/**
 * Agent Orchestration Engine
 * Implements true multi-agent feedback loops with evaluation-based routing
 * Agents can evaluate results and trigger other agents to fix issues
 */

import { EventEmitter } from 'events';
import BaseAgent from './base-agent.js';
import agentRegistry from './agent-registry.js';
import agentRouter from './agent-router.js';
import clinicalJudgeAgent from './agent-clinical-judge.js';
import dataManagerAgent from './agent-data-manager.js';
import PIAgentOrchestrator from './pi-agent-orchestrator.js';
import Anthropic from '@anthropic-ai/sdk';
import RProcessPool from './r-process-pool.js';
import { getBiostatSystemPrompt } from './biostat-agent-prompt.js';
import { executeBiostatAnalysis } from './biostat-agent-core.js';
import { supabase } from './supabase-client.js';

// Initialize Anthropic for biostat agent
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize R Process Pool (SAME AS SINGLE-AGENT - 40x faster than Cloud Run Jobs!)
// This provides 3-5 second R execution instead of 128+ seconds
const rPool = new RProcessPool(30);  // Pool of 30 warm R processes - 10x original capacity (3→30), fits in 2GB memory

// Track pool readiness
let poolReady = false;

// Initialize pool on first use (lazy initialization)
async function ensureRPoolReady() {
  if (!poolReady) {
    console.log('[MULTI-AGENT] 🔄 Initializing R Process Pool...');
    await rPool.initialize();
    poolReady = true;
    console.log('[MULTI-AGENT] ✅ R Process Pool initialized successfully');
  }
}

/**
 * Wrapper class to make RProcessPool compatible with NotebookExecutor API
 * This allows biostat-agent-core.js to use R Process Pool without code changes
 */
class RProcessPoolExecutor {
  constructor(rPool) {
    this.rPool = rPool;
  }

  async executeRCode(code, options = {}) {
    // Ensure pool is ready before execution
    await ensureRPoolReady();

    // Execute via R process pool with session affinity
    const result = await this.rPool.execute(code, {
      timeout: options.timeout || 1200000,  // 20 minute default timeout (simr simulations can take 1-10 minutes)
      sessionId: options.sessionId  // Pass sessionId for process affinity
    });

    // Transform result to match NotebookExecutor API
    return {
      success: result.success,
      output: result.output,
      errors: result.success ? [] : [{ message: result.output }],
      iterations: 1,
      has_output: result.output && result.output.trim().length > 0,
      executionTime: result.executionTime,
      processId: result.processId,
      output_files: result.outputFiles || []  // Pass through files from R pool
    };
  }
}

// Create executor wrapper for biostat agent
const executor = new RProcessPoolExecutor(rPool);

class AgentOrchestrationEngine extends EventEmitter {
  constructor(config = {}) {
    super(); // Call EventEmitter constructor
    // ITERATION LIMIT: Respect caller's maxIterations, default to 20 for thorough analysis
    // User feedback: "be careful dont limit the iteration times in the agent"
    this.maxIterations = config.maxIterations || 20; // Restored from 5 to 20 for better results
    this.executionHistory = [];
    this.agentGraph = new Map(); // Track agent dependencies
    this.feedbackLoops = [];
    this.currentIteration = 0;

    // OPTIMIZATION: Track previous judge results for conditional routing
    this.lastEvaluation = null;  // Store previous iteration's evaluation
    this.previousCodeHash = null; // Track if code changed between iterations

    // PERFORMANCE: Agent timeout limits (in milliseconds)
    // USER FEEDBACK: "be careful the timeout protection not limit any its capcaity"
    this.agentTimeouts = {
      biostat_coding_agent: 60000,  // 60 seconds max for R execution
      clinical_judge_agent: 180000, // 180 seconds (3 min) - needs time for thinking mode + web search (up to 10 iterations)
      data_manager_agent: 60000,    // 60 seconds max for Claude API
      pi_agent: 30000               // 30 seconds max for task planning (with web search capability)
    };

    // PERFORMANCE: Track execution times for monitoring
    this.executionTimes = {};

    // TRACE LOGGING: Support for database persistence (optional)
    this.multiAgentSessionId = config.multiAgentSessionId || null;
    this.enableTracing = config.enableTracing !== false; // Enabled by default
  }

  /**
   * Log agent trace event to database
   */
  async logAgentTrace(fromAgent, toAgent, eventType, message, metadata = {}) {
    if (!this.enableTracing || !this.multiAgentSessionId) {
      return; // Tracing disabled or no session
    }

    try {
      const { data, error } = await supabase
        .from('agent_traces')
        .insert({
          session_id: this.multiAgentSessionId,
          timestamp: new Date().toISOString(),
          iteration: this.currentIteration,
          from_agent: fromAgent,
          to_agent: toAgent,
          event_type: eventType, // 'route', 'execution', 'evaluation', 'feedback_loop', 'completion', 'error'
          message: message,
          metadata: metadata,
          execution_time_ms: metadata.execution_time_ms || null,
          tokens_used: metadata.tokens_used || null
        });

      if (error) {
        console.error('❌ Error logging agent trace:', error);
      } else {
        console.log(`📝 Logged trace: ${fromAgent} → ${toAgent} (${eventType})`);
      }
    } catch (err) {
      console.error('❌ Exception logging agent trace:', err);
    }
  }

  /**
   * Update agent metrics for performance tracking
   */
  async updateAgentMetrics(agentName, actionsCount, duration, successRate, tokensUsed, errorCount = 0) {
    if (!this.enableTracing || !this.multiAgentSessionId) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('agent_metrics')
        .insert({
          session_id: this.multiAgentSessionId,
          agent_name: agentName,
          actions_count: actionsCount,
          total_duration: duration,
          success_rate: successRate,
          average_tokens: tokensUsed,
          error_count: errorCount,
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('❌ Error updating agent metrics:', error);
      }
    } catch (err) {
      console.error('❌ Exception updating agent metrics:', err);
    }
  }

  /**
   * Log feedback loop iteration
   */
  async logFeedbackLoop(iterationNumber, score, targetScore, fromAgent, toAgent, feedbackReason, improvementsRequested, ledToSuccess = false) {
    if (!this.enableTracing || !this.multiAgentSessionId) {
      return;
    }

    try {
      const { data, error } = await supabase
        .from('agent_feedback_loops')
        .insert({
          session_id: this.multiAgentSessionId,
          iteration_number: iterationNumber,
          score: score,
          target_score: targetScore,
          from_agent: fromAgent,
          to_agent: toAgent,
          feedback_reason: feedbackReason,
          improvements_requested: improvementsRequested,
          timestamp: new Date().toISOString(),
          led_to_success: ledToSuccess
        });

      if (error) {
        console.error('❌ Error logging feedback loop:', error);
      } else {
        console.log(`📝 Logged feedback loop: Iteration ${iterationNumber}, Score ${score}/${targetScore}`);
      }
    } catch (err) {
      console.error('❌ Exception logging feedback loop:', err);
    }
  }

