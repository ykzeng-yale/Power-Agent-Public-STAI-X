import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSourceSearch, createSourceReader, isPrimarySourceUrl } from './scientific-sources.js';

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
  await assert.rejects(read('https://localhost/doc'), /allowed HTTPS/);
});

test('source URL and transport failures do not fabricate receipts or expose keys', async () => {
  for (const url of ['file:///private', 'https://user:pass@stat.ethz.ch/x', 'https://stat.ethz.ch:8080/x', 'https://127.0.0.1/']) assert.equal(isPrimarySourceUrl(url), false);
  assert.equal(createSourceSearch({ apiKey: '' }), null);
  const search = createSourceSearch({ apiKey: 'test-source-key', fetchImpl: async () => new Response('private-provider-body', { status: 401 }) });
  await assert.rejects(search('R power'), /HTTP 401/);
  await assert.rejects(search(''), /1–1500/);
});
