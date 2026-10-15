import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph } from 'docx';
import { registerScientificRoutes } from './scientific-api.js';
import { getScientificAccessPolicy } from './scientific-public-access.js';

async function serverFor({ user = null, owner = 'user-1', charged = true, anonymousReserved = true, exempt = false, analysis = null, storage = null,
  sessionLookup = null, creditReservation = null, anonymousReservation = null, parseFile = null, correctDocument = null,
  accessMode = 'credits', accessPolicy = null, creditGateBlocked = false, datasetBucket = null } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scientific-api-test-'));
  const priorRoot = process.env.SCIENTIFIC_WORKSPACE;
  process.env.SCIENTIFIC_WORKSPACE = directory;
  const state = { calls: 0, reads: [], charges: 0, anonymousReservations: 0, creditChecks: 0, statuses: [], options: null, sourceText: null };
  const app = express(); app.use(express.json());
  let markClosed;
  const responseClosed = new Promise(resolve => { markClosed = resolve; });
  app.use((req, res, next) => { res.once('close', markClosed); next(); });
  const supabase = { from: table => {
    state.reads.push(table);
    const chain = { select: () => chain, eq: () => chain, order: () => chain,
      single: async () => { if (sessionLookup) await sessionLookup(); return { data: { user_id: owner } }; }, limit: async () => ({ data: [] }) };
    return chain;
  } };
  registerScientificRoutes(app, {
    authenticateUser: (req, res, next) => { if (user) req.user = { id: user }; else req.anonFingerprint = '11111111-1111-4111-8111-111111111111'; req.creditExempt = exempt; next(); },
    requireCredits: () => (req, res, next) => { state.creditChecks++; if (creditGateBlocked) return res.status(402).json({ error: 'insufficient_credits' }); next(); }, supabase,
    scientificAccessPolicy: accessPolicy || getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: accessMode }),
    deductCredits: async () => { state.charges++; if (creditReservation) await creditReservation(); return { success: charged }; },
    recordAnonymousUsage: async () => { state.anonymousReservations++; if (anonymousReservation) await anonymousReservation(); return { success: anonymousReserved }; }, storage, parseFile, datasetBucket, correctDocument,
    updateSessionStatus: async (sessionId, status, metadata) => { state.statuses.push({ sessionId, status, metadata }); },
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
  return { state, directory, url, responseClosed, post: async body => fetch(url + '/api/scientific-analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Calculate power', stream: false, ...body }) }),
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

