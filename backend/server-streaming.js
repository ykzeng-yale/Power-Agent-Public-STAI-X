import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3002;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * STREAMING endpoint - Shows agent progress in real-time!
 */
app.post('/api/analyze-streaming', async (req, res) => {
  let sandbox = null;

  // Set up SSE (Server-Sent Events)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendStep(step, data) {
    res.write(`data: ${JSON.stringify({ step, ...data })}\n\n`);
  }

  try {
    const { query, data } = req.body;

    if (!query) {
      sendStep('error', { message: 'Query is required' });
      return res.end();
    }

    console.log(`\n📊 Streaming Analysis: ${query.substring(0, 60)}...`);

    // Step 1: Understanding Request
    sendStep('understanding', {
      title: 'Understanding Your Request',
      status: 'running',
      message: 'Analyzing your question and determining the best approach...',
    });

    await sleep(500);

    sendStep('understanding', {
      title: 'Understanding Your Request',
      status: 'completed',
      message: 'Request understood. Planning analysis strategy...',
    });

    // Step 2: Generate Code
    sendStep('generating', {
      title: 'Generating Python Code',
      status: 'running',
      message: 'Asking Claude to write analysis code...',
    });

    let prompt = `You are a data analysis expert. Generate Python code to analyze this request.

User request: "${query}"

${data ? `Data provided:\n${data}\n\n` : ''}

Generate concise Python code that:
1. Analyzes the data
2. Prints clear, formatted results
3. Creates visualizations if appropriate
4. Uses pandas, numpy, matplotlib, seaborn as needed

Important:
- Save plots to /home/user/plot.png
- Print all key findings clearly
- Keep code simple and focused

Return ONLY the Python code, no explanations.`;

    const codeGenResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });

    const fullResponse = codeGenResponse.content[0].text;
    const codeMatch = fullResponse.match(/```python\n([\s\S]*?)\n```/);
    const pythonCode = codeMatch ? codeMatch[1] : fullResponse;

    sendStep('generating', {
      title: 'Generating Python Code',
      status: 'completed',
      code: pythonCode,
      message: 'Code generated successfully!',
    });

    // Step 3: Create Sandbox
    sendStep('sandbox', {
      title: 'Creating Secure Execution Environment',
      status: 'running',
      message: 'Initializing E2B sandbox...',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    sendStep('sandbox', {
      title: 'Creating Secure Execution Environment',
      status: 'completed',
      message: 'Sandbox created. Environment ready.',
    });

    // Step 4: Prepare Data
    if (data) {
      sendStep('preparing', {
        title: 'Preparing Data',
        status: 'running',
        message: 'Writing data to sandbox filesystem...',
      });

      await sandbox.files.write('/home/user/data.csv', data);

      sendStep('preparing', {
        title: 'Preparing Data',
        status: 'completed',
        message: 'Data loaded into sandbox.',
      });
    }

    // Step 5: Execute Code
    sendStep('executing', {
      title: 'Executing Python Code',
      status: 'running',
      message: 'Running analysis in isolated environment...',
    });

    // Prepare code with data loading
    let fullCode = '';
    if (data) {
      fullCode = `
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import seaborn as sns

# Load data
try:
    df = pd.read_csv('/home/user/data.csv')
    print("✓ Data loaded successfully")
    print(f"Shape: {df.shape}")
except Exception as e:
    # Fallback for simple data
    with open('/home/user/data.csv', 'r') as f:
        raw_data = f.read()
    print(f"Raw data: {raw_data}")

`;
    } else {
      fullCode = `
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns

`;
    }

    fullCode += pythonCode;

    const execution = await sandbox.runCode(fullCode);

    const hasErrors = execution.logs.stderr && execution.logs.stderr.length > 0;

    sendStep('executing', {
      title: 'Executing Python Code',
      status: hasErrors ? 'error' : 'completed',
      output: execution.logs.stdout || [],
      error: execution.logs.stderr || [],
      message: hasErrors ? 'Execution completed with warnings' : 'Code executed successfully!',
    });

    // Step 6: Collect Visualizations
    sendStep('visualizing', {
      title: 'Collecting Visualizations',
      status: 'running',
      message: 'Checking for generated charts...',
    });

    const images = [];
    const files = await sandbox.files.list('/home/user');

    for (const file of files) {
      if (file.name.endsWith('.png') || file.name.endsWith('.jpg')) {
        const imageData = await sandbox.files.read(file.path);
        images.push({
          filename: file.name,
          data: Buffer.from(imageData).toString('base64'),
          format: 'image/png',
        });
      }
    }

    if (images.length > 0) {
      sendStep('visualizing', {
        title: 'Collecting Visualizations',
        status: 'completed',
        images: images,
        message: `${images.length} visualization(s) generated!`,
      });
    } else {
      sendStep('visualizing', {
        title: 'Collecting Visualizations',
        status: 'completed',
        message: 'No visualizations generated (text-only results)',
      });
    }

    // Step 7: Interpret Results
    sendStep('interpreting', {
      title: 'Interpreting Results',
      status: 'running',
      message: 'Asking Claude to explain the findings...',
    });

    const interpretPrompt = `I executed your code and got these results:

OUTPUT:
${execution.logs.stdout ? execution.logs.stdout.join('\n') : 'No output'}

${execution.logs.stderr && execution.logs.stderr.length > 0 ? `WARNINGS:\n${execution.logs.stderr.join('\n')}` : ''}

Please provide a brief, clear interpretation of these results. Focus on:
1. Key findings
2. What the numbers mean
3. Any insights or patterns

Keep it concise (2-3 paragraphs max).`;

    const interpretResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: interpretPrompt }],
    });

    const interpretation = interpretResponse.content[0].text;

    sendStep('interpreting', {
      title: 'Interpretation & Insights',
      status: 'completed',
      interpretation: interpretation,
      message: 'Analysis complete!',
    });

    // Final step: Complete
    sendStep('complete', {
      usage: {
        input_tokens:
          codeGenResponse.usage.input_tokens +
          interpretResponse.usage.input_tokens,
        output_tokens:
          codeGenResponse.usage.output_tokens +
          interpretResponse.usage.output_tokens,
      },
    });

    console.log('✅ Streaming analysis complete');

    res.end();
  } catch (error) {
    console.error('❌ Error:', error);
    sendStep('error', {
      message: error.message,
      details: error.toString(),
    });
    res.end();
  } finally {
    if (sandbox) {
      await sandbox.kill();
    }
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'claude-streaming-agent',
    execution: 'E2B + Claude with real-time streaming',
    features: ['streaming', 'real-execution', 'step-visualization'],
  });
});

/**
 * Static file serving for frontend
 */
app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start server
app.listen(port, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Claude Streaming Agent - LIVE on port ${port}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n📍 Endpoints:`);
  console.log(`   POST /api/analyze-streaming - STREAMING WITH STEPS`);
  console.log(`   GET  /health - Health check`);
  console.log(`\n✨ Features:`);
  console.log(`   • Real-time step visualization`);
  console.log(`   • Live code execution (E2B)`);
  console.log(`   • Claude-powered analysis`);
  console.log(`\n🌐 Open in browser:`);
  console.log(`   http://localhost:${port}/chat.html`);
  console.log(`\n${'='.repeat(60)}\n`);
});

export default app;


