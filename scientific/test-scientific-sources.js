import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceSearch, createSourceReader, isPrimarySourceUrl, isPublicSourceAddress, primaryHtmlText, SOURCE_RESPONSE_LIMIT, ScientificSourceError } from './scientific-sources.js';

test('source search has the same bounded primary receipts and excludes generated answers', async () => {
  let calls = 0;
  const search = createSourceSearch({ apiKey: 'test-source-key', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.tavily.com/search');
    const body = JSON.parse(options.body);
    assert.equal(body.include_answer, false);
    return new Response(JSON.stringify({ answer: 'An unverified synthesized answer', usage: { credits: 1 }, results: [
      { title: 'R documentation', url: 'https://stat.ethz.ch/R-manual/R-devel/library/stats/html/power.t.test.html', content: 'strict includes the opposite rejection tail.' },
      { title: 'Untrusted redirect-like host', url: 'https://stat.ethz.ch.attacker.example/doc', content: 'fabricated' },
      { title: 'Private host', url: 'http://169.254.169.254/latest', content: 'private' }
    ] }));
  } });
  const found = await search('R power t strict');
  assert.equal(found.results.length, 1);
  assert.equal(found.answer, undefined);
  assert.equal(found.results[0].content_sha256, createHash('sha256').update(found.results[0].content).digest('hex'));
  assert.equal((await search('R power t strict')).cache_hit, true);
  assert.equal(calls, 1);
});

test('document extraction records actual text scope and rejects unsupported targets', async () => {
  let calls = 0;
  const url = 'https://www.stata.com/manuals/pss-2powercox.pdf';
  const read = createSourceReader({ apiKey: 'test-source-key', fetchImpl: async (endpoint, options) => {
    calls++;
    assert.equal(endpoint, 'https://api.tavily.com/extract');
    assert.deepEqual(JSON.parse(options.body).urls, [url]);
    return new Response(JSON.stringify({ usage: { credits: 1 }, results: [{ url, raw_content: 'Extracted method text' }] }));
  } });
  const found = await read(url);
  assert.equal(found.results[0].content_scope, 'provider_extracted_document_text');
  assert.match(found.results[0].truncation_scope, /omit pages/);
  assert.equal((await read(url)).cache_hit, true);
  assert.equal(calls, 1);
  await assert.rejects(read('https://localhost/doc'), /url_not_allowed/);
});

test('source URL and transport failures do not fabricate receipts or expose keys', async () => {
  for (const url of ['file:///private', 'https://user:pass@stat.ethz.ch/x', 'https://stat.ethz.ch:8080/x', 'https://127.0.0.1/']) assert.equal(isPrimarySourceUrl(url), false);
  assert.equal(createSourceSearch({ apiKey: '', firecrawlApiKey: '' }), null);
  const search = createSourceSearch({ apiKey: 'test-source-key', fetchImpl: async () => new Response('private-provider-body', { status: 401 }) });
  await assert.rejects(search('R power'), /HTTP 401/);
  await assert.rejects(search(''), /1–1500/);
});

