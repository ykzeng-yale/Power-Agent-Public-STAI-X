import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import CloudRunExecutor from './cloudrun-executor.js';

dotenv.config();

const app = express();
const port = 3005;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * PROACTIVE KNOWLEDGE SEARCH
 * Searches for package/method documentation BEFORE executing any code
 */
async function proactiveKnowledgeSearch(userQuery) {
  try {
    console.log(`🧠 Proactive knowledge search for: ${userQuery.substring(0, 80)}...`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      thinking: {
        type: 'enabled',
        budget_tokens: 3000,
      },
      messages: [{
        role: 'user',
        content: `User wants to: "${userQuery}"

TASK: Extract R package names or statistical methods mentioned, then search the web for their documentation.

Look for:
- R package names (e.g., "swdpwr", "MatchIt", "lme4", "CRTSize")
- Statistical methods (e.g., "propensity score matching", "difference-in-differences", "stepped wedge CRT")

Then search the web and provide:
1. Package/method overview and purpose
2. Key functions with EXACT parameter names and types
3. Working code examples (complete, runnable)
4. Common pitfalls and solutions

Format your response as a concise knowledge summary with code examples.`,
      }],
    });

    const content = response.content.find(block => block.type === 'text')?.text || '';
    console.log(`✅ Proactive search complete (${content.length} chars)`);

    return {
      found: content.length > 100,
      content: content,
    };
  } catch (error) {
    console.error('Proactive search error:', error.message);
    return {
      found: false,
      content: '',
    };
  }
}

/**
 * REACTIVE ERROR RECOVERY SEARCH
 * Searches for help when errors occur during execution
 */
async function searchRPackageHelp(packageName, errorMessage) {
  try {
    console.log(`🔍 Searching for help: ${packageName} - ${errorMessage.substring(0, 100)}`);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      thinking: {
        type: 'enabled',
        budget_tokens: 5000,
      },
      messages: [{
        role: 'user',
        content: `Search the web and find documentation for the R package "${packageName}".

Error encountered: ${errorMessage}

Find:
1. Correct function names and usage
2. Parameter names and types
3. Working code examples
4. Common issues and solutions

Provide a concise summary with actual code examples.`,
      }],
    });

    const content = response.content.find(block => block.type === 'text')?.text || '';
    console.log(`✅ Search results found (${content.length} chars)`);

    return {
      found: true,
      content: content,
    };
  } catch (error) {
    console.error('Search error:', error.message);
    return {
      found: false,
      content: `Could not search for package help. Try checking CRAN documentation manually: https://cran.r-project.org/package=${packageName}`,
    };
  }
}

/**
 * CLOUD RUN AGENTIC WORKFLOW
 * Uses Google Cloud Run instead of E2B for robust R execution
 */
app.post('/api/analyze-cloudrun', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendStep(step, data) {
    res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), ...data })}\n\n`);
  }

  try {
    let { query, data, preferredLanguage = 'auto' } = req.body;

    if (!query) {
      sendStep('error', { message: 'Query is required' });
      return res.end();
    }

    // AUTO-DETECT R PREFERENCE
    const rKeywords = ['swdpwr', 'MatchIt', 'lme4', 'lmerTest', 'CRTSize', 'pwr', 'broom',
                       'rstanarm', 'brms', 'AER', 'ivreg', 'rdrobust', 'rdd',
                       'use R', 'R package', 'R code', 'in R', 'with R'];

    const mentionsR = rKeywords.some(keyword =>
      query.toLowerCase().includes(keyword.toLowerCase())
    );

    const analysisKeywords = ['sample size', 'power', 'analysis', 'regression', 'test',
                              'model', 'correlation', 'anova', 'statistical', 'survival',
                              'bayesian', 'causal', 'inference', 'clinical trial', 'study design',
                              'propensity', 'difference-in-differences', 'instrumental variable',
                              'mixed model', 'hierarchical', 'multilevel'];

    const isAnalysisTask = analysisKeywords.some(keyword =>
      query.toLowerCase().includes(keyword.toLowerCase())
    );

    if (mentionsR && preferredLanguage === 'auto') {
      preferredLanguage = 'R';
      console.log('📊 Auto-detected R preference from R keywords');
    } else if (isAnalysisTask && preferredLanguage === 'auto') {
      preferredLanguage = 'R';
      console.log('📊 Default to R for statistical analysis task');
    }

    console.log(`\n🧠 Cloud Run Agentic Analysis: ${query.substring(0, 60)}...`);

    // Initialize Cloud Run Executor
    sendStep('init', {
      title: 'Initializing Cloud Run Environment',
      status: 'running',
      message: 'Connecting to Google Cloud Run Job...',
    });

    const executor = new CloudRunExecutor({
      projectId: process.env.GCP_PROJECT_ID || 'power-agent-476822',
      region: process.env.GCP_REGION || 'us-central1',
      jobName: process.env.GCP_JOB_NAME || 'rpy-agent-job',
    });

    sendStep('init', {
      title: 'Cloud Run Ready',
      status: 'completed',
      message: `Connected to ${executor.jobName} in ${executor.region}. R environment with pre-installed packages ready!`,
    });

    console.log(`✅ Cloud Run executor initialized: ${executor.jobName}`);

    // AGENTIC LOOP
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 5;
    let isComplete = false;

    // Track installed R packages
    const installedPackages = new Set();

    function trimConversationHistory() {
      if (conversationHistory.length > 9) {
        const initial = conversationHistory.slice(0, 1);
        const recent = conversationHistory.slice(-8);
        conversationHistory.length = 0;
        conversationHistory.push(...initial, ...recent);
        console.log(`🧹 Trimmed conversation history to ${conversationHistory.length} messages`);
      }
    }

    const systemPrompt = `You are an expert data analyst agent with access to R via Google Cloud Run.

