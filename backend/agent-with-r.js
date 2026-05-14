import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { Sandbox } from '@e2b/code-interpreter';

dotenv.config();

const app = express();
const port = 3004;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================
// PERSISTENT SANDBOX MANAGEMENT (Phase 1)
// ============================================
const sessionSandboxes = new Map(); // sessionId -> { sandboxId, buildToolsInstalled, createdAt }

// Cleanup old sessions after 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionSandboxes.entries()) {
    if (now - session.createdAt > 30 * 60 * 1000) {
      console.log(`🧹 Cleaning up expired session: ${sessionId}`);
      sessionSandboxes.delete(sessionId);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

/**
 * Web search helper for R package documentation and error debugging
 */
/**
 * PROACTIVE KNOWLEDGE SEARCH
 * Searches for package/method documentation BEFORE executing any code
 * Reduces errors and iterations by providing correct syntax upfront
 */
async function proactiveKnowledgeSearch(userQuery) {
  try {
    console.log(`🧠 Proactive knowledge search for: ${userQuery.substring(0, 80)}...`);

    // Use Claude to extract packages and search for documentation
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

    const searchQuery = `R ${packageName} package function usage example CRAN ${errorMessage.substring(0, 100)}`;

    // Use Claude with extended thinking for web search
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
      query: searchQuery,
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
 * MULTI-LANGUAGE AGENTIC WORKFLOW
 * Supports Python AND R code execution
 */
app.post('/api/analyze-multilang', async (req, res) => {
  let sandbox = null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function sendStep(step, data) {
    res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), ...data })}\n\n`);
  }

  try {
    let { query, data, preferredLanguage = 'auto', sessionId } = req.body;

    if (!query) {
      sendStep('error', { message: 'Query is required' });
      return res.end();
    }

    // Generate session ID if not provided (for persistent sandboxes)
    if (!sessionId) {
      sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // AUTO-DETECT R PREFERENCE
    // If user mentions R packages or "use R", strongly prefer R methods
    const rKeywords = ['swdpwr', 'MatchIt', 'lme4', 'lmerTest', 'CRTSize', 'pwr', 'broom',
                       'rstanarm', 'brms', 'AER', 'ivreg', 'rdrobust', 'rdd',
                       'use R', 'R package', 'R code', 'in R', 'with R'];

    const mentionsR = rKeywords.some(keyword =>
      query.toLowerCase().includes(keyword.toLowerCase())
    );

    // STATISTICAL ANALYSIS KEYWORDS - prefer R by default
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

    console.log(`\n🧠 Multi-Language Agentic Analysis: ${query.substring(0, 60)}...`);

    // ============================================
    // PERSISTENT SANDBOX: Check for existing session
    // ============================================
    let buildToolsInstalled = false;
    const sessionData = sessionSandboxes.get(sessionId);

    if (sessionData) {
      // Try to reuse existing sandbox
      try {
        sendStep('init', {
          title: 'Reusing Existing Environment',
          status: 'running',
          message: 'Reconnecting to persistent session...',
        });

        sandbox = await Sandbox.reconnect(sessionData.sandboxId, {
          apiKey: process.env.E2B_API_KEY,
        });

        buildToolsInstalled = sessionData.buildToolsInstalled;
        console.log(`♻️  Reusing sandbox ${sessionData.sandboxId} (build tools: ${buildToolsInstalled ? 'ready' : 'not installed'})`);

        sendStep('init', {
          title: 'Session Restored',
          status: 'completed',
          message: 'Connected to existing environment. R packages and build tools preserved!',
        });
      } catch (reconnectError) {
        console.log(`⚠️  Failed to reconnect to sandbox ${sessionData.sandboxId}: ${reconnectError.message}`);
        console.log('🆕 Creating new sandbox instead...');
        sessionSandboxes.delete(sessionId);
      }
    }

    if (!sandbox) {
      // Create new sandbox
      sendStep('init', {
        title: 'Initializing Multi-Language Environment',
        status: 'running',
        message: 'Creating sandbox with Python + R support...',
      });

      sandbox = await Sandbox.create({
        apiKey: process.env.E2B_API_KEY,
        template: 'biostat-r-v4', // Clean rebuild with verified packages
        timeout: 1800000, // 30 minutes
      });

      // Store sandbox for reuse
      sessionSandboxes.set(sessionId, {
        sandboxId: sandbox.id,
        buildToolsInstalled: false,
        createdAt: Date.now(),
      });

      console.log(`🆕 Created new sandbox ${sandbox.id} for session ${sessionId}`);

      // Extend sandbox lifetime
      await sandbox.setTimeout(1800000); // 30 minutes keepalive
    }

    // Install rpy2 for R integration
    sendStep('init', {
      title: 'Setting Up R Support',
      status: 'running',
      message: 'Installing rpy2 for R package integration...',
    });

    try {
      await sandbox.runCode('pip install -q rpy2 2>&1');
      sendStep('init', {
        title: 'R Support Ready',
        status: 'completed',
        message: 'Python + R environment configured. Agent can use both languages!',
      });
    } catch (err) {
      sendStep('init', {
        title: 'R Support',
        status: 'completed',
        message: 'Python environment ready. Will use Python with R integration via rpy2 if needed.',
      });
    }

    // Write data if provided
    if (data) {
      await sandbox.files.write('/home/user/data.csv', data);
      sendStep('data', {
        status: 'completed',
        message: 'Data loaded and accessible to both Python and R',
      });
    }

    // AGENTIC LOOP with multi-language support
    const conversationHistory = [];
    let iteration = 0;
    const maxIterations = 5;  // Max 5 attempts - if fails 5 times, something is fundamentally wrong
    let isComplete = false;

    // Track installed R packages across iterations
    const installedPackages = new Set();

    // ============================================
    // CONVERSATION HISTORY TRIMMING (Fix token overflow)
    // ============================================
    function trimConversationHistory() {
      // Keep only the last 4 exchanges (8 messages: 4 user + 4 assistant)
      // Plus the initial query
      if (conversationHistory.length > 9) {
        const initial = conversationHistory.slice(0, 1); // Keep first user query
        const recent = conversationHistory.slice(-8); // Keep last 8 messages
        conversationHistory.length = 0;
        conversationHistory.push(...initial, ...recent);
        console.log(`🧹 Trimmed conversation history to ${conversationHistory.length} messages`);
      }
    }

    const systemPrompt = `You are an expert data analyst agent with access to BOTH Python AND R.

LANGUAGE PREFERENCE:
- Current setting: ${preferredLanguage}
${preferredLanguage === 'R' ? `- User explicitly requested R or mentioned R packages
- ⚠️ STRONGLY PREFER R for all statistical analysis
- Use native R packages and code (swdpwr, MatchIt, lme4, CRTSize, pwr, etc.)
- Only use Python if task cannot be done in R` : '- Choose best language for the task (R for stats packages, Python for general data manipulation)'}

CRITICAL RULES:
1. You MUST execute code and see results before saying "ANALYSIS_COMPLETE"
2. Generate code in EVERY iteration (don't just explain)
3. After seeing execution results, decide: iterate again OR complete
4. Only say "ANALYSIS_COMPLETE" AFTER you've seen execution outputs and are satisfied

Your capabilities:
- Python: pandas, numpy, matplotlib, seaborn, scipy, scikit-learn
- R: Full R environment with ability to use ANY CRAN package
- Multi-language: Can use Python for execution and call R packages when needed

R PACKAGES - PRE-INSTALLED (NO INSTALLATION NEEDED):

✅ The following R packages are ALREADY AVAILABLE in the E2B template - just use library():
- lme4 (mixed-effects models, difference-in-differences, hierarchical models)
- swdpwr (stepped wedge cluster randomized trial power analysis)
- CRTSize (cluster randomized trial sample size calculations)
- survey (complex survey analysis and weighting)
- survival (survival analysis, Kaplan-Meier, Cox proportional hazards)
- Rcpp, RcppEigen (C++ integration for performance)

**CRITICAL: For these packages, DO NOT use install.packages() - they are already installed!**

Usage example (NO install.packages() needed):
\`\`\`r
library(lme4)  # Ready to use immediately - no installation!
model <- lmer(outcome ~ treatment + (1|unit_id), data)
summary(model)
\`\`\`

Example for swdpwr (NO install.packages() needed):
\`\`\`r
library(swdpwr)  # Already installed - just load it!
result <- swdpower(...)
\`\`\`

OTHER R PACKAGES (NOT PRE-INSTALLED):

For packages NOT in the above list, you can install them from CRAN:

\`\`\`r
# Set CRAN mirror
options(repos = c(CRAN = "https://cloud.r-project.org"))

# Install and load package
if (!require("packageName", quietly = TRUE)) {
  cat("Installing packageName from CRAN...\\n")
  install.packages("packageName", dependencies = TRUE)
  library(packageName)
  cat("✓ packageName ready\\n")
} else {
  library(packageName)
}
\`\`\`

⚠️ IMPORTANT INSTALLATION NOTES:
- First-time C++ package installs take 2-5 minutes (compiling from source)
- Some complex packages (bartCause, brms, rstanarm) take 20+ minutes and may hit E2B timeout
- If install.packages() times out after ~5 minutes, consider:
  1. Using a pre-installed alternative (see list above)
  2. Switching to Python equivalent (scipy, sklearn, statsmodels)
  3. Using simpler R packages with similar functionality

CRITICAL R PACKAGE USAGE RULES:
1. Each R code block runs in a NEW R session - nothing persists between iterations
2. You MUST call library(packageName) at the START of EVERY R code block that uses that package
3. If you used library(swdpwr) in iteration 2, you must use it again in iterations 3, 4, 5, etc.
4. Always start R code with: library(packageName) before using any functions from that package

Example - EVERY iteration needs library():
\`\`\`r
library(swdpwr)  # MUST include this EVERY TIME
result <- swdpower(...)  # Now function is available
\`\`\`

How to use R packages in Python:
\`\`\`python
import rpy2.robjects as ro
from rpy2.robjects import pandas2ri
from rpy2.robjects.packages import importr

# Activate pandas conversion
pandas2ri.activate()

# Import R packages
base = importr('base')
stats = importr('stats')
# For CRAN packages: Use ro.r('install.packages("package_name")')

# Use R functions
result = stats.lm('y ~ x', data=df_r)
\`\`\`

Alternative - Direct R code execution:
\`\`\`python
import subprocess
r_code = """
library(ggplot2)
data <- read.csv('/home/user/data.csv')
summary(data)
"""
result = subprocess.run(['Rscript', '-e', r_code], capture_output=True, text=True)
print(result.stdout)
\`\`\`

Your workflow:
1. Determine if task needs R-specific features (e.g., lme4, survey packages, specific R functions)
2. If yes, use rpy2 or subprocess approach
3. After installing R packages, ALWAYS call library(packageName) to load them
4. If you get "function not found" errors, check if package is loaded with library()
5. Inspect outputs and iterate as needed
6. When satisfied, include "ANALYSIS_COMPLETE"

${data ? 'Data available at: /home/user/data.csv' : ''}`;

    conversationHistory.push({
      role: 'user',
      content: `User request: "${query}"

Language preference: ${preferredLanguage}

${data ? 'Data is loaded at /home/user/data.csv' : ''}

Please analyze this request. You can use Python, R (via rpy2), or both.`,
    });

    // PROACTIVE KNOWLEDGE ACQUISITION (NEW)
    // Search for package documentation BEFORE attempting any code execution
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
        content: `📚 PROACTIVE KNOWLEDGE (from web search before coding):

${proactiveKnowledge.content}

Now use this knowledge to write correct code on your first attempt.`,
      });
    }

    // ITERATIVE LOOP (increased from 5 to 10 for complex R package debugging)
    while (!isComplete && iteration < maxIterations) {
      iteration++;

      sendStep('thinking', {
        iteration,
        title: `Agent Reasoning - Iteration ${iteration}`,
        status: 'running',
        message:
          iteration === 1
            ? 'Analyzing request and choosing best approach (Python, R, or both)...'
            : 'Reviewing results and deciding next steps...',
      });

      // Trim conversation history to prevent token overflow
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

      // DON'T complete yet if there's code to execute!
      // Only complete if explicitly requested AND no code present
      const hasCodeToExecute = assistantMessage.match(/```(python|r)\n/);
      
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

      // Extract code (Python or R detection)
      const pythonMatch = assistantMessage.match(/```python\n([\s\S]*?)\n```/);
      const rMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);

      let code, language;
      if (pythonMatch) {
        code = pythonMatch[1];
        language = 'Python';
      } else if (rMatch) {
        code = rMatch[1];
        language = 'R';
      } else {
        conversationHistory.push({
          role: 'user',
          content: 'Please provide the code to execute (Python or R).',
        });
        continue;
      }

      sendStep('code', {
        iteration,
        title: `${language} Code Generated`,
        status: 'completed',
        code: code,
        language: language,
        message: `Ready to execute ${language} code`,
      });

      // Execute code
      sendStep('executing', {
        iteration,
        title: `Executing ${language} Code`,
        status: 'running',
        message: `Running ${language} in E2B sandbox...`,
      });

      let execution;
      const execStartTime = Date.now(); // Track execution duration for error logging
      try {
        // If R code with package installation, ensure build tools are present
        if (language === 'R' && code.includes('install.packages') && !buildToolsInstalled) {
          sendStep('build_tools', {
            iteration,
            title: 'Installing Build Tools',
            status: 'running',
            message: 'Installing g++, gfortran, and system dependencies...',
          });

          // Install build tools via E2B commands with MAXIMUM timeout for robustness
          try {
            await sandbox.commands.run(
              'sudo apt-get update -qq && sudo apt-get install -y -qq build-essential gfortran libopenblas-dev liblapack-dev libcurl4-openssl-dev libssl-dev libxml2-dev 2>&1 | tail -5',
              { timeoutMs: 900000 } // 15 minutes for maximum robustness
            );

            buildToolsInstalled = true;

            // Update session data
            const session = sessionSandboxes.get(sessionId);
            if (session) {
              session.buildToolsInstalled = true;
            }

            sendStep('build_tools', {
              iteration,
              title: 'Build Tools Ready',
              status: 'completed',
              message: 'C++/Fortran compilers installed. R package compilation enabled.',
            });
          } catch (toolErr) {
            console.log('Build tools install warning:', toolErr.message);
          }
        } else if (language === 'R' && code.includes('install.packages') && buildToolsInstalled) {
          // Build tools already installed - skip!
          console.log('♻️  Build tools already installed, skipping...');
        }

        // If R code, wrap in Python subprocess call
        let execCode = code;
        if (language === 'R') {
          execCode = `
import subprocess
import tempfile

r_code = """
${code}
"""

# Write R code to temp file
with tempfile.NamedTemporaryFile(mode='w', suffix='.R', delete=False) as f:
    f.write(r_code)
    r_file = f.name

# Execute R script (MAXIMUM timeout for robustness)
try:
    result = subprocess.run(['Rscript', r_file],
                          capture_output=True,
                          text=True,
                          timeout=1200)
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)
except Exception as e:
    print(f"Error executing R: {e}")
`;
        }

        // Detect long-running packages that need background execution with polling
        const longRunningPackages = ['bartCause', 'ranger', 'brms', 'rstanarm', 'caret', 'mgcv'];
        const isLongRunning = language === 'R' &&
                             code.includes('install.packages') &&
                             longRunningPackages.some(pkg => code.includes(pkg));

        if (isLongRunning) {
          // Background execution with polling for long-running packages
          const startTime = Date.now();
          const estimatedMinutes = code.includes('bartCause') ? '5-7' :
                                  code.includes('ranger') || code.includes('caret') ? '3-5' :
                                  code.includes('brms') || code.includes('rstanarm') ? '8-12' : '5-10';

          sendStep('executing', {
            iteration,
            title: `Installing R Package (Background)`,
            status: 'running',
            message: `Starting package installation in background... Estimated: ${estimatedMinutes} minutes`,
          });

          // Write code to temp file in sandbox
          const timestamp = Date.now();
          const scriptPath = `/tmp/r_exec_${timestamp}.py`;
          const stdoutPath = `/tmp/r_stdout_${timestamp}.txt`;
          const stderrPath = `/tmp/r_stderr_${timestamp}.txt`;
          const wrapperPath = `/tmp/r_wrapper_${timestamp}.sh`;

          await sandbox.files.write(scriptPath, execCode);

          // Create wrapper script for proper output capture
          const wrapperScript = `#!/bin/bash
python3 ${scriptPath} > ${stdoutPath} 2> ${stderrPath}
echo $? > ${stdoutPath}.exitcode
`;
          await sandbox.files.write(wrapperPath, wrapperScript);

          // Make wrapper executable and run in background
          await sandbox.commands.run(`chmod +x ${wrapperPath}`);
          const process = await sandbox.commands.run(`nohup ${wrapperPath} &`, {
            background: true,
            timeout: 0, // No timeout - will poll manually
          });

          console.log(`🔄 Started background process for R package installation (wrapper: ${wrapperPath})`);

          // Poll every 30 seconds - check for completion via exitcode file
          let pollCount = 0;
          const maxPolls = 60; // 60 polls × 30s = 30 min maximum
          let completedNormally = false;
          let lastReadPosition = 0; // Track position in stdout file for streaming
          let consecutiveReadErrors = 0; // Track sandbox health

          while (pollCount < maxPolls) {
            await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds
            pollCount++;

            const elapsed = (Date.now() - startTime) / 1000 / 60; // minutes

            // CRITICAL: Send SSE keepalive to prevent connection timeout
            // Even if no new data, keep connection alive during long operations
            sendStep('keepalive', {
              iteration,
              timestamp: Date.now(),
              elapsed: `${elapsed.toFixed(1)} min`,
            });

            // Check if process completed by looking for exitcode file
            let stillRunning = true;
            try {
              const exitcodeContent = await sandbox.files.read(`${stdoutPath}.exitcode`);
              stillRunning = false; // File exists and readable = process done
              completedNormally = true;
              console.log(`✅ Background process completed after ${elapsed.toFixed(1)} minutes`);
            } catch (e) {
              // E2B ERROR LOGGING: Log full error details for debugging
              // Skip logging expected "does not exist" errors (normal - means process still running)
              if (e.name !== 'NotFoundError' && !e.message?.includes('does not exist')) {
                console.error(`🔴 E2B Error reading exitcode (poll ${pollCount}):`, {
                  message: e.message,
                  name: e.name,
                  stack: e.stack,
                  sandboxId: sandbox?.id,
                });
              }
              // File doesn't exist yet = still running
              // Read stdout file and stream new content to user
              try {
                const currentStdout = await sandbox.files.read(stdoutPath);
                const fullOutput = currentStdout.toString();

                // Success reading - reset error counter
                consecutiveReadErrors = 0;

                if (fullOutput.length > 0) {
                  console.log(`📊 Output file size: ${fullOutput.length} bytes`);

                  // Get only new content since last read
                  if (fullOutput.length > lastReadPosition) {
                    const newContent = fullOutput.substring(lastReadPosition);
                    lastReadPosition = fullOutput.length;

                    // Parse for meaningful updates (package installation progress)
                    const lines = newContent.split('\n').filter(line => line.trim());
                    const interestingLines = lines.filter(line => {
                      const lower = line.toLowerCase();
                      return (
                        lower.includes('installing') ||
                        lower.includes('trying url') ||
                        lower.includes('downloaded') ||
                        lower.includes('done (') ||
                        lower.includes('gcc') ||
                        lower.includes('g++') ||
                        lower.includes('gfortran') ||
                        lower.includes('compiling') ||
                        lower.includes('loading') ||
                        lower.includes('package') ||
                        lower.includes('* installing *source* package') ||
                        lower.includes('** libs') ||
                        lower.includes('** r') ||
                        lower.includes('** byte-compile')
                      );
                    });

                    // Stream interesting lines to user
                    if (interestingLines.length > 0) {
                      // Take up to last 5 meaningful lines for display
                      const displayLines = interestingLines.slice(-5);
                      const progressMessage = displayLines.join('\n');

                      sendStep('progress', {
                        iteration,
                        title: `Installing... (${elapsed.toFixed(1)}/${estimatedMinutes} min)`,
                        status: 'running',
                        message: progressMessage,
                        detail: `${pollCount * 30}s elapsed`,
                      });

                      console.log(`📦 Progress update (${displayLines.length} lines):`);
                      displayLines.forEach(line => console.log(`   ${line.substring(0, 100)}`));
                    } else if (newContent.trim().length > 0) {
                      // If no interesting lines but got new content, show generic update
                      sendStep('progress', {
                        iteration,
                        title: `Installing... (${elapsed.toFixed(1)}/${estimatedMinutes} min)`,
                        status: 'running',
                        message: `Compiling package... ${pollCount * 30}s elapsed. Processing...`,
                        detail: `${lines.length} new output lines`,
                      });
                    }
                  } else {
                    // No new content since last read
                    sendStep('progress', {
                      iteration,
                      title: `Installing... (${elapsed.toFixed(1)}/${estimatedMinutes} min)`,
                      status: 'running',
                      message: `Compiling package... ${pollCount * 30}s elapsed. Still running...`,
                    });
                  }
                }
              } catch (readErr) {
                // E2B ERROR LOGGING: Track consecutive failures to detect sandbox death
                // Skip logging expected "does not exist" errors unless approaching sandbox death threshold
                consecutiveReadErrors++;

                // Only log if it's a real error OR we're approaching the death threshold (3+)
                if ((readErr.name !== 'NotFoundError' && !readErr.message?.includes('does not exist')) || consecutiveReadErrors >= 3) {
                  console.error(`🔴 E2B Error reading stdout (poll ${pollCount}, error ${consecutiveReadErrors}/5):`, {
                    message: readErr.message,
                    name: readErr.name,
                    sandboxId: sandbox?.id,
                  });
                }

                // SANDBOX HEALTH CHECK: If 5+ consecutive read errors, sandbox might be dead
                if (consecutiveReadErrors >= 5) {
                  console.error(`❌ E2B Sandbox appears to be dead (5+ consecutive read errors)`);

                  const detailedError = `E2B Sandbox died after ${elapsed.toFixed(1)} minutes (${pollCount * 30}s).\n\n` +
                    `🔴 SANDBOX HEALTH CHECK FAILURE:\n` +
                    `- Consecutive Read Errors: ${consecutiveReadErrors}\n` +
                    `- Error Type: ${readErr.name || 'Unknown'}\n` +
                    `- Error Message: ${readErr.message}\n` +
                    `- Sandbox ID: ${sandbox?.id || 'unknown'}\n` +
                    `- Time Running: ${elapsed.toFixed(1)} minutes\n` +
                    `- Likely Cause: E2B sandbox timeout, crash, or connection loss during long compilation\n\n` +
                    `AGENT GUIDANCE:\n` +
                    `This package (${code.includes('bartCause') ? 'bartCause' : code.includes('brms') ? 'brms' : code.includes('rstanarm') ? 'rstanarm' : 'unknown'}) requires extremely long compilation (20+ min) and E2B sandbox cannot sustain it.\n\n` +
                    `RECOMMENDED ALTERNATIVES:\n` +
                    `1. Use Python equivalent (e.g., scikit-learn GBRT instead of BART)\n` +
                    `2. Use pre-compiled binaries (if available)\n` +
                    `3. Suggest simpler R packages with similar functionality\n` +
                    `4. Break analysis into smaller chunks\n` +
                    `5. Document limitation and suggest local R installation for production use`;

                  sendStep('executing', {
                    iteration,
                    title: 'E2B Sandbox Error',
                    status: 'error',
                    error: `Sandbox connection lost after ${elapsed.toFixed(1)} minutes. E2B may have timed out or crashed. Error: ${readErr.message}`,
                  });
                  throw new Error(detailedError);
                }

                // Stdout file not readable yet (might be initializing)
                sendStep('progress', {
                  iteration,
                  title: `Installing... (${elapsed.toFixed(1)}/${estimatedMinutes} min)`,
                  status: 'running',
                  message: `Compiling package... ${pollCount * 30}s elapsed. ${consecutiveReadErrors > 0 ? `(read attempt ${consecutiveReadErrors})` : 'Initializing...'}`,
                });
              }
              stillRunning = true;
            }

            if (!stillRunning) {
              sendStep('executing', {
                iteration,
                title: `Package Installation Complete`,
                status: 'completed',
                message: `Installation finished in ${elapsed.toFixed(1)} minutes`,
              });
              break;
            }

            // Check if we're approaching max polls
            if (pollCount >= maxPolls - 5) {
              console.log(`⚠️  Approaching max poll limit (${pollCount}/${maxPolls})`);
            }

            console.log(`⏳ Poll ${pollCount}: Still running (${elapsed.toFixed(1)} min elapsed)`);
          }

          // Handle timeout case
          if (!completedNormally) {
            const elapsed = (Date.now() - startTime) / 1000 / 60;
            console.log(`⏱️  Background process reached max poll limit after ${elapsed.toFixed(1)} minutes`);
            console.log(`⚠️  Process may still be running - checking for partial output...`);
          }

          // Read output from the redirected files
          let stdout = [];
          let stderr = [];

          try {
            // Read stdout
            const stdoutContent = await sandbox.files.read(stdoutPath);
            stdout = stdoutContent.toString().split('\n').filter(line => line.trim());
          } catch (e) {
            console.log(`Could not read stdout: ${e.message}`);
          }

          try {
            // Read stderr
            const stderrContent = await sandbox.files.read(stderrPath);
            stderr = stderrContent.toString().split('\n').filter(line => line.trim());
          } catch (e) {
            console.log(`Could not read stderr: ${e.message}`);
          }

          console.log(`📄 Captured ${stdout.length} stdout lines, ${stderr.length} stderr lines`);

          execution = {
            logs: {
              stdout: stdout,
              stderr: stderr,
            },
            error: null,
          };

        } else {
          // Regular execution with MAXIMUM timeout for robustness
          const timeoutMs = language === 'R' && code.includes('install.packages') ? 1200000 : 600000; // 20 min / 10 min
          execution = await sandbox.runCode(execCode, { timeoutMs });
        }
      } catch (execError) {
        // E2B DEEP ERROR LOGGING: Capture full error details for debugging
        console.error(`❌ E2B Execution Error (iteration ${iteration}):`, {
          message: execError.message,
          name: execError.name,
          stack: execError.stack,
          code: execError.code,
          sandboxId: sandbox?.id,
          language: language,
          timeElapsed: `${((Date.now() - (execStartTime || Date.now())) / 1000).toFixed(1)}s`,
        });

        // Send detailed error to frontend
        const errorDetails = {
          message: execError.message,
          type: execError.name || 'ExecutionError',
          sandboxId: sandbox?.id,
        };

        // Check if this is an E2B sandbox timeout or connection error
        const isE2BConnectionError = execError.message?.includes('timeout') ||
                                     execError.message?.includes('Timeout') ||
                                     execError.message?.includes('connection') ||
                                     execError.message?.includes('Connection') ||
                                     execError.message?.includes('ECONNREFUSED') ||
                                     execError.message?.includes('terminated') ||  // undici connection terminated
                                     execError.message?.includes('sandbox');

        sendStep('executing', {
          iteration,
          title: `Executing ${language} Code`,
          status: 'error',
          error: execError.message,
          errorDetails: errorDetails,
          isE2BError: isE2BConnectionError,
        });

        // AGENT SELF-CORRECTION: Feed detailed E2B error info to Claude for smarter debugging
        let errorContextForAgent = `Execution error: ${execError.message}\n`;

        if (isE2BConnectionError) {
          errorContextForAgent += `\n🔴 E2B SANDBOX ERROR DETECTED:\n`;
          errorContextForAgent += `- Error Type: ${execError.name || 'Unknown'}\n`;
          errorContextForAgent += `- Sandbox ID: ${sandbox?.id || 'unknown'}\n`;
          errorContextForAgent += `- Time Elapsed: ${((Date.now() - execStartTime) / 1000).toFixed(1)}s\n`;

          // Specific guidance for "terminated" errors (undici connection drops)
          if (execError.message?.includes('terminated')) {
            errorContextForAgent += `- Likely Cause: E2B connection dropped during package installation (network timeout after ~5 min)\n\n`;
            errorContextForAgent += `CRITICAL ISSUE: E2B connection terminates after 5 minutes during package installation.\n\n`;
            errorContextForAgent += `IMMEDIATE ACTIONS:\n`;
            errorContextForAgent += `1. **AVOID package installation entirely** - use ONLY base R packages (stats, graphics, etc.)\n`;
            errorContextForAgent += `2. If you need statistical analysis:\n`;
            errorContextForAgent += `   - Use base R: lm(), glm(), t.test(), cor(), etc.\n`;
            errorContextForAgent += `   - NO install.packages() calls\n`;
            errorContextForAgent += `3. If advanced packages needed, switch to Python with built-in libraries:\n`;
            errorContextForAgent += `   - pandas, numpy, scipy, sklearn (pre-installed)\n`;
            errorContextForAgent += `4. Document this E2B limitation to the user\n\n`;
          } else {
            errorContextForAgent += `- Likely Cause: E2B sandbox timed out, crashed, or lost connection\n\n`;
            errorContextForAgent += `RECOMMENDED ACTIONS:\n`;
            errorContextForAgent += `1. If timeout error: Package compilation may need >30 min - try simpler alternative\n`;
            errorContextForAgent += `2. If connection error: E2B infrastructure issue - try Python fallback\n`;
            errorContextForAgent += `3. If this is a long-running package (bartCause, brms, etc), consider suggesting:\n`;
            errorContextForAgent += `   - Pre-compiled binaries instead of source\n`;
            errorContextForAgent += `   - Alternative packages with same functionality\n`;
            errorContextForAgent += `   - Breaking down analysis into smaller chunks\n\n`;
          }
        }

        errorContextForAgent += `Please analyze the error and choose the best approach.`;

        conversationHistory.push({
          role: 'user',
          content: errorContextForAgent,
        });
        continue;
      }

      const stdout = execution.logs.stdout || [];
      const stderr = execution.logs.stderr || [];

      // CRITICAL FIX: Send execution success status to frontend
      sendStep('executing', {
        iteration,
        title: `${language} Code Executed`,
        status: 'completed',
        message: stdout.length > 0 || stderr.length > 0
          ? `Execution complete. ${stdout.length} stdout lines, ${stderr.length} stderr lines.`
          : 'Execution complete (no output).',
      });

      // Check for R function errors and trigger web search
      let searchResults = null;
      if (language === 'R' && stderr.length > 0) {
        const stderrText = stderr.join('\n');

        // Detect common R errors that benefit from web search
        const functionNotFoundMatch = stderrText.match(/could not find function ["'](\w+)["']/i);
        const packageNotFoundMatch = stderrText.match(/there is no package called ["'](\w+)["']/i);
        const errorInMatch = stderrText.match(/Error in (\w+)\(/i);

        if (functionNotFoundMatch || packageNotFoundMatch || errorInMatch) {
          // Extract package name from context
          const recentCode = code.substring(Math.max(0, code.length - 500));
          const packageMatch = recentCode.match(/library\(["']?(\w+)["']?\)|install\.packages\(["'](\w+)["']\)/);
          const packageName = packageMatch ? (packageMatch[1] || packageMatch[2]) : 'unknown';

          sendStep('web_search', {
            iteration,
            title: 'Searching Documentation',
            status: 'running',
            message: `Searching for ${packageName} package documentation and examples...`,
          });

          searchResults = await searchRPackageHelp(packageName, stderrText);

          sendStep('web_search', {
            iteration,
            title: 'Documentation Found',
            status: 'completed',
            message: searchResults.found
              ? `Found ${packageName} documentation and examples`
              : 'Limited results - check CRAN manually',
          });
        }
      }

      sendStep('executing', {
        iteration,
        title: `${language} Execution Complete`,
        status: 'completed',
        output: stdout,
        warnings: stderr.length > 0 ? stderr : undefined,
        language: language,
      });

      // Collect images
      const images = [];
      const files = await sandbox.files.list('/home/user');

      for (const file of files) {
        if (file.name.match(/\.(png|jpg|jpeg|pdf)$/i)) {
          try {
            const imageData = await sandbox.files.read(file.path);
            images.push({
              filename: file.name,
              data: Buffer.from(imageData).toString('base64'),
              format: file.name.endsWith('.pdf') ? 'application/pdf' : 'image/png',
            });
          } catch (err) {
            console.error('Error reading file:', err);
          }
        }
      }

      if (images.length > 0) {
        sendStep('visualization', {
          iteration,
          title: `Visualizations Generated`,
          status: 'completed',
          images: images,
          message: `${images.length} visualization(s) created`,
        });
      }

      // Give execution results back to agent
      let executionFeedback = `
===== EXECUTION RESULTS (Iteration ${iteration}) =====

LANGUAGE: ${language}

STDOUT:
${stdout.length > 0 ? stdout.join('\n') : '(empty - code may have run successfully with no print output)'}

${stderr.length > 0 ? `STDERR/WARNINGS:\n${stderr.join('\n')}` : ''}

${images.length > 0 ? `VISUALIZATIONS: ${images.length} file(s) generated` : ''}`;

      // Add web search results if available
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
   - Generate improved code for the next iteration
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

    console.log(`✅ Multi-language analysis complete (${iteration} iterations)`);
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
    service: 'claude-multilang-agent',
    languages: ['Python', 'R (via rpy2)', 'R (via subprocess)'],
    features: [
      'python-execution',
      'r-package-support',
      'iterative-reasoning',
      'multi-language',
    ],
  });
});

app.use(express.static('../frontend'));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.listen(port, () => {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`🌐 MULTI-LANGUAGE AGENTIC SYSTEM - Port ${port}`);
  console.log(`${'='.repeat(70)}`);
  console.log(`\n💻 Supported Languages:`);
  console.log(`   • Python (native)`);
  console.log(`   • R packages (via rpy2)`);
  console.log(`   • R scripts (via Rscript)`);
  console.log(`\n📦 R Packages Available:`);
  console.log(`   • Base R, stats, graphics`);
  console.log(`   • Can install CRAN packages on demand`);
  console.log(`   • Access via Python rpy2 bridge`);
  console.log(`\n🧠 Agent Can:`);
  console.log(`   • Choose best language for task`);
  console.log(`   • Use Python for data manipulation`);
  console.log(`   • Call R for statistical packages`);
  console.log(`   • Iterate and refine`);
  console.log(`\n🌐 Open: http://localhost:${port}/chat-multilang.html`);
  console.log(`\n${'='.repeat(70)}\n`);
});

export default app;