const primary = 'https://stat.ethz.ch/R-manual/R-devel/library/stats/html/power.t.test.html';
const htmlResponse = text => new Response(text, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const safeError = (reason, statuses = []) => error => {
  assert.ok(error instanceof ScientificSourceError);
  assert.equal(error.source_error.reason, reason);
  assert.ok(!JSON.stringify(error).includes('private-provider-body'));
  assert.ok(!String(error).includes('test-source-key'));
  if (statuses.length) assert.deepEqual(error.provider_attempts.map(row => row.status), statuses);
  return true;
};

test('genuine alternate search records both attempts, filters URLs and keeps usage unknown', async () => {
  const calls = [];
  const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: 'test-fallback-key', fetchImpl: async (endpoint, options) => {
    calls.push(endpoint);
    if (endpoint.endsWith('/search') && endpoint.includes('tavily')) return new Response('private-provider-body', { status: 403 });
    assert.equal(endpoint, 'https://api.firecrawl.dev/v2/search');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.sources, ['web']); assert.equal(body.limit, 5); assert.ok(body.includeDomains.includes('stat.ethz.ch'));
    assert.equal(body.scrapeOptions, undefined);
    assert.equal(options.headers.authorization, 'Bearer test-fallback-key');
    return new Response(JSON.stringify({ success: true, data: { web: [
      { url: primary, title: 'Official manual', description: 'Actual search excerpt' },
      { url: 'https://stat.ethz.ch.attacker.example/doc', description: 'bad' },
      { url: 'http://169.254.169.254/latest', description: 'bad' }
    ] } }));
  } });
  const result = await search('power t manual');
  assert.equal(result.provider, 'firecrawl_search'); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].content_scope, 'provider_excerpt');
  assert.equal(result.provider_attempts[0].http_status, 403);
  assert.equal(result.provider_attempts[0].usage_unknown, true); assert.equal(result.provider_usage, null);
  assert.equal(result.provider_usage_unknown, true); assert.equal(result.fallback_used, true);
  assert.equal((await search('power  t manual')).cache_hit, true); assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(result).includes('private-provider-body'));
  assert.ok(!JSON.stringify(result).includes('test-fallback-key'));
});

test('authentication/validation failures do not silently use an alternate search subscription', async () => {
  for (const status of [400, 401, 422]) {
    let calls = 0;
    const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: 'test-fallback-key', fetchImpl: async () => {
      calls++; return new Response('private-provider-body', { status });
    } });
    await assert.rejects(search('power'), error => error instanceof ScientificSourceError && error.source_error.http_status === status);
    assert.equal(calls, 1);
  }
});

test('both search providers failing return redacted enum diagnostics and no receipts', async () => {
  let calls = 0;
  const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: 'test-fallback-key', fetchImpl: async () => {
    calls++; return new Response('private-provider-body', { status: calls === 1 ? 503 : 429 });
  } });
  await assert.rejects(search('power'), safeError('rate_limited', ['failed', 'failed']));
  assert.equal(calls, 2);
});

test('search fallback accepts only reported credits and strips arbitrary provider usage diagnostics', async () => {
  const search = createSourceSearch({ apiKey: '', firecrawlApiKey: 'test-fallback-key', fetchImpl: async () => new Response(JSON.stringify({
    success: true, creditsUsed: 2, usage: { private_key: 'test-fallback-key' }, data: { web: [{ url: primary, description: 'Actual excerpt' }] }
  })) });
  const result = await search('power'); assert.deepEqual(result.provider_usage, { credits: 2 });
  assert.equal(result.provider_attempts[0].reason, 'not_configured'); assert.equal(result.provider_attempts[0].usage_unknown, false);
  assert.ok(!JSON.stringify(result).includes('test-fallback-key'));
});

test('known public HTML document falls back after extract failure without leaking provider authorization', async () => {
  let directCalls = 0;
  const reader = createSourceReader({ apiKey: 'test-source-key', fetchImpl: async () => new Response('private-provider-body', { status: 403 }),
    directFetchImpl: async (url, options) => {
      directCalls++; assert.equal(url, primary); assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, undefined); assert.ok(!JSON.stringify(options).includes('test-source-key'));
      return htmlResponse('<title>Power &amp; Sample Size</title><script>secret dynamic code</script><p>Actual method &#945; = 0.05</p>');
    } });
  const result = await reader(primary);
  assert.equal(result.provider, 'direct_primary_http'); assert.equal(result.results[0].content_scope, 'direct_markup_stripped_document_text');
  assert.equal(result.results[0].completeness_verified, false); assert.match(result.results[0].content, /Actual method α/);
  assert.ok(!result.results[0].content.includes('secret dynamic code'));
  assert.equal(result.provider_attempts[0].http_status, 403); assert.equal(result.provider_usage_unknown, true);
  assert.equal(result.results[0].content_sha256, createHash('sha256').update(result.results[0].content).digest('hex'));
  assert.equal((await reader(primary)).cache_hit, true); assert.equal(directCalls, 1);
});