test('production capacity is server-owned and ignores client attempts to replace its limits', async () => {
  const server = await serverFor();
  try {
    assert.equal((await server.post({ workflowMode: 'multi', maxModelCalls: 999999, maxExecutions: 999999, deadlineMs: 1,
      budgetProfile: { id: 'client-overwrite', solverMaxCalls: 1 } })).status, 200);
    assert.equal(server.state.options.maxModelCalls, 64); assert.equal(server.state.options.maxExecutions, 32);
    assert.equal(server.state.options.deadlineMs, 1200000); assert.equal(server.state.options.maxRExecutionMs, 300000);
    assert.equal(server.state.options.budgetProfile.id, 'hosted-research-v1');
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
  const storage = { bucket: () => ({ file: name => ({ save: async buffer => { if (name.endsWith('/result.R')) exported = buffer.toString(); }, getSignedUrl: async () => ['https://outputs.example.test/result.R'] }) }) };
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

function delayedOperation() {
  let announce, release;
  const started = new Promise(resolve => { announce = resolve; });
  const released = new Promise(resolve => { release = resolve; });
  return { started, release, wait: async () => { announce(); await released; } };
}

async function abortDuringOperation(server, delay, body = {}) {
  const client = new AbortController();
  const pending = fetch(server.url + '/api/scientific-analysis', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Cancel during authorization', stream: false, ...body }), signal: client.signal });
  try {
    await delay.started;
    client.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    await server.responseClosed;
    delay.release();
    await new Promise(resolve => setTimeout(resolve, 100));
  } finally { client.abort(); delay.release(); }
}

test('abort during session ownership lookup does not charge or start an analysis', async () => {
  const delay = delayedOperation();
  const server = await serverFor({ user: 'user-1', sessionLookup: delay.wait });
  try {
    await abortDuringOperation(server, delay, { sessionId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(server.state.charges, 0);
    assert.equal(server.state.calls, 0);
    assert.equal(server.state.options, null);
    assert.deepEqual(await fs.readdir(server.directory), []);
  } finally { delay.release(); await server.close(); }
});

test('abort during an in-flight atomic credit reservation never starts analysis after reservation finishes', async () => {
  const delay = delayedOperation();
  const server = await serverFor({ user: 'user-1', creditReservation: delay.wait });
  try {
    await abortDuringOperation(server, delay);
    assert.equal(server.state.charges, 1);
    assert.equal(server.state.calls, 0);
    assert.equal(server.state.options, null);
    assert.deepEqual(await fs.readdir(server.directory), []);
  } finally { delay.release(); await server.close(); }
});

test('abort during an in-flight anonymous reservation never reserves twice or starts analysis', async () => {
  const delay = delayedOperation();
  const server = await serverFor({ anonymousReservation: delay.wait });
  try {
    await abortDuringOperation(server, delay);
    assert.equal(server.state.anonymousReservations, 1);
    assert.equal(server.state.calls, 0);
    assert.equal(server.state.options, null);
    assert.deepEqual(await fs.readdir(server.directory), []);
  } finally { delay.release(); await server.close(); }
});

test('abort while preparing a source clears running status and removes the workspace without analysis', async () => {
  const delay = delayedOperation();
  const server = await serverFor({ user: 'user-1', parseFile: async () => { await delay.wait(); return { text: 'Local fixture source' }; } });
  try {
    await abortDuringOperation(server, delay, { sessionId: '11111111-1111-4111-8111-111111111111',
      dataset: { name: 'fixture.pdf', content: Buffer.from('Local file fixture').toString('base64') } });
    assert.equal(server.state.charges, 1);
    assert.equal(server.state.calls, 0);
    assert.equal(server.state.options, null);
    assert.deepEqual(server.state.statuses.map(entry => entry.status), ['running', 'error']);
    assert.equal(server.state.statuses.at(-1).metadata.current_step, 'Cancelled by client');
    assert.equal(server.state.statuses.at(-1).metadata.successful_completion, false);
    assert.deepEqual(await fs.readdir(server.directory), []);
  } finally { delay.release(); await server.close(); }
});

test('normal response close does not downgrade a finalized completed session to cancellation', async () => {
  const server = await serverFor({ user: 'user-1' });
  try {
    const response = await server.post({ sessionId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).scientificStatus, 'completed');
    await server.responseClosed;
    await assertWorkspaceRemoved(server.state);
    assert.equal(server.state.charges, 1);
    assert.equal(server.state.calls, 1);
    assert.deepEqual(server.state.statuses.map(entry => entry.status), ['running', 'completed']);
  } finally { await server.close(); }
});

test('public scientific access starts a guest analysis without an anonymous allowance or credit lookup', async () => {
  const server = await serverFor({ accessMode: 'public', creditGateBlocked: true, anonymousReserved: false });
  try {
    const response = await server.post({});
    assert.equal(response.status, 200); assert.equal((await response.json()).accessMode, 'public');
    assert.equal(server.state.calls, 1); assert.equal(server.state.creditChecks, 0);
    assert.equal(server.state.charges, 0); assert.equal(server.state.anonymousReservations, 0);
    assert.deepEqual(server.state.reads, []);
  } finally { await server.close(); }
});

test('public scientific access preserves logged-in ownership and does not invoke a missing credit RPC', async () => {
  const server = await serverFor({ accessMode: 'public', user: 'user-1', charged: false, creditGateBlocked: true });
  try {
    const response = await server.post({ sessionId: '11111111-1111-4111-8111-111111111111' });
    assert.equal(response.status, 200); assert.equal(server.state.calls, 1);
    assert.equal(server.state.creditChecks, 0); assert.equal(server.state.charges, 0);
    assert.deepEqual(server.state.reads, ['chat_sessions', 'messages']);
  } finally { await server.close(); }
  const foreign = await serverFor({ accessMode: 'public', user: 'user-1', owner: 'user-2' });
  try {
    assert.equal((await foreign.post({ sessionId: '11111111-1111-4111-8111-111111111111' })).status, 403);
    assert.equal(foreign.state.calls, 0); assert.equal(foreign.state.charges, 0);
    assert.deepEqual(foreign.state.reads, ['chat_sessions']);
  } finally { await foreign.close(); }
});

test('public ticket handshake is noncharging and advertises the server access mode', async () => {
  const priorSecret = process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET;
  process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET = 'unit-test-only-public-transport-secret-no-production-permissions';
  const server = await serverFor({ accessMode: 'public', creditGateBlocked: true, anonymousReserved: false });
  try {
    const response = await fetch(server.url + '/api/scientific-analysis-ticket', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://power-agent.io' }, body: '{}' });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.accessMode, 'public'); assert.equal(body.creditRequired, false);
    assert.ok(body.anonymousTicket); assert.equal(server.state.calls, 0); assert.equal(server.state.charges, 0);
    assert.equal(server.state.creditChecks, 0); assert.equal(server.state.anonymousReservations, 0);
  } finally { await server.close(); if (priorSecret) process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET = priorSecret; else delete process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET; }
  const authenticated = await serverFor({ accessMode: 'public', user: 'user-1', creditGateBlocked: true });
  try {
    const response = await fetch(authenticated.url + '/api/scientific-analysis-ticket', { method: 'POST' });
    assert.deepEqual(await response.json(), { authenticated: true, accessMode: 'public', creditRequired: false });
    assert.equal(authenticated.state.calls, 0); assert.equal(authenticated.state.creditChecks, 0);
  } finally { await authenticated.close(); }
});

test('public HTTP 429 rejects overlapping analyses before model calls and releases capacity after completion', async () => {
  const delay = delayedOperation();
  const server = await serverFor({ accessMode: 'public', analysis: async (query, options) => {
    await delay.wait();
    return { success: true, scientificStatus: 'completed', answer: { summary: 'Done' }, trace: [], outputFiles: [], iterations: 1 };
  } });
  try {
    const first = server.post({}); await delay.started;
    const denied = await server.post({}); const body = await denied.json();
    assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '30'); assert.equal(body.error, 'capacity_busy');
    assert.equal(server.state.calls, 1); assert.equal(server.state.charges, 0); assert.equal(server.state.anonymousReservations, 0);
    delay.release(); assert.equal((await first).status, 200);
    const next = await server.post({}); assert.equal(next.status, 200); assert.equal(server.state.calls, 2);
  } finally { delay.release(); await server.close(); }
});

test('public rate-limit rejection and malformed queries do not start or reserve another analysis', async () => {
  const policy = getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public', POWER_AGENT_PUBLIC_REQUESTS_PER_IP: 1 });
  const server = await serverFor({ accessPolicy: policy });
  try {
    assert.equal((await server.post({ query: '' })).status, 400);
    assert.equal((await server.post({})).status, 200);
    const limited = await server.post({}); assert.equal(limited.status, 429); assert.equal((await limited.json()).error, 'rate_limit');
    assert.equal(server.state.calls, 1); assert.equal(server.state.creditChecks, 0); assert.equal(server.state.charges, 0);
  } finally { await server.close(); }
});

test('public client cancellation releases admission after analysis cancellation and removes its workspace', async () => {
  let announce;
  const started = new Promise(resolve => { announce = resolve; });
  const server = await serverFor({ accessMode: 'public', analysis: async (query, options, state) => {
    if (state.calls === 1) return new Promise((resolve, reject) => { announce(); options.signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true }); });
    return { success: true, scientificStatus: 'completed', answer: { summary: 'Done' }, trace: [], outputFiles: [], iterations: 1 };
  } });
  const client = new AbortController();
  try {
    const pending = fetch(server.url + '/api/scientific-analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Cancel this analysis', stream: false }), signal: client.signal });
    await started; client.abort(); await assert.rejects(pending, error => error.name === 'AbortError');
    await assertWorkspaceRemoved(server.state);
    assert.equal((await server.post({})).status, 200); assert.equal(server.state.calls, 2);
  } finally { client.abort(); await server.close(); }
});

test('server-side stored files require an owned session even in public access mode', async () => {
  let downloads = 0;
  const datasetBucket = { file: () => ({ download: async () => { downloads++; return [Buffer.from('x\n1\n')]; } }) };
  const guest = await serverFor({ accessMode: 'public', datasetBucket });
  try {
    const response = await guest.post({ dataset: { name: 'data.csv', gcsPath: 'user-uploads/11111111-1111-4111-8111-111111111111/data.csv' } });
    assert.equal(response.status, 403); assert.match((await response.json()).error, /does not belong/);
    assert.equal(downloads, 0); assert.equal(guest.state.calls, 0);
  } finally { await guest.close(); }
  const owned = await serverFor({ accessMode: 'public', user: 'user-1', datasetBucket });
  try {
    assert.equal((await owned.post({ sessionId: '11111111-1111-4111-8111-111111111111', dataset: { name: 'data.csv', gcsPath: 'user-uploads/11111111-1111-4111-8111-111111111111/data.csv' } })).status, 200);
    assert.equal(downloads, 1); assert.equal(owned.state.calls, 1);
    const denied = await owned.post({ sessionId: '11111111-1111-4111-8111-111111111111', dataset: { name: 'data.csv', gcsPath: 'user-uploads/22222222-2222-4222-8222-222222222222/data.csv' } });
    assert.equal(denied.status, 403); assert.equal(downloads, 1); assert.equal(owned.state.calls, 1);
  } finally { await owned.close(); }
});

test('supplied document text remains usable for guests without fetching its remote storage object', async () => {
  let downloads = 0;
  const datasetBucket = { file: () => ({ download: async () => { downloads++; return [Buffer.from('unused')]; } }) };
  const server = await serverFor({ accessMode: 'public', datasetBucket });
  try {
    const response = await server.post({ sessionFiles: [{ name: 'protocol.pdf', full_content: 'Protocol supplied by this request',
      gcsPath: 'user-uploads/11111111-1111-4111-8111-111111111111/protocol.pdf' }] });
    assert.equal(response.status, 200); assert.equal(downloads, 0);
    assert.equal(server.state.options.context.source_files[0].text, 'Protocol supplied by this request');
  } finally { await server.close(); }
});

test('public SSE exports actual document proposal bytes and hides provider thinking without altering the internal trace',async()=>{
  const original=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Original protocol has an editable statistical passage. Please preserve all original bytes.')]}]}));
  const proposed=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Proposed protocol revision for author review.')]}]}));
  const internalTrace=[{type:'model_content',role:'coder',text:'PRIVATE_PROVIDER_CONTENT_FIXTURE'},{type:'model_call',role:'coder',model:'fixture-not-provider'}];let revisionCalls=0;
  const server=await serverFor({accessMode:'public',parseFile:async()=>({text:'Original protocol has an editable statistical passage. Please preserve all original bytes.',metadata:{parsedAs:'controlled-fixture'}}),
    correctDocument:async options=>{revisionCalls++;assert.deepEqual(options.originalBuffer,original);return{success:true,correctedBuffer:proposed,format:'docx',correctedFileName:'protocol_proposed-revision.docx',corrections:[{find:'Original protocol',replace:'Proposed protocol',reason:'Fixture proposal'}],model_receipt:{actual_model:'test-stub-not-provider'}};},
    analysis:async(query,options)=>{await options.onEvent(internalTrace[0]);return{success:true,scientificStatus:'completed',runId:options.workspace.runId,answer:{summary:'Controlled accepted-record fixture.'},trace:internalTrace,outputFiles:[],iterations:1};}});
  try{
    const response=await server.post({stream:true,workflowMode:'multi',dataset:{name:'protocol.docx',content:original.toString('base64')}});const body=await response.text();
    assert.equal(response.status,200);assert.equal(revisionCalls,1);assert.doesNotMatch(body,/PRIVATE_PROVIDER_CONTENT_FIXTURE/);
    const events=body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));const complete=events.find(event=>event.step==='complete');
    assert.equal(complete.documentCorrections[0].status,'proposal_generated');assert.equal(complete.documentProcessing.budget.max_documents,2);assert.equal(complete.documentRevisionFiles[0].source_kind,'document_revision');
    assert.deepEqual(Buffer.from(complete.documentRevisionFiles[0].content_base64,'base64'),proposed);assert.equal(complete.documentRevisionFiles[0].original_source_sha256,createHash('sha256').update(original).digest('hex'));
    assert.ok(events.find(event=>event.step==='outputs').files.some(file=>file.source_kind==='document_revision'&&file.content_base64));assert.ok(events.some(event=>event.step==='document_correction'&&event.status==='completed'));
    assert.equal(internalTrace[0].type,'model_content');assert.equal(internalTrace.length,2);assert.equal(complete.trace.some(event=>event.type==='model_content'),false);
  }finally{await server.close();}
});

