import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveModelRoles, modelRequestSettings, getModelPolicy } from './model-config.js';
import { runScientificAnalysis, classifyScientificRequest } from './scientific-harness.js';

const tool = (name, input, model) => ({ content: [{ type: 'thinking', thinking: '', signature: `fixture-signature-${name}` }, { type: 'tool_use', id: `tool-${name}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'tool_use', model });
const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: 'fixture estimand', hypothesis: 'fixture hypothesis', method: 'fixture_method', alpha: .05, sidedness: 'two-sided', target_power: .8, allocation_ratio: 1, sample_size_unit: 'participants_total', parameters: [], assumptions: [], missing_information: [], clarification_questions: [], scientific_notes: [] };
const answer = { summary: 'Fixture calculation only', method: 'fixture_method', results: [{ metric: 'fixture_count', value: 4, unit: 'participants_total' }], assumptions: [], limitations: [], evidence_ids: ['e1'], simulation: null, citations: [] };
const review = { verdict: 'pass', summary: 'Fixture check only', issues: [], checked_evidence_ids: ['e1'], independent_check_evidence_ids: ['e2'], checks: [{ name: 'fixture_check', passed: true, evidence: 'e2' }] };
const classifier = { request_category: 'sample_size', requested_outputs: ['figure', 'table'], needs_source_retrieval: true };
const executor = { createWorkspace: async () => ({ runId: 'model-policy-fixture' }), executeRCode: async () => ({ success: true, exitCode: 0, output: 'POWER_AGENT_RESULT=' + JSON.stringify({ results: answer.results }) }) };

test('default role policy keeps scientific design, implementation and review on Sonnet, routing on Haiku', () => {
  assert.deepEqual(resolveModelRoles({}, {}), { router: 'claude-haiku-5-5', planner: 'claude-sonnet-5-5', coder: 'claude-sonnet-5-5', reviewer: 'claude-sonnet-5-5' });
  const settings = modelRequestSettings('claude-sonnet-5-5', 'coder');
  assert.equal(settings.max_tokens, 16000); assert.equal(settings.output_config.effort, 'high'); assert.equal(settings.supports_forced_tools, false);
  assert.equal(modelRequestSettings('claude-haiku-5-5', 'router').max_tokens, 2048);
  assert.equal(modelRequestSettings('claude-haiku-5-5', 'router').output_config.effort, 'low');
});

test('explicit model overrides preserve old scientific roles and skip routing; explicit role overrides take precedence', () => {
  const environment = { POWER_AGENT_MODEL: 'cloud-default', POWER_AGENT_REVIEWER_MODEL: 'cloud-reviewer', POWER_AGENT_ROUTER_MODEL: 'cloud-router' };
  const options = { model: 'claude-haiku-4-5-20251001' };
  assert.deepEqual(resolveModelRoles(options, environment), Object.fromEntries(['router', 'planner', 'coder', 'reviewer'].map(role => [role, options.model])));
  assert.equal(getModelPolicy(options, environment).routing_enabled, false);
  assert.equal(resolveModelRoles({ ...options, roleModels: { reviewer: 'explicit-reviewer' } }, environment).reviewer, 'explicit-reviewer');
  assert.equal(resolveModelRoles({}, environment).reviewer, 'cloud-reviewer');
  assert.equal(resolveModelRoles({}, environment).router, 'cloud-router');
  assert.throws(() => resolveModelRoles({ roleModels: { analyst: 'unknown-role' } }), /unknown role/);
  assert.throws(() => resolveModelRoles({ roleModels: { coder: '' } }), /Invalid model/);
});

test('current default routing is a real one-call phase in the global budget and records actual per-role models', async () => {
  const models = resolveModelRoles({}, {}), requests = [];
  const queue = [tool('classify_request', classifier, models.router), tool('submit_design', plan, models.planner), tool('execute_r', { code: 'fixture <- 2 + 2', purpose: 'fixture calculation' }, models.coder), tool('submit_answer', answer, models.coder), tool('execute_r', { code: 'fixture <- sum(c(2, 2))', purpose: 'fixture verification' }, models.reviewer), tool('submit_review', review, models.reviewer)];
  const result = await runScientificAnalysis('Fixture request: return a table and figure', { roleModels: models, workflowMode: 'multi', executor, maxRepairs: 0, transport: async request => { requests.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(result.budget.used.model_calls, 6);
  assert.equal(result.routing.status, 'completed'); assert.deepEqual(result.routing.classification, classifier);
  assert.equal(result.budget.phases[0].name, 'routing'); assert.equal(result.budget.phases[0].max_model_calls, 1); assert.equal(result.budget.phases[0].model_calls, 1);
  assert.deepEqual(result.actual_role_models, { router: [models.router], planner: [models.planner], coder: [models.coder], reviewer: [models.reviewer] });
  assert.deepEqual(requests[0].tools.map(t => t.name), ['classify_request']); assert.equal(requests[0].max_tokens, 2048);
  const plannerContext = JSON.parse(requests[1].messages[0].content);
  assert.equal(plannerContext.user_request, 'Fixture request: return a table and figure');
  assert.deepEqual(plannerContext.routing_advice.classification, classifier);
  assert.match(plannerContext.routing_advice.instruction, /Check it against the complete unchanged user request/);
  assert.deepEqual(JSON.parse(requests[2].messages[0].content).routing_advice.classification, classifier);
  assert.deepEqual(JSON.parse(requests[4].messages[0].content).routing_advice.classification, classifier);
  assert.ok(requests.slice(1).every(r => r.model === models.coder && r.max_tokens === 16000 && r.tool_choice.type === 'auto'));
  assert.equal(result.trace.filter(event => event.type === 'model_call').length, 6);
});

test('single workflow keeps system, tools and thinking blocks unchanged across planner, coder and self-review', async () => {
  const requests = [], queue = [tool('submit_design', plan, 'claude-sonnet-5-5'), tool('execute_r', { code: 'fixture <- 2 + 2', purpose: 'fixture calculation' }, 'claude-sonnet-5-5'), tool('submit_answer', answer, 'claude-sonnet-5-5'), tool('execute_r', { code: 'fixture <- 2 * 2', purpose: 'fixture verification' }, 'claude-sonnet-5-5'), tool('submit_review', review, 'claude-sonnet-5-5')];
  const result = await runScientificAnalysis('Fixture request', { model: 'claude-sonnet-5-5', verificationPolicy: 'required', executor, maxRepairs: 0, transport: async request => { requests.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(result.routing.status, 'disabled');
  for (let i = 1; i < requests.length; i++) {
    assert.equal(requests[i].system, requests[0].system); assert.deepEqual(requests[i].tools, requests[0].tools);
    assert.deepEqual(requests[i].messages.slice(0, requests[i - 1].messages.length), requests[i - 1].messages);
  }
  assert.ok(requests[1].messages.some(message => Array.isArray(message.content) && message.content.some(block => block.signature === 'fixture-signature-submit_design')));
  assert.ok(requests[3].messages.some(message => typeof message.content === 'string' && message.content.includes('self-verification')));
});

test('blind review keeps adopted source inputs and user history while withholding prior assistant answer hints', async () => {
  const models = resolveModelRoles({}, {}), requests = [];
  const queue = [tool('classify_request', classifier, models.router), tool('submit_design', plan, models.planner),
    tool('execute_r', { code: 'fixture <- 2 + 2', purpose: 'fixture' }, models.coder), tool('submit_answer', answer, models.coder),
    tool('execute_r', { code: 'fixture <- sum(c(2, 2))', purpose: 'independent fixture' }, models.reviewer), tool('submit_review', review, models.reviewer)];
  const history = [{ role: 'user', content: 'Previous supplied design and adopted data' },
    { role: 'assistant', content: 'Previous answer hint which must not enter the blind precheck' }];
  const source = { name: 'cleaned.csv', local_path: '/request-owned/source-1-cleaned.csv',
    source_kind: 'prior_generated_artifact', input_role: 'adopted_input', lineage_status: 'client_claimed_unverified' };
  const result = await runScientificAnalysis('Continue with the adopted input', { roleModels: models, workflowMode: 'multi',
    context: { source_files: [source] }, conversationHistory: history, executor, maxRepairs: 0,
    transport: async request => { requests.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed');
  const coderContext = JSON.parse(requests[2].messages[0].content);
  assert.deepEqual(coderContext.prior_user_conversation, history);
  const blindContext = JSON.parse(requests[4].messages[0].content);
  assert.deepEqual(blindContext.prior_user_conversation, [history[0]]);
  assert.deepEqual(blindContext.source_material.source_files, [source]);
  assert.equal(blindContext.candidate_answer, undefined);
  assert.equal(blindContext.execution_evidence, undefined);
  assert.equal(JSON.stringify(blindContext).includes(history[1].content), false);
});

test('Sonnet uses auto on the final allowed call, while the exact old model path retains forced submission', async () => {
  for (const model of ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001']) {
    const requests = [], queue = [tool('submit_design', plan, model), tool('execute_r', { code: 'fixture <- 2 + 2', purpose: 'fixture' }, model), tool('submit_answer', answer, model)];
    const result = await runScientificAnalysis('Fixture request', { model, maxModelCalls: 3, budgetProfile: { plannerMaxCalls: 1, solverMaxCalls: 2, reservationPolicy: 'full', reserveRepair: false }, executor, transport: async request => { requests.push(structuredClone(request)); return queue.shift(); } });
    assert.equal(result.scientificStatus, 'completed');
    assert.deepEqual(requests[2].tool_choice, model === 'claude-sonnet-5-5' ? { type: 'auto' } : { type: 'tool', name: 'submit_answer' });
    if (model !== 'claude-sonnet-5-5') { assert.equal(requests[2].max_tokens, 6000); assert.equal(requests[2].thinking, undefined); }
  }
});

test('invalid advisory routing cannot replace user scientific inputs or prevent successful planning', async () => {
  const requests = [], queue = [tool('classify_request', { ...classifier, numeric_answer: 999 }, 'claude-haiku-5-5'), tool('submit_design', plan, 'claude-sonnet-5-5'), tool('execute_r', { code: 'fixture <- 2 + 2', purpose: 'fixture' }, 'claude-sonnet-5-5'), tool('submit_answer', answer, 'claude-sonnet-5-5')];
  const result = await runScientificAnalysis('The original requested target is unchanged', { roleModels: resolveModelRoles({}, {}), executor, transport: async request => { requests.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(result.routing.status, 'unavailable');
  assert.equal(JSON.parse(requests[1].messages[0].content).user_request, 'The original requested target is unchanged');
  assert.equal(JSON.parse(requests[1].messages[0].content).routing_advice, undefined);
  assert.equal(requests[1].messages.some(message => typeof message.content === 'string' && message.content.includes('numeric_answer')), false);
});

test('routing budget exhaustion and cancellation remain honest terminal failures', async () => {
  const result = await runScientificAnalysis('Fixture', { roleModels: resolveModelRoles({}, {}), maxModelCalls: 1, executor, transport: async () => tool('classify_request', classifier, 'claude-haiku-5-5') });
  assert.equal(result.scientificStatus, 'budget_exhausted'); assert.equal(result.budget.used.model_calls, 1); assert.equal(result.budget.exhaustion.kind, 'global_model_calls');
  const controller = new AbortController(); controller.abort(); let invoked = false;
  const cancelled = await runScientificAnalysis('Fixture', { roleModels: resolveModelRoles({}, {}), signal: controller.signal, executor, transport: async () => { invoked = true; } });
  assert.equal(invoked, false); assert.equal(cancelled.success, false); assert.match(cancelled.error, /HARNESS_ABORTED/);
});

test('provider refusals stop scientific work without silent downgrade or repeated calls', async () => {
  let calls = 0;
  const result = await runScientificAnalysis('Fixture', { model: 'claude-sonnet-5-5', executor, transport: async () => { calls++; return { model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'Declined fixture' }], stop_reason: 'refusal' }; } });
  assert.equal(calls, 1); assert.equal(result.success, false); assert.match(result.error, /CLAUDE_REFUSAL/);
});

test('standalone classification records actual Haiku usage and validates its limited schema', async () => {
  let captured;
  const result = await classifyScientificRequest('Fixture source and figure request', { roleModels: { router: 'claude-haiku-5-5' }, transport: async request => { captured = request; return tool('classify_request', classifier, 'claude-haiku-5-5'); } });
  assert.equal(captured.model, 'claude-haiku-5-5'); assert.equal(result.model, 'claude-haiku-5-5'); assert.equal(result.usage.input_tokens, 1);
  await assert.rejects(() => classifyScientificRequest('Fixture', { transport: async () => tool('classify_request', { arbitrary: 'answer' }, 'fixture') }), /unavailable/);
});
