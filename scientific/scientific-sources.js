import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

export const PRIMARY_SOURCE_DOMAINS = Object.freeze([
  'r-project.org', 'stat.ethz.ch', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov',
  'doi.org', 'onlinelibrary.wiley.com', 'academic.oup.com', 'bmj.com',
  'jamanetwork.com', 'nejm.org', 'nature.com', 'springer.com', 'link.springer.com',
  'stata.com', 'researchmethodsresources.nih.gov'
]);
export const SOURCE_RESPONSE_LIMIT = 2000000;
export const SOURCE_USER_AGENT = 'Mozilla/5.0 (compatible; PowerAgent/2.2.2; +https://power-agent.io)';
const REASONS = new Set(['http_authentication', 'http_forbidden', 'rate_limited', 'provider_http_failure',
  'timeout', 'cancelled', 'network_failure', 'malformed_response', 'response_too_large',
  'no_extracted_text', 'unsupported_content', 'unsupported_encoding', 'url_not_allowed',
  'redirect_limit', 'empty_document', 'nonpublic_address', 'not_configured', 'query_limit']);

/** Fixed enum metadata only: never propagate a provider body, request headers,
 * credentials, original network exception or its cause. */
export class ScientificSourceError extends Error {
  constructor(provider, operation, reason, status = null, attempts = []) {
    const safeReason = REASONS.has(reason) ? reason : 'network_failure';
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    super(`Primary-source ${operation} failed: ${safeReason}${safeStatus ? ` (HTTP ${safeStatus})` : ''}`);
    this.name = 'ScientificSourceError'; this.code = 'SCIENTIFIC_SOURCE_ERROR';
    this.source_error = { provider, operation, reason: safeReason, http_status: safeStatus,
      usage_unknown: ['tavily', 'tavily_extract', 'firecrawl_search'].includes(provider) && !['not_configured', 'query_limit'].includes(safeReason) };
    this.provider_attempts = attempts;
  }
}
const statusReason = status => status === 401 ? 'http_authentication' : status === 403 ? 'http_forbidden' :
  status === 429 ? 'rate_limited' : 'provider_http_failure';
const transportReason = (error, signal) => signal?.aborted ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled') :
  error?.name === 'TimeoutError' ? 'timeout' : 'network_failure';
function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function checkAbort(signal, provider, operation) {
  if (signal?.aborted) throw new ScientificSourceError(provider, operation, transportReason(null, signal));
}
const failedAttempt = error => ({ ...error.source_error, status: 'failed', dispatched: !['not_configured', 'query_limit'].includes(error.source_error.reason), provider_usage: null });
export function isPrimarySourceUrl(value, domains = PRIMARY_SOURCE_DOMAINS) {
  try {
    const url = new URL(value);
    return typeof value === 'string' && value.length <= 3000 && url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
}

// Conservative public-address filter; the actual HTTPS request uses the checked
// DNS addresses, preventing a second unvalidated lookup or private redirect.
export function isPublicSourceAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 2))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const value = new URL('https://[' + address + ']/').hostname.slice(1, -1).toLowerCase();
    return /^[23][0-9a-f]{0,3}:/.test(value) && !value.startsWith('2001:db8:') &&
      !value.startsWith('2001:0:') && !value.startsWith('2002:');
  }
  return false;
}
async function raceAbort(promise, signal) {
  if (signal.aborted) throw signal.reason;
  let listener;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      listener = () => reject(signal.reason); signal.addEventListener('abort', listener, { once: true });
    })]);
  } finally { signal.removeEventListener('abort', listener); }
}

/** Native direct transport: no provider Authorization header or key; manual
 * redirect handling, public DNS pinning, TLS validation, and bounded bytes. */