test('original biostat SSE entry defaults to real multi contract with actual R/output/report transport',async()=>{
  const code='x<-c(2,5);cat(jsonlite::toJSON(list(results=list(list(metric="observed mean",value=mean(x),unit="units"))),auto_unbox=TRUE),"\\n");png("observed.png",width=480,height=360);plot(x);dev.off()';
  const server=await serverFor({accessMode:'public',analysis:async(query,options)=>{
    assert.equal(options.workflowMode,'multi');await options.onEvent({type:'design',role:'planner',plan:{ready:true,method:'Controlled descriptive-mean interface fixture',assumptions:['Two specified observations.']}});
    await options.onEvent({type:'code',role:'coder',evidence_id:'actual-fixture-execution',code,message:'Controlled real R execution'});
    const execution=await options.executor.executeRCode(code,{workspace:options.workspace,executionId:'actual-fixture-execution'});assert.equal(execution.success,true,execution.stderr);
    await options.onEvent({type:'execution',role:'coder',evidence_id:'actual-fixture-execution',success:execution.success,output:execution.output,error:execution.stderr,exitCode:execution.exitCode,output_files:execution.output_files});
    return{success:true,scientificStatus:'completed',workflowMode:options.workflowMode,runId:options.workspace.runId,answer:{summary:'Controlled interface fixture: the R-computed mean is3.5.',method:'Mean of two supplied values.',results:[{metric:'observed mean',value:3.5,unit:'units'}],assumptions:['Controlled fixture; no provider or scientific review called.'],limitations:['Transport test only.']},trace:[],outputFiles:execution.output_files,iterations:0,fullCode:code,executionOutput:execution.output};
  }});
  try{
    const response=await fetch(server.url+'/api/analyze-biostat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'Run the controlled interface fixture.'})});const events=(await response.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
    assert.equal(response.status,200);assert.equal(server.state.options.workflowMode,'multi');assert.match(events.find(event=>event.step==='planning').output,/descriptive-mean/);assert.equal(events.find(event=>event.step==='execution').images.length,1);
    const insights=events.find(event=>event.step==='insights');assert.equal(insights.fullCode,code);assert.match(insights.executionOutput,/3.5/);assert.match(insights.content,/Computed results/);
    const conclusion=events.find(event=>event.step==='chatbot_conclusion_complete'),outputs=events.find(event=>event.step==='outputs');assert.deepEqual(conclusion.files,outputs.files);assert.ok(outputs.files.some(file=>file.type==='pdf'));assert.ok(outputs.files.every(file=>/^data:/.test(file.download_url)&&file.sha256));assert.ok(outputs.files.find(file=>file.type==='md').content.includes('3.5'));
    assert.equal(events.find(event=>event.step==='scientific_result').workflowMode,'multi');assert.equal(events.filter(event=>event.step==='complete').length,1);
  }finally{await server.close();}
});
test('original biostat SSE never celebrates failed review or clarification and preserves explicit research single',async()=>{
  for(const scientificStatus of ['review_failed','needs_clarification']){
    const server=await serverFor({accessMode:'public',analysis:async(query,options)=>({success:false,scientificStatus,workflowMode:options.workflowMode,runId:options.workspace.runId,answer:{summary:'Unresolved fixture input or review.'},error:'Fixture unresolved issue',trace:[],outputFiles:[],iterations:0})});
    try{const response=await fetch(server.url+'/api/analyze-biostat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'Check unresolved fixture.'})});const body=await response.text(),events=body.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));assert.equal(events.some(event=>event.step==='complete'||event.step==='insights'),false);assert.equal(events.find(event=>event.step==='scientific_result').scientificStatus,scientificStatus);assert.ok(events.some(event=>event.step===(scientificStatus==='needs_clarification'?'needs_info':'error')));}
    finally{await server.close();}
  }
  const research=await serverFor({accessMode:'public'});try{await research.post({workflowMode:'single'});assert.equal(research.state.options.workflowMode,'single');}finally{await research.close();}
});


test('hosted source revision runs after accepted science and before reports with actual file receipts', async () => {
  const original = await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Source claim: 20 participants.')]}]}));
  const proposed = await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Controlled source-anchored proposal.')]}]}));
  let server, edits=0;
  server = await serverFor({parseFile:async()=>({text:'Source claim: 20 participants.'}),correctDocument:async options=>{
    edits++; assert.match(options.analysisReport,/Accepted computed finding/); assert.deepEqual(options.originalBuffer,original);
    await assert.rejects(fs.access(path.join(server.state.options.workspace.directory,'analysis-report.html')));
    return {success:true,correctedBuffer:proposed,correctedFileName:'protocol_proposed.docx',format:'docx',corrections:[{find:'20',replace:'computed value',reason:'Controlled fixture'}],model_receipt:{actual_model:'fixture-not-provider'}};
  },analysis:async(query,options)=>{
    assert.equal(options.context.document_revision_support,'post_scientific_acceptance');
    return {success:true,scientificStatus:'completed',workflowMode:options.workflowMode,runId:options.workspace.runId,answer:{summary:'Accepted computed finding; no R DOCX was captured.'},trace:[],outputFiles:[],iterations:1};
  }});
  try { const response=await server.post({query:'Provide a revised DOCX protocol.',dataset:{name:'protocol.docx',content:original.toString('base64')}});const record=await response.json();
    assert.equal(edits,1);assert.equal(record.scientificSuccess,true);assert.equal(record.success,true);assert.equal(record.documentDelivery.status,'proposal_delivered');
    const file=record.documentRevisionFiles[0];assert.equal(file.sha256,createHash('sha256').update(proposed).digest('hex'));
    const html=Buffer.from(record.reportFiles.find(f=>f.type==='html').content_base64,'base64').toString();assert.ok(html.includes(file.name));assert.ok(html.includes(file.original_source_sha256));assert.ok(html.includes('no R DOCX was captured'));assert.ok(html.includes('post-processing'));
  } finally {await server.close();}
});
test('required proposal failure exposes partial delivery while preserving accepted numerical status', async()=>{
  const original=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Source protocol.')]}]}));
  const server=await serverFor({parseFile:async()=>({text:'Source protocol.'}),correctDocument:async()=>({success:false,reason:'Controlled source anchor failure',corrections:[]})});
  try {const record=await(await server.post({query:'Provide a revised DOCX document.',dataset:{name:'protocol.docx',content:original.toString('base64')}})).json();assert.equal(record.scientificSuccess,true);assert.equal(record.scientificStatus,'completed');assert.equal(record.success,false);assert.equal(record.productStatus,'partial_delivery');assert.equal(record.documentDelivery.complete,false);assert.equal(record.documentRevisionFiles.length,0);}finally{await server.close();}
});