  /**
   * Save final multi-agent results
   */
  async saveMultiAgentResults(results) {
    if (!this.enableTracing || !this.multiAgentSessionId) {
      return;
    }

    try {
      const executionTrace = this.executionHistory.map(h => ({
        agent: h.agent,
        action: h.action,
        timestamp: h.timestamp || new Date().toISOString(),
        result: h.result
      }));

      const { data, error} = await supabase
        .from('multi_agent_results')
        .insert({
          session_id: this.multiAgentSessionId,
          final_score: results.judgeEvaluation?.finalScore || 0,
          total_iterations: results.iterations || this.currentIteration,
          total_duration_seconds: results.executionTime / 1000 || 0,
          agents_involved: results.agentsInvolved || ['PI_Agent', 'Biostat_Coding_Agent', 'Clinical_Judge_Agent'],
          success: results.success || false,
          final_output: results.finalContent || '',
          code_blocks: results.rCode ? [results.rCode] : [],
          output_files: results.outputFiles || [],
          execution_trace: executionTrace,
          judge_final_score: results.judgeEvaluation?.finalScore || 0,
          judge_aspect_scores: results.judgeEvaluation?.aspectScores || {},
          judge_reasoning: results.judgeEvaluation?.reasoning || {},
          judge_passed: results.judgeEvaluation?.passed || false,
          judge_summary: results.judgeEvaluation?.summary || '',
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('❌ Error saving multi-agent results:', error);
      } else {
        console.log(`✅ Saved multi-agent results to database`);
      }
    } catch (err) {
      console.error('❌ Exception saving multi-agent results:', err);
    }
  }

  /**
   * Execute multi-agent workflow with feedback loops
   */
  async executeWithFeedback(query, context = {}) {
    console.log('\n🔄 STARTING MULTI-AGENT ORCHESTRATION WITH FEEDBACK LOOPS');
    console.log('═'.repeat(80));

    this.executionHistory = [];
    this.feedbackLoops = [];
    this.currentIteration = 0;

    let workflowComplete = false;
    let currentResults = null;
    let satisfactionScore = 0;

    // Initial PI agent analysis
    const piAnalysis = await this.piAgentAnalyze(query, context);
    this.logExecution('PI_AGENT', 'ANALYZE', piAnalysis);

    while (!workflowComplete && this.currentIteration < this.maxIterations) {
      this.currentIteration++;
      console.log(`\n🔁 ITERATION ${this.currentIteration}`);
      console.log('─'.repeat(40));

      // Step 1: Execute based on current understanding
      if (this.currentIteration === 1) {
        // First iteration - execute initial plan
        currentResults = await this.executeInitialPlan(piAnalysis, query, context);
      } else {
        // Subsequent iterations - execute feedback-driven improvements
        currentResults = await this.executeFeedbackPlan(currentResults, query, context);
      }

      // Step 2: Evaluate results with multiple agents
      const evaluation = await this.multiAgentEvaluation(currentResults, query, context);
      satisfactionScore = evaluation.overallScore; // Keep for backward compatibility

      console.log(`\n📊 Evaluation Result: ${evaluation.overallJudgment}`);
      console.log(`   Overall Score: ${satisfactionScore}/100 (for reference)`);

      if (evaluation.overallJudgment === 'FAIL' && evaluation.failureReasons.length > 0) {
        console.log(`   Failure Reasons:`);
        evaluation.failureReasons.forEach(reason => {
          console.log(`     - ${reason}`);
        });
      }

      // Step 3: Check if all judges passed (BINARY JUDGMENT!)
      if (evaluation.overallJudgment === 'PASS') {
        console.log(`✅ Analysis PASSED all judge evaluations - workflow complete`);
        workflowComplete = true;
      } else {
        console.log(`❌ Analysis FAILED judge evaluations - improvements needed`);

        // Step 4: Generate improvement plan
        const improvementPlan = await this.generateImprovementPlan(
          evaluation,
          currentResults,
          query
        );

        if (improvementPlan.actions.length === 0) {
          console.log('📌 No further improvements identified - accepting current results');
          workflowComplete = true;
        } else {
          console.log(`📝 ${improvementPlan.actions.length} improvements identified:`);
          improvementPlan.actions.forEach(action => {
            console.log(`   • ${action.agent}: ${action.task}`);
          });
        }

        // Store feedback for next iteration
        currentResults.feedback = improvementPlan;
      }
    }

    // Save final multi-agent results to database
    const finalResults = {
      success: satisfactionScore >= 60,
      finalScore: satisfactionScore,
      iterations: this.currentIteration,
      results: currentResults,
      executionHistory: this.executionHistory,
      feedbackLoops: this.feedbackLoops,
      // Add structured data for database
      finalContent: currentResults?.outputs?.statistical?.finalContent || '',
      rCode: currentResults?.outputs?.statistical?.rCode || '',
      executionOutput: currentResults?.outputs?.statistical?.fullOutput || '',
      outputFiles: currentResults?.outputs?.statistical?.outputFiles || [],
      executionTime: Date.now(), // Will be calculated properly
      judgeEvaluation: {
        finalScore: satisfactionScore,
        passed: satisfactionScore >= 80,
        summary: `Multi-agent analysis completed in ${this.currentIteration} iterations`
      },
      agentsInvolved: ['PI_Agent', 'Biostat_Coding_Agent', 'Clinical_Judge_Agent']
    };

    // Log final trace: Workflow complete
    await this.logAgentTrace(
      'PI_Agent',
      null,
      'completion',
      `Multi-agent workflow completed: ${finalResults.success ? 'SUCCESS' : 'FAILED'} after ${this.currentIteration} iterations`,
      {
        iterations: this.currentIteration,
        final_score: satisfactionScore,
        success: finalResults.success
      }
    );

    // Save complete results to database
    await this.saveMultiAgentResults(finalResults);

    return finalResults;
  }

  /**
   * OPTION 3: Execute with hierarchical orchestration
   * PI Agent acts as central orchestrator with dynamic task breakdown and routing
   */
  async executeWithHierarchicalOrchestration(query, context = {}) {
    console.log('\n🎯 STARTING HIERARCHICAL MULTI-AGENT ORCHESTRATION');
    console.log('═'.repeat(80));
    console.log('   PI Agent acts as central orchestrator');
    console.log('   Dynamic task breakdown and routing');
    console.log('═'.repeat(80));

    const piOrchestrator = new PIAgentOrchestrator();
    this.executionHistory = [];
    this.feedbackLoops = [];
    this.currentIteration = 0;

    // STEP 1: PI Agent breaks down query into tasks
    console.log('\n📋 STEP 1: Task Breakdown by PI Agent');
    const taskPlan = await piOrchestrator.analyzeAndBreakdown(query, context);

    console.log(`\n🧠 PI Agent Task Plan:`);
    console.log(`   Understanding: ${taskPlan.understanding}`);
    console.log(`   Tasks to Execute: ${taskPlan.tasks.length}`);
    taskPlan.tasks.forEach((task, i) => {
      console.log(`   ${i+1}. [${task.priority}] ${task.agent}: ${task.description}`);
      console.log(`      Duration: ~${task.estimated_duration}, Cloud Run: ${task.requires_cloud_run}`);
    });

    if (taskPlan.skip_agents.length > 0) {
      console.log(`\n   ⏭️  Skipping Agents: ${taskPlan.skip_agents.join(', ')}`);
      console.log(`   Reason: ${taskPlan.skip_reason}`);
    }

    // Initialize workflow state
    let workflowState = {
      completedTasks: [],
      pendingTasks: [...taskPlan.tasks],
      failedTasks: [],  // Track failed tasks to prevent infinite retries
      issues: [],
      iteration: 0,
      results: {},
      piPlan: taskPlan
    };

    // STEP 2: Execute tasks dynamically based on PI Agent decisions
    console.log('\n🔄 STEP 2: Dynamic Task Execution');

    while (workflowState.iteration < this.maxIterations) {
      workflowState.iteration++;
      this.currentIteration = workflowState.iteration;
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`🔁 ITERATION ${workflowState.iteration}/${this.maxIterations}`);
      console.log(`${'─'.repeat(80)}`);

      // Check if workflow is complete
      if (workflowState.pendingTasks.length === 0) {
        // CRITICAL VALIDATION: If biostat was executed, clinical judge MUST also execute
        const hasBiostat = workflowState.completedTasks.some(t => t.agent === 'biostat_coding_agent');
        const hasClinical = workflowState.completedTasks.some(t => t.agent === 'clinical_judge_agent');

        // FIX: Check both completed AND failed tasks to prevent infinite retries
        const clinicalFailed = workflowState.failedTasks.some(t => t.agent === 'clinical_judge_agent');
        const clinicalAttempts = workflowState.failedTasks.filter(t => t.agent === 'clinical_judge_agent').length;

        if (hasBiostat && !hasClinical && !clinicalFailed) {
          console.log(`\n⚠️  VALIDATION FAILED: Biostat analysis completed without clinical validation!`);
          console.log(`   → Force-adding mandatory clinical judge task to queue`);

          // Add MANDATORY clinical judge task
          const clinicalTask = {
            id: `task-clinical-mandatory-${Date.now()}`,
            type: 'clinical_validation',
            agent: 'clinical_judge_agent',
            priority: 'CRITICAL',
            description: 'MANDATORY: Validate biostat results for clinical appropriateness and statistical validity',
            isMandatory: true,
            reason: 'Clinical validation is required for all biostatistical analyses'
          };

          workflowState.pendingTasks.push(clinicalTask);
          console.log(`   → Clinical validation task added: ${clinicalTask.id}`);
          continue; // Continue loop to execute the mandatory task
        } else if (hasBiostat && clinicalFailed) {
          console.log(`\n⚠️  CRITICAL: Clinical Judge failed ${clinicalAttempts} time(s)`);
          console.log(`   → Cannot complete workflow without clinical validation`);
          console.log(`   → Review issues: ${workflowState.issues.filter(i => i.includes('clinical_judge')).join('; ')}`);
          // Don't add another task - break out to prevent infinite loop
        }

        console.log('\n✅ All tasks completed - requesting final evaluation from PI Agent...');

        // Get final evaluation from PI Agent
        const finalEval = await piOrchestrator.evaluateFeedback(
          workflowState.results,
          query,
          this.executionHistory
        );

        console.log(`\n📊 PI Agent Final Evaluation:`);
        console.log(`   Task Success: ${finalEval.task_success ? '✅' : '❌'}`);
        console.log(`   Output Complete: ${finalEval.output_complete ? '✅' : '❌'}`);
        console.log(`   Confidence: ${(finalEval.confidence * 100).toFixed(0)}%`);

        if (finalEval.next_action.type === 'APPROVE') {
          console.log(`\n✅ PI Agent APPROVED - Workflow COMPLETE`);
          console.log(`   Reason: ${finalEval.next_action.reason}`);
          break;
        } else {
          console.log(`\n🔄 PI Agent requesting additional work...`);
          console.log(`   Action: ${finalEval.next_action.type}`);
          console.log(`   Reason: ${finalEval.next_action.reason}`);

          // PI Agent wants more work done
          const nextStep = await piOrchestrator.decideNextStep(workflowState, finalEval);

          if (nextStep.decision === 'COMPLETE') {
            console.log(`✅ PI Agent decided to COMPLETE workflow`);
            break;
          } else if (nextStep.decision === 'ABORT') {
            console.log(`❌ PI Agent decided to ABORT workflow`);
            console.log(`   Reason: ${nextStep.reasoning}`);
            break;
          } else if (nextStep.next_task) {
            console.log(`   Adding new task to queue: ${nextStep.next_task.description}`);
            workflowState.pendingTasks.push(nextStep.next_task);
          }
        }
      }

      // Execute next task
      const currentTask = workflowState.pendingTasks.shift();
      console.log(`\n▶️  Executing Task: ${currentTask.id}`);
      console.log(`   Type: ${currentTask.type}`);
      console.log(`   Agent: ${currentTask.agent}`);
      console.log(`   Priority: ${currentTask.priority}`);
      console.log(`   Description: ${currentTask.description}`);

      try {
        const taskResult = await this.executeTask(currentTask, query, context, workflowState);
        workflowState.results[currentTask.id] = taskResult;
        workflowState.completedTasks.push(currentTask);

        console.log(`   ✅ Task completed successfully`);

        // PI Agent evaluates the task result
        console.log(`\n🔍 PI Agent Evaluation of Task Result...`);
        const evaluation = await piOrchestrator.evaluateFeedback(
          taskResult,
          query,
          this.executionHistory
        );

        console.log(`\n📊 PI Agent Evaluation:`);
        console.log(`   Task Success: ${evaluation.task_success ? '✅' : '❌'}`);
        console.log(`   Output Complete: ${evaluation.output_complete ? '✅' : '❌'}`);
        console.log(`   Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);

        if (evaluation.issues_found.length > 0) {
          console.log(`   Issues Found:`);
          evaluation.issues_found.forEach(issue => {
            console.log(`     • ${issue}`);
          });
          workflowState.issues.push(...evaluation.issues_found);
        }

        // PI Agent decides next action
        console.log(`\n🎯 PI Agent Decision:`);
        console.log(`   Next Action: ${evaluation.next_action.type}`);
        console.log(`   Reason: ${evaluation.next_action.reason}`);

        if (evaluation.next_action.type === 'APPROVE') {
          // FIX: Don't break immediately - check if there are pending tasks first
          if (workflowState.pendingTasks.length === 0) {
            console.log(`\n✅ PI Agent APPROVED - All tasks complete, workflow finishing`);
            break;
          } else {
            console.log(`\n✅ Task approved - but ${workflowState.pendingTasks.length} pending task(s) remaining`);
            console.log(`   → Continuing to execute remaining tasks...`);
            // Continue loop to execute next pending task
          }
        } else if (evaluation.next_action.type === 'ADD_REMEDIATION_TASKS') {
          // INTELLIGENT FEEDBACK-DRIVEN SUBTASK GENERATION
          console.log(`\n🔧 PI Agent: Adding ${evaluation.next_action.tasks.length} REMEDIATION task(s) to queue`);
          console.log(`   Reason: ${evaluation.next_action.reason}`);

          // Add each remediation task to the pending queue
          evaluation.next_action.tasks.forEach((remediationTask, index) => {
            console.log(`\n   📋 Remediation Task ${index + 1}/${evaluation.next_action.tasks.length}:`);
            console.log(`      ID: ${remediationTask.id}`);
            console.log(`      Agent: ${remediationTask.agent}`);
            console.log(`      Priority: ${remediationTask.priority}`);
            console.log(`      Description: ${remediationTask.description}`);
            console.log(`      Issue Type: ${remediationTask.remediationFor?.issue_type}`);
            console.log(`      Issue Severity: ${remediationTask.remediationFor?.issue_severity}`);

            // Add to pending tasks
            workflowState.pendingTasks.push(remediationTask);
          });

          // Sort pending tasks by priority (CRITICAL > HIGH > MEDIUM > LOW)
          workflowState.pendingTasks.sort((a, b) => {
            const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            const priorityA = priorityOrder[a.priority] !== undefined ? priorityOrder[a.priority] : 3;
            const priorityB = priorityOrder[b.priority] !== undefined ? priorityOrder[b.priority] : 3;
            return priorityA - priorityB;
          });

          console.log(`\n   ✓ Queue updated: ${workflowState.pendingTasks.length} pending task(s)`);
          console.log(`   → Next task will be: ${workflowState.pendingTasks[0]?.id} (${workflowState.pendingTasks[0]?.priority})`);

          // Log feedback loop for tracking
          this.logFeedbackLoop(
            'PI_AGENT',
            evaluation.next_action.tasks[0]?.agent?.toUpperCase() || 'UNKNOWN',
            `Intelligent feedback-driven remediation: ${evaluation.next_action.reason}`
          );

        } else if (evaluation.next_action.type === 'ROUTE_TO_AGENT') {
          // Add new task based on PI Agent decision
          const newTask = {
            id: `task-${Date.now()}`,
            type: evaluation.next_action.type,
            agent: evaluation.next_action.agent,
            description: evaluation.next_action.instructions,
            priority: 'HIGH',
            parentTask: currentTask.id
          };
          workflowState.pendingTasks.unshift(newTask); // Add to front of queue
          console.log(`   → Routing to ${evaluation.next_action.agent}`);
          console.log(`   → New task added: ${newTask.id}`);

          // Log feedback loop
          this.logFeedbackLoop('PI_AGENT', evaluation.next_action.agent.toUpperCase(), evaluation.next_action.reason);

        } else if (evaluation.next_action.type === 'RERUN_WITH_FIXES') {
          // Rerun same agent with fixes
          const fixTask = {
            ...currentTask,
            id: `task-fix-${Date.now()}`,
            description: evaluation.next_action.instructions,
            fixes: evaluation.issues_found,
            isRetry: true
          };
          workflowState.pendingTasks.unshift(fixTask);
          console.log(`   → Re-running ${currentTask.agent} with fixes`);
          console.log(`   → Fix task added: ${fixTask.id}`);

          // Log feedback loop
          this.logFeedbackLoop('PI_AGENT', currentTask.agent.toUpperCase(), 'Requesting fixes');

        } else if (evaluation.next_action.type === 'REQUEST_MANUAL_REVIEW') {
          console.log(`   ⚠️  Manual review requested`);
          console.log(`   → Continuing with current results`);
        }

      } catch (error) {
        console.error(`   ❌ Task execution failed: ${error.message}`);
        workflowState.issues.push(`Task ${currentTask.id} failed: ${error.message}`);

        // FIX: Track failed tasks to prevent infinite retries
        workflowState.failedTasks.push(currentTask);
        console.log(`   → Marked task as failed (agent: ${currentTask.agent})`);

        // Ask PI Agent what to do about the failure
        const failureEval = await piOrchestrator.evaluateFeedback(
          { error: error.message, taskId: currentTask.id },
          query,
          this.executionHistory
        );

        if (failureEval.next_action.type === 'ABORT') {
          console.log(`   ❌ PI Agent decided to ABORT due to task failure`);
          break;
        }

        // FIX: Don't retry indefinitely - if same agent failed multiple times, stop
        const sameAgentFailures = workflowState.failedTasks.filter(t => t.agent === currentTask.agent).length;
        if (sameAgentFailures >= 3) {
          console.log(`   ⚠️  Agent ${currentTask.agent} has failed ${sameAgentFailures} times - stopping retries`);
          break;
        }
      }
    }

    // Return final results
    console.log(`\n${'═'.repeat(80)}`);
    console.log('✅ HIERARCHICAL ORCHESTRATION COMPLETE');
    console.log(`${'═'.repeat(80)}`);
    console.log(`   Iterations: ${workflowState.iteration}`);
    console.log(`   Tasks Completed: ${workflowState.completedTasks.length}`);
    console.log(`   Tasks Pending: ${workflowState.pendingTasks.length}`);
    console.log(`   Issues Found: ${workflowState.issues.length}`);

    return {
      success: true,
      iterations: workflowState.iteration,
      tasksCompleted: workflowState.completedTasks.length,
      tasksPending: workflowState.pendingTasks.length,
      results: workflowState.results,
      issues: workflowState.issues,
      executionHistory: this.executionHistory,
      feedbackLoops: this.feedbackLoops,
      piPlan: taskPlan
    };
  }

  /**
   * Wrapper to execute async function with timeout
   * @param {Function} asyncFn - The async function to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @param {string} agentName - Name of the agent for logging
   */
  async executeWithTimeout(asyncFn, timeoutMs, agentName) {
    const startTime = Date.now();

    return Promise.race([
      asyncFn(),
      new Promise((_, reject) =>
        setTimeout(() => {
          const elapsed = Date.now() - startTime;
          reject(new Error(`${agentName} timeout after ${(elapsed/1000).toFixed(1)}s (limit: ${timeoutMs/1000}s)`));
        }, timeoutMs)
      )
    ]).then(result => {
      const elapsed = Date.now() - startTime;

      // Track execution time
      if (!this.executionTimes[agentName]) {
        this.executionTimes[agentName] = [];
      }
      this.executionTimes[agentName].push(elapsed);

      console.log(`   ⏱️ ${agentName} completed in ${(elapsed/1000).toFixed(1)}s`);
      return result;
    }).catch(error => {
      const elapsed = Date.now() - startTime;
      console.error(`   ❌ ${agentName} failed after ${(elapsed/1000).toFixed(1)}s: ${error.message}`);
      throw error;
    });
  }

  /**
   * Execute a specific task by routing to the appropriate agent
   */
  async executeTask(task, query, context, workflowState) {
    console.log(`   🔧 Executing task with agent: ${task.agent}`);

    switch (task.agent) {
      case 'biostat_coding_agent':
        // Biostat agent needs R code execution (Cloud Run, ~90s)
        const enhancedContext = {
          ...context,
          taskInstructions: task.description,
          fixes: task.fixes || [],
          isRetry: task.isRetry || false
        };

        // PERFORMANCE: Apply timeout protection to biostat agent
        const timeout = this.agentTimeouts.biostat_coding_agent;
        const biostatResult = await this.executeWithTimeout(
          () => this.callBiostatCodingAgent(query, enhancedContext),
          timeout,
          'biostat_coding_agent'
        );

        // Log execution
        this.logExecution('BIOSTAT_AGENT', 'EXECUTE', {
          taskId: task.id,
          success: biostatResult.executionSuccess || false,
          hasOutput: !!biostatResult.fullOutput,
          filesGenerated: (biostatResult.outputFiles || []).length
        });

        return biostatResult;

      case 'clinical_judge_agent':
        // Clinical judge validates (Claude API, ~15s)
        // Get biostat result from previous tasks
        const biostatData = Object.values(workflowState.results).find(r => r.rCode);

        if (!biostatData) {
          console.log(`     ⚠️  No biostat results available for clinical validation`);
          return {
            error: 'No biostat results available',
            judgment: 'FAIL',
            score: 0,
            reasoning: 'Cannot validate without biostat results'
          };
        }

        const enrichedContext = {
          ...context,
          userQuery: query,
          executionTrace: {
            currentIteration: this.currentIteration,
            executionHistory: this.executionHistory,
            feedbackLoops: this.feedbackLoops,
          },
          domainContext: {
            analysisType: this.detectAnalysisType(biostatData.rCode || '', query),
            trialType: context.studyType || 'general',
            regulatoryRequirements: context.regulatory || []
          }
        };

        // PERFORMANCE: Apply timeout protection to clinical judge
        const clinicalTimeout = this.agentTimeouts.clinical_judge_agent;
        const clinicalResult = await this.executeWithTimeout(
          () => this.callClinicalJudgeAgent(biostatData, enrichedContext, query),
          clinicalTimeout,
          'clinical_judge_agent'
        );

        // Log execution
        this.logExecution('CLINICAL_JUDGE', 'EVALUATE', {
          taskId: task.id,
          approved: clinicalResult.approved,
          score: clinicalResult.fullEvaluation?.statisticalValidity?.score || 0
        });

        return clinicalResult;

      case 'data_manager_agent':
        // Data manager assesses data quality (Claude API, ~15s)
        // Get analysis result from previous tasks
        const analysisData = Object.values(workflowState.results).find(r => r.rCode);

        if (!analysisData) {
          console.log(`     ⚠️  No analysis results available for data quality assessment`);
          return {
            error: 'No analysis results available',
            dataQuality: 'Unknown',
            requiresReanalysis: false
          };
        }

        const dataContext = {
          ...context,
          userQuery: query,
          executionTrace: {
            currentIteration: this.currentIteration,
            executionHistory: this.executionHistory,
            feedbackLoops: this.feedbackLoops,
          },
          domainContext: {
            analysisType: this.detectAnalysisType(analysisData.rCode || '', query),
            hasUserDataset: !!(context.dataset || context.datasetInfo || context.uploadedFiles?.length > 0)
          }
        };

        // PERFORMANCE: Apply timeout protection to data manager
        const dataTimeout = this.agentTimeouts.data_manager_agent;
        const dataResult = await this.executeWithTimeout(
          () => this.callDataManagerAgent(analysisData, dataContext, query),
          dataTimeout,
          'data_manager_agent'
        );

        // Log execution
        this.logExecution('DATA_MANAGER', 'ASSESS', {
          taskId: task.id,
          dataQuality: dataResult.dataQuality,
          requiresReanalysis: dataResult.requiresReanalysis
        });

        return dataResult;

      default:
        throw new Error(`Unknown agent: ${task.agent}`);
    }
  }

  /**
   * PI Agent analyzes query and creates initial plan
   */
  async piAgentAnalyze(query, context) {
    console.log('\n🧠 PI Agent Analysis:');

    // Simulate PI agent analysis
    const analysis = {
      intent: this.detectIntent(query),
      requiredCapabilities: this.extractRequiredCapabilities(query),
      expectedOutputs: ['statistical_results', 'clinical_validation'],
      successCriteria: {
        hasStatisticalAnalysis: true,
        hasClinicalValidation: true,
        pValueThreshold: 0.05,
        clinicallyMeaningful: true
      }
    };

    console.log(`   Intent: ${analysis.intent}`);
    console.log(`   Required: ${analysis.requiredCapabilities.join(', ')}`);

    return analysis;
  }

  /**
   * Execute initial plan from PI agent
   */
  async executeInitialPlan(piAnalysis, query, context) {
    console.log('\n▶️ Executing Initial Plan...');

    const results = {
      agents: [],
      outputs: {},
      errors: []
    };

    // Route to biostatistics coding agent first
    if (piAnalysis.requiredCapabilities.includes('statistical_analysis')) {
      const biostatResult = await this.callBiostatCodingAgent(query, context);
      results.agents.push('biostat-coding-agent');
      results.outputs.statistical = biostatResult;

      this.logExecution('BIOSTAT_AGENT', 'EXECUTE', biostatResult);
      console.log('   ✓ Biostatistics analysis completed');
    }

    return results;
  }

  /**
   * Execute feedback-driven improvements
   */
  async executeFeedbackPlan(previousResults, query, context) {
    console.log('\n🔧 Executing Feedback-Driven Improvements...');

    const results = { ...previousResults };
    const feedback = previousResults.feedback;

    if (!feedback || !feedback.actions) {
      return results;
    }

    // Execute each improvement action
    for (const action of feedback.actions) {
      console.log(`\n   → ${action.agent}: ${action.task}`);

      switch (action.agent) {
        case 'biostat-coding-agent':
          // Coding agent needs to fix/improve analysis
          const improvedStats = await this.callBiostatCodingAgent(
            query,
            { ...context, previousResults: results, fixIssues: action.issues }
          );
          results.outputs.statistical = improvedStats;
          this.logFeedbackLoop('CLINICAL_JUDGE', 'BIOSTAT_AGENT', action.reason);
          break;

        case 'data-manager-agent':
          // Data manager needs to better understand data
          const dataInsights = await this.callDataManagerAgent(
            results.outputs.statistical,
            context,
            query  // Pass original query for full context
          );
          results.outputs.dataQuality = dataInsights;

          // Data manager might trigger coding agent to re-analyze
          if (dataInsights.requiresReanalysis) {
            console.log('     Data Manager → Coding Agent: Requesting re-analysis');
            const reanalysis = await this.callBiostatCodingAgent(
              query,
              { ...context, dataInsights }
            );
            results.outputs.statistical = reanalysis;
            this.logFeedbackLoop('DATA_MANAGER', 'BIOSTAT_AGENT', 'Data quality issues');
          }
          break;

        case 'clinical-judge-agent':
          // Clinical judge validates and might request changes
          const clinicalValidation = await this.callClinicalJudgeAgent(
            results.outputs.statistical,
            context,
            query  // Pass original query for full context
          );
          results.outputs.clinical = clinicalValidation;
          break;
      }
    }

    return results;
  }

  /**
   * Multi-agent evaluation of results
   * BINARY JUDGMENT: Aggregates binary PASS/FAIL from all judges with AND logic
   */
  async multiAgentEvaluation(results, query, context) {
    console.log('\n🔍 Multi-Agent Evaluation:');

    const evaluation = {
      judgments: {},         // Binary judgments from each judge
      scores: {},            // Keep scores for debugging
      issues: [],            // All issues from all judges
      failureReasons: [],    // Specific reasons for FAIL judgments
      overallScore: 0,       // Keep for backward compatibility
      overallJudgment: 'PASS' // Start optimistic, set to FAIL if any judge fails
    };

    // 1. PI Agent evaluates completeness
    const piEval = this.piAgentEvaluate(results, query);
    evaluation.judgments.completeness = {
      result: piEval.judgment,
      score: piEval.score,
      reasoning: piEval.reasoning
    };
    evaluation.scores.completeness = piEval.score;
    console.log(`   PI Agent - Completeness: ${piEval.judgment} (${piEval.score}/100)`);

    if (piEval.judgment === 'FAIL') {
      evaluation.overallJudgment = 'FAIL';
      evaluation.failureReasons.push(`Completeness: ${piEval.reasoning}`);
    }

    if (piEval.issues.length > 0) {
      evaluation.issues.push(...piEval.issues);
      console.log(`     Issues: ${piEval.issues.join(', ')}`);
    }

    // 2 & 3. OPTIMIZATION: Run Clinical Judge and Data Manager in PARALLEL
    // Both are Claude API calls (~15s each), no dependencies between them
    // This saves ~15s per iteration compared to sequential execution
    const hasDataset = context.dataset || context.datasetInfo ||
                       context.uploadedFiles?.length > 0 ||
                       context.files?.length > 0;

    console.log(`\n   ⚡ Running judges in parallel...`);
    const startTime = Date.now();

    const [clinicalEval, dataEval] = await Promise.all([
      this.clinicalJudgeEvaluate(results, query, context),
      hasDataset
        ? this.dataManagerEvaluate(results, query, context)
        : Promise.resolve(null) // Skip Data Manager if no dataset
    ]);

    const parallelTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`   ⚡ Parallel execution completed in ${parallelTime}s`);

    // Process Clinical Judge result
    evaluation.judgments.clinical = {
      result: clinicalEval.judgment,
      score: clinicalEval.score,
      reasoning: clinicalEval.reasoning
    };
    evaluation.scores.clinical = clinicalEval.score;
    console.log(`   Clinical Judge - Validity: ${clinicalEval.judgment} (${clinicalEval.score}/100)`);

    if (clinicalEval.judgment === 'FAIL') {
      evaluation.overallJudgment = 'FAIL';
      evaluation.failureReasons.push(`Clinical: ${clinicalEval.reasoning}`);
    }

    if (clinicalEval.issues.length > 0) {
      evaluation.issues.push(...clinicalEval.issues);
      console.log(`     Issues: ${clinicalEval.issues.join(', ')}`);
    }

    // Process Data Manager result (if it ran)
    if (dataEval) {
      evaluation.judgments.dataQuality = {
        result: dataEval.judgment,
        score: dataEval.score,
        reasoning: dataEval.reasoning
      };
      evaluation.scores.dataQuality = dataEval.score;
      console.log(`   Data Manager - Quality: ${dataEval.judgment} (${dataEval.score}/100)`);

      if (dataEval.judgment === 'FAIL') {
        evaluation.overallJudgment = 'FAIL';
        evaluation.failureReasons.push(`Data Quality: ${dataEval.reasoning}`);
      }

      if (dataEval.issues.length > 0) {
        evaluation.issues.push(...dataEval.issues);
        console.log(`     Issues: ${dataEval.issues.join(', ')}`);
      }
    } else {
      console.log(`   Data Manager - SKIPPED (no user dataset provided)`);
    }

    // Calculate overall score (keep for backward compatibility and debugging)
    const scores = Object.values(evaluation.scores);
    evaluation.overallScore = scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;

    // OPTIMIZATION: Store this evaluation and code hash for next iteration's conditional routing
    const currentCodeHash = this.hashCode(results.outputs?.statistical?.rCode || '');
    this.lastEvaluation = evaluation;
    this.previousCodeHash = currentCodeHash;

    return evaluation;
  }

  /**
   * PI Agent evaluates if results meet requirements
   * BINARY JUDGMENT: Returns PASS/FAIL based on completeness
   */
  piAgentEvaluate(results, query) {
    const evaluation = {
      score: 0,
      issues: [],
      satisfied: false
    };

    // Check if statistical analysis exists
    if (results.outputs?.statistical) {
      evaluation.score += 30;
    } else {
      evaluation.issues.push('Missing statistical analysis');
    }

    // Check if p-values are present
    if (results.outputs?.statistical?.pValue !== undefined) {
      evaluation.score += 20;
    } else {
      evaluation.issues.push('No p-values calculated');
    }

    // Check if effect sizes are present
    if (results.outputs?.statistical?.effectSize !== undefined) {
      evaluation.score += 20;
    } else {
      evaluation.issues.push('No effect sizes reported');
    }

    // Check if clinical validation exists
    if (results.outputs?.clinical) {
      evaluation.score += 30;
    } else {
      evaluation.issues.push('Missing clinical validation');
    }

    // BINARY DECISION: PASS if score >= 60 (completeness threshold)
    const judgment = evaluation.score >= 60 ? 'PASS' : 'FAIL';
    evaluation.satisfied = (judgment === 'PASS');

    return {
      judgment: judgment,  // BINARY: PASS or FAIL
      score: evaluation.score,
      reasoning: `Completeness check: ${evaluation.issues.length} issues found`,
      issues: evaluation.issues
    };
  }

  /**
   * Clinical Judge evaluates with RIGOROUS 5-POINT SCORING SYSTEM
   * Each point is a specific, verifiable aspect based on user query
   * Need 4/5 points to PASS (80% threshold)
   *
   * 5 EVALUATION ASPECTS (query-driven):
   * 1. Statistical Method Correctness - Right test/method for the question
   * 2. Parameter Accuracy - All user-specified values present & correct
   * 3. Code Execution Success - R code runs without errors, produces outputs
   * 4. Output Completeness - Has all required elements (sample size, power, etc.)
   * 5. Clinical Validity - Appropriate for study design & clinically sound
   */
  async clinicalJudgeEvaluate(results, query, context) {
    const stats = results.outputs?.statistical;

    // CRITICAL CHECK - Stop immediately if no stats available
    if (!stats) {
      return {
        judgment: 'FAIL',
        score: 0,
        pointsAwarded: 0,
        totalPoints: 5,
        aspectScores: {
          methodCorrectness: { score: 0, reason: 'No results available' },
          parameterAccuracy: { score: 0, reason: 'No results available' },
          executionSuccess: { score: 0, reason: 'No results available' },
          outputCompleteness: { score: 0, reason: 'No results available' },
          clinicalValidity: { score: 0, reason: 'No results available' }
        },
        reasoning: 'No statistical results available',
        issues: ['CRITICAL: No statistical results available'],
        recommendations: ['Check biostat agent execution'],
        approved: false
      };
    }

    // RIGOROUS 5-POINT EVALUATION
    const aspectScores = {};
    let pointsAwarded = 0;

    // ASPECT 1: Statistical Method Correctness
    // Check if the right statistical method was used for the query
    const methodCheck = this.evaluateMethodCorrectness(stats, query, context);
    aspectScores.methodCorrectness = methodCheck;
    if (methodCheck.score === 1) pointsAwarded++;

    // ASPECT 2: Parameter Accuracy
    // Verify all user-specified parameters are present and correct
    const paramCheck = this.evaluateParameterAccuracy(stats, query, context);
    aspectScores.parameterAccuracy = paramCheck;
    if (paramCheck.score === 1) pointsAwarded++;

    // ASPECT 3: Code Execution Success
    // Code must run without errors and produce valid output
    const execCheck = this.evaluateExecutionSuccess(stats);
    aspectScores.executionSuccess = execCheck;
    if (execCheck.score === 1) pointsAwarded++;

    // ASPECT 4: Output Completeness
    // Must have all required outputs (sample size, formulas, explanations)
    const outputCheck = this.evaluateOutputCompleteness(stats, query);
    aspectScores.outputCompleteness = outputCheck;
    if (outputCheck.score === 1) pointsAwarded++;

    // ASPECT 5: Clinical Validity
    // Results must be clinically sound and appropriate
    const clinicalCheck = this.evaluateClinicalValidity(stats, query, context);
    aspectScores.clinicalValidity = clinicalCheck;
    if (clinicalCheck.score === 1) pointsAwarded++;

    // BINARY DECISION: PASS if >= 4/5 points (80% threshold)
    const judgment = pointsAwarded >= 4 ? 'PASS' : 'FAIL';
    const percentScore = Math.round((pointsAwarded / 5) * 100);

    // Collect issues from failing aspects
    const issues = [];
    const recommendations = [];
    for (const [aspect, result] of Object.entries(aspectScores)) {
      if (result.score === 0) {
        issues.push(`${aspect}: ${result.reason}`);
        if (result.recommendation) {
          recommendations.push(result.recommendation);
        }
      }
    }

    console.log(`   📊 5-Point Evaluation: ${pointsAwarded}/5 points (${percentScore}%)`);
    console.log(`      ✓ Method: ${aspectScores.methodCorrectness.score}`);
    console.log(`      ✓ Parameters: ${aspectScores.parameterAccuracy.score}`);
    console.log(`      ✓ Execution: ${aspectScores.executionSuccess.score}`);
    console.log(`      ✓ Outputs: ${aspectScores.outputCompleteness.score}`);
    console.log(`      ✓ Clinical: ${aspectScores.clinicalValidity.score}`);

    return {
      judgment: judgment,
      score: percentScore,
      pointsAwarded: pointsAwarded,
      totalPoints: 5,
      aspectScores: aspectScores,
      reasoning: `Scored ${pointsAwarded}/5 points (${percentScore}%). Need 4/5 to pass.`,
      issues: issues,
      recommendations: recommendations,
      approved: judgment === 'PASS'
    };
  }

  /**
   * ASPECT 1: Statistical Method Correctness
   * Verifies the right statistical test/method was used for the query
   */
  evaluateMethodCorrectness(stats, query, context) {
    const queryLower = query.toLowerCase();
    const rCode = stats.rCode || '';
    const methodUsed = stats.methodUsed || '';

    // Common method patterns from query
    const methodPatterns = {
      'sample size': ['pwr.', 'power.', 'sample.size'],
      'power analysis': ['pwr.', 'power.'],
      't-test': ['t.test', 'pwr.t.test'],
      'two group': ['pwr.t.test', 'pwr.2p.test'],
      'anova': ['pwr.anova', 'aov'],
      'correlation': ['pwr.r.test', 'cor.test'],
      'proportion': ['pwr.p.test', 'pwr.2p.test', 'prop.test'],
      'regression': ['lm(', 'glm(', 'pwr.f2.test']
    };

    // Identify what method is needed from query
    let expectedMethod = null;
    for (const [keyword, patterns] of Object.entries(methodPatterns)) {
      if (queryLower.includes(keyword)) {
        expectedMethod = patterns;
        break;
      }
    }

    // If we couldn't identify expected method, assume it's a sample size/power calculation
    if (!expectedMethod) {
      expectedMethod = methodPatterns['sample size'];
    }

    // Check if any expected pattern appears in the R code
    const methodFound = expectedMethod.some(pattern =>
      rCode.includes(pattern) || methodUsed.includes(pattern)
    );

    if (methodFound) {
      return {
        score: 1,
        reason: 'Correct statistical method used for the query'
      };
    } else {
      return {
        score: 0,
        reason: `Expected method matching query not found. Query suggests: ${expectedMethod[0]}`,
        recommendation: `Use appropriate statistical test based on study design`
      };
    }
  }

  /**
   * ASPECT 2: Parameter Accuracy
   * Verifies all user-specified parameters are present and correct
   */
  evaluateParameterAccuracy(stats, query, context) {
    const queryLower = query.toLowerCase();
    const rCode = stats.rCode || '';
    const parameters = stats.parameters || {};

    // Extract expected parameters from query
    const expectedParams = {};

    // Alpha/significance level
    const alphaMatch = query.match(/alpha\s*=?\s*(0\.\d+)/i) || query.match(/significance\s+level\s*=?\s*(0\.\d+)/i);
    if (alphaMatch) expectedParams.alpha = alphaMatch[1];

    // Power
    const powerMatch = query.match(/power\s*=?\s*(0\.\d+)/i);
    if (powerMatch) expectedParams.power = powerMatch[1];

    // Effect size
    const effectMatch = query.match(/effect\s+size\s*=?\s*(0\.\d+)/i) || query.match(/cohen'?s\s+d\s*=?\s*(0\.\d+)/i);
    if (effectMatch) expectedParams.effectSize = effectMatch[1];

    // Sample size (if verifying a calculation)
    const nMatch = query.match(/n\s*=?\s*(\d+)/i) || query.match(/sample\s+size\s*=?\s*(\d+)/i);
    if (nMatch) expectedParams.n = nMatch[1];

    // If no specific parameters found, pass (user didn't specify)
    if (Object.keys(expectedParams).length === 0) {
      return {
        score: 1,
        reason: 'No specific parameter values in query to verify'
      };
    }

    // Check if expected parameters appear in R code or output
    const missingParams = [];
    for (const [param, value] of Object.entries(expectedParams)) {
      const valueInCode = rCode.includes(value) || JSON.stringify(parameters).includes(value);
      if (!valueInCode) {
        missingParams.push(`${param}=${value}`);
      }
    }

    if (missingParams.length === 0) {
      return {
        score: 1,
        reason: 'All user-specified parameters correctly used'
      };
    } else {
      return {
        score: 0,
        reason: `Missing or incorrect parameters: ${missingParams.join(', ')}`,
        recommendation: `Ensure all user-specified values are used in the calculation`
      };
    }
  }

  /**
   * ASPECT 3: Code Execution Success
   * Verifies R code ran without errors and produced valid output
   */
  evaluateExecutionSuccess(stats) {
    // Check execution flag
    if (stats.executionSuccess === false) {
      return {
        score: 0,
        reason: 'R code execution failed',
        recommendation: 'Fix R syntax errors and ensure all packages are available'
      };
    }

    // Check for error messages
    const errorText = stats.errorMessage || stats.error || '';
    if (errorText && errorText.length > 0) {
      return {
        score: 0,
        reason: `Execution error: ${errorText.substring(0, 100)}`,
        recommendation: 'Debug R code and resolve execution errors'
      };
    }

    // Check if we have output
    const hasOutput = !!(
      stats.results ||
      stats.sampleSize ||
      stats.power ||
      stats.outputText ||
      stats.fullOutput
    );

    if (!hasOutput) {
      return {
        score: 0,
        reason: 'Code executed but produced no output',
        recommendation: 'Ensure R code includes print() or return statements'
      };
    }

    return {
      score: 1,
      reason: 'Code executed successfully and produced output'
    };
  }

  /**
   * ASPECT 4: Output Completeness
   * Verifies all required outputs are present based on query
   */
  evaluateOutputCompleteness(stats, query) {
    const queryLower = query.toLowerCase();
    const missingElements = [];

    // Check for sample size if that's what was requested
    if (queryLower.includes('sample size') || queryLower.includes('how many')) {
      const hasSampleSize = !!(
        stats.sampleSize ||
        stats.n ||
        stats.results?.n ||
        stats.results?.sampleSize ||
        (stats.fullOutput && stats.fullOutput.includes('n ='))
      );
      if (!hasSampleSize) {
        missingElements.push('sample size calculation');
      }
    }

    // Check for power if requested
    if (queryLower.includes('power')) {
      const hasPower = !!(
        stats.power ||
        stats.results?.power ||
        (stats.fullOutput && stats.fullOutput.includes('power'))
      );
      if (!hasPower) {
        missingElements.push('power calculation');
      }
    }

    // Check for visualization if requested
    if (queryLower.includes('plot') || queryLower.includes('graph') || queryLower.includes('visualiz')) {
      const hasPlot = !!(
        stats.plotPath ||
        stats.plots?.length > 0 ||
        stats.visualizations?.length > 0 ||
        (stats.rCode && stats.rCode.includes('ggplot'))
      );
      if (!hasPlot) {
        missingElements.push('visualization');
      }
    }

    // Check for interpretation/explanation (always recommended)
    const hasInterpretation = !!(
      stats.interpretation ||
      stats.explanation ||
      stats.summary ||
      (stats.fullOutput && stats.fullOutput.length > 100)
    );
    if (!hasInterpretation) {
      missingElements.push('interpretation/explanation');
    }

    if (missingElements.length === 0) {
      return {
        score: 1,
        reason: 'All required outputs present'
      };
    } else {
      return {
        score: 0,
        reason: `Missing required outputs: ${missingElements.join(', ')}`,
        recommendation: 'Include all elements requested by the user'
      };
    }
  }

  /**
   * ASPECT 5: Clinical Validity
   * Verifies results are clinically sound and reasonable
   */
  evaluateClinicalValidity(stats, query, context) {
    const issues = [];

    // Check sample size is reasonable
    const sampleSize = stats.sampleSize || stats.n || stats.results?.n || stats.results?.sampleSize;
    if (sampleSize !== undefined && sampleSize !== null) {
      const n = parseFloat(sampleSize);
      if (n <= 0) {
        issues.push('Sample size is zero or negative');
      } else if (n < 5) {
        issues.push('Sample size extremely small (n < 5), may not be practical');
      } else if (n > 1000000) {
        issues.push('Sample size unrealistically large (n > 1,000,000)');
      }
    }

    // Check power is in valid range if specified
    const power = stats.power || stats.results?.power;
    if (power !== undefined && power !== null) {
      const p = parseFloat(power);
      if (p < 0 || p > 1) {
        issues.push(`Power outside valid range [0,1]: ${p}`);
      } else if (p < 0.5) {
        issues.push(`Power very low (${p}), study may be underpowered`);
      }
    }

    // Check alpha is reasonable if specified
    const alpha = stats.alpha || stats.results?.alpha || stats.parameters?.alpha;
    if (alpha !== undefined && alpha !== null) {
      const a = parseFloat(alpha);
      if (a < 0 || a > 1) {
        issues.push(`Alpha outside valid range [0,1]: ${a}`);
      } else if (a > 0.2) {
        issues.push(`Alpha unusually high (${a}), very liberal significance threshold`);
      }
    }

    // Check for execution errors that might indicate problems
    if (stats.executionSuccess === false) {
      issues.push('Failed execution suggests technical issues');
    }

    // Check if interpretation is present and reasonable
    const interpretation = stats.interpretation || stats.explanation || stats.summary || stats.fullOutput || '';
    if (interpretation.length < 50) {
      issues.push('Insufficient explanation/interpretation of results');
    }

    if (issues.length === 0) {
      return {
        score: 1,
        reason: 'Results are clinically valid and reasonable'
      };
    } else {
      return {
        score: 0,
        reason: `Clinical validity concerns: ${issues.join('; ')}`,
        recommendation: 'Review statistical assumptions and verify calculations'
      };
    }
  }

  /**
   * Data Manager evaluates data quality
   * SIMPLIFIED: Trust the REAL LLM Data Manager to extract and evaluate
   * No more hardcoded checks - agent reads fullOutput directly
   *
   * ENRICHED CONTEXT: Now receives user query + execution trace for full context
   * BINARY JUDGMENT: Returns PASS/FAIL based on data quality
   */
  async dataManagerEvaluate(results, query, context) {
    const stats = results.outputs?.statistical;

    // CRITICAL CHECK - Stop immediately if no stats available
    if (!stats) {
      return {
        judgment: 'FAIL',
        score: 0,
        reasoning: 'No statistical results available',
        issues: ['CRITICAL: No statistical results available'],
        recommendations: ['Check biostat agent execution'],
        dataQualityFlags: []
      };
    }

    // CRITICAL CHECK - Stop immediately if analysis failed
    if (stats.executionSuccess === false) {
      return {
        judgment: 'FAIL',  // BINARY: Execution failure = FAIL
        score: 0,
        reasoning: 'Analysis execution failed - no valid results to evaluate',
        issues: ['CRITICAL: Analysis execution failed - no valid results to evaluate'],
        recommendations: ['Manual review required'],
        dataQualityFlags: []
      };
    }

    // BUILD ENRICHED CONTEXT for Data Manager
    // Include: user query, execution trace, domain context
    const enrichedContext = {
      ...context,
      userQuery: query,  // CRITICAL: Data Manager needs to know what user asked
      executionTrace: {
        currentIteration: this.currentIteration,
        executionHistory: this.executionHistory,  // All agent actions
        feedbackLoops: this.feedbackLoops,        // All feedback between agents
      },
      domainContext: {
        analysisType: this.detectAnalysisType(stats.rCode || '', query),
        hasUserDataset: !!(context.dataset || context.datasetInfo || context.uploadedFiles?.length > 0)
      }
    };

    // Call REAL Data Manager Agent with FULL CONTEXT
    const dataManagerResult = await this.callDataManagerAgent(stats, enrichedContext, query);

    // Extract evaluation metrics from real agent
    // Data Manager returns classification and recommendations
    let score = 70; // Base score for data quality

    if (dataManagerResult.classification?.confidence) {
      // Higher confidence = better data quality understanding
      score = Math.round(dataManagerResult.classification.confidence * 100);
    }

    if (dataManagerResult.requiresReanalysis) {
      score -= 20; // Penalize if reanalysis needed
    }

    const finalScore = Math.max(0, Math.min(100, score));

    // BINARY DECISION: PASS if score >= 70 (data quality threshold)
    const judgment = finalScore >= 70 ? 'PASS' : 'FAIL';

    return {
      judgment: judgment,  // BINARY: PASS or FAIL
      score: finalScore,   // Keep for debugging
      reasoning: `Data quality confidence: ${dataManagerResult.classification?.confidence || 'unknown'}`,
      issues: dataManagerResult.recommendations?.filter(r => r.includes('issue') || r.includes('warning')) || [],
      dataQualityFlags: dataManagerResult.classification?.issues || [],
      recommendations: dataManagerResult.recommendations || []
    };
  }

  /**
   * Generate improvement plan based on evaluation
   */
  async generateImprovementPlan(evaluation, currentResults, query) {
    const plan = {
      actions: [],
      priority: []
    };

    // Analyze each issue and determine which agent should fix it
    evaluation.issues.forEach(issue => {
      // FIX: Convert issue to string if it's an object (judges may return objects in issues array)
      const issueStr = typeof issue === 'string' ? issue : JSON.stringify(issue);

      if (issueStr.includes('statistical') || issueStr.includes('p-value') || issueStr.includes('effect')) {
        plan.actions.push({
          agent: 'biostat-coding-agent',
          task: 'Recalculate statistics with corrections',
          issues: [issue],
          reason: `Statistical issue detected: ${issueStr}`
        });
      } else if (issueStr.includes('clinical') || issueStr.includes('interpretation')) {
        plan.actions.push({
          agent: 'clinical-judge-agent',
          task: 'Provide clinical interpretation',
          issues: [issue],
          reason: `Clinical validation needed: ${issueStr}`
        });
      } else if (issueStr.includes('data') || issueStr.includes('missing') || issueStr.includes('outlier')) {
        // Only call Data Manager if user has actually provided a dataset
        // Check for dataset in multiple possible locations in currentResults
        const hasDataset = !!(
          currentResults?.context?.dataset ||
          currentResults?.context?.datasetInfo ||
          currentResults?.context?.uploadedFiles?.length > 0 ||
          currentResults?.context?.files?.length > 0 ||
          currentResults?.outputs?.statistical?.rCode?.includes('read.csv') ||
          currentResults?.outputs?.statistical?.rCode?.includes('read.table')
        );

        if (hasDataset) {
          plan.actions.push({
            agent: 'data-manager-agent',
            task: 'Assess data quality and preprocessing',
            issues: [issue],
            reason: `Data quality issue detected: ${issueStr}`
          });
        } else {
          // Skip data manager for sample size calculations without actual data
          console.log(`   ⏭️  Skipping data-manager for issue without dataset: ${issueStr.substring(0, 80)}...`);
        }
      }
    });

    // Prioritize actions
    plan.actions.sort((a, b) => {
      const priority = {
        'data-manager-agent': 1,    // Fix data first
        'biostat-coding-agent': 2,  // Then statistics
        'clinical-judge-agent': 3   // Finally validate
      };
      return priority[a.agent] - priority[b.agent];
    });

    return plan;
  }

  /**
   * Detect analysis task type from query and R code
   * Used for adaptive thresholding and judge selection
   */
  detectAnalysisType(rCode, query) {
    const queryLower = query.toLowerCase();
    const codeLower = rCode.toLowerCase();

    // Sample size calculation
    if (queryLower.includes('sample size') || queryLower.includes('power calculation') ||
        codeLower.includes('pwr.') || codeLower.includes('power.t.test')) {
      return 'sample_size_calculation';
    }

    // Hypothesis testing
    if (queryLower.includes('test') || queryLower.includes('hypothesis') ||
        codeLower.includes('t.test') || codeLower.includes('wilcox.test') ||
        codeLower.includes('chisq.test')) {
      return 'hypothesis_testing';
    }

    // Survival analysis
    if (queryLower.includes('survival') || queryLower.includes('cox') ||
        codeLower.includes('survfit') || codeLower.includes('coxph')) {
      return 'survival_analysis';
    }

    // Data exploration
    if (queryLower.includes('explore') || queryLower.includes('summary') ||
        queryLower.includes('describe') || queryLower.includes('visualize')) {
      return 'data_exploration';
    }

    // Regulatory submission (detected from context or query)
    if (queryLower.includes('regulatory') || queryLower.includes('fda') ||
        queryLower.includes('submission') || queryLower.includes('ich')) {
      return 'regulatory_submission';
    }

    return 'general_analysis';
  }

  /**
   * Get task-specific quality threshold
   * Based on research: different tasks require different rigor
   */
  getTaskThreshold(taskType) {
    const TASK_THRESHOLDS = {
      sample_size_calculation: 75,    // Exploratory, multiple valid approaches
      hypothesis_testing: 85,          // Requires rigorous statistical validity
      data_exploration: 70,            // More subjective, descriptive
      survival_analysis: 80,           // Complex, requires careful interpretation
      regulatory_submission: 90,       // Safety-critical, regulatory compliance
      general_analysis: 80             // Default/fallback
    };

    return TASK_THRESHOLDS[taskType] || 80;
  }

  /**
   * Get task-specific evaluation weights
   * Different tasks emphasize different aspects
   */
  getTaskWeights(taskType) {
    const TASK_WEIGHTS = {
      sample_size_calculation: {
        intent_resolution: 0.40,      // Most important: did it answer the question?
        output_completeness: 0.30,    // Files and values present?
        statistical_validity: 0.20,   // Calculations correct?
        clinical_applicability: 0.10  // Real-world feasible?
      },
      hypothesis_testing: {
        statistical_validity: 0.40,   // Most important: correct test, assumptions
        intent_resolution: 0.30,      // Did it answer the question?
        data_quality: 0.20,           // Missing data, outliers handled?
        output_completeness: 0.10     // Files present?
      },
      data_exploration: {
        output_completeness: 0.40,    // Visualizations, summaries generated?
        intent_resolution: 0.30,      // Did it show what was requested?
        data_quality: 0.20,           // Data cleaning applied?
        statistical_validity: 0.10    // Appropriate methods?
      },
      regulatory_submission: {
        statistical_validity: 0.35,   // Rigorous methods required
        data_quality: 0.30,           // Data integrity critical
        output_completeness: 0.20,    // All required outputs
        clinical_applicability: 0.15  // Real-world relevance
      }
    };

    return TASK_WEIGHTS[taskType] || {
      intent_resolution: 0.30,
      statistical_validity: 0.30,
      output_completeness: 0.25,
      data_quality: 0.15
    };
  }

  /**
   * Call REAL Biostat Coding Agent with R execution
   * Uses shared core logic (100% identical to single-agent)
   */
  async callBiostatCodingAgent(query, context) {
    console.log('   🧬 Calling REAL Biostat Coding Agent (SHARED CORE)...');
    console.log('   📥 Original query received:', query.substring(0, 100) + '...');

    // Log trace: PI → Biostat Agent
    await this.logAgentTrace(
      'PI_Agent',
      'Biostat_Coding_Agent',
      'route',
      'Routing query to biostat coding agent for R code generation',
      { query_preview: query.substring(0, 100) }
    );

    const startTime = Date.now();

    try {
      // Build enhanced query with feedback if available
      // Put file generation requirements at the START as explicit instructions
      // This ensures they're treated as PRIMARY directives, not optional suggestions
      let enhancedQuery = `CRITICAL INSTRUCTIONS - You MUST follow these requirements:
1. SAVE ALL VISUALIZATIONS as PNG files using ggsave(filename, plot, width=10, height=6)
2. SAVE ALL NUMERICAL RESULTS as CSV files using write.csv(data, filename)
3. Use descriptive filenames (e.g., "power_analysis.png", "results.csv")

These files are MANDATORY - without them, your response is incomplete.

USER QUESTION: ${query}`;

      if (context.fixIssues && Array.isArray(context.fixIssues)) {
        enhancedQuery += `\n\nPrevious issues to fix: ${context.fixIssues.join(', ')}`;
      }
      if (context.dataInsights) {
        enhancedQuery += `\n\nData insights: ${JSON.stringify(context.dataInsights)}`;
      }

      // DIAGNOSTIC: Log enriched query to verify it's being created correctly
      console.log('   📝 [DIAGNOSTIC] Enriched query length:', enhancedQuery.length);
      console.log('   📝 [DIAGNOSTIC] Enriched query preview:');
      console.log('      ' + enhancedQuery.substring(0, 300).replace(/\n/g, '\n      '));
      if (enhancedQuery.includes('CRITICAL INSTRUCTIONS')) {
        console.log('   ✅ [DIAGNOSTIC] Query enrichment VERIFIED - contains CRITICAL INSTRUCTIONS');
      } else {
        console.log('   ❌ [DIAGNOSTIC] WARNING: Query enrichment MISSING!');
      }

      // Call shared core (SAME as single-agent)
      const result = await executeBiostatAnalysis(enhancedQuery, {
        datasetInfo: context.datasetInfo,
        data: context.data,
        maxIterations: 10,  // Allow full iterative reasoning (same as single-agent)
        executor: executor,  // Use shared executor
        sessionId: this.multiAgentSessionId,  // Pass sessionId for R process affinity
        onStep: (step) => {
          // Log steps for monitoring
          if (step.type === 'thinking') {
            console.log(`      [Iteration ${step.iteration}] ${step.message}`);
          } else if (step.type === 'code') {
            console.log(`      [Iteration ${step.iteration}] Generated ${step.code.length} chars of R code`);
          } else if (step.type === 'execution_success') {
            console.log(`      [Iteration ${step.iteration}] R execution successful`);
          } else if (step.type === 'execution_error') {
            console.log(`      [Iteration ${step.iteration}] Error: ${step.error?.substring(0, 100)}...`);
          }
        }
      });

      console.log(`      ✅ Biostat analysis complete in ${result.iterations} iterations`);

      // Transform result format for multi-agent compatibility
      return {
        // Core execution data
        rCode: result.fullCode,  // All executed code
        fullOutput: result.fullOutput,  // All R outputs
        executionIterations: result.iterations,
        executionSuccess: true,

        // Output files
        outputFiles: result.outputFiles || [],

        // Metadata for judges
        analysisMetadata: {
          codeLength: result.fullCode?.length || 0,
          outputLength: result.fullOutput?.length || 0,
          filesGenerated: (result.outputFiles || []).length,
          timestamp: new Date().toISOString(),
          agentIterations: result.iterations
        },

        // Final content (for reference)
        finalContent: result.finalContent
      };

    } catch (error) {
      console.error('❌ Real Biostat Coding Agent error:', error);

      // Return explicit failure
      return {
        success: false,
        error: error.message,
        errorType: 'EXECUTION_FAILURE',
        executionSuccess: false,

        // Explicit flags for downstream agents
        isRealAnalysis: false,
        requiresManualReview: true,

        // Keep error details for debugging
        note: `Biostat agent failed: ${error.message}`
      };
    }
  }


  async callClinicalJudgeAgent(stats, context, query) {
    // Call REAL Clinical Judge Agent with AI evaluation
    console.log('   🏥 Calling REAL Clinical Judge Agent...');

    // Log trace: Biostat Agent → Clinical Judge
    await this.logAgentTrace(
      'Biostat_Coding_Agent',
      'Clinical_Judge_Agent',
      'evaluation',
      'Sending analysis results to clinical judge for evaluation',
      {
        has_r_code: !!stats.rCode,
        has_output: !!stats.fullOutput,
        execution_success: !!stats.executionSuccess,
        files_count: stats.outputFiles?.length || 0
      }
    );

    const startTime = Date.now();

    try{
      // Prepare request for real agent with FULL CONTEXT
      const request = {
        analysisResults: stats,  // Keep extracted values for backward compatibility

        // ADD FULL EXECUTION CONTEXT (FIX 1):
        executionDetails: {
          rCode: stats.rCode || null,           // Actual R code executed
          fullOutput: stats.fullOutput || null, // Complete R execution output
          executionSuccess: !stats.error,
          iterations: stats.executionIterations || 0,
          outputFiles: stats.outputFiles || []
        },

        // FIX 6: ADD COMPLETE EXECUTION TRACE
        executionTrace: {
          currentIteration: this.currentIteration,
          executionHistory: this.executionHistory,  // All previous agent actions
          feedbackLoops: this.feedbackLoops,        // All feedback between agents
          query: query                              // Original user query
        },

        // ADD CLEAR ERROR FLAGGING:
        isRealAnalysis: !stats.error && !stats.note?.includes('fallback'),
        warnings: stats.error ? [stats.error] : [],

        context: {
          studyType: context.studyType || 'clinical_trial',
          population: context.population || 'general',
          adverseEvents: context.adverseEvents || { serious: 0, total: 0 },
          assumptionsRequired: context.assumptionsRequired || [],
          ...context
        },
        requirements: {
          mcid: context.mcid || 0.5,
          regulatory: context.regulatory || [],
          requiredAnalyses: context.requiredAnalyses || []
        }
      };

      // Call REAL agent's process method
      const agentResult = await clinicalJudgeAgent.process(request);

      if (!agentResult.success || !agentResult.result) {
        throw new Error('Clinical Judge Agent failed: ' + (agentResult.error || 'Unknown error'));
      }

      const evaluation = agentResult.result;

      // Extract and return structured result
      const result = {
        clinicallySignificant: evaluation.clinicalSignificance?.rating?.includes('significant') || false,
        interpretation: evaluation.judgment?.rationale || evaluation.clinicalSignificance?.explanation || 'Clinical evaluation completed',
        recommendations: (evaluation.recommendations || []).map(r => r.action || r),
        safetyAssessment: evaluation.safetyAssessment?.riskLevel || 'Unknown',
        approved: evaluation.judgment?.recommendation?.includes('Approve') || false,
        statisticalValidity: evaluation.statisticalValidity,
        protocolCompliance: evaluation.protocolCompliance,
        fullEvaluation: evaluation // Include full AI-generated evaluation
      };

      console.log(`      Clinical Score: ${evaluation.statisticalValidity?.score || 'N/A'}/100`);
      console.log(`      Significance: ${result.clinicallySignificant ? '✅' : '❌'}`);

      // Log trace: Clinical Judge completed evaluation
      const executionTime = Date.now() - startTime;
      const judgeScore = evaluation.statisticalValidity?.score || 0;

      await this.logAgentTrace(
        'Clinical_Judge_Agent',
        'PI_Agent',
        'evaluation',
        `Judge evaluation complete: Score ${judgeScore}/100, ${result.approved ? 'APPROVED' : 'NEEDS IMPROVEMENT'}`,
        {
          execution_time_ms: executionTime,
          score: judgeScore,
          approved: result.approved,
          clinically_significant: result.clinicallySignificant,
          safety_assessment: result.safetyAssessment
        }
      );

      // Update agent metrics
      await this.updateAgentMetrics(
        'Clinical_Judge_Agent',
        1, // one evaluation
        executionTime,
        result.approved ? 1.0 : 0.0,
        0, // tokens not tracked
        result.approved ? 0 : 1
      );

      return result;

    } catch (error) {
      console.error('❌ Real Clinical Judge Agent error:', error);
      // Fallback to basic evaluation if AI fails
      return {
        clinicallySignificant: stats.effectSize > 0.5,
        interpretation: 'Clinical Judge AI unavailable - using fallback logic',
        recommendations: ['Review results manually'],
        safetyAssessment: 'Unknown',
        approved: false,
        error: error.message
      };
    }
  }

  async callDataManagerAgent(stats, context, query) {
    // Call REAL Data Manager Agent with AI orchestration
    console.log('   📊 Calling REAL Data Manager Agent...');

    try {
      // Prepare request for real agent with FULL CONTEXT
      const request = {
        fileName: context.fileName || 'analysis_results.json',
        fileContent: JSON.stringify(stats, null, 2),
        analysisType: 'quality_assessment',

        // ADD FULL EXECUTION CONTEXT (FIX 1):
        executionDetails: {
          rCode: stats.rCode || null,           // R code shows data processing steps
          fullOutput: stats.fullOutput || null, // Full output may show data quality issues
          executionSuccess: !stats.error,
          datasetInfo: context.datasetInfo || null  // Reference to original dataset if available
        },

        // FIX 6: ADD COMPLETE EXECUTION TRACE
        executionTrace: {
          currentIteration: this.currentIteration,
          executionHistory: this.executionHistory,  // All previous agent actions
          feedbackLoops: this.feedbackLoops,        // All feedback between agents
          query: query                              // Original user query
        },

        // ADD CLEAR ERROR FLAGGING:
        isRealAnalysis: !stats.error && !stats.note?.includes('fallback'),
        warnings: stats.error ? [stats.error] : [],

        options: {
          query: query || 'Assess data quality and provide recommendations',
          clinicalContext: context,
          clinicalValidation: false // Don't need another clinical validation in data manager
        }
      };

      // Call REAL agent's process method
      const agentResult = await dataManagerAgent.process(request);

      if (!agentResult.success || !agentResult.result) {
        throw new Error('Data Manager Agent failed: ' + (agentResult.error || 'Unknown error'));
      }

      const analysis = agentResult.result;

      // Determine if reanalysis is needed based on classification and results
      const requiresReanalysis = stats.pValue > 0.05 ||
                                  analysis.classification?.confidence < 0.7 ||
                                  false; // Can be enhanced with more logic

      // Extract and return structured result
      const result = {
        dataQuality: analysis.classification?.domain || 'General',
        classification: analysis.classification,
        requiresReanalysis,
        recommendations: analysis.recommendation?.nextSteps || [],
        preprocessingApplied: true,
        workflow: analysis.workflow,
        fullAnalysis: analysis // Include full AI-generated analysis
      };

      console.log(`      Data Quality: ${result.dataQuality}`);
      console.log(`      Reanalysis Needed: ${requiresReanalysis ? '⚠️  Yes' : '✅ No'}`);

      return result;

    } catch (error) {
      console.error('❌ Real Data Manager Agent error:', error);
      // Fallback to basic evaluation if AI fails
      return {
        dataQuality: 'Unknown',
        requiresReanalysis: stats.pValue > 0.05,
        recommendations: ['Manual data review recommended'],
        preprocessingApplied: false,
        error: error.message
      };
    }
  }

  /**
   * Helper methods
   */
  detectIntent(query) {
    if (query.includes('clinical trial')) return 'clinical_trial_analysis';
    if (query.includes('power')) return 'power_analysis';
    if (query.includes('data')) return 'data_analysis';
    return 'general_analysis';
  }

  extractRequiredCapabilities(query) {
    const capabilities = [];
    if (query.includes('statistical') || query.includes('analysis')) {
      capabilities.push('statistical_analysis');
    }
    if (query.includes('clinical')) {
      capabilities.push('clinical_validation');
    }
    if (query.includes('data')) {
      capabilities.push('data_processing');
    }
    return capabilities.length > 0 ? capabilities : ['statistical_analysis'];
  }

  logExecution(agent, action, data) {
    this.executionHistory.push({
      timestamp: new Date().toISOString(),
      iteration: this.currentIteration,
      agent,
      action,
      data: typeof data === 'object' ? { ...data } : data
    });
  }

  logFeedbackLoop(fromAgent, toAgent, reason) {
    const loop = {
      timestamp: new Date().toISOString(),
      iteration: this.currentIteration,
      from: fromAgent,
      to: toAgent,
      reason
    };

    this.feedbackLoops.push(loop);
    console.log(`\n   🔄 FEEDBACK LOOP: ${fromAgent} → ${toAgent}`);
    console.log(`      Reason: ${reason}`);
  }

  /**
   * Simple hash function for code comparison
   * Used to detect if code changed between iterations
   */
  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36); // Convert to alphanumeric string
  }

  /**
   * Print execution summary
   */
  printExecutionSummary(result) {
    console.log('\n' + '═'.repeat(80));
    console.log('📊 EXECUTION SUMMARY');
    console.log('═'.repeat(80));

    console.log(`\nIterations: ${result.iterations}`);
    console.log(`Final Score: ${result.finalScore}/100`);
    console.log(`Success: ${result.success ? '✅' : '❌'}`);

    if (result.feedbackLoops.length > 0) {
      console.log(`\n🔄 Feedback Loops (${result.feedbackLoops.length}):`);
      result.feedbackLoops.forEach(loop => {
        console.log(`   ${loop.from} → ${loop.to}: ${loop.reason}`);
      });
    }

    console.log('\n📈 Score Progression:');
    let previousScore = 0;
    for (let i = 1; i <= result.iterations; i++) {
      const iterData = result.executionHistory.filter(h => h.iteration === i);
      if (iterData.length > 0) {
        const score = this.estimateScoreForIteration(iterData);
        const trend = score > previousScore ? '↗️' : score < previousScore ? '↘️' : '→';
        console.log(`   Iteration ${i}: ${score}/100 ${trend}`);
        previousScore = score;
      }
    }

    console.log('\n🤖 Agents Involved:');
    const agents = new Set();
    result.executionHistory.forEach(h => agents.add(h.agent));
    agents.forEach(agent => {
      const count = result.executionHistory.filter(h => h.agent === agent).length;
      console.log(`   ${agent}: ${count} actions`);
    });

    // PERFORMANCE: Print execution time summary
    this.printExecutionTimeSummary();
  }

  /**
   * Print execution time summary for performance monitoring
   */
  printExecutionTimeSummary() {
    console.log('\n⏱️ EXECUTION TIME SUMMARY:');
    console.log('─'.repeat(40));

    let totalTime = 0;
    const agentStats = {};

    // Calculate statistics for each agent
    Object.entries(this.executionTimes).forEach(([agent, times]) => {
      if (times.length > 0) {
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
        const maxTime = Math.max(...times);
        const minTime = Math.min(...times);
        const totalAgentTime = times.reduce((a, b) => a + b, 0);

        agentStats[agent] = {
          calls: times.length,
          avg: avgTime,
          max: maxTime,
          min: minTime,
          total: totalAgentTime
        };

        totalTime += totalAgentTime;
      }
    });

    // Print agent performance stats
    Object.entries(agentStats).forEach(([agent, stats]) => {
      console.log(`\n   ${agent}:`);
      console.log(`     Calls: ${stats.calls}`);
      console.log(`     Avg: ${(stats.avg/1000).toFixed(1)}s`);
      console.log(`     Min: ${(stats.min/1000).toFixed(1)}s`);
      console.log(`     Max: ${(stats.max/1000).toFixed(1)}s`);
      console.log(`     Total: ${(stats.total/1000).toFixed(1)}s`);
    });

    if (totalTime > 0) {
      console.log(`\n   Total Execution Time: ${(totalTime/1000).toFixed(1)}s`);

      // Check for performance issues
      if (totalTime > 120000) { // More than 2 minutes
        console.log(`\n   ⚠️ WARNING: Total execution time exceeded 2 minutes!`);
        console.log(`   Consider further optimization or timeout adjustments.`);
      }
    }
  }

  estimateScoreForIteration(iterData) {
    // Estimate score based on what was fixed
    let score = 40; // Base
    iterData.forEach(item => {
      if (item.data?.pValue && item.data.pValue < 0.05) score += 20;
      if (item.data?.effectSize && item.data.effectSize > 0.3) score += 20;
      if (item.data?.clinicallySignificant) score += 20;
    });
    return Math.min(100, score);
  }
}

export default AgentOrchestrationEngine;
export { AgentOrchestrationEngine };