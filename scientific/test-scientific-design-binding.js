import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { explicitDesignInputBindings, validateScientificDesignBindings, runScientificAnalysis } from './scientific-harness.js';
import { ScientificRExecutor } from './scientific-r-executor.js';

const query = "Two independent normal groups with common variance, no attrition, equal allocation: Cohen's d = 0.5, alpha = 0.05, target 80% power, strict two-sided pooled t test. Find the minimum sample size per group.";
const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: 'Difference between two independent normal groups', hypothesis: 'Two-sided difference in means', method: 'two_sample_t', alpha: .05, sidedness: 'two-sided', target_power: .8, allocation_ratio: 1, sample_size_unit: 'participants per group',
  parameters: [{ name: 'delta', value: .5, unit: 'SD units', source: 'user' }, { name: 'sd', value: 1, unit: 'SD units', source: 'explicit_assumption' }], assumptions: ['Two independent normal groups', 'Common SD and equal variance', 'No attrition'], missing_information: [], clarification_questions: [], scientific_notes: [] };
const repaired = () => ({ ...structuredClone(plan), parameters: [...structuredClone(plan.parameters), { name: 'cohens_d', value: .5, unit: 'standardized mean difference', source: 'user' }] });
const tool = (name, input, id = name) => ({ content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'tool_use', model: 'fixture-model' });

test('bounded input ledger retains explicit user labels, signs, scientific notation and declared percent scales', () => {
  const bindings = explicitDesignInputBindings("Cohen’s d = -.5e0, alpha=5%, want 80% power.");
  assert.deepEqual(bindings.map(({ kind, value, source }) => ({ kind, value, source })), [{ kind: 'cohens_d', value: -.5, source: 'user' }, { kind: 'alpha', value: .05, source: 'user' }, { kind: 'target_power', value: .8, source: 'user' }]);
  assert.equal(bindings[0].raw_span, 'Cohen’s d = -.5e0'); assert.equal(bindings[1].literal_value, 5); assert.equal(bindings[1].literal_unit, 'percent');
  assert.equal(explicitDesignInputBindings('Cohen d = 0.5garbage').length, 0);
  assert.equal(explicitDesignInputBindings('mean change=0.36, marginal SD=1.2, correlation rho=0.5').length, 0);
});

test('delta normalization alone cannot replace the explicitly supplied standardized effect; faithful canonical input passes', () => {
  const bindings = explicitDesignInputBindings(query);
  assert.ok(validateScientificDesignBindings(plan, bindings).some(issue => /cohens_d/.test(issue)));
  assert.deepEqual(validateScientificDesignBindings(repaired(), bindings), []);
  for (const mismatch of [ { value: .6 }, { source: 'explicit_assumption' }, { unit: 'mmHg' } ]) {
    const candidate = repaired(); Object.assign(candidate.parameters.at(-1), mismatch);
    assert.ok(validateScientificDesignBindings(candidate, bindings).length > 0);
  }
  const nuisance = structuredClone(plan); nuisance.parameters[1].unit = "SD units (Cohen's d = 0.5)";
  assert.ok(validateScientificDesignBindings(nuisance, bindings).length > 0);
});

test('explicit alpha and target power are checked before code, including percent scaling and multiple scenarios', () => {
  for (const mismatch of [{ alpha: .1 }, { target_power: .9 }, { target_power: null }]) assert.ok(validateScientificDesignBindings({ ...repaired(), ...mismatch }, explicitDesignInputBindings(query)).length > 0);
  const paired = { ...repaired(), method: 'paired_t', estimand: 'Paired mean change', assumptions: ['Paired normally distributed differences'], parameters: [{ name: 'mean change', value: .36, unit: 'outcome', source: 'user' }] };
  assert.deepEqual(validateScientificDesignBindings(paired, explicitDesignInputBindings('Paired differences, mean change .36, alpha .05, target power .8')), []);
  assert.ok(validateScientificDesignBindings(repaired(), explicitDesignInputBindings('Cohen d=.5, power=.8 and power=.9')).some(issue => /multiple explicit target_power/.test(issue)));
  assert.deepEqual(validateScientificDesignBindings({ ...plan, ready: false }, explicitDesignInputBindings(query)), []);
});

test('supported profile missing a structured effect is returned to the planner before R instead of silently inferred', () => {
  assert.ok(validateScientificDesignBindings(plan, []).some(issue => /Repair the parameter binding before code execution/.test(issue)));
  assert.equal(plan.parameters.some(parameter => parameter.name === 'cohens_d'), false);
  assert.deepEqual(validateScientificDesignBindings({ ...plan, method: 'paired_t', assumptions: ['Paired differences'] }, []), []);
});

test('real R single workflow repairs the design before executing and passes the unchanged pooled-t math guard', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'power-design-binding-')); await fs.chmod(directory, 0o711);
  const executor = new ScientificRExecutor({ root: directory });
  let steps = 0, startedExecutions = 0; const requests = [];
  const code = 'continuous <- stats::power.t.test(delta=.5,sd=1,sig.level=.05,power=.8,type="two.sample",alternative="two.sided",strict=TRUE)$n; n <- ceiling(continuous); at <- stats::power.t.test(n=n,delta=.5,sd=1,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE)$power; previous <- stats::power.t.test(n=n-1,delta=.5,sd=1,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE)$power; power_agent_emit(list(power_agent_row("Minimum participants per arm",n,"participants_per_arm"),power_agent_row("Total participants",2*n,"participants_total"),power_agent_row("Power at n",at,"probability"),power_agent_row("Power at n-1",previous,"probability")))';
  try {
    const result = await runScientificAnalysis(query, { model: 'claude-sonnet-5-5', workflowMode: 'single', executor, maxModelCalls: 6, onEvent: event => { if (event.type === 'code') startedExecutions++; }, transport: async request => {
      requests.push(structuredClone(request)); steps++;
      if (steps === 1) { assert.equal(startedExecutions, 0); return tool('submit_design', plan); }
      if (steps === 2) { assert.equal(startedExecutions, 0); return tool('submit_design', repaired()); }
      if (steps === 3) return tool('execute_r', { code, purpose: 'Actual package calculation for the declared user inputs' }, 'real-r');
      if (steps === 4) {
        const block = request.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).findLast(content => content.type === 'tool_result' && content.tool_use_id === 'real-r');
        const execution = JSON.parse(block.content);
        return tool('submit_answer', { summary: 'Executed minimum design under the declared inputs.', method: 'two_sample_t', results: execution.computed_result.results, assumptions: plan.assumptions, limitations: [], evidence_ids: [execution.evidence_id], simulation: null, citations: [] });
      }
      throw new Error('Unexpected fixture model call');
    } });
    assert.equal(result.scientificStatus, 'completed'); assert.equal(result.referenceAudit.status, 'passed');
    assert.equal(result.budget.phases.find(phase => phase.name === 'planner').model_calls, 2);
    assert.equal(result.executions[0].role, 'coder'); assert.equal(result.executions[1].role, 'reference_check');
    const rejection = result.trace.find(event => event.type === 'tool_result' && event.tool === 'submit_design' && event.result.accepted === false);
    assert.ok(rejection.result.issues.some(issue => /cohens_d/.test(issue)));
    assert.equal(JSON.parse(requests[0].messages[0].content).user_request, query);
    assert.equal(result.plan.parameters.at(-1).value, .5); assert.equal(result.plan.parameters.at(-1).source, 'user');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
