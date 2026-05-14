/**
 * AI-Powered Biostatistics Server with On-Demand Package Installation
 *
 * Combines:
 * - Full AI biostatistics agent (Claude Sonnet 4 + comprehensive prompt)
 * - R Process Pool with on-demand package installation
 * - 370+ pre-installed biostatistics packages
 * - Web search integration via Tavily
 */

import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { getBiostatSystemPrompt } from './biostat-agent-prompt.js';
import tavilySearchTool from './tavily-search-tool.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8080;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// =============================================================================
// R PROCESS POOL WITH ON-DEMAND INSTALLATION
// =============================================================================

class RProcessPool {
  constructor(size = 3) {
    this.size = size;
    this.processes = [];
    this.available = [];
    this.stats = {
      totalExecutions: 0,
      packageInstalls: {},
      avgExecutionTime: 0,
    };
  }

  async init() {
    console.log('🚀 Initializing R Process Pool with on-demand installation support...');

    // Create R bootstrap script for on-demand installation
    const bootstrapScript = `
# On-demand package installation bootstrap
cache_lib <- Sys.getenv("R_LIBS_USER", "/tmp/Rlibs")
if (!dir.exists(cache_lib)) {
  dir.create(cache_lib, recursive = TRUE, showWarnings = FALSE)
  cat("✅ Created", cache_lib, "for on-demand packages\\n")
}

# Use Posit Package Manager for Linux binaries
ppm_repo <- "https://packagemanager.posit.co/cran/__linux__/jammy/latest"
options(repos = c(PPM = ppm_repo, CRAN = "https://cloud.r-project.org"))

# Prepend to library paths
.old <- .libPaths()
.libPaths(c(cache_lib, .old))

cat("📚 Library paths:\\n")
print(.libPaths())
cat("📦 Using PPM binary repo:", ppm_repo, "\\n")
cat("\\n")

# Install pak if not available
if (!requireNamespace("pak", quietly = TRUE)) {
  cat("📦 Installing pak (modern package installer)...\\n")
  install.packages("pak", repos = "https://cloud.r-project.org", lib = cache_lib)
}

# Function to ensure packages are installed using pak
ensure_packages <- function(cran_pkgs = character(), github_pkgs = character()) {
  start_time <- Sys.time()

  # Use pak for unified CRAN + GitHub installation
  suppressPackageStartupMessages(library(pak))

  all_refs <- c(cran_pkgs, github_pkgs)

  if (length(all_refs) > 0) {
    cat("📦 Installing packages via pak:", paste(all_refs, collapse=", "), "\\n")
    cat("   (pak uses parallel downloads + binary packages when available)\\n")

    tryCatch({
      pak::pkg_install(all_refs, lib = cache_lib, upgrade = FALSE, ask = FALSE)
      cat("✅ All packages installed successfully\\n")
    }, error = function(e) {
      cat("❌ Installation error:", conditionMessage(e), "\\n")
      stop(e)
    })
  } else {
    cat("✓ No packages to install\\n")
  }

  elapsed <- difftime(Sys.time(), start_time, units="secs")
  cat("⏱️ Package installation took:", round(as.numeric(elapsed), 2), "seconds\\n\\n")

  return(as.numeric(elapsed))
}

# Make function available globally
.GlobalEnv$ensure_packages <- ensure_packages

cat("✅ On-demand installation bootstrap complete (using pak + PPM binaries)\\n\\n")
`;

    await fs.writeFile('/tmp/r_bootstrap_ondemand.R', bootstrapScript);

    for (let i = 0; i < this.size; i++) {
      const process = spawn('R', ['--vanilla', '--quiet'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.processes.push({
        id: i,
        process,
        busy: false,
        executionCount: 0,
        lastError: null,
      });

      this.available.push(i);

      // Load bootstrap
      await this.executeOnProcess(i, `source('/tmp/r_bootstrap_ondemand.R')`);
    }

    console.log(`✅ R Process Pool ready with ${this.size} processes`);
    console.log('📦 On-demand package installation enabled to /tmp/Rlibs\n');
  }

  async executeOnProcess(processId, code) {
    return new Promise((resolve, reject) => {
      const proc = this.processes[processId];
      let stdout = '';
      let stderr = '';

      console.log(`🔍 Process ${processId}: Sending R code (${code.split('\n').length} lines):`);
      console.log(`--- R CODE START ---\n${code.substring(0, 500)}${code.length > 500 ? '...(truncated)' : ''}\n--- R CODE END ---`);

      const cleanup = () => {
        proc.process.stdout.removeAllListeners('data');
        proc.process.stderr.removeAllListeners('data');
      };

      proc.process.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        console.log(`📤 Process ${processId} stdout: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      });

      proc.process.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        console.log(`📤 Process ${processId} stderr: ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
      });

      // Wrap code in tryCatch and ensure completion marker is always printed
      const wrappedCode = `
tryCatch({
${code}
}, error = function(e) {
  cat("ERROR:", conditionMessage(e), "\\n")
}, finally = {
  cat("\\n__END_OF_OUTPUT__\\n")
  flush.console()
})
`;

      // Send wrapped code
      proc.process.stdin.write(wrappedCode);

      // Wait for completion marker
      const checkOutput = setInterval(() => {
        if (stdout.includes('__END_OF_OUTPUT__')) {
          clearInterval(checkOutput);
          cleanup();

          console.log(`✅ Process ${processId}: Execution completed`);

          // Remove marker
          stdout = stdout.replace('__END_OF_OUTPUT__', '').trim();

          resolve({ stdout, stderr });
        }
      }, 100);

      // 5 minute timeout for individual executions
      setTimeout(() => {
        clearInterval(checkOutput);
        cleanup();
        console.log(`⏰ Process ${processId}: Execution timed out after 5 minutes`);
        reject(new Error('R execution timeout after 5 minutes'));
      }, 300000);
    });
  }

  async execute(code, requiredPackages = { cran: [], github: [] }) {
    const startTime = Date.now();

    if (this.available.length === 0) {
      throw new Error('No R processes available');
    }

    const processId = this.available.shift();
    const proc = this.processes[processId];
    proc.busy = true;

    try {
      let fullOutput = '';
      let installTime = 0;

      // Install required packages on-demand
      if (requiredPackages.cran.length > 0 || requiredPackages.github.length > 0) {
        console.log(`📦 Process ${processId}: Installing required packages...`);

        const ensureCode = `ensure_packages(
          cran_pkgs = c(${requiredPackages.cran.map(p => `"${p}"`).join(', ')}),
          github_pkgs = c(${requiredPackages.github.map(p => `"${p}"`).join(', ')})
        )`;

        const installResult = await this.executeOnProcess(processId, ensureCode);
        fullOutput += '=== PACKAGE INSTALLATION ===\n';
        fullOutput += installResult.stdout + '\n';
        fullOutput += installResult.stderr + '\n\n';

        // Extract install time from output
        const timeMatch = installResult.stdout.match(/took:\s*([\d.]+)\s*seconds/);
        if (timeMatch) {
          installTime = parseFloat(timeMatch[1]);
        }

        // Track installations
        for (const pkg of [...requiredPackages.cran, ...requiredPackages.github]) {
          this.stats.packageInstalls[pkg] = (this.stats.packageInstalls[pkg] || 0) + 1;
        }
      }

      // Execute actual code
      console.log(`⚙️ Process ${processId}: Executing R code...`);
      const result = await this.executeOnProcess(processId, code);

      fullOutput += '=== R CODE EXECUTION ===\n';
      fullOutput += result.stdout + '\n';
      if (result.stderr) {
        fullOutput += '\n=== WARNINGS/MESSAGES ===\n';
        fullOutput += result.stderr + '\n';
      }

      const executionTime = Date.now() - startTime;
      const codeTime = executionTime - (installTime * 1000);

      proc.executionCount++;
      this.stats.totalExecutions++;

      // Update avg execution time
      const prevAvg = this.stats.avgExecutionTime;
      this.stats.avgExecutionTime =
        (prevAvg * (this.stats.totalExecutions - 1) + executionTime) / this.stats.totalExecutions;

      return {
        output: fullOutput,
        success: true,
        executionTime,
        installTime: installTime * 1000,
        codeTime,
        processId,
      };

    } catch (error) {
      proc.lastError = error.message;
      return {
        output: '',
        error: error.message,
        success: false,
        processId,
      };
    } finally {
      proc.busy = false;
      this.available.push(processId);
    }
  }

  getStats() {
    return {
      totalProcesses: this.size,
      availableProcesses: this.available.length,
      busyProcesses: this.size - this.available.length,
      totalExecutions: this.stats.totalExecutions,
      avgExecutionTimeMs: Math.round(this.stats.avgExecutionTime),
      packageInstalls: this.stats.packageInstalls,
      processStats: this.processes.map(p => ({
        id: p.id,
        busy: p.busy,
        executionCount: p.executionCount,
        lastError: p.lastError,
      })),
    };
  }
}

// =============================================================================
// AI BIOSTATISTICS AGENT
// =============================================================================

async function executeBiostatAnalysis(query, rPool, options = {}) {
  const {
    maxIterations = 10,
    datasetInfo = null,
    data = null,
  } = options;

  // Agent loop state
  const conversationHistory = [];
  let iteration = 0;
  let isComplete = false;
  const allExecutedCode = [];
  const allExecutionOutputs = [];

  // System prompt with statistical coding rationale
  const systemPrompt = getBiostatSystemPrompt(datasetInfo, data);

  // Initial user message
  conversationHistory.push({
    role: 'user',
    content: `${query}${data ? '\n\nData:\n' + data : ''}`,
  });

  console.log(`\n📊 Starting AI Biostatistics Analysis`);
  console.log(`Query: ${query.substring(0, 100)}...`);

  // ITERATIVE AGENT LOOP
  while (!isComplete && iteration < maxIterations) {
    iteration++;
    console.log(`\n🔄 Iteration ${iteration}/${maxIterations}`);

    // Call Claude with FULL conversation history and Tavily web search
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',  // Sonnet 4.6 for best biostat reasoning
      max_tokens: 4000,
      system: systemPrompt,
      messages: conversationHistory,
      tools: [tavilySearchTool.getClaudeToolDefinition('statistical')]
    });

