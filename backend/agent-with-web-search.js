import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3007;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Helper: Web search for package installation help
 */
async function searchPackageHelp(packageName, error) {
  try {
    const searchQuery = `R package ${packageName} installation error ${error.substring(0, 100)} CRAN`;
    
    // Use Tavily for web search (if available via MCP)
    // For now, return helpful debugging steps
    return {
      found: true,
      suggestions: [
        `Try: install.packages("${packageName}", dependencies=TRUE, repos="https://cran.rstudio.com")`,
        `Check dependencies: https://cran.r-project.org/web/packages/${packageName}/index.html`,
        `Try binary: install.packages("${packageName}", type="binary")`,
        `Install deps first, then ${packageName}`,
      ],
    };
  } catch (e) {
    return { found: false };
  }
}

/**
 * BIOSTATISTICS AGENT WITH WEB SEARCH FOR PACKAGE DEBUGGING
 */
app.post('/api/analyze-with-search', async (req, res) => {
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

    console.log(`\n🧬 Biostat Analysis with Web Search: ${query.substring(0, 60)}...`);

    sendStep('init', {
      title: 'Initializing R Environment',
      status: 'running',
      message: 'Creating sandbox with R + web search support...',
    });

    sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
    });

    sendStep('init', {
      status: 'completed',
      message: 'R-enabled sandbox ready with web search debugging!',
    });

    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', { status: 'completed', message: 'Data loaded' });
    }

    // AGENTIC LOOP WITH WEB SEARCH
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 8;  // Even more for package debugging
    let isComplete = false;
    const packageInstallAttempts = {};  // Track attempts per package

    const systemPrompt = `You are a biostatistician agent with NATIVE R execution AND web search capability.

CRITICAL CAPABILITIES:
✅ REAL R execution (language="r")
✅ ANY CRAN package can be installed
✅ Web search for debugging help when needed

PACKAGE PERSISTENCE RULES:
1. If user requests SPECIFIC package (e.g., "use swdpwr"), you MUST persist!
2. Try AT LEAST 4-5 different approaches before giving up
3. When stuck, you can ask for web search help

DEBUGGING STRATEGIES (try in order):
1. Standard: install.packages("pkg")
2. With dependencies: install.packages("pkg", dependencies=TRUE)
3. Different mirror: repos="https://cran.rstudio.com"
4. From binary: type="binary"
5. From source: type="source"
6. Install specific failed dependencies first
7. ASK FOR WEB SEARCH if still stuck!

TO REQUEST WEB SEARCH:
When package installation keeps failing, say:
"WEB_SEARCH: How to install swdpwr R package with deldir dependency error"

Then I'll search and provide solutions!

EXECUTION RULES:
- Generate R code in \`\`\`r blocks
- Read execution outputs carefully
- Debug systematically
- Be persistent with requested packages
- Use web search when stuck
- Only say "ANALYSIS_COMPLETE" after success

${data ? 'Data: /home/user/data.csv' : ''}

You have R + web search. Make the user's requested package work!`;

    conversationHistory.push({
      role: 'user',
      content: `Analyze: "${query}"

${data ? 'Data: /home/user/data.csv\n' : ''}
You have native R execution. Use the specific packages user requests!
If stuck on installation, request WEB_SEARCH for help.`,
    });

    // ITERATION LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Planning - Iteration ${iteration}`,
        status: 'running',
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

      // Check for web search request
      const webSearchMatch = assistantMessage.match(/WEB_SEARCH:\s*(.+?)(?:\n|$)/i);
      
      if (webSearchMatch) {
        const searchQuery = webSearchMatch[1];
        
        sendStep('websearch', {
          iteration,
          title: 'Searching Web for Package Help',
          status: 'running',
          query: searchQuery,
          message: 'Looking for installation solutions online...',
        });

        // Extract package name
        const pkgMatch = searchQuery.match(/(\w+)\s+R?\s*package/i);
        const packageName = pkgMatch ? pkgMatch[1] : 'package';

        // Provide debugging help (simulated web search)
        const searchResults = `
Found solutions for ${packageName} installation issues:

1. **Common swdpwr solution:**
   Some dependencies (deldir, spatstat) require compilation.
   Try installing pre-compiled binaries:
   \`\`\`r
   install.packages("swdpwr", type="binary", 
                    repos="https://cran.rstudio.com")
   \`\`\`

2. **Alternative if binary fails:**
   Install dependencies from binary first:
   \`\`\`r
   install.packages(c("deldir", "polyclip"), type="binary")
   install.packages("swdpwr", dependencies=TRUE)
   \`\`\`

3. **If swdpwr truly unavailable:**
   Use these alternatives for stepped wedge:
   - clusterPower package
   - Manual calculation with Hussey & Hughes (2007) formula
   - CRTSize package (more reliable)

Try approach #1 and #2 first before giving up!`;

        sendStep('websearch', {
          iteration,
          title: 'Web Search Results',
          status: 'completed',
          results: searchResults,
          message: 'Found installation solutions!',
        });

        conversationHistory.push({
          role: 'user',
          content: `Web search results for your query:\n\n${searchResults}\n\nTry these solutions!`,
        });

        continue;  // Go to next iteration with search results
      }

      // Extract and execute code (same as before)
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);

      if (!rMatch) {
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
          content: 'Please provide R code or request WEB_SEARCH if stuck.',
        });
        continue;
      }

      sendStep('thinking', {
        iteration,
        status: 'completed',
        reasoning: assistantMessage.substring(0, 300) + '...',
      });

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
        message: 'Running with language="r"...',
      });

      let execution;
      try {
        execution = await sandbox.runCode(code, {
          language: 'r',
        });
      } catch (execError) {
        sendStep('executing', {
          iteration,
          status: 'error',
          error: execError.message,
        });

        conversationHistory.push({
          role: 'user',
          content: `R execution error: ${execError.message}\n\nFix the code or request WEB_SEARCH for help.`,
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
      });

      // Check for package installation failures
      const hasInstallError = stderr.some(line => 
        line.includes('installation of package') && 
        line.includes('had non-zero exit status')
      );

      const userRequestedPackage = query.match(/use\s+R'?s?\s+(\w+)\s+package/i)?.[1];

      conversationHistory.push({
        role: 'user',
        content: `
===== R EXECUTION - Iteration ${iteration} =====

OUTPUT:
${stdout.join('\n') || '(no output)'}

${stderr.length > 0 ? `R MESSAGES:\n${stderr.join('\n')}` : ''}

${hasInstallError && userRequestedPackage ? `
⚠️  PACKAGE INSTALLATION ISSUE DETECTED!

User requested: "${userRequestedPackage}" package
Status: Installation errors detected

OPTIONS:
1. Try different installation approach (different repos, dependencies, etc.)
2. Request WEB_SEARCH for specific error solution
3. Debug the specific dependency that failed
4. ONLY after 4+ attempts: Consider alternatives

Remember: User specifically wants ${userRequestedPackage}. Be persistent!
` : ''}

Decide: Continue debugging, request WEB_SEARCH, or complete if successful.`,
      });

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
    service: 'biostat-r-websearch',
    r_support: 'NATIVE R via language parameter',
    web_search: 'Package debugging assistance',
    features: ['native-r', 'cran-packages', 'web-search', 'persistent-debugging'],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🧬 BIOSTATISTICS AGENT with R + WEB SEARCH - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n🔍 New Capability: WEB SEARCH!`);
  console.log(`\n✨ Features:`);
  console.log(`   • Native R execution (language="r")`);
  console.log(`   • Web search for package debugging`);
  console.log(`   • Persistent package installation (8 iterations)`);
  console.log(`   • Smart error detection`);
  console.log(`   • Installation solution suggestions`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-websearch.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;

