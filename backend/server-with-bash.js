import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Endpoint using bash tool to execute Python code
 */
app.post('/api/analyze-executable', async (req, res) => {
  try {
    const { query, data } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`\n📊 Analysis Request (with execution): ${query}`);

    let prompt = `You are a data analysis expert with access to bash commands. 

User request: "${query}"

${data ? `Data provided:\n${data}\n\n` : ''}

Please:
1. Write a Python script to analyze the data
2. Save it to a file (e.g., analysis.py)
3. Run it using bash
4. Show the results

Important:
- Use the bash tool to create and run Python files
- Keep code simple and focused
- Print results clearly`;

    // Call Claude with bash tool
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      tools: [
        {
          type: 'bash_20250124',
          name: 'bash',
        },
      ],
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    console.log('✅ Analysis complete (with bash execution)');

    // Process response
    const results = {
      text: [],
      commands: [],
      outputs: [],
    };

    for (const block of response.content) {
      if (block.type === 'text') {
        results.text.push(block.text);
      } else if (block.type === 'tool_use' && block.name === 'bash') {
        results.commands.push(block.input);
      } else if (block.type === 'tool_result') {
        if (block.content) {
          for (const item of block.content) {
            if (item.type === 'text') {
              results.outputs.push(item.text);
            }
          }
        }
      }
    }

    res.json({
      success: true,
      query,
      results,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      note: 'Using bash tool to execute code',
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'claude-bash-execution' });
});

app.listen(port, () => {
  console.log(`\n🚀 Claude Backend with Bash Execution on port ${port}`);
  console.log(`   This version uses bash tool to execute Python code\n`);
});