    // Handle response content
    const assistantContent = response.content;

    // Handle tool calls (Tavily web search)
    const toolUses = assistantContent.filter(block => block.type === 'tool_use');
    if (toolUses.length > 0) {
      // CRITICAL: Every tool_use MUST have a corresponding tool_result
      const toolResults = [];

      for (const toolUse of toolUses) {
        try {
          if (toolUse.name.startsWith('tavily_')) {
            const searchQuery = toolUse.input.query;
            console.log(`🔍 Web search: "${searchQuery}"`);

            let searchResult;
            if (toolUse.name === 'tavily_medical_search') {
              searchResult = await tavilySearchTool.searchMedical(searchQuery);
            } else if (toolUse.name === 'tavily_r_documentation_search') {
              searchResult = await tavilySearchTool.searchRDocumentation(searchQuery);
            } else {
              searchResult = await tavilySearchTool.search(searchQuery);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: tavilySearchTool.formatResultsForAgent(searchResult)
            });
          } else {
            // Unknown tool - still must provide tool_result
            console.log(`⚠️ Unknown tool: ${toolUse.name}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: Unknown tool "${toolUse.name}".`
            });
          }
        } catch (toolError) {
          // CRITICAL: Even on error, provide tool_result
          console.error(`❌ Tool error for ${toolUse.name}:`, toolError.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error: ${toolError.message}`,
            is_error: true
          });
        }
      }

      // ALWAYS add when tool_use exists
      conversationHistory.push({
        role: 'assistant',
        content: assistantContent
      });
      conversationHistory.push({
        role: 'user',
        content: toolResults
      });

      // Continue to next iteration
      continue;
    }

    const textBlocks = assistantContent
      .filter(block => block.type === 'text')
      .map(block => block.text);
    const assistantMessage = textBlocks.join('\n\n');

    // Add to conversation
    conversationHistory.push({
      role: 'assistant',
      content: assistantContent,
    });

    // Check if agent wants to complete
    const wantsToComplete = assistantMessage.includes('ANALYSIS_COMPLETE');

    // Extract R code
    const rCodeMatch = assistantMessage.match(/```r\n([\s\S]*?)\n```/);
    const rCode = rCodeMatch ? rCodeMatch[1] : null;

    if (!rCode) {
      if (wantsToComplete) {
        // Final interpretation without code
        isComplete = true;
        console.log('✅ Analysis complete (no more code to execute)');
        break;
      }

      // Prompt for code
      conversationHistory.push({
        role: 'user',
        content: 'Please provide executable R code for the analysis.'
      });
      continue;
    }

    // Extract required packages from code
    const requiredPackages = extractRequiredPackages(rCode);

    console.log(`📝 Executing R code (${rCode.split('\n').length} lines)`);
    if (requiredPackages.cran.length > 0 || requiredPackages.github.length > 0) {
      console.log(`📦 Detected packages: ${[...requiredPackages.cran, ...requiredPackages.github].join(', ')}`);
    }

    // Execute R code with on-demand package installation
    const execution = await rPool.execute(rCode, requiredPackages);

    allExecutedCode.push(rCode);
    allExecutionOutputs.push(execution.output);

    if (!execution.success) {
      console.log(`❌ R execution error: ${execution.error}`);

      conversationHistory.push({
        role: 'user',
        content: `R execution error: ${execution.error}\n\nPlease fix the code and try again. Remember to inspect errors carefully and make minimal, targeted fixes.`
      });
      continue;
    }

    console.log(`✅ R execution successful (${execution.executionTime}ms)`);
    if (execution.installTime > 0) {
      console.log(`   📦 Package installation: ${execution.installTime}ms`);
      console.log(`   ⚙️  Code execution: ${execution.codeTime}ms`);
    }

    // Give results back to agent
    const executionFeedback = `
===== EXECUTION RESULTS - Iteration ${iteration} =====

OUTPUT:
${execution.output}

===== REVIEW REQUIRED =====

You have now SEEN the execution results above.

1. Did the code execute successfully?
2. Do the results answer the user's question?
3. Do you need to refine or try different approach?

DECISION:
A) Results are SUFFICIENT:
   - Interpret the outputs clearly
   - Explain what they mean
   - Include "ANALYSIS_COMPLETE"

B) Need to iterate:
   - Explain what you learned
   - What will you try next
   - Generate improved code
   - Do NOT say "ANALYSIS_COMPLETE"

Remember: User wants REAL RESULTS, not just code!`;

    conversationHistory.push({
      role: 'user',
      content: executionFeedback,
    });

    if (wantsToComplete) {
      // Agent marked complete after seeing results
      isComplete = true;
      console.log('✅ Analysis marked complete by agent');
      break;
    }
  }

  // Extract final response
  const finalResponse = conversationHistory[conversationHistory.length - 1];
  const finalText = finalResponse.role === 'assistant'
    ? finalResponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n\n')
    : '';

  return {
    success: true,
    iterations: iteration,
    code: allExecutedCode,
    outputs: allExecutionOutputs,
    finalResponse: finalText,
    conversationHistory,
  };
}

// Helper: Extract required packages from R code
function extractRequiredPackages(rCode) {
  const packages = { cran: [], github: [] };

  // Match library() and require() calls
  const libraryMatches = rCode.matchAll(/(?:library|require)\s*\(\s*["']?(\w+)["']?\s*\)/g);
  for (const match of libraryMatches) {
    packages.cran.push(match[1]);
  }

  // Match :: namespace calls
  const namespaceMatches = rCode.matchAll(/(\w+)::/g);
  for (const match of namespaceMatches) {
    packages.cran.push(match[1]);
  }

  // Match pak::pkg_install() calls
  const pakMatches = rCode.matchAll(/pak::pkg_install\s*\(\s*c?\(?\s*["']([^"']+)["']/g);
  for (const match of pakMatches) {
    if (match[1].includes('/')) {
      packages.github.push(match[1]);
    } else {
      packages.cran.push(match[1]);
    }
  }

  // Remove duplicates
  packages.cran = [...new Set(packages.cran)];
  packages.github = [...new Set(packages.github)];

  return packages;
}

// =============================================================================
// API ENDPOINTS
// =============================================================================

let rPool = null;

// Health endpoint
app.get('/health', (req, res) => {
  const stats = rPool ? rPool.getStats() : null;
  res.json({
    status: 'ok',
    service: 'ai-biostatistics-ondemand',
    mode: 'ai-agent-with-r-pool-ondemand',
    poolReady: !!rPool,
    poolStats: stats,
    features: [
      'AI biostatistics agent (Claude Sonnet 4)',
      'Web search integration (Tavily)',
      'On-demand R package installation (pak + PPM binaries)',
      'CRAN and GitHub package support',
      'R process pool (3 processes)',
      '370+ pre-installed biostatistics packages',
      'Automatic package caching within container',
      'Iterative reasoning with error recovery'
    ]
  });
});

// Main AI analysis endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { query, data } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    if (!rPool) {
      return res.status(503).json({ error: 'R pool not initialized yet' });
    }

    console.log(`\n📊 AI Analysis Request: ${query.substring(0, 60)}...`);

    // Execute with AI agent
    const result = await executeBiostatAnalysis(query, rPool, { data });

    res.json({
      success: true,
      query,
      iterations: result.iterations,
      code: result.code,
      outputs: result.outputs,
      finalResponse: result.finalResponse,
      poolStats: rPool.getStats(),
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Pool stats endpoint
app.get('/api/stats', (req, res) => {
  if (!rPool) {
    return res.status(503).json({ error: 'R pool not initialized' });
  }
  res.json(rPool.getStats());
});

// =============================================================================
// INITIALIZATION
// =============================================================================

(async () => {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🧬 AI BIOSTATISTICS SERVER WITH ON-DEMAND INSTALLATION');
    console.log('='.repeat(80));
    console.log('\n🔧 Initializing R Process Pool...');
    console.log('📦 Using Posit Package Manager for Linux binaries');
    console.log('⚙️  Using pak for fast, parallel package installation');
    console.log('🤖 Using Claude Sonnet 4 for AI biostatistics reasoning\n');

    rPool = new RProcessPool(30);
    await rPool.init();

    console.log('\n✅ R Process Pool fully initialized and ready!');

    // Only start server AFTER pool is ready
    app.listen(PORT, () => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`\n📍 Endpoints:`);
      console.log(`   POST /api/analyze - AI biostatistics analysis`);
      console.log(`   GET  /health - Health check`);
      console.log(`   GET  /api/stats - Pool statistics`);
      console.log(`\n✨ Features:`);
      console.log(`   ✅ AI agent with Claude Sonnet 4`);
      console.log(`   ✅ Web search for R documentation`);
      console.log(`   ✅ 370+ pre-installed packages`);
      console.log(`   ✅ On-demand installation for any package`);
      console.log(`   ✅ PPM Linux binaries (fast installs)`);
      console.log(`   ✅ Iterative reasoning with error recovery`);
      console.log(``);
    });
  } catch (error) {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
  }
})();
