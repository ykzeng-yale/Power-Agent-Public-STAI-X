/**
 * Firecrawl Web Content Extraction Tool
 *
 * Provides deep content extraction from web pages using Firecrawl API.
 * Used alongside Tavily search for comprehensive web research:
 * - Tavily: Quick search discovery (URLs + snippets)
 * - Firecrawl: Deep content extraction (full articles/papers)
 */

import axios from 'axios';

class FirecrawlTool {
  constructor() {
    this.baseUrl = 'https://api.firecrawl.dev/v1';
    this.defaultTimeout = 60000; // 60 seconds for extraction
    this._apiKey = null;
  }

  // Lazy-load API key from environment
  get apiKey() {
    if (!this._apiKey) {
      this._apiKey = process.env.FIRECRAWL_API_KEY;
      if (!this._apiKey) {
        console.warn('[Firecrawl] Warning: FIRECRAWL_API_KEY not found. Deep extraction will not work.');
      }
    }
    return this._apiKey;
  }

  /**
   * Scrape a single URL and get LLM-ready content
   *
   * @param {string} url - URL to scrape
   * @param {object} options - Scrape options
   * @param {string[]} options.formats - Output formats: 'markdown', 'html', 'rawHtml', 'links', 'screenshot'
   * @param {boolean} options.onlyMainContent - Extract only main content (default: true)
   * @param {number} options.timeout - Request timeout in ms
   * @returns {Promise<object>} Scraped content with metadata
   */
  async scrape(url, options = {}) {
    const {
      formats = ['markdown'],
      onlyMainContent = true,
      timeout = this.defaultTimeout
    } = options;

    if (!this.apiKey) {
      return {
        success: false,
        error: 'FIRECRAWL_API_KEY not configured',
        url
      };
    }

    try {
      console.log(`[Firecrawl] Scraping: ${url}`);

      const response = await axios.post(
        `${this.baseUrl}/scrape`,
        {
          url,
          formats,
          onlyMainContent
        },
        {
          timeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      const data = response.data;
      console.log(`[Firecrawl] Scraped ${data.data?.markdown?.length || 0} chars from ${url}`);

      return {
        success: true,
        url,
        title: data.data?.metadata?.title || '',
        description: data.data?.metadata?.description || '',
        markdown: data.data?.markdown || '',
        html: data.data?.html || '',
        links: data.data?.links || [],
        metadata: data.data?.metadata || {}
      };

    } catch (error) {
      console.error(`[Firecrawl] Scrape failed: ${error.message}`);

      // Handle rate limiting
      if (error.response?.status === 429) {
        return {
          success: false,
          error: 'Rate limited - too many requests',
          url
        };
      }

      return {
        success: false,
        error: error.message,
        url
      };
    }
  }

  /**
   * Extract structured data from a URL using AI
   *
   * @param {string} url - URL to extract from
   * @param {string} prompt - Natural language extraction prompt
   * @param {object} schema - Optional JSON schema for structured output
   * @returns {Promise<object>} Extracted data
   */
  async extract(url, prompt, schema = null) {
    if (!this.apiKey) {
      return {
        success: false,
        error: 'FIRECRAWL_API_KEY not configured',
        url
      };
    }

    try {
      console.log(`[Firecrawl] Extracting from: ${url}`);

      const requestBody = {
        urls: [url],
        prompt
      };

      if (schema) {
        requestBody.schema = schema;
      }

      const response = await axios.post(
        `${this.baseUrl}/extract`,
        requestBody,
        {
          timeout: this.defaultTimeout,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          }
        }
      );

      console.log(`[Firecrawl] Extraction complete`);

      return {
        success: true,
        url,
        data: response.data.data || response.data
      };

    } catch (error) {
      console.error(`[Firecrawl] Extract failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
        url
      };
    }
  }

  /**
   * Scrape multiple URLs in batch
   *
   * @param {string[]} urls - URLs to scrape
   * @param {object} options - Scrape options
   * @returns {Promise<object[]>} Array of scraped content
   */
  async scrapeBatch(urls, options = {}) {
    console.log(`[Firecrawl] Batch scraping ${urls.length} URLs`);

    const results = await Promise.allSettled(
      urls.map(url => this.scrape(url, options))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          error: result.reason?.message || 'Unknown error',
          url: urls[index]
        };
      }
    });
  }

  /**
   * Format scraped content for agent consumption
   *
   * @param {object} scrapeResult - Raw Firecrawl scrape result
   * @param {number} maxLength - Maximum content length (default: 8000)
   * @returns {string} Formatted text for agents
   */
  formatForAgent(scrapeResult, maxLength = 8000) {
    if (!scrapeResult.success) {
      return `Failed to extract content: ${scrapeResult.error}`;
    }

    let formatted = `## ${scrapeResult.title || 'Untitled'}\n`;
    formatted += `**Source:** ${scrapeResult.url}\n\n`;

    if (scrapeResult.description) {
      formatted += `**Summary:** ${scrapeResult.description}\n\n`;
    }

    formatted += `### Content\n\n`;

    // Truncate if too long
    const content = scrapeResult.markdown || '';
    if (content.length > maxLength) {
      formatted += content.substring(0, maxLength) + '\n\n... [Content truncated]';
    } else {
      formatted += content;
    }

    return formatted;
  }

  /**
   * Create Claude-compatible tool definition for Firecrawl
   */
  getClaudeToolDefinition() {
    return {
      name: 'firecrawl_scrape',
      description: 'Extract full content from a web page URL. Use this after Tavily search to get complete article text, research papers, or documentation. Returns clean markdown formatted content suitable for LLM analysis.',
      input_schema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL of the web page to scrape'
          },
          only_main_content: {
            type: 'boolean',
            description: 'Extract only main content, excluding navigation, ads, etc. (default: true)',
            default: true
          }
        },
        required: ['url']
      }
    };
  }
}

// Export singleton instance
const firecrawlTool = new FirecrawlTool();
export default firecrawlTool;
export { FirecrawlTool };
