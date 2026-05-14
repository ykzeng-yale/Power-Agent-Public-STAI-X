/**
 * Complete Demo - Production-Ready Data Analysis Agent
 * 
 * This example shows a complete, production-ready implementation
 * with error handling, rate limiting, caching, and logging.
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

class ProductionDataAnalysisAgent {
  constructor(options = {}) {
    this.anthropic = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY,
    });

    this.model = options.model || 'claude-sonnet-4-20250514';
    this.maxTokens = options.maxTokens || 4096;

    // Simple in-memory cache (use Redis in production)
    this.cache = new Map();
    this.cacheEnabled = options.cache !== false;
    this.cacheTTL = options.cacheTTL || 3600 * 1000; // 1 hour

    // Rate limiting
    this.rateLimitWindow = options.rateLimitWindow || 60 * 1000; // 1 minute
    this.rateLimitMax = options.rateLimitMax || 10;
    this.requestCounts = new Map();

    // Logging
    this.verbose = options.verbose !== false;
  }

  /**
   * Main analysis method with production features
   */
  async analyze(query, data = null) {
    try {
      // Rate limiting check
      if (!this.checkRateLimit()) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }

      // Input validation
      this.validateInput(query, data);

      // Check cache
      const cacheKey = this.getCacheKey(query, data);
      if (this.cacheEnabled) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.log('✅ Returning cached result');
          return { ...cached, cached: true };
        }
      }

      // Build prompt
      const prompt = this.buildPrompt(query, data);

      this.log(`📊 Analyzing: ${query.substring(0, 60)}...`);

      // Execute analysis with retry logic
      const response = await this.executeWithRetry(prompt);

      // Process results
      const results = this.processResponse(response);

      // Cache results
      if (this.cacheEnabled) {
        this.saveToCache(cacheKey, results);
      }

      this.log('✅ Analysis complete');

      return { ...results, cached: false };
    } catch (error) {
      this.log(`❌ Error: ${error.message}`, 'error');
      throw this.handleError(error);
    }
  }

  /**
   * Execute analysis with retry logic
   */
  async executeWithRetry(prompt, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.anthropic.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          tools: [
            {
              type: 'code_execution_20250201',
              name: 'code_execution',
            },
          ],
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        return response;
      } catch (error) {
        lastError = error;

        // Retry on 529 (overloaded) or 500 (server error)
        if (
          (error.status === 529 || error.status === 500) &&
          attempt < maxRetries
        ) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          this.log(`⚠️  Retry ${attempt}/${maxRetries} after ${delay}ms`, 'warn');
          await this.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Input validation
   */
  validateInput(query, data) {
    if (!query || typeof query !== 'string') {
      throw new Error('Query must be a non-empty string');
    }

    if (query.length > 2000) {
      throw new Error('Query is too long (max 2000 characters)');
    }

    if (data && typeof data !== 'string') {
      throw new Error('Data must be a string');
    }

    if (data && data.length > 10 * 1024 * 1024) {
      throw new Error('Data is too large (max 10MB)');
    }
  }

  /**
   * Build analysis prompt
   */
  buildPrompt(query, data) {
    let prompt = `You are a data analysis expert. The user has requested: "${query}"\n\n`;

    if (data) {
      prompt += `Data has been provided:\n\n${data}\n\n`;
    }

    prompt += `Please:
1. Analyze the data thoroughly
2. Generate appropriate visualizations
3. Provide statistical insights
4. Explain findings clearly

Use Python with pandas, numpy, matplotlib, scipy, and scikit-learn as needed.`;

    return prompt;
  }

  /**
   * Process Claude's response
   */
  processResponse(response) {
    const results = {
      text: [],
      code: [],
      outputs: [],
      images: [],
      errors: [],
    };

    for (const block of response.content) {
      if (block.type === 'text') {
        results.text.push(block.text);
      } else if (block.type === 'tool_use' && block.name === 'code_execution') {
        results.code.push({
          id: block.id,
          code: block.input.code,
        });
      } else if (block.type === 'tool_result') {
        const toolResult = {
          id: block.tool_use_id,
          success: !block.is_error,
          outputs: [],
        };

        if (block.content) {
          for (const item of block.content) {
            if (item.type === 'text') {
              toolResult.outputs.push(item.text);
              if (!block.is_error) {
                results.outputs.push(item.text);
              }
            } else if (item.type === 'image') {
              const image = {
                format: item.source.media_type,
                data: item.source.data,
              };
              toolResult.outputs.push(image);
              results.images.push(image);
            }
          }
        }

        if (block.is_error) {
          results.errors.push(toolResult);
        }
      }
    }

    return {
      results,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
      summary: this.generateSummary(results),
    };
  }

  /**
   * Generate result summary
   */
  generateSummary(results) {
    return {
      hasText: results.text.length > 0,
      codeBlocks: results.code.length,
      outputs: results.outputs.length,
      images: results.images.length,
      errors: results.errors.length,
      success: results.errors.length === 0,
    };
  }

  /**
   * Cache management
   */
  getCacheKey(query, data) {
    const content = `${query}|${data || ''}`;
    return crypto.createHash('md5').update(content).digest('hex');
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check expiration
    if (Date.now() - cached.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  saveToCache(key, data) {
    // Limit cache size
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  clearCache() {
    this.cache.clear();
    this.log('🗑️  Cache cleared');
  }

  /**
   * Rate limiting
   */
  checkRateLimit() {
    const now = Date.now();
    const windowStart = now - this.rateLimitWindow;

    // Clean old entries
    for (const [timestamp, _] of this.requestCounts) {
      if (timestamp < windowStart) {
        this.requestCounts.delete(timestamp);
      }
    }

    // Check limit
    if (this.requestCounts.size >= this.rateLimitMax) {
      return false;
    }

    // Add current request
    this.requestCounts.set(now, true);
    return true;
  }

  /**
   * Error handling
   */
  handleError(error) {
    if (error.status === 401) {
      return new Error('Invalid API key. Please check your configuration.');
    } else if (error.status === 429) {
      return new Error('Rate limit exceeded. Please try again later.');
    } else if (error.status === 529) {
      return new Error('Service temporarily overloaded. Please retry.');
    } else if (error.status === 400) {
      return new Error(`Invalid request: ${error.message}`);
    } else {
      return error;
    }
  }

  /**
   * Logging
   */
  log(message, level = 'info') {
    if (!this.verbose) return;

    const timestamp = new Date().toISOString();
    const prefix = {
      info: 'ℹ️ ',
      warn: '⚠️ ',
      error: '❌',
    }[level];

    console.log(`${prefix} [${timestamp}] ${message}`);
  }

  /**
   * Utility
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheHits: 0, // Would need to track this
      requestsInWindow: this.requestCounts.size,
      rateLimitRemaining: this.rateLimitMax - this.requestCounts.size,
    };
  }
}

/**
 * Demo usage
 */
async function demo() {
  console.log('\n🚀 Production Data Analysis Agent Demo\n');
  console.log('═'.repeat(70));

  // Initialize agent
  const agent = new ProductionDataAnalysisAgent({
    cache: true,
    rateLimitMax: 10,
    verbose: true,
  });

  // Example 1: Sales Analysis
  console.log('\n📊 Example 1: Sales Analysis\n');

  const salesData = `
date,product,quantity,revenue
2024-01-01,Widget,50,2500
2024-01-02,Gadget,30,4500
2024-01-03,Widget,60,3000
2024-01-04,Gadget,40,6000
2024-01-05,Widget,55,2750
  `.trim();

  try {
    const result1 = await agent.analyze(
      'Analyze sales trends and calculate total revenue by product',
      salesData
    );

    console.log('\n📝 Summary:');
    console.log(JSON.stringify(result1.summary, null, 2));
    console.log('\n💬 Insights:');
    console.log(result1.results.text.join('\n\n'));
    console.log('\n📊 Usage:');
    console.log(`   Tokens: ${result1.usage.totalTokens}`);
    console.log(`   Cached: ${result1.cached ? 'Yes' : 'No'}`);
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n' + '═'.repeat(70));

  // Example 2: Same query (should be cached)
  console.log('\n🔄 Example 2: Cache Test (Same Query)\n');

  try {
    const result2 = await agent.analyze(
      'Analyze sales trends and calculate total revenue by product',
      salesData
    );

    console.log(`\n✅ Cached: ${result2.cached ? 'Yes' : 'No'}`);
  } catch (error) {
    console.error('Error:', error.message);
  }

  console.log('\n' + '═'.repeat(70));

  // Example 3: Rate limit test
  console.log('\n⚡ Example 3: Rate Limit Test\n');

  console.log('Making multiple rapid requests...\n');

  for (let i = 1; i <= 12; i++) {
    try {
      await agent.analyze(`Test query ${i}`, 'x,y\n1,2\n3,4');
      console.log(`✅ Request ${i} succeeded`);
    } catch (error) {
      console.log(`❌ Request ${i} failed: ${error.message}`);
      break;
    }
  }

  console.log('\n' + '═'.repeat(70));

  // Show statistics
  console.log('\n📊 Agent Statistics:\n');
  console.log(JSON.stringify(agent.getStats(), null, 2));

  console.log('\n✅ Demo complete!\n');
}

// Run demo if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demo().catch(console.error);
}

export default ProductionDataAnalysisAgent;


