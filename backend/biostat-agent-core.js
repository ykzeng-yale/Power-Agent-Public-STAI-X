/**
 * Core Biostat Agent Logic
 * Shared between single-agent and multi-agent systems
 *
 * This module contains the FULL iterative biostatistician agent logic
 * that is used by BOTH:
 * 1. Single-agent endpoint (/api/analyze-biostat)
 * 2. Multi-agent orchestrator (agent-orchestration-engine.js)
 *
 * ARCHITECTURE PRINCIPLE:
 * The multi-agent system's biostat agent MUST have IDENTICAL capacity
 * to the single-agent. This is achieved by using the EXACT SAME CODE.
 */

import Anthropic from '@anthropic-ai/sdk';
import NotebookExecutor from './notebook-executor.js';
import { getBiostatSystemPrompt } from './biostat-agent-prompt.js';
import { getBiostatSystemPrompt as getBiostatSystemPromptImproved } from './biostat-agent-prompt-IMPROVED.js';
import tavilySearchTool from './tavily-search-tool.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 180000,  // 3 minute timeout for LLM API calls (prevents hanging on complex queries)
});

/**
 * Call Anthropic API with retry logic for 529 overloaded errors
 */
async function callAnthropicWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      const isOverloaded = error.status === 529 ||
        (error.message && error.message.includes('overloaded'));

      if (isOverloaded && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
        console.log(`[BIOSTAT] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Execute biostatistical analysis with full iterative reasoning
 * This is the COMPLETE agent logic from the single-agent system
 *
 * @param {string} query - User's biostatistical question
 * @param {Object} options - Configuration options
 * @param {Object} options.datasetInfo - Dataset information if uploaded
 * @param {string} options.data - Inline data if provided
 * @param {number} options.maxIterations - Maximum iterations (default: 10)
 * @param {Function} options.onStep - Optional callback for progress updates
 * @param {NotebookExecutor} options.executor - Optional custom executor
 * @param {string} options.sessionId - Session ID for R process affinity (maintains workspace across iterations)
 * @returns {Object} Analysis results with code, outputs, and iteration count
 */
export async function executeBiostatAnalysis(query, options = {}) {
  const {
    datasetInfo = null,
    data = null,
    maxIterations = 10,
    onStep = null,
    executor: customExecutor = null,
    useImprovedPrompt = false,
    sessionId = null  // Session ID for R process affinity
  } = options;

  // Use custom executor or create default one
  const executor = customExecutor || new NotebookExecutor({
    dockerImage: 'gcr.io/power-agent-476822/biostat-backend:latest',
    maxIterations: 5,
    useDocker: false,
    gcp: {
      project: process.env.GCP_PROJECT || 'power-agent-476822',
      region: process.env.GCP_REGION || 'us-central1',
      jobName: process.env.GCP_JOB_NAME || 'biostat-notebook-job'
    }
  });

  // Agent loop state
  const conversationHistory = [];
  let iteration = 0;
  let isComplete = false;
  const allExecutedCode = [];
  const allExecutionOutputs = [];
  let lastExecution = null;
  let thinkingOnlyIterations = 0;  // Track consecutive thinking-only iterations
  const MAX_THINKING_ONLY = 1;     // Max 1 thinking-only iteration before forcing code

  // System prompt (shared with single-agent)
  // Use improved efficiency-focused prompt if requested
  const systemPrompt = useImprovedPrompt
    ? getBiostatSystemPromptImproved(datasetInfo, data)
    : getBiostatSystemPrompt(datasetInfo, data);

  // Initial user message
  // NOTE: Query may include enriched requirements (like file generation)
  // DO NOT wrap in quotes - requirements must be treated as instructions

  // DIAGNOSTIC: Log the query received by biostat core
  console.log('[Biostat Core] 📥 Query received, length:', query.length);
  console.log('[Biostat Core] 📝 First 200 chars of query:');
  console.log('[Biostat Core]    ' + query.substring(0, 200).replace(/\n/g, '\n[Biostat Core]    '));
  if (query.includes('CRITICAL INSTRUCTIONS')) {
    console.log('[Biostat Core] ✅ [DIAGNOSTIC] Enriched query VERIFIED in core');
  } else {
    console.log('[Biostat Core] ⚠️  [DIAGNOSTIC] Query does NOT contain enrichment');
  }

  conversationHistory.push({
    role: 'user',
    content: `${query}${data ? '\n\nData:\n' + data : ''}`,
  });

  // Emit initialization step
  if (onStep) {
    onStep({
      type: 'init',
      iteration: 0,
      message: 'Starting biostatistical analysis...'
    });
  }

  // ITERATIVE AGENT LOOP (SAME AS SINGLE-AGENT)
  while (!isComplete && iteration < maxIterations) {
    iteration++;

    // DEBUG: Log iteration start
    console.log(`\n[BIOSTAT-DEBUG] ╔═══════════════════════════════════════════════════════╗`);
    console.log(`[BIOSTAT-DEBUG] ║  ITERATION ${iteration}/${maxIterations} START                              ║`);
    console.log(`[BIOSTAT-DEBUG] ╚═══════════════════════════════════════════════════════╝`);
    console.log(`[BIOSTAT-DEBUG] Session ID: ${sessionId}`);
    console.log(`[BIOSTAT-DEBUG] Conversation history length: ${conversationHistory.length} messages`);
    console.log(`[BIOSTAT-DEBUG] Previous executions: ${allExecutedCode.length}`);
    console.log(`[BIOSTAT-DEBUG] Is complete: ${isComplete}`);
    console.log(`[BIOSTAT-DEBUG] Timestamp: ${new Date().toISOString()}`);

    if (onStep) {
      onStep({
        type: 'thinking',
        iteration,
        message: iteration === 1
          ? 'Understanding the biostatistical request and planning approach...'
          : 'Reviewing previous results and deciding next steps...'
      });
    }

    // Call Claude with FULL conversation history and Tavily web search
    // Using Sonnet 4 for best reasoning quality on complex biostatistics
    console.log(`[BIOSTAT-DEBUG] Calling Claude API for iteration ${iteration}...`);
    const apiStartTime = Date.now();

    const response = await callAnthropicWithRetry({
      model: 'claude-sonnet-4-6',  // Sonnet 4.6 for best biostat reasoning
      max_tokens: 4000,
      system: systemPrompt,
      messages: conversationHistory,
      tools: [tavilySearchTool.getClaudeToolDefinition('statistical')]
    });

    const apiDuration = Date.now() - apiStartTime;
    console.log(`[BIOSTAT-DEBUG] Claude API responded in ${apiDuration}ms`);
    console.log(`[BIOSTAT-DEBUG] Response content blocks: ${response.content.length}`);

    // Handle response content
    const assistantContent = response.content;

    // Handle tool calls (Tavily web search)
    const toolUses = assistantContent.filter(block => block.type === 'tool_use');
    if (toolUses.length > 0) {
      // CRITICAL: Every tool_use MUST have a corresponding tool_result
      // Claude API will return 400 error if tool_use exists without tool_result
      const toolResults = [];

      for (const toolUse of toolUses) {
        try {
          if (toolUse.name.startsWith('tavily_')) {
            // Execute Tavily search
            const searchQuery = toolUse.input.query;
            console.log(`[Biostat Core] Executing Tavily search: "${searchQuery}"`);

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
            // Unknown tool - still must provide tool_result to avoid API error
            console.log(`[Biostat Core] Unknown tool called: ${toolUse.name}`);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: `Error: Unknown tool "${toolUse.name}". Only Tavily search tools are supported.`
            });
          }
        } catch (toolError) {
          // CRITICAL: Even on error, we MUST provide a tool_result
          console.error(`[Biostat Core] Tool execution error for ${toolUse.name}:`, toolError.message);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error executing tool: ${toolError.message}. Please try an alternative approach.`,
            is_error: true
          });
        }
      }

      // ALWAYS add assistant message and tool results when tool_use exists
      // This prevents the "tool_use without tool_result" API error
      conversationHistory.push({
        role: 'assistant',
        content: assistantContent
      });
      conversationHistory.push({
        role: 'user',
        content: toolResults
      });

      if (onStep) {
        onStep({
          type: 'tool_use',
          iteration,
          message: `Executed ${toolResults.length} web search(es)`,
          searches: toolUses.map(t => t.input?.query || 'unknown')
        });
      }

      // Continue to next iteration to get agent's response after tool use
      continue;
    }

    const textBlocks = assistantContent
      .filter(block => block.type === 'text')
      .map(block => block.text);
    const assistantMessage = textBlocks.join('\n\n');

    // Check if web search was used
    const usedWebSearch = toolUses.length > 0;

    // Add FULL content to conversation
    conversationHistory.push({
      role: 'assistant',
      content: assistantContent,
    });

    // Check if agent wants to complete
    const wantsToComplete = assistantMessage.includes('ANALYSIS_COMPLETE');

    if (onStep) {
      onStep({
        type: 'thinking_complete',
        iteration,
        message: wantsToComplete
          ? 'Agent has generated final code for execution...'
          : usedWebSearch
            ? 'Agent searched the web for information and has a plan...'
            : 'Agent has a plan. Generating R code...',
        reasoning: assistantMessage.substring(0, 500) + (assistantMessage.length > 500 ? '...' : ''),
        webSearchUsed: usedWebSearch
      });
    }

    // Extract ALL R code blocks from response
    const codeBlockRegex = /```[rR]\n([\s\S]*?)\n```/g;
    const codeBlocks = [];
    let match;
    while ((match = codeBlockRegex.exec(assistantMessage)) !== null) {
      codeBlocks.push(match[1]);
    }

    if (codeBlocks.length === 0) {
      // No code to execute - track thinking-only iterations
      thinkingOnlyIterations++;

      console.log(`[BIOSTAT-DEBUG] ⚠️ No code in iteration ${iteration} (${thinkingOnlyIterations} consecutive thinking-only)`);

      if (wantsToComplete) {
        if (allExecutedCode.length === 0) {
          // Force code generation
          conversationHistory.push({
            role: 'user',
            content: `You said ANALYSIS_COMPLETE but you haven't executed ANY R code yet!

This is a biostatistics query that REQUIRES actual calculation using R packages.

You MUST:
1. Write R code using appropriate packages
2. EXECUTE the code to get REAL results
3. Show the actual numerical output
4. THEN provide your interpretation

DO NOT guess or estimate - CALCULATE with actual R code!`,
          });
          continue;
        } else {
          // Has executed code before, can complete now
          isComplete = true;
          break;
        }
      }

      // CRITICAL FIX: Force code generation after too many thinking iterations
      if (thinkingOnlyIterations > MAX_THINKING_ONLY) {
        console.log(`[BIOSTAT-DEBUG] 🚨 FORCING CODE GENERATION - ${thinkingOnlyIterations} thinking-only iterations exceeded limit of ${MAX_THINKING_ONLY}`);
        conversationHistory.push({
          role: 'user',
          content: `⚠️ CRITICAL: You have spent ${thinkingOnlyIterations} iterations just thinking without writing any R code!

STOP PLANNING. START CODING NOW.

You MUST write executable R code in your NEXT response. No more planning or thinking.

Requirements:
1. Write COMPLETE R code in a \`\`\`r code block
2. Include ALL necessary calculations (not placeholders)
3. If this is a simr/simulation query, you MUST include actual powerSim() or powerCurve() calls
4. Generate actual output files (plots, CSVs) with real computed values
5. DO NOT generate template reports with placeholder values like "[Preliminary]"

If you do not provide executable R code in your next response, the analysis will fail.

WRITE THE R CODE NOW.`,
        });
        continue;
      }

      // Normal case: Agent is just thinking, ask for code
      conversationHistory.push({
        role: 'user',
        content: 'Please write the R code to proceed with the analysis.',
      });
      continue;
    }

    // Reset thinking counter when code is found
    thinkingOnlyIterations = 0;

    // Concatenate all code blocks
    const rCode = codeBlocks.join('\n\n');

    // DEBUG: Log code extraction
    console.log(`[BIOSTAT-DEBUG] ✅ R code extracted - Iteration ${iteration}`);
    console.log(`[BIOSTAT-DEBUG] Code blocks found: ${codeBlocks.length}`);
    console.log(`[BIOSTAT-DEBUG] Total code length: ${rCode.length} chars`);
    console.log(`[BIOSTAT-DEBUG] Code preview (first 300 chars):\n${rCode.substring(0, 300)}...`);

    if (onStep) {
      onStep({
        type: 'code',
        iteration,
        code: rCode,
        message: codeBlocks.length > 1
          ? `Combined ${codeBlocks.length} R code blocks for execution`
          : 'R code ready for execution'
      });
    }

    // Execute code with NotebookExecutor
    if (onStep) {
      onStep({
        type: 'executing',
        iteration,
        message: 'Running R in Jupyter notebook with auto-error fixing...'
      });
    }

    let execution;
    try {
      // DEBUG: Log before R execution
      console.log(`[BIOSTAT-DEBUG] ════════════════════════════════════════`);
      console.log(`[BIOSTAT-DEBUG] Starting R execution - Iteration ${iteration}`);
      console.log(`[BIOSTAT-DEBUG] Session ID: ${sessionId}`);
      console.log(`[BIOSTAT-DEBUG] Code length: ${rCode.length} chars`);
      console.log(`[BIOSTAT-DEBUG] First 200 chars: ${rCode.substring(0, 200)}...`);
      console.log(`[BIOSTAT-DEBUG] Timestamp: ${new Date().toISOString()}`);

      const execStartTime = Date.now();
      execution = await executor.executeRCode(rCode, {
        query,
        dataset: datasetInfo,
        sessionId  // Pass sessionId for R process affinity
      });
      const execDuration = Date.now() - execStartTime;

      // Store execution time on the execution object so validation can use it
      execution.measured_execution_time = execDuration;

      // DEBUG: Log after R execution
      console.log(`[BIOSTAT-DEBUG] ────────────────────────────────────────`);
      console.log(`[BIOSTAT-DEBUG] R execution completed - Iteration ${iteration}`);
      console.log(`[BIOSTAT-DEBUG] Duration: ${execDuration}ms`);
      console.log(`[BIOSTAT-DEBUG] Success: ${execution.success}`);
      console.log(`[BIOSTAT-DEBUG] Has output: ${execution.has_output}`);
      console.log(`[BIOSTAT-DEBUG] Output length: ${execution.output?.length || 0} chars`);
      console.log(`[BIOSTAT-DEBUG] Errors count: ${execution.errors?.length || 0}`);
      console.log(`[BIOSTAT-DEBUG] Files generated: ${execution.output_files?.length || 0}`);
      console.log(`[BIOSTAT-DEBUG] ════════════════════════════════════════`);

    } catch (execError) {
      console.error(`[BIOSTAT-ERROR] ❌ R EXECUTION EXCEPTION - Iteration ${iteration}`);
      console.error(`[BIOSTAT-ERROR] Exception message: ${execError.message}`);
      console.error(`[BIOSTAT-ERROR] Exception stack: ${execError.stack}`);
      console.error(`[BIOSTAT-ERROR] Session ID: ${sessionId}`);

      if (onStep) {
        onStep({
          type: 'execution_error',
          iteration,
          error: execError.message,
          message: 'Execution error - agent will try to fix...'
        });
      }

      conversationHistory.push({
        role: 'user',
        content: `Execution error: ${execError.message}\n\nPlease fix the R code and try again.`,
      });
      continue;
    }

    // Check execution result
    if (!execution.success) {
      const errorMsg = execution.errors && execution.errors.length > 0
        ? execution.errors.map(e => e.message || JSON.stringify(e)).join('\n')
        : execution.has_output === false
          ? 'Code executed but produced no output. The code may have syntax errors or missing packages.'
          : 'Unknown error';

      // DEBUG: Log execution failure details
      console.error(`[BIOSTAT-ERROR] ❌ R EXECUTION FAILED - Iteration ${iteration}`);
      console.error(`[BIOSTAT-ERROR] Error message: ${errorMsg}`);
      console.error(`[BIOSTAT-ERROR] Has errors array: ${execution.errors?.length > 0}`);
      console.error(`[BIOSTAT-ERROR] Has output: ${execution.has_output}`);
      console.error(`[BIOSTAT-ERROR] Iterations attempted: ${execution.iterations || 1}`);
      console.error(`[BIOSTAT-ERROR] Full execution object:`, JSON.stringify(execution, null, 2).substring(0, 500));

      if (onStep) {
        onStep({
          type: 'execution_error',
          iteration,
          error: errorMsg,
          message: `Execution failed after ${execution.iterations || 1} attempts. Agent will try to fix...`
        });
      }

      // Provide detailed error feedback to agent
      const isPackageError = errorMsg.includes('package') || errorMsg.includes('install') || errorMsg.includes('dependency');
      const isNonNumericError = errorMsg.includes('non-numeric argument') || errorMsg.includes('non-numeric value');

      const errorFeedback = isNonNumericError ? `Execution failed with "non-numeric argument" error:
${errorMsg}

This error means you tried to use mathematical functions on a COMPLEX OBJECT instead of a simple number!
Use the INSPECT-FIRST pattern with str() to see the object structure before extracting values.`
        : isPackageError ? `Execution failed due to package installation error:
${errorMsg}

Check if packages are pre-installed before reinstalling. Use system dependencies if needed.`
        : `Execution failed:
${errorMsg}

Please fix the R code and try again.`;

      conversationHistory.push({
        role: 'user',
        content: errorFeedback,
      });
      continue;
    }

    // Success! Show results
    const stdout = execution.output || '';
    const hasOutput = stdout && stdout.trim().length > 0;

    if (onStep) {
      onStep({
        type: 'execution_success',
        iteration,
        output: stdout,
        message: `Code executed successfully in ${execution.iterations || 1} iteration(s)`
      });
    }

    // Store successful execution
    lastExecution = execution;
    if (hasOutput) {
      allExecutedCode.push(`# Iteration ${iteration}\n${rCode}`);
      allExecutionOutputs.push(`# Iteration ${iteration} Output\n${stdout}`);
    }

    // If no output and not completing, treat as error
    if (!hasOutput && !wantsToComplete) {
      conversationHistory.push({
        role: 'user',
        content: `The code executed without errors but produced NO OUTPUT. Please add cat() or print() statements to show results.`,
      });
      continue;
    }

    // CRITICAL FIX: Validate simr queries produce real simulation results
    const isSimrQuery = query.toLowerCase().includes('simr') ||
                         query.toLowerCase().includes('simulation') ||
                         query.toLowerCase().includes('powersim') ||
                         query.toLowerCase().includes('powercurve') ||
                         query.toLowerCase().includes('monte carlo');

    // =====================================================================
    // EARLY FABRICATION DETECTION (2025-12-05)
    // =====================================================================
    // Detect when Claude writes a fake report file with fabricated power values
    // BEFORE the final validation. This catches the main fabrication pattern:
    // - Claude writes markdown report with cat("Power = 85.6%...")
    // - But never actually runs powerSim()
    // =====================================================================
    if (isSimrQuery) {
      const allCodeJoined = allExecutedCode.join('\n');
      const allOutputsJoined = allExecutionOutputs.join('\n');

      // Check if current code is writing a report with power values
      const isWritingReport = rCode.includes('cat(') && (rCode.includes('.md') || rCode.includes('report') || rCode.includes('Report'));
      const codeHasPowerValues = /Power[:\s]*=?\s*\d+\.?\d*%/i.test(rCode) || /\d+\.?\d*%\s*power/i.test(rCode);
      const codeHasConfidenceIntervals = /\[\s*\d+\.?\d*\s*,?\s*\d+\.?\d*\s*\]/i.test(rCode) || /CI\s*[:=]/i.test(rCode);

      // Check if simr was actually executed in any prior iteration
      const hasRealSimrOutput = allOutputsJoined.includes('Power for predictor') ||
                                 (allOutputsJoined.includes('based on') && allOutputsJoined.includes('simulations')) ||
                                 allOutputsJoined.includes('simr object') ||
                                 /Power\s*:\s*\d+\.\d+%\s*\(\s*\d+\.\d+,\s*\d+\.\d+\s*\)/.test(allOutputsJoined);

      // CRITICAL CHECK: Is Claude writing a report with power values without having run simr?
      const isFabricatingReport = (isWritingReport || codeHasPowerValues || codeHasConfidenceIntervals) && !hasRealSimrOutput;

      // Also check execution time - if code claims to run powerSim but completes in <5 seconds, it's fake
      const execTime = execution.measured_execution_time || 0;
      const codeClaimsPowerSim = rCode.includes('powerSim(') || rCode.includes('powerCurve(');
      const isSuspiciouslyFast = codeClaimsPowerSim && execTime < 5000; // <5 seconds for simulation = suspicious

      console.log(`[BIOSTAT-EARLY-VALIDATION] 🔍 Checking iteration ${iteration} for fabrication:`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   isWritingReport: ${isWritingReport}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   codeHasPowerValues: ${codeHasPowerValues}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   codeHasConfidenceIntervals: ${codeHasConfidenceIntervals}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   hasRealSimrOutput (from prior iterations): ${hasRealSimrOutput}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   isFabricatingReport: ${isFabricatingReport}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   execTime: ${execTime}ms`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   codeClaimsPowerSim: ${codeClaimsPowerSim}`);
      console.log(`[BIOSTAT-EARLY-VALIDATION]   isSuspiciouslyFast: ${isSuspiciouslyFast}`);

      if (isFabricatingReport || isSuspiciouslyFast) {
        console.error(`[BIOSTAT-EARLY-VALIDATION] 🚨 FABRICATION DETECTED - Rejecting and forcing real simulation`);

        conversationHistory.push({
          role: 'user',
          content: `🚨🚨🚨 FABRICATION DETECTED 🚨🚨🚨

YOUR CODE WAS DETECTED AS FABRICATING RESULTS.

${isFabricatingReport ? '❌ You wrote a report with power values (e.g., "Power = 85.6%") WITHOUT having run actual simr simulations.' : ''}
${isSuspiciouslyFast ? `❌ Your code included powerSim() but execution completed in only ${execTime}ms - real simulations take MINUTES, not milliseconds.` : ''}

REAL simr output looks like this:
  "Power for predictor 'treatment': 78.40% (95% CI: [65.17, 88.36])"
  "based on 100 simulations"

You HAVE NOT produced any output like this yet.

STOP writing reports. You MUST:
1. First run powerSim() or powerCurve() with nsim >= 100
2. Wait for the actual simulation to complete (1-10 minutes expected)
3. ONLY AFTER you see "Power for predictor" in the output, then create a report

Write ONLY the simulation code now. DO NOT write any report or cat() statements.`,
        });
        continue;
      }
    }

    if (isSimrQuery && wantsToComplete) {
      // ===== STRICT VALIDATION FOR SIMR QUERIES =====
      // The agent MUST run actual simulations, not generate fake reports with made-up values

      // CRITICAL FIX (2025-12-04): Check ACCUMULATED outputs across ALL iterations, not just current
      const allCodeJoined = allExecutedCode.join('\n');
      const allOutputsJoined = allExecutionOutputs.join('\n');

      // Check for placeholder/fake results indicators in CURRENT output
      const hasFakeIndicators = stdout.includes('[Preliminary]') ||
                                 stdout.includes('[placeholder]') ||
                                 stdout.includes('[TBD]') ||
                                 stdout.includes('theoretical') ||
                                 (stdout.includes('power') && !stdout.includes('powerSim') && !stdout.includes('Power for predictor'));

      // Check if actual simr functions were called (look for typical simr output patterns)
      // These are the ONLY acceptable patterns that indicate real simr execution
      // Check BOTH current output AND all accumulated outputs
      const hasSimrOutputCurrent = stdout.includes('Power for predictor') ||
                            (stdout.includes('based on') && stdout.includes('simulations')) ||
                            stdout.includes('simr object') ||
                            stdout.includes('Power analysis for model') ||
                            /\d+\.\d+%?\s*\(\s*\d+\.\d+\s*,\s*\d+\.\d+\s*\)/.test(stdout);  // Power with CI pattern

      // CRITICAL: Also check ALL accumulated outputs for simr results
      const hasSimrOutputAny = hasSimrOutputCurrent ||
                               allOutputsJoined.includes('Power for predictor') ||
                               (allOutputsJoined.includes('based on') && allOutputsJoined.includes('simulations')) ||
                               allOutputsJoined.includes('simr object') ||
                               allOutputsJoined.includes('Power analysis for model');

      // Check code for actual simr function calls - check ALL iterations
      const codeHasSimrCallsCurrent = rCode.includes('powerSim(') ||
                                rCode.includes('powerCurve(') ||
                                rCode.includes('simr::powerSim') ||
                                rCode.includes('simr::powerCurve');

      const codeHasSimrCallsAny = codeHasSimrCallsCurrent ||
                                  allCodeJoined.includes('powerSim(') ||
                                  allCodeJoined.includes('powerCurve(') ||
                                  allCodeJoined.includes('simr::powerSim') ||
                                  allCodeJoined.includes('simr::powerCurve');

      // Check execution time - simr simulations should take significant time
      // 100 simulations: ~30-120 seconds
      // 500 simulations: ~2-10 minutes
      // Use measured_execution_time (set in this file) or execution_time from executor
      const executionTime = execution.measured_execution_time || execution.execution_time || 0;
      console.log(`[BIOSTAT-DEBUG] 🕐 Execution time for validation: ${executionTime}ms`);
      const nsimMatch = allCodeJoined.match(/nsim\s*=\s*(\d+)/);
      const requestedNsim = nsimMatch ? parseInt(nsimMatch[1]) : 0;

      // Expected minimum time: ~0.3 sec per simulation for simple models
      const expectedMinTime = requestedNsim * 300; // 300ms per simulation minimum
      const isTooFast = requestedNsim > 50 && executionTime < expectedMinTime;

      // CRITICAL: Check if agent wrote markdown report with power values but didn't run simr
      // This is the main cheating pattern - writing "Power = 85.6%" without running powerSim()
      const hasReportWithPowerValues = (rCode.includes('cat(') && rCode.includes('Power')) ||
                                        (rCode.includes('file =') && rCode.includes('.md'));

      // STRICTER CHECK: If writing a report, we MUST have seen simr output in ANY iteration
      const isProbablyFakingReport = hasReportWithPowerValues && !hasSimrOutputAny;

      // CRITICAL NEW CHECK: Look for placeholder patterns in reports (em dashes, asterisks for missing values)
      const hasPlaceholderPatterns = rCode.includes('| — |') ||  // Em dash placeholders
                                      rCode.includes('| - |') ||   // Regular dash placeholders
                                      rCode.includes('[— , —]') || // CI placeholders
                                      rCode.includes('≥80%') ||    // Vague "greater than" instead of exact value
                                      (rCode.includes('Power') && rCode.includes('~') && !rCode.includes('powerSim'));

      console.log(`[BIOSTAT-DEBUG] 🔍 STRICT SIMR VALIDATION CHECK:`);
      console.log(`[BIOSTAT-DEBUG]   - isSimrQuery: ${isSimrQuery}`);
      console.log(`[BIOSTAT-DEBUG]   - hasFakeIndicators: ${hasFakeIndicators}`);
      console.log(`[BIOSTAT-DEBUG]   - hasSimrOutputCurrent: ${hasSimrOutputCurrent}`);
      console.log(`[BIOSTAT-DEBUG]   - hasSimrOutputAny (all iterations): ${hasSimrOutputAny}`);
      console.log(`[BIOSTAT-DEBUG]   - codeHasSimrCallsCurrent: ${codeHasSimrCallsCurrent}`);
      console.log(`[BIOSTAT-DEBUG]   - codeHasSimrCallsAny (all iterations): ${codeHasSimrCallsAny}`);
      console.log(`[BIOSTAT-DEBUG]   - executionTime: ${executionTime}ms`);
      console.log(`[BIOSTAT-DEBUG]   - requestedNsim: ${requestedNsim}`);
      console.log(`[BIOSTAT-DEBUG]   - expectedMinTime: ${expectedMinTime}ms`);
      console.log(`[BIOSTAT-DEBUG]   - isTooFast: ${isTooFast}`);
      console.log(`[BIOSTAT-DEBUG]   - hasReportWithPowerValues: ${hasReportWithPowerValues}`);
      console.log(`[BIOSTAT-DEBUG]   - hasPlaceholderPatterns: ${hasPlaceholderPatterns}`);
      console.log(`[BIOSTAT-DEBUG]   - isProbablyFakingReport: ${isProbablyFakingReport}`);
      console.log(`[BIOSTAT-DEBUG]   - Total iterations with code: ${allExecutedCode.length}`);
      console.log(`[BIOSTAT-DEBUG]   - Total outputs accumulated: ${allExecutionOutputs.length}`);

      // Build list of validation failures
      const failures = [];
      if (hasFakeIndicators) failures.push('Output contains placeholder/theoretical values');
      if (!codeHasSimrCallsAny) failures.push('NO powerSim() or powerCurve() calls in ANY iteration');
      if (!hasSimrOutputAny) failures.push('NO simr simulation output detected in ANY iteration');
      if (isTooFast) failures.push(`Execution too fast (${executionTime}ms) for ${requestedNsim} simulations (expected >${expectedMinTime}ms)`);
      if (isProbablyFakingReport) failures.push('Writing report with power values WITHOUT simr output in any iteration');
      if (hasPlaceholderPatterns) failures.push('Report contains placeholder values (dashes, vague estimates) instead of actual numbers');

      // Reject if ANY validation fails
      if (failures.length > 0) {
        console.log(`[BIOSTAT-DEBUG] 🚨 REJECTING FAKE/INVALID SIMR RESULTS:`);
        failures.forEach(f => console.log(`[BIOSTAT-DEBUG]   ❌ ${f}`));

        conversationHistory.push({
          role: 'user',
          content: `🚨🚨🚨 CRITICAL VALIDATION FAILED 🚨🚨🚨

YOUR OUTPUT WAS REJECTED because it does NOT contain real simulation results.

VALIDATION FAILURES:
${failures.map(f => `❌ ${f}`).join('\n')}

THIS IS UNACCEPTABLE. You CANNOT:
- Write markdown reports with made-up power values
- Generate "theoretical" power estimates
- Claim simulations ran when they didn't
- Write power values like "85.6%" without actually running powerSim()
- Use placeholder values like "—" or "≥80%" instead of actual computed values

YOU MUST DO THE FOLLOWING IN YOUR NEXT RESPONSE:

1. LOAD the simr package: library(simr)
2. CREATE a model using makeLmer() or makeGlmer() with the specified parameters
3. SET the effect size using fixef(model)["parameter"] <- value
4. RUN powerSim() or powerCurve() - this MUST appear in your code
5. The execution WILL take 1-10 minutes for 100-500 simulations - this is expected
6. The output MUST show "Power for predictor... based on X simulations"
7. ONLY AFTER seeing real simulation output, save the results to CSV/PNG

DO NOT generate any reports until AFTER you see the real simulation output.

Write ONLY the R code for steps 1-5 now. Do NOT write any markdown reports yet.`,
        });
        continue;
      }
    }

    // WORKSPACE PERSISTENCE: Provide iteration-aware feedback
    // Early iterations: Encourage incremental building using workspace
    // Later iterations: Allow completion when analysis is truly done
    const isComplexQuery = query.toLowerCase().includes('simr') ||
                           query.toLowerCase().includes('multiple') ||
                           query.toLowerCase().includes('several') ||
                           query.toLowerCase().includes('steps') ||
                           query.split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•') || /^\d+\./.test(line.trim())).length > 2;

    // CRITICAL: For iteration 1 of complex queries, FORCE continuation feedback even if agent said ANALYSIS_COMPLETE
    // This prevents premature completion and enables true multi-iteration building
    const executionFeedback = (iteration === 1 && isComplexQuery) ? `
✅ Iteration ${iteration} executed successfully!

========================================
R OUTPUT:
========================================
${stdout}
========================================

💾 WORKSPACE SAVED: All variables and objects from this iteration are preserved.

For multi-step analyses, you can now:
1. Continue building incrementally - all objects are available in next iteration
2. Generate additional code that uses results from this iteration
3. Refine or extend the analysis

Your workspace persists across iterations, so you can build complex analyses step-by-step.

**When to complete:**
- Only include "ANALYSIS_COMPLETE" when ALL requested steps are done
- For multi-step queries, continue building until the full analysis is complete`
      : wantsToComplete ? `
EXECUTION COMPLETE! Here are the ACTUAL results from your R code:

========================================
ACTUAL R OUTPUT:
========================================
${stdout}
========================================

Now provide your final biostatistical insights based on these ACTUAL results.
IMPORTANT: Extract the EXACT numbers from the output above.

Include "ANALYSIS_COMPLETE" in your response to finish.`
      : `
Execution results from iteration ${iteration}:

========================================
OUTPUT:
========================================
${stdout}
========================================

📂 Workspace state: ${iteration > 1 ? 'Variables from previous iterations available' : 'Fresh workspace'}

Based on these results:
1. Did this iteration succeed?
2. Is there more to do, or is the analysis complete?
3. Can you build on these results in the next iteration?

${iteration >= 3 ? 'You\'ve completed ' + iteration + ' iterations. ' : ''}If the full analysis is done, include "ANALYSIS_COMPLETE" in your response.`;

    conversationHistory.push({
      role: 'user',
      content: executionFeedback,
    });

    if (wantsToComplete) {
      // Agent will respond in next iteration with final summary
      continue;
    }
  }

  // Extract final answer from last assistant message
  const finalResponse = conversationHistory[conversationHistory.length - 1];
  let finalContent = '';

  if (finalResponse.role === 'assistant') {
    finalContent = Array.isArray(finalResponse.content)
      ? finalResponse.content.filter(block => block.type === 'text').map(block => block.text).join('\n\n')
      : finalResponse.content;

    // Clean up the final content
    if (finalContent.includes('ANALYSIS_COMPLETE')) {
      const parts = finalContent.split('ANALYSIS_COMPLETE');
      finalContent = parts[parts.length - 1].trim();
    }

    // Remove code blocks and reasoning patterns
    finalContent = finalContent.replace(/```[\s\S]*?```/g, '').trim();
    finalContent = finalContent.replace(/I'll (perform|search|look|check|find).*?\n/gi, '');
    finalContent = finalContent.replace(/Let me (search|look|check|find|start).*?\n/gi, '');
    finalContent = finalContent.split('\n')
      .filter(line => {
        const trimmed = line.trim();
        return !trimmed.match(/^(I'|Let me|Now let|Now I|Perfect!|Great!|Based on my)/i) ||
               trimmed.match(/^(In |With |The |This |These |For |Using |According)/i);
      })
      .join('\n').trim();
    finalContent = finalContent.replace(/\n{3,}/g, '\n\n');
  }

  // Combine all executed code
  const fullCode = allExecutedCode.length > 0
    ? allExecutedCode.join('\n\n' + '='.repeat(60) + '\n\n')
    : null;

  const fullOutput = allExecutionOutputs.length > 0
    ? allExecutionOutputs.join('\n\n' + '='.repeat(60) + '\n\n')
    : null;

  // ====================================================================
  // CRITICAL FIX (2025-12-04): VALIDATE FINAL CONTENT FOR SIMR QUERIES
  // ====================================================================
  // The agent sometimes fabricates power values in its final response
  // without actually running simr simulations. This validation ensures
  // that any power values claimed in the final content actually appeared
  // in the R execution output.
  const isSimrQuery = query.toLowerCase().includes('simr') ||
                      query.toLowerCase().includes('simulation') ||
                      query.toLowerCase().includes('powersim') ||
                      query.toLowerCase().includes('powercurve') ||
                      query.toLowerCase().includes('monte carlo');

  if (isSimrQuery && finalContent) {
    console.log('[BIOSTAT-FINAL-VALIDATION] 🔍 Validating final content for simr query...');

    // Extract power percentages from final content (e.g., "82.3%", "68.4%")
    const powerValuesInFinal = finalContent.match(/\d{1,3}\.\d+%/g) || [];
    console.log(`[BIOSTAT-FINAL-VALIDATION] Power values in final content: ${powerValuesInFinal.join(', ') || 'none'}`);

    // Check if these values appear in the R output
    const allOutputsJoined = allExecutionOutputs.join('\n');
    const unverifiedPowers = [];

    for (const powerVal of powerValuesInFinal) {
      // Check if this power value or its numeric form appears in R output
      const numericVal = powerVal.replace('%', '');
      const foundInOutput = allOutputsJoined.includes(powerVal) ||
                           allOutputsJoined.includes(numericVal) ||
                           allOutputsJoined.includes(` ${numericVal}`) ||
                           allOutputsJoined.includes(`${numericVal} `);

      if (!foundInOutput) {
        unverifiedPowers.push(powerVal);
      }
    }

    if (unverifiedPowers.length > 0) {
      console.log(`[BIOSTAT-FINAL-VALIDATION] ⚠️ UNVERIFIED POWER VALUES: ${unverifiedPowers.join(', ')}`);

      // Check if R output contains ANY simr results at all
      const hasRealSimrOutput = allOutputsJoined.includes('Power for predictor') ||
                                allOutputsJoined.includes('based on') && allOutputsJoined.includes('simulations') ||
                                allOutputsJoined.includes('Power:') ||
                                /\d+\.\d+%?\s*\(\s*\d+\.\d+\s*,\s*\d+\.\d+\s*\)/.test(allOutputsJoined);

      if (!hasRealSimrOutput) {
        // CRITICAL: No real simr output but final content has power values - likely fabricated
        console.error('[BIOSTAT-FINAL-VALIDATION] 🚨 CRITICAL: Final content contains power values but NO simr output detected!');
        console.error('[BIOSTAT-FINAL-VALIDATION] 🚨 This indicates the agent fabricated results without running simulations.');

        // Add warning to final content
        finalContent = `⚠️ **VALIDATION WARNING**: This response may contain unverified power estimates. The system did not detect corresponding simulation output. Please verify results independently.\n\n---\n\n${finalContent}`;
      } else {
        // Some simr output exists but specific values don't match
        console.warn(`[BIOSTAT-FINAL-VALIDATION] ⚠️ Some power values (${unverifiedPowers.join(', ')}) may not match R output exactly`);
      }
    } else if (powerValuesInFinal.length > 0) {
      console.log('[BIOSTAT-FINAL-VALIDATION] ✅ All power values verified in R output');
    }
  }

  // Return comprehensive results
  return {
    success: true,
    iterations: iteration,
    finalContent: finalContent,
    fullCode: fullCode,
    fullOutput: fullOutput,
    outputFiles: lastExecution?.output_files || [],
    rCode: allExecutedCode.length > 0 ? allExecutedCode[allExecutedCode.length - 1] : null,
    lastOutput: allExecutionOutputs.length > 0 ? allExecutionOutputs[allExecutionOutputs.length - 1] : null,
    conversationHistory: conversationHistory
  };
}
