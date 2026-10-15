import { createHmac, timingSafeEqual } from 'node:crypto';

const scope = 'power-agent:anonymous:scientific-analysis';
const validFingerprint = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function getAnonymousScientificOrigins(additional = process.env.POWER_AGENT_ADDITIONAL_UI_ORIGINS) {
  const canonical = ['https://power-agent.io', 'https://www.power-agent.io'];
  if (!additional) return canonical;
  if (typeof additional !== 'string' || additional.length > 2048) return canonical;
  const configured = additional.split(',').map(value => value.trim()).filter(Boolean);
  if (configured.length > 8) return canonical;
  const validated = configured.filter(value => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.hostname.includes('*') && url.origin === value;
    } catch { return false; }
  });
  return [...new Set([...canonical, ...validated])];
}
const permittedOrigin = (value, additional) => getAnonymousScientificOrigins(additional).includes(value);
function signingSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Anonymous analysis transport is unavailable');
  return secret;
}

// This transports the existing cookie identity across hosts. It grants no new
// allowance: the scientific handler must still atomically reserve that identity.
export function issueAnonymousAnalysisTicket(fingerprint, origin, { secret = process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET, now = Date.now(), additionalOrigins = process.env.POWER_AGENT_ADDITIONAL_UI_ORIGINS } = {}) {
  if (!validFingerprint(fingerprint) || !permittedOrigin(origin, additionalOrigins)) throw new Error('Invalid anonymous analysis identity');
  const issued = Math.floor(now / 1000), expires = issued + 300;
  const payload = Buffer.from(JSON.stringify({ v: 1, scope, fingerprint, origin, iat: issued, exp: expires })).toString('base64url');
  const signature = createHmac('sha256', signingSecret(secret)).update(payload).digest('base64url');
  return { anonymousTicket: `${payload}.${signature}`, expiresAt: new Date(expires * 1000).toISOString() };
}

export function verifyAnonymousAnalysisTicket(ticket, origin, { secret = process.env.POWER_AGENT_ANONYMOUS_TICKET_SECRET, now = Date.now(), additionalOrigins = process.env.POWER_AGENT_ADDITIONAL_UI_ORIGINS } = {}) {
  if (typeof ticket !== 'string' || ticket.length > 2048 || !permittedOrigin(origin, additionalOrigins)) throw new Error('Invalid anonymous analysis ticket');
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Invalid anonymous analysis ticket');
  const expected = createHmac('sha256', signingSecret(secret)).update(parts[0]).digest();
  const observed = Buffer.from(parts[1], 'base64url');
  if (expected.length !== observed.length || !timingSafeEqual(expected, observed)) throw new Error('Invalid anonymous analysis ticket');
  let claims;
  try { claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw new Error('Invalid anonymous analysis ticket'); }
  const seconds = Math.floor(now / 1000);
  if (claims.v !== 1 || claims.scope !== scope || !validFingerprint(claims.fingerprint) || claims.origin !== origin || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) || claims.exp - claims.iat !== 300 || claims.iat > seconds + 5 || claims.exp <= seconds) throw new Error('Invalid or expired anonymous analysis ticket');
  return claims.fingerprint;
}

export const isAnonymousScientificRoute = path => ['/api/analyze-biostat', '/api/analyze-multi-agent', '/api/analyze-hierarchical', '/api/scientific-analysis', '/api/analyze-file'].includes(path);
