import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Advanced Data Analysis Agent with conversation history and streaming
 */
export class DataAnalysisAgent {
  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    this.anthropic = new Anthropic({ apiKey });
    this.conversationHistory = [];
  }

  /**
   * Analyze data with natural language query
   * Supports multi-turn conversations and iterative refinement
   */
  async analyze(query, options = {}) {
    const {
      data = null,
      stream = false,
      context = null,
      maxTokens = 4096,
    } = options;

    // Build system prompt
    const systemPrompt = `You are an expert data analyst with access to Python code execution.

Your capabilities:
- Load and analyze CSV, JSON, and tabular data
- Perform statistical analysis (descriptive stats, hypothesis testing, regression)
- Create visualizations (plots, charts, heatmaps)
- Handle missing data and outliers
- Provide clear interpretations

Environment:
- Python 3.11 with pandas, numpy, scipy, sklearn, matplotlib
- 1GB RAM, 5GB storage
- No internet access (all data must be provided)

Best practices:
1. Always examine data structure first (df.head(), df.info(), df.describe())
2. Check for missing values and data types
3. Create clear, labeled visualizations
4. Provide statistical summaries and insights
5. Explain findings in plain language`;

    // Build user message
    let userMessage = query;

    if (data) {
      userMessage += `\n\nData:\n${data}`;
    }

    if (context) {
      userMessage = `${context}\n\n${userMessage}`;
    }

    // Add to conversation history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    });

    const messages = [...this.conversationHistory];

    console.log(`\n🤖 Agent analyzing: ${query.substring(0, 100)}...`);

    if (stream) {
      return this._streamAnalysis(systemPrompt, messages, maxTokens);
    } else {
      return this._runAnalysis(systemPrompt, messages, maxTokens);
    }
  }

  /**
   * Run analysis without streaming
   */
  async _runAnalysis(systemPrompt, messages, maxTokens) {
    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [
        {
          type: 'code_execution_20250201',
          name: 'code_execution',
        },
      ],
      messages,
    });

    // Add assistant response to history
    this.conversationHistory.push({
      role: 'assistant',
      content: response.content,
    });

    return this._processResponse(response);
  }

  /**
   * Stream analysis with real-time updates
   */
  async *_streamAnalysis(systemPrompt, messages, maxTokens) {
    const stream = await this.anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [
        {
          type: 'code_execution_20250201',
          name: 'code_execution',
        },
      ],
      messages,
    });

    let fullContent = [];

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_start') {
        yield { type: 'start', block: chunk.content_block };
      } else if (chunk.type === 'content_block_delta') {
        yield { type: 'delta', delta: chunk.delta };
      } else if (chunk.type === 'content_block_stop') {
        yield { type: 'stop' };
      }
    }

    const finalMessage = await stream.finalMessage();
    this.conversationHistory.push({
      role: 'assistant',
      content: finalMessage.content,
    });

    yield {
      type: 'complete',
      results: this._processResponse(finalMessage),
    };
  }

  /**
   * Process Claude response into structured format
   */
  _processResponse(response) {
    const results = {
      text: [],
      codeBlocks: [],
      outputs: [],
      images: [],
      errors: [],
      thinking: [],
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };

    for (const block of response.content) {
      if (block.type === 'text') {
        results.text.push(block.text);
      } else if (block.type === 'tool_use' && block.name === 'code_execution') {
        results.codeBlocks.push({
          id: block.id,
          code: block.input.code,
        });
      } else if (block.type === 'tool_result') {
        // Parse execution results
        const toolResult = {
          id: block.tool_use_id,
          success: !block.is_error,
          outputs: [],
        };

        if (block.content) {
          for (const item of block.content) {
            if (item.type === 'text') {
              toolResult.outputs.push({ type: 'text', content: item.text });
            } else if (item.type === 'image') {
              toolResult.outputs.push({
                type: 'image',
                format: item.source.media_type,
                data: item.source.data,
              });
              results.images.push({
                format: item.source.media_type,
                data: item.source.data,
              });
            }
          }
        }

        if (block.is_error) {
          results.errors.push(toolResult);
        } else {
          results.outputs.push(toolResult);
        }
      }
    }

    return results;
  }

  /**
   * Reset conversation history
   */
  reset() {
    this.conversationHistory = [];
    console.log('🔄 Conversation history reset');
  }

  /**
   * Get conversation summary
   */
  getSummary() {
    return {
      turns: this.conversationHistory.length / 2,
      messages: this.conversationHistory.map((msg, idx) => ({
        turn: Math.floor(idx / 2) + 1,
        role: msg.role,
        preview:
          typeof msg.content === 'string'
            ? msg.content.substring(0, 100)
            : '[Complex content]',
      })),
    };
  }
}

// Example usage
async function example() {
  const agent = new DataAnalysisAgent();

  // Example 1: Simple analysis
  console.log('\n📊 Example 1: Basic Statistics\n');

  const sampleData = `
temperature,humidity,sales
25,60,100
28,65,120
22,55,95
30,70,140
26,62,110
  `.trim();

  const result1 = await agent.analyze('Analyze this data and show correlations', {
    data: sampleData,
  });

  console.log('\n✅ Analysis Complete');
  console.log('Text:', result1.text.join('\n'));
  console.log('Code blocks:', result1.codeBlocks.length);
  console.log('Outputs:', result1.outputs.length);
  console.log('Images:', result1.images.length);

  // Example 2: Follow-up question (uses conversation history)
  console.log('\n📊 Example 2: Follow-up Analysis\n');

  const result2 = await agent.analyze(
    'Create a scatter plot of temperature vs sales'
  );

  console.log('\n✅ Follow-up Complete');
  console.log('Conversation turns:', agent.getSummary().turns);

  // Example 3: Streaming analysis
  console.log('\n📊 Example 3: Streaming Analysis\n');

  agent.reset(); // Start fresh

  const timeSeriesData = `
date,value
2024-01-01,100
2024-01-02,105
2024-01-03,103
2024-01-04,110
2024-01-05,115
2024-01-06,112
2024-01-07,120
  `.trim();

  const stream = agent.analyze('Analyze this time series and show trends', {
    data: timeSeriesData,
    stream: true,
  });

  for await (const chunk of stream) {
    if (chunk.type === 'delta' && chunk.delta.type === 'text_delta') {
      process.stdout.write(chunk.delta.text);
    } else if (chunk.type === 'complete') {
      console.log('\n\n✅ Streaming Complete');
      console.log('Final results:', chunk.results);
    }
  }
}

// Run examples if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}

export default DataAnalysisAgent;


