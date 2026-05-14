/**
 * Tavily Web Search Tool for Multi-Agent System
 *
 * Provides web search capability using Tavily API with timeout protection.
 * Can be used by agents (Clinical Judge, Biostat Agent) for research.
 */

import axios from 'axios';

class TavilySearchTool {
  constructor() {
    this.baseUrl = 'https://api.tavily.com/search';
    this.defaultTimeout = 30000; // 30 seconds max
    this._apiKey = null; // Cache for API key
  }

  // Lazy-load API key from environment when needed
  get apiKey() {
    if (!this._apiKey) {
      this._apiKey = process.env.TAVILY_API_KEY;
      if (!this._apiKey) {
        console.warn('[Tavily] Warning: TAVILY_API_KEY not found in environment variables. Web search will not work.');
      }
    }
    return this._apiKey;
  }

  /**
   * Search the web using Tavily API
   *
   * @param {string} query - The search query
   * @param {object} options - Search options
   * @param {number} options.max_results - Maximum number of results (default: 3)
   * @param {string} options.search_depth - 'basic' or 'advanced' (default: 'basic')
   * @param {string[]} options.include_domains - Domains to include (e.g., ['pubmed.ncbi.nlm.nih.gov'])
   * @param {number} options.timeout - Request timeout in ms (default: 30000)
   * @returns {Promise<object>} Search results with title, url, content
   */
  async search(query, options = {}) {
    const {
      max_results = 3,
      search_depth = 'basic',
      include_domains = [],
      timeout = this.defaultTimeout
    } = options;

    try {
      console.log(`[Tavily] Searching: "${query}" (timeout: ${timeout}ms)`);

      const response = await axios.post(
        this.baseUrl,
        {
          api_key: this.apiKey,
          query: query,
          max_results: max_results,
          search_depth: search_depth,
          include_domains: include_domains.length > 0 ? include_domains : undefined,
          include_answer: true // Get AI-generated answer summary
        },
        {
          timeout: timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      console.log(`[Tavily] Found ${response.data.results?.length || 0} results`);

      return {
        success: true,
        query: query,
        answer: response.data.answer, // AI-generated summary
        results: response.data.results || [],
        images: response.data.images || []
      };

    } catch (error) {
      console.error(`[Tavily] Search failed: ${error.message}`);

      if (error.code === 'ECONNABORTED') {
        return {
          success: false,
          error: 'Search timeout - request took longer than ${timeout}ms',
          query: query,
          results: []
        };
      }

      return {
        success: false,
        error: error.message,
        query: query,
        results: []
      };
    }
  }

  /**
   * Search medical literature using domain-specific search
   *
   * @param {string} query - Medical search query
   * @returns {Promise<object>} Medical search results
   */
  async searchMedical(query) {
    return this.search(query, {
      max_results: 5,
      search_depth: 'advanced',
      include_domains: [
        'pubmed.ncbi.nlm.nih.gov',
        'nejm.org',
        'jamanetwork.com',
        'thelancet.com',
        'bmj.com'
      ],
      timeout: 30000
    });
  }

  /**
   * Search R documentation and statistical resources
   *
   * @param {string} query - R/statistics search query
   * @returns {Promise<object>} R documentation search results
   */
  async searchRDocumentation(query) {
    return this.search(query, {
      max_results: 5,
      search_depth: 'basic',
      include_domains: [
        'rdocumentation.org',
        'stat.ethz.ch',
        'cran.r-project.org',
        'stackoverflow.com',
        'rdrr.io'
      ],
      timeout: 30000
    });
  }

  /**
   * Format search results for agent consumption
   *
   * @param {object} searchResults - Raw Tavily search results
   * @returns {string} Formatted text summary for agents
   */
  formatResultsForAgent(searchResults) {
    if (!searchResults.success) {
      return `Search failed: ${searchResults.error}`;
    }

    let formatted = `Search Results for: "${searchResults.query}"\n\n`;

    if (searchResults.answer) {
      formatted += `AI Summary: ${searchResults.answer}\n\n`;
    }

    if (searchResults.results && searchResults.results.length > 0) {
      formatted += `Top Results:\n`;
      searchResults.results.forEach((result, index) => {
        formatted += `\n${index + 1}. ${result.title}\n`;
        formatted += `   URL: ${result.url}\n`;
        formatted += `   ${result.content.substring(0, 200)}...\n`;
      });
    } else {
      formatted += `No results found.\n`;
    }

    return formatted;
  }

  /**
   * Create a Claude-compatible tool definition for Tavily search
   *
   * @param {string} toolType - 'medical' or 'statistical' for domain-specific search
   * @returns {object} Claude tool definition
   */
  getClaudeToolDefinition(toolType = 'general') {
    const toolDefinitions = {
      general: {
        name: 'tavily_web_search',
        description: 'Search the web for information using Tavily. Returns relevant web pages with AI-generated summaries. Use this to find current information, research papers, or documentation.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            },
            max_results: {
              type: 'number',
              description: 'Maximum number of results to return (1-10)',
              default: 3
            }
          },
          required: ['query']
        }
      },

      medical: {
        name: 'tavily_medical_search',
        description: 'Search medical literature and clinical resources (PubMed, NEJM, JAMA, Lancet, BMJ) using Tavily. Returns peer-reviewed medical information with AI-generated summaries.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The medical search query (e.g., "RCT sample size blood pressure")'
            }
          },
          required: ['query']
        }
      },

      statistical: {
        name: 'tavily_r_documentation_search',
        description: 'Search R documentation and statistical resources (CRAN, RDocumentation, StackOverflow) using Tavily. Use this to find R function documentation or statistical methods.',
        input_schema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The R/statistics search query (e.g., "power.t.test R documentation")'
            }
          },
          required: ['query']
        }
      }
    };

    return toolDefinitions[toolType] || toolDefinitions.general;
  }
}

// Export singleton instance
const tavilySearchTool = new TavilySearchTool();
export default tavilySearchTool;
export { TavilySearchTool };
