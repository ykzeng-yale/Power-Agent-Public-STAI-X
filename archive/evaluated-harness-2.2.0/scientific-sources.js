import { createHash } from 'node:crypto';

export const PRIMARY_SOURCE_DOMAINS = Object.freeze([
  'r-project.org', 'stat.ethz.ch', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov',
  'doi.org', 'onlinelibrary.wiley.com', 'academic.oup.com', 'bmj.com',
  'jamanetwork.com', 'nejm.org', 'nature.com', 'springer.com', 'link.springer.com',
  'stata.com', 'researchmethodsresources.nih.gov'
]);

export function isPrimarySourceUrl(value, domains = PRIMARY_SOURCE_DOMAINS) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && domains.some(domain =>
        url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
}

/** Primary-domain retrieval shared by hosted and portable workflows.
 * Snippets are source material, not an oracle or a claim that the full page was read.
 * Model-generated search summaries are deliberately excluded.
 */
export function createSourceSearch({ apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = globalThis.fetch, domains = PRIMARY_SOURCE_DOMAINS, timeoutMs = 20000 } = {}) {
  if (!apiKey) return null;
  const cache = new Map();
  return async (query, { signal } = {}) => {
    if (typeof query !== 'string' || !query.trim() || query.length > 1500) throw new Error('Source query must contain 1–1500 characters');
    const key = query.trim().replace(/\s+/g, ' ');
    if (cache.has(key)) return { ...cache.get(key), cache_hit: true };
    const response = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ query: key, search_depth: 'basic', topic: 'general', max_results: 5,
        include_domains: domains, include_answer: false, include_raw_content: false, include_images: false, include_usage: true }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Primary-source search failed (HTTP ${response.status})`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2000000) throw new Error('Source response exceeds the capture limit');
    const found = JSON.parse(text), retrieved_at = new Date().toISOString();
    const results = (Array.isArray(found.results) ? found.results : [])
      .filter(row => isPrimarySourceUrl(row.url, domains) && typeof row.content === 'string')
      .slice(0, 5).map(row => {
        const content = row.content.slice(0, 6000);
        return { title: String(row.title || '').slice(0, 500), url: row.url, content,
          content_sha256: createHash('sha256').update(content).digest('hex'), retrieved_at,
          source_type: 'allowed_primary_domain', content_scope: 'provider_excerpt',
          content_truncated: row.content.length > content.length,
          truncation_scope: 'Local character cap only; the provider may have excerpted the original document.' };
      });
    const value = { provider: 'tavily', query: key, results, retrieved_at,
      provider_usage: found.usage || null, cache_hit: false,
      qualification: 'Recorded primary-domain snippets; a matching URL does not certify that a citation supports a claim.' };
    cache.set(key, value);
    return value;
  };
}

/** Retrieve provider-extracted primary document text. This does not verify
 * completeness, mathematical suitability or a PDF's visual structure. */
export function createSourceReader({ apiKey = process.env.TAVILY_API_KEY,
  fetchImpl = globalThis.fetch, domains = PRIMARY_SOURCE_DOMAINS, timeoutMs = 30000 } = {}) {
  if (!apiKey) return null;
  const cache = new Map();
  return async (url, { signal } = {}) => {
    if (!isPrimarySourceUrl(url, domains)) throw new Error('Document URL must belong to an allowed HTTPS primary-source domain');
    if (cache.has(url)) return { ...cache.get(url), cache_hit: true };
    const response = await fetchImpl('https://api.tavily.com/extract', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ urls: [url], extract_depth: 'basic', format: 'text', include_usage: true }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) throw new Error(`Primary document read failed (HTTP ${response.status})`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 2000000) throw new Error('Document response exceeds the capture limit');
    const found = JSON.parse(text), retrieved_at = new Date().toISOString();
    const row = (found.results || []).find(result => result.url === url && typeof result.raw_content === 'string');
    if (!row) throw new Error('Provider returned no extracted text for the requested primary document');
    const content = row.raw_content.slice(0, 50000);
    const value = { provider: 'tavily_extract', query: url, results: [{ title: String(row.title || url).slice(0, 500), url, content,
      content_sha256: createHash('sha256').update(content).digest('hex'), retrieved_at,
      source_type: 'allowed_primary_domain', content_scope: 'provider_extracted_document_text',
      content_truncated: row.raw_content.length > content.length,
      truncation_scope: 'Local character cap; provider extraction can omit pages, equations, figures or tables.' }],
      retrieved_at, provider_usage: found.usage || null, cache_hit: false,
      qualification: 'Provider-extracted text is untrusted evidence; extraction completeness and scientific support require review.' };
    cache.set(url, value);
    return value;
  };
}
