import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScientificAnalysis, validateAnswerEvidence } from './scientific-harness.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { prepareScientificContext } from './scientific-api.js';

const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: 'mean difference', hypothesis: 'equal means', method: 'two_sample_t', alpha: .05, sidedness: 'two-sided', target_power: .8, allocation_ratio: 1, sample_size_unit: 'participants_per_group', parameters: [], assumptions: [], missing_information: [], clarification_questions: [], scientific_notes: [] };
const answer = { summary: '64 participants per group', method: 'two_sample_t', results: [{ metric: 'sample_size', value: 64, unit: 'participants_per_group' }], assumptions: [], limitations: [], evidence_ids: ['e1'], simulation: null, citations: [] };
const review = { verdict: 'pass', summary: 'Independent check agrees', issues: [], checked_evidence_ids: ['e1'], independent_check_evidence_ids: ['e2'], checks: [{ name: 'formula', passed: true, evidence: 'e2' }] };
const tool = (name, input) => ({ content: [{ type: 'tool_use', id: `tool-${name}-${Math.random()}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'tool_use', model: 'fixture-model' });
const fakeExecutor = { createWorkspace: async () => ({ runId: 'test-run' }), executeRCode: async () => ({ success: true, exitCode: 0, output: 'POWER_AGENT_RESULT={"results":[{"metric":"sample_size","value":64,"unit":"participants_per_group"}]}\n' }) };

test('real R process exit status is not masked and worker receives no API credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-harness-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  process.env.POWER_HARNESS_TEST_SECRET = 'do-not-copy-to-R';
  const good = await executor.executeRCode('cat("answer=",2+2,"\\n"); stopifnot(Sys.getenv("POWER_HARNESS_TEST_SECRET") == "")');
  assert.equal(good.success, true); assert.match(good.output, /answer= 4/);
  const bad = await executor.executeRCode('cat("partial output\\n"); stop("deliberate failure")');
  assert.equal(bad.success, false); assert.notEqual(bad.exitCode, 0); assert.match(bad.stderr, /deliberate failure/);
  delete process.env.POWER_HARNESS_TEST_SECRET;
  await fs.rm(root, { recursive: true, force: true });
});
test('fresh R executions do not reuse cached objects from another script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-harness-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const workspace = await executor.createWorkspace();
  assert.equal((await executor.executeRCode('private_cached_answer <- 999', { workspace })).success, true);
  const second = await executor.executeRCode('stopifnot(!exists("private_cached_answer"))', { workspace });
  assert.equal(second.success, true); await fs.rm(root, { recursive: true, force: true });
});
test('numerical answer cannot cite absent, failed, or mismatched output', () => {
  assert.ok(validateAnswerEvidence(answer, [], plan).length);
  const evidence = { id: 'e1', role: 'coder', success: true, computed: { results: answer.results } };
  assert.deepEqual(validateAnswerEvidence(answer, [evidence], plan), []);
  assert.ok(validateAnswerEvidence({ ...answer, results: [{ ...answer.results[0], value: 65 }] }, [evidence], plan).length);
  assert.ok(validateAnswerEvidence(answer, [{ ...evidence, success: false }], plan).length);
});
test('multi workflow has separate reviewer context and actual independent execution', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'coder-code', purpose: 'main calculation' }), tool('submit_answer', answer), tool('execute_r', { code: 'review-code', purpose: 'independent check' }), tool('submit_review', review)];
  const calls = [];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, transport: async request => { calls.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(result.executions.length, 2);
  assert.equal(calls[3].messages.length, 1); assert.match(calls[3].system, /fresh conversation/);
  assert.deepEqual(result.executions.map(e => e.role), ['coder', 'reviewer']);
  assert.equal(result.trace.filter(t => t.type === 'model_call').length, 5);
});
test('reviewer cannot grant pass without independent evidence; budget exhaustion is failure', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'code', purpose: 'calculation' }), tool('submit_answer', answer), tool('submit_review', { ...review, independent_check_evidence_ids: [] })];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, maxModelCalls: 4, transport: async () => queue.shift() });
  assert.equal(result.scientificStatus, 'budget_exhausted'); assert.equal(result.success, false);
});
test('a failed review is not promoted to success after the repair budget', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'code', purpose: 'calculation' }), tool('submit_answer', answer), tool('submit_review', { ...review, verdict: 'revise', independent_check_evidence_ids: [], issues: [{ severity: 'major', description: 'wrong test', correction: 'correct test' }], checks: [] })];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, maxRepairs: 0, transport: async () => queue.shift() });
  assert.equal(result.scientificStatus, 'review_failed'); assert.equal(result.success, false);
});
test('underspecified request asks for clarification and runs no code', async () => {
  const unresolved = { ...plan, ready: false, missing_information: ['effect size'], clarification_questions: ['What effect size should be detected?'] };
  const result = await runScientificAnalysis('How many people do I need?', { executor: { executeRCode: () => { throw new Error('must not execute'); } }, transport: async () => tool('submit_design', unresolved) });
  assert.equal(result.scientificStatus, 'needs_clarification'); assert.equal(result.executions.length, 0);
});
test('uploaded data are available in a scoped path; arbitrary storage URLs are rejected', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'power-source-test-'));
  const context = await prepareScientificContext({ dataset: { name: '../../data.csv', content: Buffer.from('x,y\n1,2\n').toString('base64') } }, { directory });
  assert.equal(await fs.readFile(context.source_files[0].local_path, 'utf8'), 'x,y\n1,2\n');
  assert.equal(path.dirname(context.source_files[0].local_path), directory);
  const prior = process.env.SUPABASE_URL; process.env.SUPABASE_URL = 'https://known.supabase.co';
  await assert.rejects(() => prepareScientificContext({ sessionFiles: [{ name: 'x.csv', download_url: 'https://outside.example/private' }] }, { directory }, { supabase: {} }), /outside configured/);
  if (prior) process.env.SUPABASE_URL = prior; else delete process.env.SUPABASE_URL;
  await fs.rm(directory, { recursive: true, force: true });
});