async function directHttpsFetch(url, { signal, headers }) {
  const addresses = await raceAbort(lookup(new URL(url).hostname, { all: true, verbatim: true }), signal);
  if (!addresses.length || addresses.some(row => !isPublicSourceAddress(row.address)))
    throw new ScientificSourceError('direct_primary_http', 'read', 'nonpublic_address');
  return await new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'GET', headers, signal,
      lookup: (_host, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family)
    }, response => {
      const status = response.statusCode || 0, responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined)
        responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      if (status < 200 || status >= 300) { response.destroy(); resolve(new Response(null, { status, headers: responseHeaders })); return; }
      const length = Number(response.headers['content-length']);
      if (Number.isFinite(length) && length > SOURCE_RESPONSE_LIMIT) {
        response.destroy(); reject(new ScientificSourceError('direct_primary_http', 'read', 'response_too_large')); return;
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > SOURCE_RESPONSE_LIMIT) { response.destroy(); reject(new ScientificSourceError('direct_primary_http', 'read', 'response_too_large')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status, headers: responseHeaders })));
      response.on('error', reject);
    });
    req.on('error', reject); req.end();
  });
}
async function boundedBody(response, signal, provider, operation) {
  checkAbort(signal, provider, operation);
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > SOURCE_RESPONSE_LIMIT) throw new ScientificSourceError(provider, operation, 'response_too_large');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > SOURCE_RESPONSE_LIMIT) throw new ScientificSourceError(provider, operation, 'response_too_large');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function providerJson(endpoint, payload, apiKey, fetchImpl, signal, provider, operation) {
  try {
    checkAbort(signal, provider, operation);
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey, 'user-agent': SOURCE_USER_AGENT },
      body: JSON.stringify(payload), signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ScientificSourceError(provider, operation, statusReason(response.status), response.status);
    }
    const bytes = await boundedBody(response, signal, provider, operation);
    try {
      const found = JSON.parse(bytes.toString('utf8'));
      if (!found || typeof found !== 'object' || Array.isArray(found)) throw new Error('invalid object');
      return found;
    }
    catch { throw new ScientificSourceError(provider, operation, 'malformed_response'); }
  } catch (error) {
    if (error instanceof ScientificSourceError) throw error;
    throw new ScientificSourceError(provider, operation, transportReason(error, signal));
  }
}
function usageRecord(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const record = {};
  for (const key of ['credits', 'input_tokens', 'output_tokens', 'total_tokens'])
    if (Number.isFinite(usage[key]) && usage[key] >= 0) record[key] = usage[key];
  return Object.keys(record).length ? record : null;
}
function searchUnavailable(error) {
  const { reason, http_status } = error.source_error;
  return ['network_failure', 'timeout', 'http_forbidden', 'rate_limited'].includes(reason) ||
    (reason === 'provider_http_failure' && http_status >= 500);
}
function searchRows(rows, domains, scope, retrieved_at, contentField) {
  return (Array.isArray(rows) ? rows : []).filter(row => row && typeof row === 'object' && isPrimarySourceUrl(row.url, domains) && typeof row[contentField] === 'string')
    .slice(0, 5).map(row => {
      const content = row[contentField].slice(0, 6000);
      return { title: String(row.title || '').slice(0, 500), url: row.url, content,
        content_sha256: createHash('sha256').update(content).digest('hex'), retrieved_at,
        source_type: 'allowed_primary_domain', content_scope: scope, content_truncated: row[contentField].length > content.length,
        truncation_scope: 'Local character cap only; the provider supplies a search excerpt, not a full document.' };
    });
}

/** Actual search APIs only; snippets are never treated as complete documents or
 * model-generated answers. Firecrawl is a bounded fallback for unavailability. */
