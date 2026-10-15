import test from 'node:test';
import assert from 'node:assert/strict';
import { createScientificPublicAdmission, getScientificAccessPolicy, scientificClientIp } from './scientific-public-access.js';

const request = ip => ({ headers: {}, socket: { remoteAddress: ip } });
test('public policy is explicit, bounded and separate from historical credit mode', () => {
  assert.equal(getScientificAccessPolicy({}).mode, 'credits');
  assert.equal(getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public' }).creditRequired, false);
  assert.throws(() => getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'anything' }));
  for (const env of [ { POWER_AGENT_PUBLIC_REQUESTS_PER_IP: 0 }, { POWER_AGENT_PUBLIC_CONCURRENT_PER_IP: 99 },
    { POWER_AGENT_PUBLIC_WINDOW_SECONDS: 'invalid' }, { POWER_AGENT_PUBLIC_MAX_TRACKED_IPS: 1000000 } ]) assert.throws(() => getScientificAccessPolicy(env));
});
test('untrusted forwarding headers cannot mint a new IP identity', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.3' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(scientificClientIp(req, {}), '127.0.0.1');
  assert.equal(scientificClientIp(req, { K_SERVICE: 'configured-cloud-run-service' }), '198.51.100.3');
  req.headers['x-forwarded-for'] = '203.0.113.9, malformed';
  assert.equal(scientificClientIp(req, { K_SERVICE: 'configured-cloud-run-service' }), '127.0.0.1');
});
test('simultaneous requests enforce per-IP and per-instance capacity; release is idempotent', () => {
  const gate = createScientificPublicAdmission(getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public' }), { env: {} });
  const a = gate.acquire(request('192.0.2.1')); assert.equal(a.accepted, true);
  assert.equal(gate.acquire(request('192.0.2.1')).reason, 'capacity_busy');
  const b = gate.acquire(request('192.0.2.2')); assert.equal(b.accepted, true);
  assert.equal(gate.acquire(request('192.0.2.3')).reason, 'capacity_busy');
  a.release(); a.release();
  const c = gate.acquire(request('192.0.2.3')); assert.equal(c.accepted, true);
  assert.equal(gate.acquire(request('192.0.2.4')).accepted, false);
  b.release(); c.release();
});
test('fingerprint changes cannot bypass per-IP rate limit and the window resets predictably', () => {
  let time = 1000;
  const policy = getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public', POWER_AGENT_PUBLIC_REQUESTS_PER_IP: 2, POWER_AGENT_PUBLIC_WINDOW_SECONDS: 60 });
  const gate = createScientificPublicAdmission(policy, { now: () => time, env: {} });
  for (let index = 0; index < 2; index++) { const lease = gate.acquire({ ...request('192.0.2.1'), anonFingerprint: String(index) }); assert.equal(lease.accepted, true); lease.release(); }
  const rejected = gate.acquire({ ...request('192.0.2.1'), anonFingerprint: 'changed-again' });
  assert.equal(rejected.reason, 'rate_limit'); assert.equal(rejected.retryAfterSeconds, 60);
  time += 60000; assert.equal(gate.acquire(request('192.0.2.1')).accepted, true);
});
test('rate-window reset does not erase a still-active concurrency reservation', () => {
  let time = 1000;
  const policy = getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public', POWER_AGENT_PUBLIC_WINDOW_SECONDS: 60 });
  const gate = createScientificPublicAdmission(policy, { now: () => time, env: {} });
  const lease = gate.acquire(request('192.0.2.1')); time += 60000;
  assert.equal(gate.acquire(request('192.0.2.1')).accepted, false);
  lease.release(); assert.equal(gate.acquire(request('192.0.2.1')).accepted, true);
});
test('bounded identity table refuses new identities without evicting an unexpired rate counter', () => {
  const policy = getScientificAccessPolicy({ POWER_AGENT_ACCESS_MODE: 'public', POWER_AGENT_PUBLIC_MAX_TRACKED_IPS: 100 });
  const gate = createScientificPublicAdmission(policy, { env: {} });
  for (let index = 1; index <= 100; index++) gate.acquire(request(`192.0.2.${index}`)).release();
  assert.equal(gate.acquire(request('192.0.2.101')).accepted, false);
  assert.equal(gate.acquire(request('192.0.2.1')).accepted, true);
});