test('missing extraction key still allows bounded known-document reading; no provider request is invented', async () => {
  const reader = createSourceReader({ apiKey: '', fetchImpl: async () => { throw new Error('must not call provider'); },
    directFetchImpl: async () => new Response('Actual plain method text', { headers: { 'content-type': 'text/plain' } }) });
  const result = await reader(primary); assert.equal(result.results[0].content_scope, 'direct_plain_document_text');
  assert.equal(result.provider_attempts[0].reason, 'not_configured'); assert.equal(result.provider_usage_unknown, false);
});

test('direct redirects are individually allowed and retain final URL instead of following private targets', async () => {
  const safeTarget = 'https://www.r-project.org/doc/manual.html';
  let calls = [];
  const reader = createSourceReader({ apiKey: '', directFetchImpl: async url => {
    calls.push(url); return url === primary ? new Response(null, { status: 302, headers: { location: safeTarget } }) : htmlResponse('<p>Actual safe method</p>');
  } });
  const result = await reader(primary); assert.deepEqual(calls, [primary, safeTarget]); assert.equal(result.results[0].final_url, safeTarget);
  const forbidden = ['http://stat.ethz.ch/doc', 'https://169.254.169.254/latest', 'https://user:pw@stat.ethz.ch/doc', 'https://stat.ethz.ch.attacker.example/doc'];
  for (const target of forbidden) {
    let count = 0;
    const rejectReader = createSourceReader({ apiKey: '', directFetchImpl: async () => { count++; return new Response(null, { status: 302, headers: { location: target } }); } });
    await assert.rejects(rejectReader(primary), safeError('url_not_allowed', ['failed', 'failed'])); assert.equal(count, 1);
  }
});

test('redirect loops and PDF/JSON/binary responses never become fake document text', async () => {
  let calls = 0;
  const looping = createSourceReader({ apiKey: '', directFetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: primary } }); } });
  await assert.rejects(looping(primary), safeError('redirect_limit')); assert.equal(calls, 4);
  for (const type of ['application/pdf', 'application/json', 'application/octet-stream', '']) {
    const reader = createSourceReader({ apiKey: '', directFetchImpl: async () => new Response('%PDF fake', { headers: { 'content-type': type } }) });
    await assert.rejects(reader(primary), safeError('unsupported_content'));
  }
});

test('streamed response byte caps and local text caps are enforced with actual hash', async () => {
  const oversized = createSourceReader({ apiKey: '', directFetchImpl: async () => new Response('x'.repeat(SOURCE_RESPONSE_LIMIT + 1), { headers: { 'content-type': 'text/plain' } }) });
  await assert.rejects(oversized(primary), safeError('response_too_large'));
  const bounded = createSourceReader({ apiKey: '', directFetchImpl: async () => new Response('x'.repeat(60000), { headers: { 'content-type': 'text/plain' } }) });
  const result = await bounded(primary); assert.equal(result.results[0].content.length, 50000); assert.equal(result.results[0].content_truncated, true);
  assert.equal(result.results[0].content_sha256, createHash('sha256').update('x'.repeat(50000)).digest('hex'));
});

test('direct content encodings and empty markup fail explicitly', async () => {
  for (const [headers, body, reason] of [
    [{ 'content-type': 'text/plain', 'content-encoding': 'gzip' }, 'not decoded', 'unsupported_encoding'],
    [{ 'content-type': 'text/plain; charset=madeup' }, 'text', 'unsupported_encoding'],
    [{ 'content-type': 'text/html' }, '<script>only JS</script>', 'empty_document']
  ]) {
    const reader = createSourceReader({ apiKey: '', directFetchImpl: async () => new Response(body, { headers }) });
    await assert.rejects(reader(primary), safeError(reason));
  }
});

