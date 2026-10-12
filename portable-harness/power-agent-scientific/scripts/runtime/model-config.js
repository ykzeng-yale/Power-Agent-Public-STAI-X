// Current defaults verified against the official catalogue and this account's
// authenticated Models API on 2026-10-11. These dateless IDs are fixed models.
// https://platform.claude.com/docs/en/models/overview
export const DEFAULT_POWER_AGENT_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_POWER_AGENT_ROUTING_MODEL = 'claude-haiku-5-5';
export const POWER_AGENT_MODEL = process.env.POWER_AGENT_MODEL || DEFAULT_POWER_AGENT_MODEL;
export const POWER_AGENT_ROUTING_MODEL = process.env.POWER_AGENT_ROUTING_MODEL || DEFAULT_POWER_AGENT_ROUTING_MODEL;
export const HARNESS_VERSION = '2.4.2';

export function resolveModelRoles(options = {}, environment = process.env) {
  const roles = ['router', 'planner', 'coder', 'reviewer'];
  if (options.roleModels !== undefined && (!options.roleModels || typeof options.roleModels !== 'object' || Array.isArray(options.roleModels))) throw new Error('roleModels must be an object');
  if (Object.keys(options.roleModels || {}).some(role => !roles.includes(role))) throw new Error('roleModels contains an unknown role');
  const models = Object.fromEntries(roles.map(role => [role,
    options.roleModels?.[role] ?? (options.model || environment[`POWER_AGENT_${role.toUpperCase()}_MODEL`] ||
    (role === 'router' ? environment.POWER_AGENT_ROUTING_MODEL || DEFAULT_POWER_AGENT_ROUTING_MODEL : environment.POWER_AGENT_MODEL || DEFAULT_POWER_AGENT_MODEL)
    )
  ]));
  for (const [role, model] of Object.entries(models)) {
    if (typeof model !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(model)) throw new Error(`Invalid model ID for ${role}`);
  }
  return Object.freeze(models);
}

export const POWER_AGENT_ROLE_MODELS = resolveModelRoles();

export function modelRequestSettings(model, role) {
  const currentThinkingModel = ['claude-sonnet-5-5', 'claude-haiku-5-5'].includes(model);
  return {
    max_tokens: currentThinkingModel ? (role === 'router' ? 2048 : 16000) : 6000,
    ...(currentThinkingModel ? { thinking: { type: 'adaptive' }, output_config: { effort: role === 'router' ? 'low' : 'high' } } : {}),
    supports_forced_tools: model !== 'claude-sonnet-5-5',
    preserve_conversation_prefix: currentThinkingModel
  };
}

export function getModelPolicy(options = {}, environment = process.env) {
  const roles = resolveModelRoles(options, environment);
  return { roles, request_settings: Object.fromEntries(Object.entries(roles).map(([role, model]) => [role, modelRequestSettings(model, role)])),
    routing_enabled: options.enableRouting ?? !options.model,
    routing_scope: 'Advisory request/output classification only. The scientific planner, analyst and reviewer read the original request; classification does not select a method, change inputs or waive review.' };
}
