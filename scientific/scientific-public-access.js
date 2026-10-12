import { isIP } from 'node:net';

function integer(env, name, fallback, minimum, maximum) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

export function getScientificAccessPolicy(env = process.env) {
  const mode = env.POWER_AGENT_ACCESS_MODE || 'credits';
  if (!['public', 'credits'].includes(mode)) throw new Error('POWER_AGENT_ACCESS_MODE must be public or credits');
  return {
    mode, creditRequired: mode === 'credits', admissionScope: 'per backend instance',
    windowSeconds: integer(env, 'POWER_AGENT_PUBLIC_WINDOW_SECONDS', 3600, 60, 86400),
    requestsPerIp: integer(env, 'POWER_AGENT_PUBLIC_REQUESTS_PER_IP', 12, 1, 100),
    concurrentPerIp: integer(env, 'POWER_AGENT_PUBLIC_CONCURRENT_PER_IP', 1, 1, 4),
    concurrentPerInstance: integer(env, 'POWER_AGENT_PUBLIC_CONCURRENT_PER_INSTANCE', 2, 1, 8),
    maxTrackedIps: integer(env, 'POWER_AGENT_PUBLIC_MAX_TRACKED_IPS', 10000, 100, 100000)
  };
}

// Under K_SERVICE use the last valid address in the proxy-observed chain to
// avoid trusting prepended client values. It may identify a shared proxy; it
// does not guarantee caller-IP attribution. Outside Cloud Run use the socket.
export function scientificClientIp(req, env = process.env) {
  if (env.K_SERVICE && typeof req.headers?.['x-forwarded-for'] === 'string') {
    const last = req.headers['x-forwarded-for'].split(',').at(-1).trim();
    if (isIP(last)) return last;
  }
  const socketIp = req.socket?.remoteAddress;
  if (isIP(socketIp)) return socketIp;
  return 'unidentified-client';
}

// A synchronous acquire prevents concurrent requests within this process from
// racing. This is deliberately not described as a distributed/global quota.
// Cloud Run max-instances separately bounds total deployed compute capacity.
export function createScientificPublicAdmission(policy = getScientificAccessPolicy(), { now = Date.now, env = process.env } = {}) {
  const clients = new Map();
  let active = 0;
  const windowMs = policy.windowSeconds * 1000;
  const refused = (reason, retryAfterSeconds) => ({ accepted: false, reason, retryAfterSeconds,
    message: reason === 'rate_limit' ? 'The public analysis limit for this connection has been reached. Try again after the stated wait.' : 'Analysis capacity is currently in use. Try again after the stated wait.' });
  return {
    acquire(req) {
      const time = now();
      for (const [key, entry] of clients) if (entry.active === 0 && time - entry.start >= windowMs) clients.delete(key);
      const key = scientificClientIp(req, env);
      let entry = clients.get(key);
      if (entry && time - entry.start >= windowMs) { entry.start = time; entry.used = 0; }
      if (entry?.used >= policy.requestsPerIp) return refused('rate_limit', Math.max(1, Math.ceil((entry.start + windowMs - time) / 1000)));
      if (entry?.active >= policy.concurrentPerIp || active >= policy.concurrentPerInstance) return refused('capacity_busy', 30);
      if (!entry) {
        if (clients.size >= policy.maxTrackedIps) return refused('capacity_busy', 30);
        entry = { start: time, used: 0, active: 0 }; clients.set(key, entry);
      }
      entry.used++; entry.active++; active++;
      let released = false;
      return { accepted: true, release() { if (released) return; released = true; entry.active--; active--; } };
    }
  };
}