test('caller cancellation never dispatches search fallback or direct document reading', async () => {
  for (const kind of ['search', 'reader']) {
    const controller = new AbortController(); let calls = 0, fallbackCalls = 0;
    const fetchImpl = async () => { calls++; controller.abort(); throw new Error('test-source-key private-provider-body'); };
    const operation = kind === 'search' ? createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: 'test-fallback-key', fetchImpl }) :
      createSourceReader({ apiKey: 'test-source-key', fetchImpl, directFetchImpl: async () => { fallbackCalls++; return htmlResponse('text'); } });
    await assert.rejects(operation(kind === 'search' ? 'power' : primary, { signal: controller.signal }), safeError('cancelled'));
    assert.equal(calls, 1); assert.equal(fallbackCalls, 0);
  }
});

test('null/malformed provider JSON and private errors cannot leak or fabricate search results', async () => {
  for (const body of ['null', '[1,2]', '{invalid', JSON.stringify({ success: false, error: 'test-fallback-key' })]) {
    const search = createSourceSearch({ apiKey: '', firecrawlApiKey: 'test-fallback-key', fetchImpl: async () => new Response(body) });
    await assert.rejects(search('power'), safeError('malformed_response'));
  }
  const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: '', fetchImpl: async () => { throw new Error('Authorization Bearer test-source-key private-provider-body'); } });
  await assert.rejects(search('power'), safeError('network_failure'));
});

test('HTML stripping preserves literal numbers and qualifies omitted nontext content', () => {
  const value = primaryHtmlText('<title>A &amp; B</title><p>n &lt; 40 and &#x3b1; = 0.05</p><svg>hidden figure 99</svg><style>bad</style>');
  assert.equal(value.title, 'A & B'); assert.match(value.content, /n < 40 and α = 0.05/); assert.ok(!value.content.includes('99'));
});

test('direct production DNS-address guard rejects private and special-use IPv4/IPv6', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.100.1.1', '198.51.100.1', '203.0.113.1',
    '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0db8:0:0:0:0:0:1']) assert.equal(isPublicSourceAddress(address), false, address);
  for (const address of ['8.8.8.8', '129.132.119.70', '2606:4700:4700::1111']) assert.equal(isPublicSourceAddress(address), true, address);
});

test('malformed individual source rows are ignored without leaking error internals', async () => {
  const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: '', fetchImpl: async () => new Response(JSON.stringify({
    results: [null, 12, {}, { url: primary, content: 'Valid excerpt' }]
  })) });
  assert.equal((await search('power')).results.length, 1);
  const reader = createSourceReader({ apiKey: 'test-source-key', fetchImpl: async () => new Response(JSON.stringify({
    results: [null, 12, { url: primary, raw_content: 'Actual provider extraction' }]
  })) });
  assert.equal((await reader(primary)).results[0].content, 'Actual provider extraction');
});

test('timeout is shared across provider and direct read; slow provider leaves fallback time', async () => {
  let fallback = 0;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const reader = createSourceReader({ apiKey: 'test-source-key', timeoutMs: 80, fetchImpl: async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }), directFetchImpl: async () => { fallback++; return htmlResponse('<p>Actual fallback</p>'); } });
    const result = await reader(primary); assert.equal(fallback, 1); assert.equal(result.provider_attempts[0].reason, 'timeout');
    const hanging = createSourceReader({ apiKey: '', timeoutMs: 40, directFetchImpl: async (_url, options) => new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }) });
    const started = Date.now(); await assert.rejects(hanging(primary), safeError('timeout')); assert.ok(Date.now() - started < 300);
  } finally { clearTimeout(keepAlive); }
});

test('already cancelled operation rejects even a cached receipt without another dispatch', async () => {
  let calls = 0;
  const reader = createSourceReader({ apiKey: '', directFetchImpl: async () => { calls++; return htmlResponse('<p>Actual text</p>'); } });
  await reader(primary);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(reader(primary, { signal: controller.signal }), safeError('cancelled'));
  assert.equal(calls, 1);
});

