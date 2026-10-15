import test from 'node:test';
import assert from 'node:assert/strict';
import { getHostedScientificOptions, getHostedScientificLimits } from './hosted-scientific-config.js';

test('hosted capacity protects complete review cycles and uses elastic production phases', () => {
  const options = getHostedScientificOptions('multi', {});
  assert.equal(options.maxModelCalls, 64); assert.equal(options.maxExecutions, 32);
  assert.equal(options.deadlineMs, 1200000); assert.equal(options.maxRExecutionMs, 300000);
  assert.equal(options.budgetProfile.verificationMaxCalls, 10);
  assert.equal(options.budgetProfile.reservationPolicy, 'full');
  assert.equal(options.budgetProfile.phaseLimitPolicy, 'elastic');
  assert.equal(getHostedScientificLimits({}).single.maxModelCalls, 32);
});
test('only bounded server environment settings configure hosted capacity', () => {
  assert.equal(getHostedScientificOptions('multi', { POWER_AGENT_MULTI_MAX_MODEL_CALLS: '80' }).maxModelCalls, 80);
  for (const value of ['0', 'Infinity', '-1', '97', '4.5', 'many']) {
    assert.throws(() => getHostedScientificOptions('multi', { POWER_AGENT_MULTI_MAX_MODEL_CALLS: value }));
  }
  assert.throws(() => getHostedScientificOptions('multi', { POWER_AGENT_ANALYSIS_DEADLINE_SECONDS: '3600' }));
  assert.throws(() => getHostedScientificOptions('wrong', {}));
});
