// Server-owned production capacity. Client bodies cannot increase these limits.
function integer(env, name, fallback, min, max) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function getHostedScientificOptions(mode, env = process.env) {
  if (!['single', 'multi'].includes(mode)) throw new Error('Unknown scientific workflow');
  const multi = mode === 'multi';
  const prefix = multi ? 'POWER_AGENT_MULTI_' : 'POWER_AGENT_SINGLE_';
  return {
    maxModelCalls: integer(env, prefix + 'MAX_MODEL_CALLS', multi ? 64 : 32, 12, 96),
    maxExecutions: integer(env, prefix + 'MAX_R_EXECUTIONS', multi ? 32 : 16, 4, 48),
    deadlineMs: 1000 * integer(env, 'POWER_AGENT_ANALYSIS_DEADLINE_SECONDS', 1200, 60, 1200),
    maxRExecutionMs: 1000 * integer(env, 'POWER_AGENT_R_TIMEOUT_SECONDS', 300, 30, 600),
    maxRepairs: 1, maxSearches: 12, maxSourceReads: 8, maxSourceChars: 160000,
    budgetProfile: {
      id: 'hosted-research-v1', plannerMaxCalls: 6,
      solverMaxCalls: multi ? 28 : 26, solverMaxExecutions: multi ? 16 : 14,
      verificationMaxCalls: multi ? 10 : 8, verificationMaxExecutions: multi ? 6 : 4,
      repairMaxCalls: multi ? 8 : 6, repairMaxExecutions: multi ? 4 : 3,
      reserveRepair: true, reservationPolicy: 'full', phaseLimitPolicy: 'elastic'
    }
  };
}

export function getHostedScientificLimits(env = process.env) {
  return { single: getHostedScientificOptions('single', env), multi: getHostedScientificOptions('multi', env) };
}
