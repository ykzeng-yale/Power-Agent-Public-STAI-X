import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox as E2BSandbox } from 'e2b';

dotenv.config();

const app = express();
const port = 3006;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * PROPER R EXECUTION using E2B General Sandbox (has R pre-installed!)
 */
app.post('/api/analyze-r-native', async (req, res) => {
  let sandbox = null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendStep(step, data) {
    res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), ...data })}\n\n`);
  }

  try {
    const { query, data } = req.body;

    if (!query) {
      sendStep('error', { message: 'Query is required' });
      return res.end();
    }

    console.log(`\n🧬 R-Native Analysis: ${query.substring(0, 60)}...`);

    // Create general E2B sandbox (has R!)
    sendStep('init', {
      title: 'Creating R-Enabled Environment',
      status: 'running',
      message: 'Initializing E2B sandbox with R support...',
    });

    sandbox = await E2BSandbox.create({
      apiKey: process.env.E2B_API_KEY,
      template: 'base',  // General sandbox with R
    });

    sendStep('init', {
      status: 'completed',
      message: 'Sandbox ready with R pre-installed!',
    });

    // Write data if provided
    if (data) {
      await sandbox.filesystem.write('/tmp/data.csv', data);
      sendStep('data', {
        status: 'completed',
        message: 'Data uploaded',
      });
    }

    // AGENT LOOP
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 5;
    let isComplete = false;

    const systemPrompt = `You are a biostatistician agent with NATIVE R execution.

ENVIRONMENT:
- Full R installation available via 'Rscript' command
- Can install ANY CRAN package with install.packages()
- Python also available for data manipulation

CRITICAL RULES:
1. Generate R code as R scripts (use \`\`\`r code blocks)
2. R code will be executed natively via Rscript
3. You MUST execute code before saying "ANALYSIS_COMPLETE"
4. After seeing outputs, decide: iterate or complete

HOW TO WRITE R CODE:

For R analysis:
\`\`\`r
# Install packages if needed
if (!require("CRTSize")) install.packages("CRTSize")

library(CRTSize)

# Your analysis
result <- n.clust(d=0.3, ICC=0.05, m=50, power=0.80)
cat("Clusters needed:", ceiling(result), "\\n")
\`\`\`

The R code will be executed with Rscript and outputs will be shown.

${data ? 'Data available at: /tmp/data.csv' : ''}`;

    conversationHistory.push({
      role: 'user',
      content: `User request: "${query}"

${data ? 'Data: /tmp/data.csv' : ''}

Generate R code to analyze this. R is natively available!`,
    });

    // ITERATION LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Planning - Iteration ${iteration}`,
        status: 'running',
        message: 'Deciding approach...',
      });

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        system: systemPrompt,
        messages: conversationHistory,
      });

      const assistantMessage = response.content[0].text;
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Check for code
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);
      const pythonMatch = assistantMessage.match(/```python\n([\s\S]*?)\n```/);

      if (!rMatch && !pythonMatch) {
        if (assistantMessage.includes('ANALYSIS_COMPLETE')) {
          isComplete = true;
          sendStep('thinking', {
            iteration,
            status: 'completed',
            reasoning: assistantMessage,
          });
          break;
        }
        
        conversationHistory.push({
          role: 'user',
          content: 'Please provide R or Python code to execute.',
        });
        continue;
      }

      sendStep('thinking', {
        iteration,
        status: 'completed',
        reasoning: assistantMessage.substring(0, 300) + '...',
      });

      // Execute R code natively
      if (rMatch) {
        const rCode = rMatch[1];

        sendStep('code', {
          iteration,
          title: 'R Code Generated',
          status: 'completed',
          code: rCode,
          language: 'R',
        });

        sendStep('executing', {
          iteration,
          title: 'Executing R Code',
          status: 'running',
          message: 'Running R via Rscript...',
        });

        // Write R code to file
        await sandbox.filesystem.write('/tmp/analysis.R', rCode);

        // Execute with Rscript
        const result = await sandbox.process.start({
          cmd: 'Rscript /tmp/analysis.R',
          onStdout: (data) => console.log('R stdout:', data),
          onStderr: (data) => console.log('R stderr:', data),
        });

        await result.wait();

        const stdout = result.stdout || '';
        const stderr = result.stderr || '';

        sendStep('executing', {
          iteration,
          title: 'R Execution Complete',
          status: 'completed',
          output: stdout ? [stdout] : [],
          warnings: stderr ? [stderr] : undefined,
          language: 'R',
        });

        // Feedback to agent
        conversationHistory.push({
          role: 'user',
          content: `R execution results:\n\nOUTPUT:\n${stdout || '(no output)'}\n\n${stderr ? `MESSAGES:\n${stderr}` : ''}\n\nReview these results. If sufficient, interpret and say "ANALYSIS_COMPLETE".`,
        });
      } else if (pythonMatch) {
        // Python code execution (similar to before)
        const pythonCode = pythonMatch[1];
        
        sendStep('code', {
          iteration,
          title: 'Python Code Generated',
          status: 'completed',
          code: pythonCode,
          language: 'Python',
        });

        sendStep('executing', {
          iteration,
          title: 'Executing Python',
          status: 'running',
        });

        await sandbox.filesystem.write('/tmp/analysis.py', pythonCode);
        
        const result = await sandbox.process.start({
          cmd: 'python3 /tmp/analysis.py',
        });

        await result.wait();

        sendStep('executing', {
          iteration,
          status: 'completed',
          output: result.stdout ? [result.stdout] : [],
          warnings: result.stderr ? [result.stderr] : undefined,
        });

        conversationHistory.push({
          role: 'user',
          content: `Python results:\n\n${result.stdout || '(no output)'}\n\nReview and decide next steps.`,
        });
      }

      await sleep(500);
    }

    sendStep('summary', {
      title: 'Analysis Complete',
      totalIterations: iteration,
    });

    const finalMsg = conversationHistory[conversationHistory.length - 1];
    if (finalMsg.role === 'assistant') {
      sendStep('insights', {
        title: 'Final Insights',
        content: finalMsg.content,
      });
    }

    sendStep('complete', { iterations: iteration });
    
    console.log(`✅ Analysis complete (${iteration} iterations)`);
    res.end();
  } catch (error) {
    console.error('❌ Error:', error);
    sendStep('error', { message: error.message });
    res.end();
  } finally {
    if (sandbox) {
      try {
        await sandbox.close();
      } catch (e) {}
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'biostat-r-native',
    environment: 'E2B general sandbox with native R',
    features: ['native-r-execution', 'cran-packages', 'iterative-reasoning'],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 BIOSTATISTICS AGENT with NATIVE R - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n✨ Features:`);
  console.log(`   • Native R execution (via Rscript)`);
  console.log(`   • Install any CRAN package on-demand`);
  console.log(`   • Full R environment`);
  console.log(`   • Python also available`);
  console.log(`\n⚠️  Note: Uses e2b general sandbox, not code-interpreter`);
  console.log(`   Requires: npm install e2b`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-r-native.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;


