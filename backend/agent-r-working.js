import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3006;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * REAL R EXECUTION using E2B language="r" parameter!
 * This ACTUALLY works - tested and confirmed!
 */
app.post('/api/analyze-r-real', async (req, res) => {
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

    console.log(`\n🧬 Real R Analysis: ${query.substring(0, 60)}...`);

    // Create sandbox
    sendStep('init', {
      title: 'Creating R-Enabled Environment',
      status: 'running',
      message: 'Initializing E2B with native R support...',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      template: process.env.E2B_TEMPLATE_ID || 'c04rlom0i7295cso55gk',  // USE CUSTOM TEMPLATE!
    });

    sendStep('init', {
      status: 'completed',
      message: 'E2B sandbox ready with R language support!',
    });

    // Write data if provided
    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', {
        status: 'completed',
        message: 'Data available at /home/user/data.csv',
      });
    }

    // AGENTIC LOOP
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 7;  // Increased for package debugging
    let isComplete = false;

    const systemPrompt = `You are a biostatistician agent with NATIVE R execution via E2B.

CRITICAL: R IS FULLY SUPPORTED!

PACKAGE PERSISTENCE RULES (VERY IMPORTANT!):
1. If user requests a SPECIFIC R package (e.g., "use swdpwr"), you MUST try to make it work!
2. Do NOT switch to alternative packages unless you've tried AT LEAST 3 different approaches
3. When package installation fails, try these in order:
   a. Install with different CRAN mirror: repos="https://cran.rstudio.com"
   b. Install dependencies manually first
   c. Try installing from source with dependencies=TRUE
   d. Check if package has different name or is in Bioconductor
   e. ONLY THEN consider alternative packages

DEBUGGING PACKAGE INSTALLATION:
If install.packages() fails:
- READ the error message carefully
- Install failed dependencies individually
- Try: install.packages("packagename", dependencies=TRUE, type="source")
- Try different repos: "https://cloud.r-project.org", "https://cran.rstudio.com"
- Check package availability: available.packages()[,"Package"]

EXECUTION RULES:
1. Generate R code in \`\`\`r code blocks
2. R code executes natively with full CRAN access
3. After execution, READ outputs and decide: iterate or complete
4. Be PERSISTENT with the user's requested package!
5. Only say "ANALYSIS_COMPLETE" after seeing execution results

R CAPABILITIES:
- Execute R code via language="r"
- Install ANY CRAN package
- Full R statistical functions
- Base R: lm(), glm(), t.test(), etc.
- Packages: lme4, survey, survival, CRTSize, pwrss, swdpwr, etc.

${data ? 'Data: /home/user/data.csv' : ''}

REMEMBER: User trusts SPECIFIC R packages for a reason. Try hard to make them work!`;

    conversationHistory.push({
      role: 'user',
      content: `Analyze: "${query}"

${data ? 'Data: /home/user/data.csv\n' : ''}
You have native R execution - use R packages when appropriate!`,
    });

    // ITERATION LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Planning - Iteration ${iteration}`,
        status: 'running',
        message: 'Determining best approach...',
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

      // Extract code
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
          content: 'Please provide R code to execute (R is available!).',
        });
        continue;
      }

      sendStep('thinking', {
        iteration,
        status: 'completed',
        reasoning: assistantMessage.substring(0, 350) + '...',
      });

      let code, language, execution;

      // EXECUTE R CODE (NATIVE!)
      if (rMatch) {
        code = rMatch[1];
        language = 'R';

        sendStep('code', {
          iteration,
          title: 'R Code Generated',
          status: 'completed',
          code: code,
          language: 'R',
          message: 'Using REAL R execution with CRAN packages!',
        });

        sendStep('executing', {
          iteration,
          title: 'Executing Native R Code',
          status: 'running',
          message: 'Running R with language="r" parameter...',
        });

        try {
          execution = await sandbox.runCode(code, {
            language: 'r',  // THIS IS THE KEY!
          });
        } catch (execError) {
          sendStep('executing', {
            iteration,
            title: 'R Execution Error',
            status: 'error',
            error: execError.message,
          });

          conversationHistory.push({
            role: 'user',
            content: `R execution error: ${execError.message}\n\nPlease fix the R code and try again.`,
          });
          continue;
        }

        const stdout = execution.logs.stdout || [];
        const stderr = execution.logs.stderr || [];

        sendStep('executing', {
          iteration,
          title: 'R Execution Complete',
          status: 'completed',
          output: stdout,
          warnings: stderr.length > 0 ? stderr : undefined,
          language: 'R',
          message: '✅ REAL R execution with authentic R packages!',
        });

        // Collect images if any
        const images = [];
        
        if (execution.results) {
          for (const result of execution.results) {
            if (result.png) {
              images.push({
                filename: 'r_plot.png',
                data: result.png,
                format: 'image/png',
              });
            }
          }
        }

        if (images.length > 0) {
          sendStep('visualization', {
            iteration,
            images: images,
            status: 'completed',
            message: 'R visualizations generated!',
          });
        }

        // Give R results back to agent
        const userRequestedPackage = query.match(/use\s+R'?s?\s+(\w+)\s+package/i)?.[1];
        
        conversationHistory.push({
          role: 'user',
          content: `
===== R EXECUTION RESULTS - Iteration ${iteration} =====

REAL R OUTPUT:
${stdout.join('\n') || '(no output)'}

${stderr.length > 0 ? `R MESSAGES/WARNINGS:\n${stderr.join('\n')}` : ''}
${images.length > 0 ? `VISUALIZATIONS: ${images.length} R plot(s) generated` : ''}

===== REVIEW AND DECIDE =====

${userRequestedPackage ? `IMPORTANT: User specifically requested "${userRequestedPackage}" package.

If installation failed:
1. Try different CRAN mirror: repos="https://cran.rstudio.com"
2. Install dependencies manually
3. Try: install.packages("${userRequestedPackage}", dependencies=TRUE)
4. Debug the specific error message
5. ONLY switch packages after 3+ attempts

Do NOT give up on ${userRequestedPackage} easily!
` : ''}

If results are sufficient: Interpret and say "ANALYSIS_COMPLETE".
If package failed: Try different installation approach.
If need refinement: Improve R code and iterate.`,
        });
      } 
      
      // EXECUTE PYTHON CODE (fallback)
      else if (pythonMatch) {
        code = pythonMatch[1];
        language = 'Python';

        sendStep('code', {
          iteration,
          title: 'Python Code Generated',
          status: 'completed',
          code: code,
        });

        sendStep('executing', {
          iteration,
          status: 'running',
          message: 'Running Python...',
        });

        try {
          execution = await sandbox.runCode(code, {
            language: 'python',
          });
        } catch (execError) {
          sendStep('executing', {
            iteration,
            status: 'error',
            error: execError.message,
          });

          conversationHistory.push({
            role: 'user',
            content: `Execution error: ${execError.message}\n\nPlease fix and try again.`,
          });
          continue;
        }

        sendStep('executing', {
          iteration,
          status: 'completed',
          output: execution.logs.stdout || [],
          warnings: execution.logs.stderr || undefined,
        });

        conversationHistory.push({
          role: 'user',
          content: `Python results:\n\n${execution.logs.stdout?.join('\n') || '(no output)'}\n\nReview and decide.`,
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
        await sandbox.kill();
      } catch (e) {}
    }
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'biostat-r-native',
    r_support: 'NATIVE R via language parameter',
    r_packages: 'ANY CRAN package',
    features: ['native-r-execution', 'cran-packages', 'iterative-reasoning', 'real-r-output'],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 BIOSTATISTICS AGENT with REAL R EXECUTION - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n🎉 BREAKTHROUGH: Native R execution discovered!`);
  console.log(`\n✨ Features:`);
  console.log(`   • Execute R code natively (language="r")`);
  console.log(`   • Install ANY CRAN package`);
  console.log(`   • Use authentic R functions`);
  console.log(`   • CRTSize, lme4, survey, etc. all work!`);
  console.log(`   • Real R statistical output`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-r-real.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;