test('provider non-OK response body is cancelled without inspecting private body text', async () => {
  let cancelled = false;
  const search = createSourceSearch({ apiKey: 'test-source-key', firecrawlApiKey: '', fetchImpl: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; }
  }), { status: 403 }) });
  await assert.rejects(search('power'), safeError('http_forbidden'));
  assert.equal(cancelled, true);
});

test('alternate provider query limit is explicit and never silently changes the scientific search request', async () => {
  let calls = 0;
  const search = createSourceSearch({ apiKey: '', firecrawlApiKey: 'test-fallback-key', fetchImpl: async () => { calls++; throw new Error('must not dispatch'); } });
  await assert.rejects(search('x'.repeat(501)), error => {
    assert.equal(error.source_error.reason, 'query_limit'); assert.equal(error.source_error.usage_unknown, false);
    assert.equal(error.provider_attempts[1].dispatched, false); return true;
  });
  assert.equal(calls, 0);
});

test('actual adapter fallback metadata survives the orchestration receipt and cache accounting', async () => {
  const { runScientificAnalysis } = await import('./scientific-harness.js');
  let providerCalls = 0, directCalls = 0;
  const reader = createSourceReader({ apiKey: 'test-source-key', fetchImpl: async () => { providerCalls++; return new Response('private-provider-body', { status: 403 }); },
    directFetchImpl: async () => { directCalls++; return htmlResponse('<p>Actual method documentation</p>'); } });
  const design = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: 'fixture quantity', hypothesis: 'fixture hypothesis',
    method: 'fixture_method', alpha: .05, sidedness: 'two-sided', target_power: .8, allocation_ratio: 1, sample_size_unit: 'participants_per_group',
    parameters: [], assumptions: [], missing_information: [], clarification_questions: [], scientific_notes: [] };
  const answer = { summary: 'Fixture only', method: 'fixture_method', results: [{ metric: 'quantity', value: 64, unit: 'participants_per_group' }],
    assumptions: [], limitations: [], evidence_ids: ['e1'], simulation: null, citations: [] };
  const tool = (name, input) => ({ content: [{ type: 'tool_use', id: `fixture-${name}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'fixture-model' });
  const queue = [tool('read_source', { url: primary }), tool('read_source', { url: primary }), tool('submit_design', design),
    tool('execute_r', { code: 'fixture_only', purpose: 'Representation fixture' }), tool('submit_answer', answer)];
  const result = await runScientificAnalysis('Use the documented supplied scientific method', { model: 'claude-haiku-4-5-20251001', readSource: reader,
    executor: { createWorkspace: async () => ({ runId: 'source-fixture' }), executeRCode: async () => ({ success: true, exitCode: 0,
      output: 'POWER_AGENT_RESULT=' + JSON.stringify({ results: answer.results }) + '\n' }) }, transport: async () => queue.shift() });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(providerCalls, 1); assert.equal(directCalls, 1);
  assert.equal(result.sources[0].content_scope, 'direct_markup_stripped_document_text');
  const [first, cached] = result.source_requests;
  assert.equal(first.fallback_used, true); assert.equal(first.network_attempt_count, 2); assert.equal(first.usage_unknown, true);
  assert.equal(first.provider_attempts[0].reason, 'http_forbidden'); assert.equal(first.provider_attempts[0].success, false);
  assert.equal(first.provider_attempts[1].status, 'succeeded'); assert.equal(first.provider_attempts[1].success, true);
  assert.equal(cached.network_attempt_count, 0); assert.equal(cached.usage_unknown, false); assert.equal(cached.historical_attempt_usage_unknown, true);
  assert.equal(result.budget.used.source_reads, 2); assert.ok(!JSON.stringify(result).includes('test-source-key'));
});
