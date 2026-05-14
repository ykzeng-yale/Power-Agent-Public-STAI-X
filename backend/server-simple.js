import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Main endpoint for data analysis requests
 * Claude generates Python code and explains the analysis
 */
app.post('/api/analyze', async (req, res) => {
  try {
    const { query, data } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log(`\n📊 Analysis Request: ${query}`);

    // Prepare the analysis prompt
    let prompt = `You are a data analysis expert. The user has requested: "${query}"\n\n`;

    if (data) {
      prompt += `Data provided:\n${data}\n\n`;
    }

    prompt += `Please:
1. Write Python code to analyze the data
2. Explain what the code does
3. Describe what insights we would get from running it
4. If applicable, describe what visualizations would be created

Format your response clearly with:
- Code blocks using \`\`\`python
- Clear explanations
- Expected insights

Note: The code won't be executed automatically, but show complete, runnable Python code that uses pandas, numpy, matplotlib, scipy, or scikit-learn as needed.`;

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    console.log('✅ Analysis complete');

    // Extract results
    const text = response.content[0].text;
    
    // Parse code blocks from markdown
    const codeBlocks = [];
    const codeRegex = /```python\n([\s\S]*?)\n```/g;
    let match;
    while ((match = codeRegex.exec(text)) !== null) {
      codeBlocks.push(match[1]);
    }

    res.json({
      success: true,
      query,
      results: {
        text: [text],
        code: codeBlocks,
        outputs: [],
        images: [],
      },
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      note: 'Code generation mode - Claude generates Python code and explains the analysis',
    });
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'claude-data-analysis' });
});

/**
 * Example endpoint showing available analysis types
 */
app.get('/api/examples', (req, res) => {
  res.json({
    examples: [
      {
        title: 'Descriptive Statistics',
        query: 'Calculate mean, median, std dev, and create a histogram',
        sampleData: '1,2,3,4,5,6,7,8,9,10',
      },
      {
        title: 'Correlation Analysis',
        query: 'Calculate correlation matrix and create a heatmap',
        sampleData: 'x,y,z\n1,2,3\n2,4,5\n3,6,7\n4,8,9',
      },
      {
        title: 'Time Series Analysis',
        query: 'Analyze trends and create a time series plot',
        sampleData: 'date,value\n2024-01-01,100\n2024-01-02,105\n2024-01-03,103',
      },
      {
        title: 'Regression Analysis',
        query: 'Perform linear regression and show the results',
        sampleData: 'x,y\n1,2\n2,4\n3,6\n4,8\n5,10',
      },
    ],
  });
});

// Start server
app.listen(port, () => {
  console.log(`\n🚀 Claude Data Analysis Backend running on port ${port}`);
  console.log(`📍 Endpoints:`);
  console.log(`   POST /api/analyze - Submit analysis request`);
  console.log(`   GET  /api/examples - View example requests`);
  console.log(`   GET  /health - Health check`);
  console.log(`\n✨ Claude will generate Python code and explain the analysis`);
  console.log(`📝 Visit http://localhost:${port}/health to test\n`);
});

export default app;


