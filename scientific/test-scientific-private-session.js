import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import { registerScientificPrivateGuards } from './scientific-private-session.js';
import { issueAnonymousAnalysisTicket } from './scientific-access-ticket.js';

process.env.SUPABASE_URL ||= 'https://unit-test.invalid';
process.env.SUPABASE_ANON_KEY ||= 'unit-test-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';
const { authenticateUser } = await import('./auth-middleware.js');
const ownedId = '11111111-1111-4111-8111-111111111111', foreignId = '22222222-2222-4222-8222-222222222222';
const origin = 'https://power-agent.io', secret = 'unit-test-only-secret-with-no-production-permissions';
process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET = secret;

async function serverFor() {
  const state = { queries: [], privateReads: 0, memoryReads: 0, directExecutions: 0 };
  const client = { auth: { getUser: async token => token === 'verified-owner' ? { data: { user: { id: 'fixture-owner', is_anonymous: true } }, error: null } : { data: null, error: { message: 'Invalid fixture bearer' } } },
    from(table) {
      const filters = []; state.queries.push({ table, filters });
      const chain = { select: () => chain, eq: (field, value) => { filters.push({ field, value }); return chain; },
        maybeSingle: async () => ({ data: filters.some(filter => filter.field === 'session_id' && filter.value === ownedId) && filters.some(filter => filter.field === 'user_id' && filter.value === 'fixture-owner') ? { session_id: ownedId, user_id: 'fixture-owner' } : null, error: null }) };
      return chain;
    } };
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.cookies = {}; next(); });
  registerScientificPrivateGuards(app, { supabase: client, authenticateUser: (req, res, next) => authenticateUser(req, res, next, client) });
  for (const route of ['/api/session/:sessionId/traces', '/api/session/:sessionId/evaluation', '/api/session/:sessionId/info', '/api/agent-traces/:sessionId']) app.get(route, (req, res) => { state.privateReads++; res.json({ private_source: 'PRIVATE_SESSION_CONTENT_FIXTURE', owned_session: req.ownedScientificSessionId }); });
  app.post('/api/domain-expert', (req, res) => { if (req.ownedScientificSessionId) { state.memoryReads++; res.json({ private_source: 'PRIVATE_MEMORY_AND_FILES_FIXTURE', owned_session: req.ownedScientificSessionId }); } else res.json({ standalone: true }); });
  app.all('/api/test-r-direct', (req, res) => { state.directExecutions++; res.json({ executed: true }); });
  const server = app.listen(0); await new Promise(resolve => server.once('listening', resolve));
  return { state, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
test('mounted private diagnostics reject unsigned, expired-bearer and scientific-ticket identities before private queries', async () => {
  const server = await serverFor();
  try {
    const ticket = issueAnonymousAnalysisTicket(ownedId, origin, { secret }).anonymousTicket;
    for (const suffix of ['traces', 'evaluation', 'info', 'agent']) for (const headers of [{}, { authorization: 'Bearer expired-fixture' }, { origin, 'x-power-agent-anonymous-ticket': ticket }, { origin, 'x-power-agent-anonymous-ticket': 'invalid.ticket' }]) {
      const endpoint = suffix === 'agent' ? `/api/agent-traces/${ownedId}` : `/api/session/${ownedId}/${suffix}`;
      const response = await fetch(server.url + endpoint, { headers }); assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /PRIVATE_SESSION_CONTENT_FIXTURE/);
    }
    assert.equal(server.state.queries.length, 0); assert.equal(server.state.privateReads, 0);
  } finally { await server.close(); }
});
test('mounted private diagnostics deny foreign/unknown IDs and permit only the exact verified owner session', async () => {
  const server = await serverFor(); const headers = { authorization: 'Bearer verified-owner' };
  try {
    for (const endpoint of [`/api/session/${foreignId}/traces`, `/api/session/${foreignId}/evaluation`, `/api/session/${foreignId}/info`, `/api/agent-traces/${foreignId}`]) {
      const response = await fetch(server.url + endpoint, { headers }); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /PRIVATE_SESSION_CONTENT_FIXTURE/);
    }
    const before = server.state.queries.length; assert.equal((await fetch(server.url + '/api/agent-traces/latest', { headers })).status, 400); assert.equal(server.state.queries.length, before); assert.equal(server.state.privateReads, 0);
    for (const endpoint of [`/api/session/${ownedId}/traces`, `/api/session/${ownedId}/evaluation`, `/api/session/${ownedId}/info`, `/api/agent-traces/${ownedId}`]) { const response = await fetch(server.url + endpoint, { headers }); assert.equal(response.status, 200); assert.equal((await response.json()).owned_session, ownedId); }
    assert.equal(server.state.privateReads, 4); assert.ok(server.state.queries.every(query => query.table === 'chat_sessions' && query.filters.some(filter => filter.field === 'user_id' && filter.value === 'fixture-owner')));
  } finally { await server.close(); }
});
test('domain-expert supplied-session memory/file reads require ownership while standalone context remains separate', async () => {
  const server = await serverFor(); const post = (sessionId, authenticated = false) => fetch(server.url + '/api/domain-expert', { method: 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: 'Bearer verified-owner' } : {}) }, body: JSON.stringify({ query: 'Check the study.', ...(sessionId === undefined ? {} : { sessionId }) }) });
  try {
    assert.equal((await post(ownedId)).status, 401); assert.equal(server.state.queries.length, 0); assert.equal(server.state.memoryReads, 0);
    const foreign = await post(foreignId, true); assert.equal(foreign.status, 404); assert.doesNotMatch(await foreign.text(), /PRIVATE_MEMORY_AND_FILES_FIXTURE/); assert.equal(server.state.memoryReads, 0);
    assert.equal((await post('local-unverified-id', true)).status, 400); const own = await post(ownedId, true); assert.equal(own.status, 200); assert.equal((await own.json()).owned_session, ownedId); assert.equal(server.state.memoryReads, 1);
    const reads = server.state.queries.length; assert.deepEqual(await (await post(undefined)).json(), { standalone: true }); assert.equal(server.state.queries.length, reads); assert.equal(server.state.memoryReads, 1);
  } finally { await server.close(); }
});
test('the actual main server mounts the tested registrar before readers and contains no newest-session fallback', { skip: 'APP/Cloud-only source-binding gate; the standalone Public tree does not bundle the hosted monolithic main.' }, async () => {
  const source = await fs.readFile(new URL('./agent-biostat.js', import.meta.url), 'utf8');
  const registration = source.indexOf('registerScientificPrivateGuards(app, { authenticateUser, supabase });'); assert.ok(registration > 0);
  for (const marker of ["app.get('/api/session/:sessionId/traces'", "app.get('/api/agent-traces/:sessionId'", "app.get('/api/session/:sessionId/evaluation'", "app.get('/api/session/:sessionId/info'", "app.post('/api/domain-expert'", "app.post('/api/test-r-direct'"]) assert.ok(source.indexOf(marker) > registration);
  const reader = source.slice(source.indexOf("app.get('/api/agent-traces/:sessionId'"), source.indexOf("app.get('/api/session/:sessionId/evaluation'")); assert.doesNotMatch(reader, /order\('created_at'|recentSession|trying most recent/); assert.match(reader, /req\.ownedScientificSessionId/);
});
test('mounted direct-R testing route is always unavailable for anonymous, signed-ticket and authenticated requests',async()=>{
  const server=await serverFor();
  try{const ticket=issueAnonymousAnalysisTicket(ownedId,origin,{secret}).anonymousTicket;
    for(const method of ['GET','POST','PUT'])for(const headers of [{},{authorization:'Bearer verified-owner'},{origin,'x-power-agent-anonymous-ticket':ticket}]){
      const response=await fetch(server.url+'/api/test-r-direct',{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify({query:'This must never reach an executor.'})})});assert.equal(response.status,404);
    }
    assert.equal(server.state.directExecutions,0);assert.equal(server.state.queries.length,0);assert.equal(server.state.privateReads,0);
  }finally{await server.close();}
});
