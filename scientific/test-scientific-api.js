import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerScientificRoutes } from './scientific-api.js';

async function serverFor({ user = null, owner = 'user-1', charged = true, anonymousReserved = true, exempt = false, analysis = null, storage = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scientific-api-test-'));
  const priorRoot = process.env.SCIENTIFIC_WORKSPACE;
  process.env.SCIENTIFIC_WORKSPACE = directory;
  const state = { calls: 0, reads: [], charges: 0, options: null, sourceText: null };
  const app = express(); app.use(express.json());
  const supabase = { from: table => {
    state.reads.push(table);
    const chain = { select: () => chain, eq: () => chain, order: () => chain,
      single: async () => ({ data: { user_id: owner } }), limit: async () => ({ data: [] }) };
    return chain;
  } };
  registerScientificRoutes(app, {
    authenticateUser: (req, res, next) => { if (user) req.user = { id: user }; else req.anonFingerprint = 'test-fingerprint'; req.creditExempt = exempt; next(); },
    requireCredits: () => (req, res, next) => next(), supabase,
    deductCredits: async () => { state.charges++; return { success: charged }; },
    recordAnonymousUsage: async () => ({ success: anonymousReserved }), storage,
    analyze: async (query, options) => { state.calls++; state.options = options;
      if (options.context.source_files[0]?.local_path) state.sourceText = await fs.readFile(options.context.source_files[0].local_path, 'utf8');
      if (analysis) return analysis(query, options, state);
      return {
      success: true, scientificStatus: 'completed', workflowMode: options.workflowMode, runId: options.workspace.runId,
      answer: { summary: 'Executed result' }, trace: [], outputFiles: [], iterations: 1
    }; }
  });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { state, directory, url, post: async body => fetch(url + '/api/scientific-analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Calculate power', stream: false, ...body }) }),
    close: async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); if (priorRoot) process.env.SCIENTIFIC_WORKSPACE = priorRoot; else delete process.env.SCIENTIFIC_WORKSPACE; } };
}
test('foreign session is rejected before service-role history retrieval, charging, or analysis', async () => {
  const server = await serverFor({ user: 'user-1', owner: 'user-2' });
  try {
    const response = await server.post({ sessionId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(response.status, 403); assert.equal(server.state.calls, 0); assert.equal(server.state.charges, 0);
    assert.deepEqual(server.state.reads, ['chat_sessions']);
  } finally { await server.close(); }
});
test('failed atomic credit reservation cannot start a model call', async () => {
  const server = await serverFor({ user: 'user-1', charged: false });
  try { assert.equal((await server.post({})).status, 402); assert.equal(server.state.calls, 0); }
  finally { await server.close(); }
});
test('tier exemption is respected and anonymous allowance failures stop execution', async () => {
  const exempt = await serverFor({ user: 'user-1', charged: false, exempt: true });
  try { assert.equal((await exempt.post({})).status, 200); assert.equal(exempt.state.charges, 0); assert.equal(exempt.state.calls, 1); }
  finally { await exempt.close(); }
  const anon = await serverFor({ anonymousReserved: false });
  try { assert.equal((await anon.post({})).status, 403); assert.equal(anon.state.calls, 0); }
  finally { await anon.close(); }
});
test('anonymous client UUID never reads DB context; explicit client conversation and data are scoped', async () => {
  const server = await serverFor();
  try {
    const response = await server.post({ sessionId: '11111111-1111-4111-8111-111111111111', workflowMode: 'multi',
      conversationHistory: [{ role: 'user', content: 'My standardized effect is .5' }],
      dataset: { name: 'data.csv', content: Buffer.from('x\n1\n2\n').toString('base64') } });
    assert.equal(response.status, 200); assert.deepEqual(server.state.reads, []);
    assert.equal(server.state.options.workflowMode, 'multi'); assert.equal(server.state.options.conversationHistory[0].content, 'My standardized effect is .5');
    assert.equal(server.state.sourceText, 'x\n1\n2\n');
    assert.equal((await response.json()).sessionId, null);
  } finally { await server.close(); }
});

async function assertWorkspaceRemoved(state) {
  assert.ok(state.options?.workspace.directory);
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fs.access(state.options.workspace.directory); }
    catch { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Request workspace was not removed');
}

test('successful API response exports files and retains evidence before removing only its workspace', async () => {
  let exported = null;
  const storage = { bucket: () => ({ file: () => ({ save: async buffer => { exported = buffer.toString(); }, getSignedUrl: async () => ['https://outputs.example.test/result.R'] }) }) };
  const server = await serverFor({ storage, analysis: async (query, options) => {
    const filename = path.join(options.workspace.directory, 'result.R'); await fs.writeFile(filename, 'cat(42)');
    return { success: true, scientificStatus: 'completed', runId: options.workspace.runId, answer: { summary: 'Computed answer' }, trace: [], iterations: 1,
      fullCode: 'cat(42)', executionOutput: '42', results: [{ metric: 'sample_size', value: 42, unit: 'participants_total' }], outputFiles: [{ name: 'result.R', path: filename }] };
  } });
  try {
    const neighbor = path.join(server.directory, 'another-request'); await fs.mkdir(neighbor);
    const response = await server.post({}); const result = await response.json();
    assert.equal(response.status, 200); assert.equal(exported, 'cat(42)'); assert.equal(result.fullCode, 'cat(42)'); assert.equal(result.executionOutput, '42');
    assert.equal(result.outputFiles[0].download_url, 'https://outputs.example.test/result.R');
    await assertWorkspaceRemoved(server.state); await fs.access(neighbor);
  } finally { await server.close(); }
});

test('API analysis error removes its private workspace', async () => {
  const server = await serverFor({ analysis: async () => { throw new Error('Deliberate test failure'); } });
  try {
    const response = await server.post({}); assert.equal(response.status, 500); assert.match((await response.json()).error, /Deliberate test failure/);
    await assertWorkspaceRemoved(server.state);
  } finally { await server.close(); }
});

test('client abort propagates cancellation and removes its API workspace', async () => {
  let observedAbort = false;
  const server = await serverFor({ analysis: async (query, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { observedAbort = true; reject(new Error('Client disconnected')); }, { once: true });
  }) });
  const client = new AbortController();
  try {
    const response = await fetch(server.url + '/api/scientific-analysis', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'Cancel after headers', stream: true }), signal: client.signal });
    assert.equal(response.status, 200);
    for (let attempt = 0; !server.state.options && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(server.state.options); client.abort();
    await assertWorkspaceRemoved(server.state); assert.equal(observedAbort, true);
  } finally { client.abort(); await server.close(); }
});