LANGUAGE: R (via Google Cloud Run - NO Python wrapper needed!)

CRITICAL RULES:
1. You MUST execute code and see results before saying "ANALYSIS_COMPLETE"
2. Generate R code in EVERY iteration (don't just explain)
3. After seeing execution results, decide: iterate again OR complete
4. Only say "ANALYSIS_COMPLETE" AFTER you've seen execution outputs and are satisfied

Your capabilities:
- Full R environment via Cloud Run (24-hour timeout, NO 5-minute E2B limit!)
- Execute R code directly - NO need for Python subprocess wrapper
- All major R packages available

R PACKAGES - PRE-INSTALLED (NO INSTALLATION NEEDED):
✅ The following R packages are ALREADY in the Docker image - just use library():
- lme4 (mixed-effects models)
- swdpwr (stepped wedge cluster randomized trial power analysis)
- CRTSize (cluster randomized trial sample size)
- survey (complex survey analysis)
- survival (survival analysis, Cox models)
- pwr (power analysis)
- MatchIt (propensity score matching)
- lmerTest (tests for lme4 models)
- emmeans (estimated marginal means)
- effectsize (effect size calculations)
- Plus 49+ dependencies (Matrix, Rcpp, RcppEigen, jsonlite, etc.)

**CRITICAL: For these packages, DO NOT use install.packages() - they are already installed!**

Usage example (NO install.packages() needed):
\`\`\`r
library(lme4)  # Ready to use immediately!
model <- lmer(outcome ~ treatment + (1|unit_id), data)
summary(model)
\`\`\`

OTHER R PACKAGES (NOT PRE-INSTALLED):

For packages NOT in the above list, you CAN install them (NO 5-minute E2B timeout!):

\`\`\`r
options(repos = c(CRAN = "https://cloud.r-project.org"))
if (!require("packageName", quietly = TRUE)) {
  install.packages("packageName", dependencies = TRUE)
  library(packageName)
}
\`\`\`

✅ CLOUD RUN ADVANTAGE: 24-hour timeout means complex packages (bartCause, brms, rstanarm) can compile successfully!
✅ Build tools (g++, gfortran) are PRE-INSTALLED in the Docker image
✅ No more "terminated" connection errors during long compilations

CRITICAL R PACKAGE USAGE RULES:
1. Each R code block runs in a NEW R session - nothing persists between iterations
2. You MUST call library(packageName) at the START of EVERY R code block
3. Always start R code with: library(packageName) before using functions

Example - EVERY iteration needs library():
\`\`\`r
library(swdpwr)  # MUST include this EVERY TIME
result <- swdpwr(...)  # Now function is available
\`\`\`

Your workflow:
1. Generate R code for the task
2. Execute and inspect outputs
3. Iterate if needed or complete when satisfied
4. When satisfied, include "ANALYSIS_COMPLETE"

${data ? 'NOTE: Data provided by user is available as CSV text (include in your R code as inline data)' : ''}`;

    conversationHistory.push({
      role: 'user',
      content: `User request: "${query}"

Language preference: ${preferredLanguage}

${data ? `Data provided:\n${data}` : ''}

Please analyze this request using R.`,
    });

    // PROACTIVE KNOWLEDGE ACQUISITION
    const proactiveKnowledge = await proactiveKnowledgeSearch(query);

    if (proactiveKnowledge.found) {
      console.log(`📚 Injecting proactive knowledge into agent context`);

      sendStep('knowledge_search', {
        iteration: 0,
        title: 'Proactive Knowledge Acquisition',
        status: 'completed',
        message: 'Searched web for package documentation and best practices',
      });

      conversationHistory.push({
        role: 'user',
        content: `📚 PROACTIVE KNOWLEDGE (from web search):

${proactiveKnowledge.content}

Now use this knowledge to write correct R code.`,
      });
    }

    // ITERATIVE LOOP
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Reasoning - Iteration ${iteration}`,
        status: 'running',
        message:
          iteration === 1
            ? 'Analyzing request and planning R code...'
            : 'Reviewing results and deciding next steps...',
      });

      trimConversationHistory();

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

      // Check if complete
      const hasCodeToExecute = assistantMessage.match(/```r\n/);

      if (assistantMessage.includes('ANALYSIS_COMPLETE') && !hasCodeToExecute) {
        isComplete = true;
        sendStep('thinking', {
          iteration,
          title: `Agent Reasoning - Iteration ${iteration}`,
          status: 'completed',
          message: 'Analysis complete!',
          reasoning: assistantMessage.substring(0, 400),
        });
        break;
      }

      sendStep('thinking', {
        iteration,
        title: `Agent Reasoning - Iteration ${iteration}`,
        status: 'completed',
        reasoning: assistantMessage.substring(0, 300) + '...',
      });

      // Extract R code
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);

      if (!rMatch) {
        conversationHistory.push({
          role: 'user',
          content: 'Please provide R code to execute.',
        });
        continue;
      }

      const code = rMatch[1];

      sendStep('code', {
        iteration,
        title: `R Code Generated`,
        status: 'completed',
        code: code,
        language: 'R',
        message: `Ready to execute R code on Cloud Run`,
      });

      // Check if code includes package installation
      const needsInstall = code.match(/install\.packages\(['"]([\w.]+)['"]/g);
      if (needsInstall) {
        const packages = needsInstall.map(m => m.match(/install\.packages\(['"]([\w.]+)['"]/)[1]);
        const newPackages = packages.filter(pkg => !installedPackages.has(pkg));

        if (newPackages.length > 0) {
          sendStep('install', {
            iteration,
            title: 'Installing R Packages',
            status: 'running',
            message: `Installing ${newPackages.join(', ')} on Cloud Run (may take several minutes)...`,
          });

          try {
            const installResult = await executor.installPackages(newPackages);

            if (installResult.success) {
              newPackages.forEach(pkg => installedPackages.add(pkg));
              sendStep('install', {
                iteration,
                title: 'Packages Installed',
                status: 'completed',
                message: `Successfully installed: ${installResult.installed.join(', ')}`,
              });
            } else {
              sendStep('install', {
                iteration,
                title: 'Package Installation Warning',
                status: 'completed',
                message: `Some packages failed: ${installResult.failed.join(', ')}`,
              });
            }
          } catch (installError) {
            sendStep('install', {
              iteration,
              title: 'Package Installation Error',
              status: 'error',
              error: installError.message,
            });
          }
        }
      }

      // Execute R code on Cloud Run
      sendStep('executing', {
        iteration,
        title: `Executing R Code`,
        status: 'running',
        message: `Running R code on Cloud Run (24h timeout)...`,
      });

      let execution;
      try {
        execution = await executor.execute(code, 'R');

        sendStep('executing', {
          iteration,
          title: `R Code Executed`,
          status: 'completed',
          message: `Execution complete (${execution.elapsed.toFixed(1)}s). Processing results...`,
        });
      } catch (execError) {
        console.error(`❌ Cloud Run execution error:`, execError.message);

        sendStep('executing', {
          iteration,
          title: `Executing R Code`,
          status: 'error',
          error: execError.message,
        });

        conversationHistory.push({
          role: 'user',
          content: `Execution error: ${execError.message}

Please analyze the error and try a different approach.`,
        });
        continue;
      }

      const stdout = execution.logs.stdout || [];
      const stderr = execution.logs.stderr || [];

      sendStep('executing', {
        iteration,
        title: `R Execution Complete`,
        status: 'completed',
        output: stdout,
        warnings: stderr.length > 0 ? stderr : undefined,
        language: 'R',
      });

      // Check for R function errors and trigger web search
      let searchResults = null;
      if (execution.error) {
        const errorMessage = execution.error.message;
        const packageMatch = code.match(/library\(["']?(\w+)["']?\)/);
        const packageName = packageMatch ? packageMatch[1] : 'unknown';

        sendStep('web_search', {
          iteration,
          title: 'Searching Documentation',
          status: 'running',
          message: `Searching for ${packageName} package documentation...`,
        });

        searchResults = await searchRPackageHelp(packageName, errorMessage);

        sendStep('web_search', {
          iteration,
          title: 'Documentation Found',
          status: 'completed',
          message: searchResults.found
            ? `Found ${packageName} documentation and examples`
            : 'Limited results - check CRAN manually',
        });
      }

      // Give execution results back to agent
      let executionFeedback = `
===== EXECUTION RESULTS (Iteration ${iteration}) =====

PLATFORM: Google Cloud Run (24h timeout, pre-installed packages)

STDOUT:
${stdout.length > 0 ? stdout.join('\n') : '(empty - code may have run successfully with no print output)'}

${stderr.length > 0 ? `STDERR/WARNINGS:\n${stderr.join('\n')}` : ''}

${execution.error ? `ERROR:\n${execution.error.message}` : ''}`;

      if (searchResults && searchResults.found) {
        executionFeedback += `

===== WEB SEARCH RESULTS =====

${searchResults.content}

Use these documentation examples to fix your code.`;
      }

      executionFeedback += `

===== YOUR TASK =====

You have now SEEN the execution results above. Review them carefully:

1. Did the code run successfully?
2. Did you get the information needed to answer the user's question?
3. Do you need to refine the code or try a different approach?

YOUR OPTIONS:
A) If the results are SUFFICIENT:
   - Provide a clear interpretation of the results
   - Include "ANALYSIS_COMPLETE" in your response

B) If you need to iterate:
   - Explain what you learned from the outputs
   ${searchResults && searchResults.found ? '- Use the web search results above to fix function errors' : ''}
   - Generate improved R code for the next iteration
   - Do NOT say "ANALYSIS_COMPLETE"

Remember: The user is waiting for ACTUAL RESULTS, not just code!`;

      conversationHistory.push({
        role: 'user',
        content: executionFeedback,
      });

      await sleep(300);
    }

    // Final insights
    sendStep('summary', {
      title: 'Analysis Complete',
      status: 'completed',
      totalIterations: iteration,
    });

    const finalResponse = conversationHistory[conversationHistory.length - 1];
    if (finalResponse.role === 'assistant') {
      sendStep('insights', {
        title: 'Final Insights',
        status: 'completed',
        content: finalResponse.content,
      });
    }

    sendStep('complete', {
      iterations: iteration,
    });

    console.log(`✅ Cloud Run analysis complete (${iteration} iterations)`);
    res.end();
  } catch (error) {
    console.error('❌ Error:', error);
    sendStep('error', { message: error.message });
    res.end();
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'claude-cloudrun-agent',
    platform: 'Google Cloud Run Jobs',
    features: [
      'r-execution-cloudrun',
      'no-5min-timeout',
      'preinstalled-biostat-packages',
      'iterative-reasoning',
      '24h-execution-time',
    ],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🌐 CLOUD RUN AGENTIC SYSTEM - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n💻 Platform: Google Cloud Run Jobs`);
  console.log(`\n📦 R Environment:`);
  console.log(`   • R 4.4.1 with full package support`);
  console.log(`   • Pre-installed: lme4, swdpwr, CRTSize, survival, pwr, etc.`);
  console.log(`   • Build tools: g++, gfortran (pre-installed)`);
  console.log(`   • Can install CRAN packages (24h timeout - no limits!)`);
  console.log(`\n⚡ Advantages over E2B:`);
  console.log(`   • 24-hour timeout (vs 5 minutes)`);
  console.log(`   • No connection drops during long compilations`);
  console.log(`   • Complex packages (bartCause, brms) can fully compile`);
  console.log(`   • Pre-installed biostatistics packages`);
  console.log(`\n🧠 Agent Can:`);
  console.log(`   • Execute R code directly (no Python wrapper)`);
  console.log(`   • Install complex CRAN packages without timeout`);
  console.log(`   • Iterate and refine analysis`);
  console.log(`   • Auto-correct errors using web search`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-cloudrun.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;
