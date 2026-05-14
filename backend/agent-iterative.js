import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3003;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * ITERATIVE AGENTIC WORKFLOW
 * Agent can inspect outputs, refine code, and iterate until satisfied
 */
app.post('/api/analyze-agentic', async (req, res) => {
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

    console.log(`\n🤖 Starting Agentic Analysis: ${query.substring(0, 60)}...`);

    // Create sandbox once
    sendStep('init', {
      title: 'Initializing Agent',
      status: 'running',
      message: 'Creating secure execution environment...',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    sendStep('init', {
      title: 'Initializing Agent',
      status: 'completed',
      message: 'E2B sandbox ready. Starting agent loop...',
    });

    // Write data to sandbox if provided
    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', {
        title: 'Data Loaded',
        status: 'completed',
        message: 'Data available in sandbox filesystem',
      });
    }

    // AGENT LOOP - Iterative conversation with Claude
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 5;
    let isComplete = false;

    // Initial system prompt
    const systemPrompt = `You are an expert data analyst agent with access to a Python environment.

Your workflow:
1. Understand the user's request
2. Write Python code to analyze the data
3. EXECUTE the code and SEE the results
4. INSPECT the output to determine:
   - Did it work correctly?
   - Do I have enough information to answer?
   - Should I refine the code or try a different approach?
5. If needed, write improved code and iterate
6. When satisfied, provide final insights

Guidelines:
- Start with exploratory code to understand the data structure
- Iterate based on what you learn from execution outputs
- Use print() statements to inspect intermediate results
- If you encounter errors, fix them and try again
- Save visualizations to /home/user/plot_{name}.png
- When you have a complete answer, say "ANALYSIS_COMPLETE" in your response

Available libraries: pandas, numpy, matplotlib, seaborn, scipy, scikit-learn

${data ? 'Data is available at /home/user/data.csv' : 'No data file provided - user may have included data in their query'}`;

    conversationHistory.push({
      role: 'user',
      content: `Please analyze this request: "${query}"${data ? '\n\nData is loaded at /home/user/data.csv' : ''}`,
    });

    // ITERATIVE AGENT LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Thinking - Iteration ${iteration}`,
        status: 'running',
        message: iteration === 1 
          ? 'Understanding the request and planning approach...'
          : 'Reviewing previous results and deciding next steps...',
      });

      // Call Claude
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system: systemPrompt,
        messages: conversationHistory,
      });

      const assistantMessage = response.content[0].text;
      conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Check if agent wants to complete
      if (assistantMessage.includes('ANALYSIS_COMPLETE')) {
        isComplete = true;
        sendStep('thinking', {
          iteration,
          title: `Agent Thinking - Iteration ${iteration}`,
          status: 'completed',
          message: 'Agent has completed the analysis!',
          reasoning: assistantMessage,
        });
        break;
      }

      sendStep('thinking', {
        iteration,
        title: `Agent Thinking - Iteration ${iteration}`,
        status: 'completed',
        message: 'Agent has a plan. Generating code...',
        reasoning: assistantMessage.substring(0, 300) + '...',
      });

      // Extract Python code from response
      const codeMatch = assistantMessage.match(/```python\n([\s\S]*?)\n```/);
      
      if (!codeMatch) {
        // No code to execute, agent might just be thinking
        sendStep('reasoning', {
          iteration,
          title: 'Agent Reasoning',
          status: 'completed',
          message: assistantMessage,
        });

        // Add user message to continue
        conversationHistory.push({
          role: 'user',
          content: 'Please write the Python code to proceed with the analysis.',
        });
        continue;
      }

      const pythonCode = codeMatch[1];

      sendStep('code', {
        iteration,
        title: `Code Generation - Iteration ${iteration}`,
        status: 'completed',
        code: pythonCode,
        message: 'Code ready for execution',
      });

      // Execute code in sandbox
      sendStep('executing', {
        iteration,
        title: `Executing Code - Iteration ${iteration}`,
        status: 'running',
        message: 'Running Python in E2B sandbox...',
      });

      let execution;
      try {
        execution = await sandbox.runCode(pythonCode);
      } catch (execError) {
        sendStep('executing', {
          iteration,
          title: `Executing Code - Iteration ${iteration}`,
          status: 'error',
          error: execError.message,
          message: 'Execution error - agent will try to fix...',
        });

        // Tell agent about the error
        conversationHistory.push({
          role: 'user',
          content: `Execution error: ${execError.message}\n\nPlease fix the code and try again.`,
        });
        continue;
      }

      const stdout = execution.logs.stdout || [];
      const stderr = execution.logs.stderr || [];

      sendStep('executing', {
        iteration,
        title: `Executing Code - Iteration ${iteration}`,
        status: 'completed',
        output: stdout,
        warnings: stderr.length > 0 ? stderr : undefined,
        message: 'Code executed successfully',
      });

      // Collect any generated images
      const images = [];
      const files = await sandbox.files.list('/home/user');

      for (const file of files) {
        if (file.name.match(/\.(png|jpg|jpeg)$/i) && !file.name.startsWith('.')) {
          try {
            const imageData = await sandbox.files.read(file.path);
            images.push({
              filename: file.name,
              data: Buffer.from(imageData).toString('base64'),
              format: 'image/png',
            });
          } catch (err) {
            console.error('Error reading image:', err);
          }
        }
      }

      if (images.length > 0) {
        sendStep('visualization', {
          iteration,
          title: `Visualizations - Iteration ${iteration}`,
          status: 'completed',
          images: images,
          message: `Generated ${images.length} visualization(s)`,
        });
      }

      // CRITICAL: Give execution results back to Claude
      // This allows the agent to inspect outputs and decide next steps
      const executionFeedback = `
Execution results from iteration ${iteration}:

STDOUT:
${stdout.join('\n') || '(no output)'}

${stderr.length > 0 ? `STDERR:\n${stderr.join('\n')}` : ''}

${images.length > 0 ? `\nGenerated ${images.length} visualization(s)` : ''}

Based on these results:
1. Did the analysis succeed?
2. Do you have enough information to answer the user's question?
3. Should you refine the code or try a different approach?
4. Or are you ready to provide final insights?

If you're satisfied with the results and ready to provide your final answer, include "ANALYSIS_COMPLETE" in your response.
Otherwise, explain what you learned and what you'll try next.`;

      conversationHistory.push({
        role: 'user',
        content: executionFeedback,
      });

      sendStep('reviewing', {
        iteration,
        title: `Agent Reviewing Results - Iteration ${iteration}`,
        status: 'running',
        message: 'Agent is inspecting execution outputs...',
      });

      // Small delay to show the step
      await sleep(500);
    }

    // Final summary
    sendStep('summary', {
      title: 'Analysis Complete',
      status: 'completed',
      message: `Completed in ${iteration} iteration(s)`,
      totalIterations: iteration,
    });

    // Extract final answer from last assistant message
    const finalResponse = conversationHistory[conversationHistory.length - 1];
    if (finalResponse.role === 'assistant') {
      sendStep('insights', {
        title: 'Final Insights',
        status: 'completed',
        content: finalResponse.content,
      });
    }

    // Token usage
    sendStep('complete', {
      iterations: iteration,
      conversationLength: conversationHistory.length,
    });

    console.log(`✅ Agentic analysis complete in ${iteration} iterations`);

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
      try {
        await sandbox.kill();
      } catch (e) {
        console.error('Error closing sandbox:', e);
      }
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'claude-iterative-agent',
    mode: 'agentic',
    features: [
      'iterative-reasoning',
      'self-correction',
      'multi-turn-execution',
      'streaming',
      'real-execution',
    ],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🤖 ITERATIVE AGENTIC SYSTEM - LIVE on port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n🧠 Agent Capabilities:`);
  console.log(`   • Multi-turn reasoning (up to 5 iterations)`);
  console.log(`   • Self-inspection of execution results`);
  console.log(`   • Automatic code refinement`);
  console.log(`   • Error recovery and retry`);
  console.log(`   • Adaptive analysis approach`);
  console.log(`\n📍 Endpoints:`);
  console.log(`   POST /api/analyze-agentic - ITERATIVE AGENT`);
  console.log(`   GET  /health - Health check`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-agentic.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;


