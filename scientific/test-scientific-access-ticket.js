import test from 'node:test';
import assert from 'node:assert/strict';
import { issueAnonymousAnalysisTicket, verifyAnonymousAnalysisTicket, getAnonymousScientificOrigins } from './scientific-access-ticket.js';

const fingerprint = '11111111-1111-4111-8111-111111111111';
const origin = 'https://power-agent.io';
const secret = 'unit-test-only-secret-with-no-production-permissions';
const now = 1800000000000;
const options = { secret, now };
test('anonymous ticket transports exactly the existing fingerprint within five minutes', () => {
  const result = issueAnonymousAnalysisTicket(fingerprint, origin, options);
  assert.equal(verifyAnonymousAnalysisTicket(result.anonymousTicket, origin, { secret, now: now + 299000 }), fingerprint);
  assert.equal(Date.parse(result.expiresAt) - now, 300000);
});
test('ticket rejects tampering, expiration, future issuance, wrong signing key and wrong origin', () => {
  const { anonymousTicket } = issueAnonymousAnalysisTicket(fingerprint, origin, options);
  const [payload, signature] = anonymousTicket.split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), fingerprint: '22222222-2222-4222-8222-222222222222' })).toString('base64url');
  assert.throws(() => verifyAnonymousAnalysisTicket(changed + '.' + signature, origin, options));
  assert.throws(() => verifyAnonymousAnalysisTicket(anonymousTicket, origin, { secret, now: now + 300000 }));
  assert.throws(() => verifyAnonymousAnalysisTicket(anonymousTicket, origin, { secret, now: now - 10000 }));
  assert.throws(() => verifyAnonymousAnalysisTicket(anonymousTicket, origin, { secret: secret + '-other', now }));
  assert.throws(() => verifyAnonymousAnalysisTicket(anonymousTicket, 'https://www.power-agent.io', options));
  assert.throws(() => verifyAnonymousAnalysisTicket(anonymousTicket, 'https://other.invalid', options));
  assert.throws(() => issueAnonymousAnalysisTicket(fingerprint, origin, { secret: 'short', now }));
});
test('one exact configured HTTPS preview origin is signed and all other origins remain rejected',()=>{
  const preview='https://candidate-preview.vercel.app',configured={...options,additionalOrigins:preview};
  const ticket=issueAnonymousAnalysisTicket(fingerprint,preview,configured).anonymousTicket;
  assert.equal(verifyAnonymousAnalysisTicket(ticket,preview,configured),fingerprint);
  assert.throws(()=>issueAnonymousAnalysisTicket(fingerprint,preview,{...options,additionalOrigins:''}));
  assert.throws(()=>verifyAnonymousAnalysisTicket(ticket,preview,{...options,additionalOrigins:''}));
  assert.throws(()=>verifyAnonymousAnalysisTicket(ticket,'https://other-preview.vercel.app',configured));
  assert.throws(()=>verifyAnonymousAnalysisTicket(ticket,origin,configured));
  for(const invalid of ['https://*.vercel.app','http://candidate-preview.vercel.app','https://candidate-preview.vercel.app/path','https://user:password@candidate-preview.vercel.app','https://candidate-preview.vercel.app?query=1','https://candidate-preview.vercel.app#fragment']){
    assert.deepEqual(getAnonymousScientificOrigins(invalid),getAnonymousScientificOrigins(''));assert.throws(()=>issueAnonymousAnalysisTicket(fingerprint,preview,{...options,additionalOrigins:invalid}));
  }
  assert.deepEqual(getAnonymousScientificOrigins(Array.from({length:9},(_,i)=>`https://candidate-${i}.vercel.app`).join(',')),getAnonymousScientificOrigins(''));
});

process.env.SUPABASE_URL ||= 'https://unit-test.invalid';
process.env.SUPABASE_ANON_KEY ||= 'unit-test-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';
const { authenticateUser } = await import('./auth-middleware.js');
process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET = secret;
function requestWith(ticket, path = '/api/analyze-biostat') {
  return { path, headers: { origin, ...(ticket === undefined ? {} : { 'x-power-agent-anonymous-ticket': ticket }) }, cookies: { anon_fp: fingerprint } };
}
function responseFixture() {
  const state = { status: null, body: null, cookies: 0 };
  return { state, cookie() { state.cookies++; }, status(value) { state.status = value; return this; }, json(value) { state.body = value; return this; } };
}
test('direct transport uses the signed existing identity and creates no replacement cookie', () => {
  const { anonymousTicket } = issueAnonymousAnalysisTicket(fingerprint, origin, { secret });
  const req = requestWith(anonymousTicket); req.cookies = {};
  const res = responseFixture(); let next = 0;
  authenticateUser(req, res, () => next++);
  assert.equal(next, 1); assert.equal(req.anonFingerprint, fingerprint); assert.equal(res.state.cookies, 0);
});
test('scientific file preparation accepts the same signed identity without granting unrelated route access',()=>{
  const {anonymousTicket}=issueAnonymousAnalysisTicket(fingerprint,origin,{secret});const req=requestWith(anonymousTicket,'/api/analyze-file');const res=responseFixture();let next=0;
  authenticateUser(req,res,()=>next++);assert.equal(next,1);assert.equal(req.anonFingerprint,fingerprint);assert.equal(res.state.cookies,0);
});
test('invalid or out-of-scope ticket never falls back to a fresh anonymous allowance', () => {
  const { anonymousTicket } = issueAnonymousAnalysisTicket(fingerprint, origin, { secret });
  for (const req of [requestWith('bad.ticket'), requestWith(anonymousTicket, '/api/anonymous-status')]) {
    const res = responseFixture(); let next = 0;
    authenticateUser(req, res, () => next++);
    assert.equal(next, 0); assert.equal(res.state.status, 401); assert.equal(res.state.cookies, 0);
    assert.equal(req.anonFingerprint, undefined);
  }
});
test('existing same-origin cookie behavior remains compatible without a ticket', () => {
  const req = requestWith(undefined); const res = responseFixture(); let next = 0;
  authenticateUser(req, res, () => next++);
  assert.equal(next, 1); assert.equal(req.anonFingerprint, fingerprint); assert.equal(res.state.cookies, 0);
});

test('invalid optional bearer falls through to guest identity without granting private history access', async () => {
  const req = requestWith(undefined); req.headers.authorization = 'Bearer expired-test-token';
  const res = responseFixture();
  await new Promise(resolve => authenticateUser(req, res, resolve, { auth: { getUser: async () => ({ data: null, error: { message: 'Expired' } }) } }));
  assert.equal(req.user, undefined); assert.equal(req.authToken, undefined); assert.equal(req.anonFingerprint, fingerprint);
});
test('verified optional bearer retains its owner identity without creating a guest identity', async () => {
  const req = requestWith(undefined); req.headers.authorization = 'Bearer valid-test-token';
  const res = responseFixture();
  await new Promise(resolve => authenticateUser(req, res, resolve, { auth: { getUser: async () => ({ data: { user: { id: 'verified-owner', email: 'fixture@example.invalid' } }, error: null }) } }));
  assert.equal(req.user.id, 'verified-owner'); assert.equal(req.authToken, 'valid-test-token'); assert.equal(req.anonFingerprint, undefined);
});
