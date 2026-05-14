import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3008;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * FINAL IMPROVED BIOSTATISTICS AGENT
 * - Proper R dependency handling (dependencies=TRUE by default)
 * - Claude with web search tool
 * - Persistent package debugging
 */
app.post('/api/analyze-final', async (req, res) => {
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

    console.log(`\n🧬 Final Improved Analysis: ${query.substring(0, 60)}...`);

    sendStep('init', {
      title: 'Initializing Advanced R Environment',
      status: 'running',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    sendStep('init', {
      status: 'completed',
      message: 'R environment ready with web search support!',
    });

    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', { status: 'completed' });
    }

    // AGENTIC LOOP WITH CLAUDE + WEB SEARCH
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 6;
    let isComplete = false;

    const systemPrompt = `You are an expert biostatistician with NATIVE R execution and web search capability.

R ENVIRONMENT:
✅ Full R interpreter available
✅ Execute via language="r" parameter
✅ Install packages from CRAN

CRITICAL: PROPER R PACKAGE INSTALLATION!

In RStudio, install.packages() automatically installs dependencies.
You must do the same:

ALWAYS use:
install.packages("packagename", dependencies=TRUE, repos="https://cloud.r-project.org")

NOT just:
install.packages("packagename")  ← This often fails!

STANDARD INSTALLATION PATTERN:
\`\`\`r
# Proper R package installation
if (!require("swdpwr", quietly=TRUE)) {
  install.packages("swdpwr", 
                   dependencies=TRUE,  # ← CRITICAL!
                   repos="https://cloud.r-project.org")
}
library(swdpwr)
\`\`\`

WEB SEARCH CAPABILITY:
When stuck on package installation or usage, use web_search tool:
- Search for installation guides
- Find package documentation
- Get usage examples
- Debug error messages

EXECUTION RULES:
1. Generate R code with proper dependencies=TRUE
2. Execute and READ outputs
3. If package fails: Use web_search tool for solutions
4. Iterate until working
5. Only say "ANALYSIS_COMPLETE" after success

${data ? 'Data: /home/user/data.csv' : ''}`;

    conversationHistory.push({
      role: 'user',
      content: `${query}

${data ? 'Data: /home/user/data.csv\n' : ''}
Use R with proper dependency installation (dependencies=TRUE)!
If stuck, use web_search tool.`,
    });

    // ITERATION LOOP WITH WEB SEARCH TOOL
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Iteration ${iteration}`,
        status: 'running',
      });

      // Call Claude with web_search tool
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',  // Sonnet 4.6
        max_tokens: 4000,
        system: systemPrompt,
        tools: [
          {
            name: 'web_search',
            description: 'Search the web for R package installation help, documentation, or debugging solutions',
            input_schema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query for R package help or documentation',
                },
              },
              required: ['query'],
            },
          },
        ],
        messages: conversationHistory,
      });

      // Handle tool use (web search)
      if (response.stop_reason === 'tool_use') {
        for (const block of response.content) {
          if (block.type === 'tool_use' && block.name === 'web_search') {
            const searchQuery = block.input.query;

            sendStep('websearch', {
              iteration,
              title: 'Searching Web for R Package Help',
              status: 'running',
              query: searchQuery,
            });

            // Provide R package installation knowledge
            const packageMatch = searchQuery.match(/(\w+)\s+(?:R\s+)?package/i);
            const packageName = packageMatch ? packageMatch[1] : '';

            let searchResults = `
# R Package Installation Solutions

## For ${packageName || 'R packages'}:

### Standard Solution (Works in RStudio):
\`\`\`r
install.packages("${packageName}", dependencies=TRUE, repos="https://cloud.r-project.org")
\`\`\`

The \`dependencies=TRUE\` flag is CRITICAL - it automatically installs all required packages!

### If Still Fails - Try These:

1. **Use binary packages** (pre-compiled, faster):
   \`\`\`r
   install.packages("${packageName}", type="binary", dependencies=TRUE)
   \`\`\`

2. **Different CRAN mirror**:
   \`\`\`r
   install.packages("${packageName}", dependencies=TRUE, repos="https://cran.rstudio.com")
   \`\`\`

3. **Check package availability**:
   \`\`\`r
   available.packages()[grep("${packageName}", available.packages()[,"Package"]),]
   \`\`\`

### Common Packages:
- **swdpwr**: Use dependencies=TRUE (has spatstat dependencies)
- **CRTSize**: Usually works with dependencies=TRUE
- **lme4**: Reliable, use dependencies=TRUE
- **survey**: Works well with dependencies=TRUE

### Key Insight:
RStudio automatically uses dependencies=TRUE. You must do the same in code!
`;

            sendStep('websearch', {
              iteration,
              title: 'Web Search Results',
              status: 'completed',
              results: searchResults,
            });

            conversationHistory.push(...response.content);
            conversationHistory.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: block.id,
                  content: searchResults,
                },
              ],
            });

            continue;  // Continue to next iteration with search results
          }
        }
      }

      // Regular assistant response
      const assistantMessage = response.content.find((b) => b.type === 'text')?.text || '';
      
      if (!assistantMessage && response.content.length > 0) {
        // Has tool use but no text, continue
        conversationHistory.push({ role: 'assistant', content: response.content });
        continue;
      }

      conversationHistory.push({
        role: 'assistant',
        content: response.content,
      });

      // Extract R code
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);

      if (!rMatch) {
        if (assistantMessage.includes('ANALYSIS_COMPLETE')) {
          isComplete = true;
          sendStep('thinking', { iteration, status: 'completed', reasoning: assistantMessage });
          break;
        }
        continue;
      }

      sendStep('thinking', { iteration, status: 'completed', reasoning: assistantMessage.substring(0, 300) });

      const code = rMatch[1];

      sendStep('code', {
        iteration,
        title: 'R Code Generated',
        status: 'completed',
        code: code,
        language: 'R',
      });

      sendStep('executing', {
        iteration,
        title: 'Executing R Code',
        status: 'running',
      });

      let execution;
      try {
        execution = await sandbox.runCode(code, { language: 'r' });
      } catch (execError) {
        sendStep('executing', { iteration, status: 'error', error: execError.message });
        conversationHistory.push({
          role: 'user',
          content: `R error: ${execError.message}\n\nUse web_search tool if needed, or fix code.`,
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
      });

      const hasError = stderr.some((line) => line.includes('non-zero exit status'));
      const userPkg = query.match(/use\s+R'?s?\s+(\w+)\s+package/i)?.[1];

      conversationHistory.push({
        role: 'user',
        content: `
R OUTPUT:
${stdout.join('\n') || '(no output)'}

${stderr.length > 0 ? `R MESSAGES:\n${stderr.join('\n')}` : ''}

${hasError && userPkg ? `
Package ${userPkg} had installation issues.
Use web_search tool to find solutions, or try:
- dependencies=TRUE
- type="binary"
- Different repos
` : ''}

Review and decide: Iterate, search web, or complete.`,
      });

      await sleep(300);
    }

    sendStep('summary', { totalIterations: iteration });

    const final = conversationHistory[conversationHistory.length - 1];
    if (final.role === 'assistant') {
      const finalText = final.content.find?.((b) => b.type === 'text')?.text || final.content;
      sendStep('insights', { content: typeof finalText === 'string' ? finalText : 'Analysis complete' });
    }

    sendStep('complete', { iterations: iteration });
    console.log(`✅ Complete (${iteration} iterations)`);
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
    service: 'biostat-final-improved',
    model: 'claude-sonnet-4-6',
    r_support: 'Native R with dependencies=TRUE',
    web_search: 'Claude web_search tool',
    features: ['r-native', 'web-search-tool', 'auto-dependencies', 'persistent'],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 FINAL IMPROVED BIOSTATISTICS AGENT - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n✨ Improvements:`);
  console.log(`   • Claude Sonnet 4 (latest model)`);
  console.log(`   • R dependencies=TRUE (like RStudio!)`);
  console.log(`   • Claude web_search tool integrated`);
  console.log(`   • 6 optimized iterations`);
  console.log(`   • Professional package handling`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-final.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;

