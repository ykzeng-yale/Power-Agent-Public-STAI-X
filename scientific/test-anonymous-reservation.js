import test from 'node:test';
import assert from 'node:assert/strict';
// No real database/network is used; configuration permits module construction.
process.env.SUPABASE_URL ||= 'https://unit-test.invalid';
process.env.SUPABASE_ANON_KEY ||= 'unit-test-placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'unit-test-placeholder';
const { recordAnonymousUsage } = await import('./auth-middleware.js');

function schemaClient(initial = null, race = false) {
  const allowed = new Set(['fingerprint', 'ip_address', 'analyses_used', 'max_allowed', 'last_seen_at']);
  let row = initial ? { ...initial } : null, updates = 0;
  const writes = [];
  const client = { from: table => {
    assert.equal(table, 'anonymous_usage');
    let op = 'select', payload = null, expected = null;
    const validate = value => { for (const key of Object.keys(value)) assert.ok(allowed.has(key), `unsupported deployed schema field: ${key}`); writes.push(value); };
    const finish = async () => {
      if (op === 'insert') { if (row) return { error: { code: '23505' } }; row = payload; return { data: { ...row } }; }
      if (op === 'update') {
        updates++;
        if (race && updates === 1) { row.analyses_used++; return { data: null }; }
        if (row.analyses_used !== expected) return { data: null };
        row = { ...row, ...payload }; return { data: { ...row } };
      }
      return { data: row ? { ...row } : null };
    };
    const builder = { select: () => builder, eq: (key, value) => { if (key === 'analyses_used') expected = value; return builder; },
      insert: value => { validate(value); op = 'insert'; payload = value; return builder; },
      update: value => { validate(value); op = 'update'; payload = value; return builder; }, maybeSingle: finish, single: finish };
    return builder;
  } };
  return { client, writes };
}
test('first anonymous reservation uses only deployed-schema columns', async () => {
  const fixture = schemaClient();
  const result = await recordAnonymousUsage('fixture-fingerprint', '127.0.0.1', fixture.client);
  assert.equal(result.success, true); assert.equal(result.analyses_used, 1);
  assert.ok(fixture.writes[0].last_seen_at); assert.ok(!('last_used_at' in fixture.writes[0]));
});
test('CAS increments an existing allowance without unsupported fields', async () => {
  const fixture = schemaClient({ analyses_used: 1, max_allowed: 2 });
  const result = await recordAnonymousUsage('fixture-fingerprint', null, fixture.client);
  assert.equal(result.success, true); assert.equal(result.analyses_used, 2);
  assert.ok(!('last_used_at' in fixture.writes[0]));
});
test('a lost CAS race cannot reserve an already consumed final allowance', async () => {
  const fixture = schemaClient({ analyses_used: 1, max_allowed: 2 }, true);
  const result = await recordAnonymousUsage('fixture-fingerprint', null, fixture.client);
  assert.equal(result.success, false); assert.equal(result.analyses_used, 2);
});
