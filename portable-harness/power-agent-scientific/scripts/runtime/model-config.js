// Reproducible default. Verify newer Haiku versions before changing this pin.
// Official model catalogue verified 2026-10-01:
// https://platform.claude.com/docs/en/models/overview
export const DEFAULT_POWER_AGENT_MODEL = 'claude-haiku-4-5-20251001';
export const POWER_AGENT_MODEL = process.env.POWER_AGENT_MODEL || DEFAULT_POWER_AGENT_MODEL;
export const HARNESS_VERSION = '2.1.0';