export function createSourceSearch({ apiKey = process.env.TAVILY_API_KEY, firecrawlApiKey = process.env.FIRECRAWL_API_KEY,
  fetchImpl = globalThis.fetch, domains = PRIMARY_SOURCE_DOMAINS, timeoutMs = 20000 } = {}) {
  if (!apiKey && !firecrawlApiKey) return null;
  const cache = new Map();
  return async (query, { signal } = {}) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 1500) throw new Error('Source query must contain 1–1500 characters');
    const key = query.trim().replace(/\s+/g, ' '), attempts = [], overallSignal = combinedSignal(signal, timeoutMs);
    checkAbort(signal, 'tavily', 'search');
    if (cache.has(key)) return { ...cache.get(key), cache_hit: true };
    if (apiKey) {
      try {
        const found = await providerJson('https://api.tavily.com/search', { query: key, search_depth: 'basic', topic: 'general', max_results: 5,
          include_domains: domains, include_answer: false, include_raw_content: false, include_images: false, include_usage: true },
          apiKey, fetchImpl, combinedSignal(overallSignal, firecrawlApiKey ? Math.min(10000, timeoutMs / 2) : timeoutMs), 'tavily', 'search');
        const retrieved_at = new Date().toISOString(), usage = usageRecord(found.usage);
        const value = { provider: 'tavily', query: key, results: searchRows(found.results, domains, 'provider_excerpt', retrieved_at, 'content'), retrieved_at,
          provider_usage: usage, cache_hit: false, fallback_used: false,
          provider_attempts: [{ provider: 'tavily', operation: 'search', status: 'succeeded', dispatched: true, provider_usage: usage, usage_unknown: usage === null }],
          qualification: 'Recorded primary-domain search snippets; URL matching does not certify scientific support.' };
        cache.set(key, value); return value;
      } catch (error) {
        attempts.push(failedAttempt(error));
        if (!firecrawlApiKey || signal?.aborted || overallSignal.aborted || !searchUnavailable(error))
          throw new ScientificSourceError('tavily', 'search', error.source_error.reason, error.source_error.http_status, attempts);
      }
    } else attempts.push(failedAttempt(new ScientificSourceError('tavily', 'search', 'not_configured')));
    try {
      if (key.length > 500) throw new ScientificSourceError('firecrawl_search', 'search', 'query_limit');
      const found = await providerJson('https://api.firecrawl.dev/v2/search', { query: key, includeDomains: domains, sources: ['web'],
        limit: 5, timeout: Math.min(20000, Math.max(1, Math.floor(timeoutMs))), ignoreInvalidURLs: true },
        firecrawlApiKey, fetchImpl, overallSignal, 'firecrawl_search', 'search');
      if (found.success === false || !Array.isArray(found.data?.web)) throw new ScientificSourceError('firecrawl_search', 'search', 'malformed_response');
      const retrieved_at = new Date().toISOString(), usage = usageRecord(found.usage) || usageRecord({ credits: found.creditsUsed });
      const value = { provider: 'firecrawl_search', query: key, results: searchRows(found.data.web, domains, 'provider_excerpt', retrieved_at, 'description'),
        retrieved_at, provider_usage: usage, cache_hit: false, fallback_used: true,
        provider_attempts: [...attempts, { provider: 'firecrawl_search', operation: 'search', status: 'succeeded', dispatched: true, provider_usage: usage, usage_unknown: usage === null }],
        provider_usage_unknown: attempts.some(attempt => attempt.usage_unknown) || usage === null,
        provider_billing_scope: 'Failed provider attempts have unknown billable usage; alternate usage includes only provider-reported values. No invoice or quota diagnosis.',
        qualification: 'Actual alternate-provider web-search snippets from allowed primary domains; not full-document reading or scientific certification.' };
      cache.set(key, value); return value;
    } catch (error) {
      throw new ScientificSourceError('firecrawl_search', 'search', error.source_error.reason, error.source_error.http_status, [...attempts, failedAttempt(error)]);
    }
  };
}
function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole;
    const cp = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : whole;
  });
}
export function primaryHtmlText(markup) {
  const title = markup.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const content = markup.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|h[1-6]|li|tr|br|pre|section|article)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ');
  return { title: decodeEntities(title.replace(/<[^>]*>/g, ' ')).trim().slice(0, 500),
    content: decodeEntities(content).replace(/[\t\r ]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim() };
}
async function directDocument(url, domains, fetchImpl, signal) {
  let target = url; const redirects = [];
  try {
    for (let hop = 0; hop <= 3; hop++) {
      checkAbort(signal, 'direct_primary_http', 'read');
      if (!isPrimarySourceUrl(target, domains)) throw new ScientificSourceError('direct_primary_http', 'read', 'url_not_allowed');
      const response = await fetchImpl(target, { method: 'GET', redirect: 'manual', signal,
        headers: { accept: 'text/html, application/xhtml+xml, text/plain;q=0.9', 'accept-encoding': 'identity', 'user-agent': SOURCE_USER_AGENT } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        if (hop === 3) throw new ScientificSourceError('direct_primary_http', 'read', 'redirect_limit');
        const location = response.headers.get('location');
        try { target = location ? new URL(location, target).href : ''; } catch { target = ''; }
        if (!isPrimarySourceUrl(target, domains)) throw new ScientificSourceError('direct_primary_http', 'read', 'url_not_allowed');
        redirects.push(target); continue;
      }
      if (!response.ok) throw new ScientificSourceError('direct_primary_http', 'read', statusReason(response.status), response.status);
      const media = response.headers.get('content-type') || '', html = /^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(media);
      if (!html && !/^text\/plain(?:;|$)/i.test(media)) throw new ScientificSourceError('direct_primary_http', 'read', 'unsupported_content');
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw new ScientificSourceError('direct_primary_http', 'read', 'unsupported_encoding');
      const bytes = await boundedBody(response, signal, 'direct_primary_http', 'read');
      const charset = media.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
      let decoded;
      try { decoded = new TextDecoder(charset, { fatal: true }).decode(bytes); }
      catch { throw new ScientificSourceError('direct_primary_http', 'read', 'unsupported_encoding'); }
      const parsed = html ? primaryHtmlText(decoded) : { title: '', content: decoded.trim() };
      if (!parsed.content) throw new ScientificSourceError('direct_primary_http', 'read', 'empty_document');
      const content = parsed.content.slice(0, 50000), retrieved_at = new Date().toISOString();
      return { provider: 'direct_primary_http', query: url, results: [{ title: parsed.title || target, url, final_url: target, content,
        content_sha256: createHash('sha256').update(content).digest('hex'), retrieved_at, response_bytes: bytes.length,
        source_type: 'allowed_primary_domain', content_scope: html ? 'direct_markup_stripped_document_text' : 'direct_plain_document_text',
        content_truncated: parsed.content.length > content.length, completeness_verified: false,
        truncation_scope: 'Bounded direct HTML/plain-text response; markup stripping can omit equations, figures, layout and dynamic content. Not a PDF extraction or full-document certification.' }],
        retrieved_at, provider_usage: null, cache_hit: false, redirect_chain: redirects,
        qualification: 'Actual public-primary HTTPS text, untrusted source material. Scientific support, visible-page fidelity and completeness require review.' };
    }
  } catch (error) {
    if (error instanceof ScientificSourceError) throw error;
    throw new ScientificSourceError('direct_primary_http', 'read', transportReason(error, signal));
  }
}

/** Prefer provider extraction; fallback only to a known public HTML/plain-text
 * document. Its overall deadline includes both attempts. Never fake PDF text. */
export function createSourceReader({ apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = globalThis.fetch, directFetchImpl = directHttpsFetch, domains = PRIMARY_SOURCE_DOMAINS, timeoutMs = 30000 } = {}) {
  const cache = new Map();
  return async (url, { signal } = {}) => {
    if (!isPrimarySourceUrl(url, domains)) throw new ScientificSourceError('direct_primary_http', 'read', 'url_not_allowed');
    checkAbort(signal, 'tavily_extract', 'read');
    if (cache.has(url)) return { ...cache.get(url), cache_hit: true };
    const overallSignal = combinedSignal(signal, timeoutMs), attempts = [];
    if (apiKey) {
      try {
        const found = await providerJson('https://api.tavily.com/extract', { urls: [url], extract_depth: 'basic', format: 'text', include_usage: true },
          apiKey, fetchImpl, combinedSignal(overallSignal, Math.min(15000, timeoutMs / 2)), 'tavily_extract', 'read');
        const row = (Array.isArray(found.results) ? found.results : []).find(result => result && typeof result === 'object' && result.url === url && typeof result.raw_content === 'string' && result.raw_content.trim());
        if (!row) throw new ScientificSourceError('tavily_extract', 'read', 'no_extracted_text');
        const content = row.raw_content.slice(0, 50000), retrieved_at = new Date().toISOString(), usage = usageRecord(found.usage);
        const value = { provider: 'tavily_extract', query: url, results: [{ title: String(row.title || url).slice(0, 500), url, content,
          content_sha256: createHash('sha256').update(content).digest('hex'), retrieved_at,
          source_type: 'allowed_primary_domain', content_scope: 'provider_extracted_document_text', content_truncated: row.raw_content.length > content.length,
          truncation_scope: 'Local character cap; provider extraction can omit pages, equations, figures or tables.' }],
          retrieved_at, provider_usage: usage, cache_hit: false, fallback_used: false,
          provider_attempts: [{ provider: 'tavily_extract', operation: 'read', status: 'succeeded', dispatched: true, provider_usage: usage, usage_unknown: usage === null }],
          qualification: 'Provider-extracted text is untrusted evidence; extraction completeness and scientific support require review.' };
        cache.set(url, value); return value;
      } catch (error) {
        attempts.push(failedAttempt(error));
        if (signal?.aborted || overallSignal.aborted)
          throw new ScientificSourceError('tavily_extract', 'read', transportReason(null, signal?.aborted ? signal : overallSignal), null, attempts);
      }
    } else attempts.push(failedAttempt(new ScientificSourceError('tavily_extract', 'read', 'not_configured')));
    try {
      const value = await directDocument(url, domains, directFetchImpl, overallSignal);
      value.fallback_used = true; value.provider_attempts = [...attempts,
        { provider: 'direct_primary_http', operation: 'read', status: 'succeeded', dispatched: true, provider_usage: null, usage_unknown: false }];
      value.provider_usage_unknown = attempts.some(attempt => attempt.usage_unknown);
      value.provider_billing_scope = 'Direct public HTTPS has no source-provider invoice; billable usage of a failed provider attempt remains unknown. No quota diagnosis.';
      cache.set(url, value); return value;
    } catch (error) {
      throw new ScientificSourceError('direct_primary_http', 'read', error.source_error.reason, error.source_error.http_status, [...attempts, failedAttempt(error)]);
    }
  };
}
