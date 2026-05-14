/**
 * PI (Planning & Inference) Orchestrator Agent
 * Top-level agent that routes user queries to appropriate specialized agents
 * Acts as the main entry point and decision maker for the multi-agent system
 */

import BaseAgent from './base-agent.js';
import agentRouter from './agent-router.js';
import agentRegistry from './agent-registry.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class PIOrchestrator extends BaseAgent {
  constructor() {
    super({
      id: 'pi-orchestrator',
      name: 'Planning & Inference Orchestrator',
      description: 'Top-level orchestrator that analyzes requests and coordinates agent execution',
      capabilities: [
        'query_analysis',
        'intent_classification',
        'workflow_planning',
        'agent_coordination',
        'success_evaluation',
        'error_recovery'
      ],
      model: 'claude-sonnet-4-6',
      maxIterations: 5, // Can retry failed workflows
      metadata: {
        version: '1.0',
        author: 'biostat-team',
        status: 'active'
      }
    });

    // Communication trace for monitoring
    this.communicationTrace = [];
    this.activeWorkflow = null;
  }

  /**
   * Validate input request
   */
  async validate(request) {
    if (!request.query && !request.task) {
      return {
        valid: false,
        reason: 'Missing query or task field'
      };
    }
    return { valid: true };
  }

  /**
   * Execute orchestration workflow
   */
  async execute(request) {
    const { query, context = {}, maxAgents = 5, enableTracing = true } = request;

    this.logTrace('START', 'PI Orchestrator', null, `Received query: "${query}"`);
    console.log(`\n${'='.repeat(80)}`);
    console.log('🧠 PI ORCHESTRATOR: Starting multi-agent workflow');
    console.log(`${'='.repeat(80)}`);
    console.log(`📝 User Query: "${query}"`);

    try {
      // Step 1: Analyze query and create execution plan
      const plan = await this.createExecutionPlan(query, context);
      this.logTrace('PLAN', 'PI Orchestrator', null, plan);
      console.log(`\n📋 Execution Plan Created:`);
      console.log(`   - Intent: ${plan.intent}`);
      console.log(`   - Required Capabilities: ${plan.requiredCapabilities.join(', ')}`);
      console.log(`   - Workflow Type: ${plan.workflowType}`);

      // Step 2: Execute the plan
      const executionResult = await this.executePlan(plan, query, context);
      this.logTrace('EXECUTION', 'PI Orchestrator', null, executionResult);

      // Step 3: Evaluate success
      const evaluation = await this.evaluateSuccess(
        query,
        plan,
        executionResult,
        context
      );
      this.logTrace('EVALUATION', 'PI Orchestrator', null, evaluation);

      // Step 4: Generate final response
      const finalResponse = await this.generateFinalResponse(
        query,
        plan,
        executionResult,
        evaluation
      );

      console.log(`\n${'='.repeat(80)}`);
      console.log('✅ WORKFLOW COMPLETED SUCCESSFULLY');
      console.log(`${'='.repeat(80)}\n`);

      // Return comprehensive result with trace
      return {
        success: evaluation.success,
        response: finalResponse,
        plan,
        executionResult,
        evaluation,
        communicationTrace: enableTracing ? this.communicationTrace : null,
        metrics: {
          totalAgentsUsed: executionResult.agentsUsed.length,
          totalDuration: this.calculateTotalDuration(),
          iterationsUsed: executionResult.iterations || 1
        }
      };

    } catch (error) {
      this.logTrace('ERROR', 'PI Orchestrator', null, error.message);
      console.error(`\n❌ WORKFLOW FAILED: ${error.message}`);

      // Attempt error recovery
      const recovery = await this.attemptErrorRecovery(error, query, context);

      return {
        success: false,
        error: error.message,
        recovery,
        communicationTrace: enableTracing ? this.communicationTrace : null
      };
    }
  }

  /**
   * Create execution plan based on query analysis
   */
  async createExecutionPlan(query, context) {
    const prompt = `Analyze this user query and create an execution plan:

Query: "${query}"
Context: ${JSON.stringify(context)}

Determine:
1. Primary intent (statistical_analysis, clinical_validation, data_processing, report_generation, etc.)
2. Required capabilities (list all needed)
3. Workflow type (sequential, parallel, iterative)
4. Success criteria (what constitutes successful completion)
5. Potential challenges or edge cases

Return as JSON:
{
  "intent": "...",
  "requiredCapabilities": ["..."],
  "workflowType": "...",
  "successCriteria": ["..."],
  "challenges": ["..."],
  "estimatedComplexity": "low|medium|high"
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 800,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const content = response.content[0].text;
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback plan
      return {
        intent: 'general_analysis',
        requiredCapabilities: ['data_analysis'],
        workflowType: 'sequential',
        successCriteria: ['Analysis completed'],
        challenges: [],
        estimatedComplexity: 'medium'
      };

    } catch (error) {
      console.error('Plan creation error:', error);
      return {
        intent: 'unknown',
        requiredCapabilities: ['data_analysis'],
        workflowType: 'sequential',
        successCriteria: ['Task completed'],
        challenges: ['Plan creation failed'],
        estimatedComplexity: 'high'
      };
    }
  }

  /**
   * Execute the plan by coordinating agents
   */
  async executePlan(plan, query, context) {
    const { workflowType, requiredCapabilities } = plan;
    const agentsUsed = [];
    const results = [];
    let iterations = 0;

    console.log(`\n🚀 Executing ${workflowType} workflow...`);

    switch (workflowType) {
      case 'sequential':
        return await this.executeSequentialWorkflow(
          requiredCapabilities,
          query,
          context,
          plan
        );

      case 'parallel':
        return await this.executeParallelWorkflow(
          requiredCapabilities,
          query,
          context,
          plan
        );

      case 'iterative':
        return await this.executeIterativeWorkflow(
          requiredCapabilities,
          query,
          context,
          plan
        );

      default:
        return await this.executeSequentialWorkflow(
          requiredCapabilities,
          query,
          context,
          plan
        );
    }
  }

  /**
   * Execute sequential workflow
   */
  async executeSequentialWorkflow(capabilities, query, context, plan) {
    const results = [];
    const agentsUsed = [];

    for (const capability of capabilities) {
      // Find best agent for this capability
      const routingDecision = await agentRouter.route({
        capabilities: [capability],
        query,
        context
      });

      if (!routingDecision.success) {
        this.logTrace('ROUTING_FAILED', 'Router', 'PI Orchestrator',
          `No agent found for ${capability}`);
        continue;
      }

      const agent = routingDecision.agent;
      agentsUsed.push(agent.id);

      // Log communication
      this.logTrace('ROUTE', 'PI Orchestrator', agent.name,
        `Routing to ${agent.name} for ${capability}`);

      console.log(`\n   → Delegating to ${agent.name}...`);

      // Simulate agent execution
      const agentResult = await this.simulateAgentExecution(
        agent,
        query,
        context,
        results
      );

      results.push({
        agentId: agent.id,
        capability,
        result: agentResult
      });

      // Log result
      this.logTrace('RESULT', agent.name, 'PI Orchestrator', agentResult);

      // Update context with results for next agent
      context.previousResults = results;
    }

    return {
      type: 'sequential',
      agentsUsed,
      results,
      iterations: 1
    };
  }

  /**
   * Execute parallel workflow
   */
  async executeParallelWorkflow(capabilities, query, context, plan) {
    console.log(`\n   ⚡ Executing ${capabilities.length} agents in parallel...`);

    const parallelTasks = capabilities.map(async (capability) => {
      const routingDecision = await agentRouter.route({
        capabilities: [capability],
        query,
        context
      });

      if (!routingDecision.success) {
        return { capability, error: 'No agent found' };
      }

      const agent = routingDecision.agent;
      this.logTrace('ROUTE_PARALLEL', 'PI Orchestrator', agent.name,
        `Parallel route to ${agent.name}`);

      const result = await this.simulateAgentExecution(
        agent,
        query,
        context,
        []
      );

      this.logTrace('RESULT_PARALLEL', agent.name, 'PI Orchestrator', result);

      return {
        agentId: agent.id,
        capability,
        result
      };
    });

    const results = await Promise.all(parallelTasks);
    const agentsUsed = results
      .filter(r => r.agentId)
      .map(r => r.agentId);

    return {
      type: 'parallel',
      agentsUsed,
      results,
      iterations: 1
    };
  }

  /**
   * Execute iterative workflow with refinement
   */
  async executeIterativeWorkflow(capabilities, query, context, plan) {
    let results = [];
    let agentsUsed = new Set();
    let iteration = 0;
    const maxIterations = 3;
    let satisfied = false;

    console.log(`\n   🔄 Starting iterative workflow (max ${maxIterations} iterations)...`);

    while (!satisfied && iteration < maxIterations) {
      iteration++;
      console.log(`\n   Iteration ${iteration}:`);

      // Execute agents for this iteration
      const iterationResult = await this.executeSequentialWorkflow(
        capabilities,
        query,
        { ...context, iteration, previousResults: results },
        plan
      );

      // Add to overall results
      results = results.concat(iterationResult.results);
      iterationResult.agentsUsed.forEach(id => agentsUsed.add(id));

      // Check if success criteria met
      satisfied = await this.checkSuccessCriteria(
        plan.successCriteria,
        results,
        query
      );

      this.logTrace('ITERATION', 'PI Orchestrator', null,
        `Iteration ${iteration} - Satisfied: ${satisfied}`);

      if (satisfied) {
        console.log(`   ✓ Success criteria met after ${iteration} iterations`);
      }
    }

    return {
      type: 'iterative',
      agentsUsed: Array.from(agentsUsed),
      results,
      iterations: iteration
    };
  }

  /**
   * Simulate agent execution (in real system, would call actual agent)
   */
  async simulateAgentExecution(agent, query, context, previousResults) {
    // Simulate different agent responses based on type
    const simulations = {
      'biostat-coding-agent': {
        analysis: 'Statistical analysis completed',
        code: 'R code executed successfully',
        results: {
          pValue: 0.023,
          effectSize: 0.45,
          sampleSize: 120,
          power: 0.82
        }
      },
      'clinical-judge-agent': {
        validation: 'Clinical validation completed',
        clinicalSignificance: true,
        safetyAssessment: 'Low risk',
        recommendation: 'Approve with monitoring'
      },
      'data-manager-agent': {
        classification: 'Data file',
        quality: 'Good',
        preprocessing: 'Completed',
        readyForAnalysis: true
      },
      'report-generator-agent': {
        report: 'Report generated',
        format: 'PDF',
        sections: ['Summary', 'Methods', 'Results', 'Conclusions']
      }
    };

    // Add processing delay to simulate work
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));

    return simulations[agent.id] || {
      status: 'completed',
      message: `${agent.name} processed successfully`
    };
  }

  /**
   * Check if success criteria are met
   */
  async checkSuccessCriteria(criteria, results, query) {
    // Simple check - in real system would be more sophisticated
    if (results.length === 0) return false;

    // Check if we have results from key agents
    const hasStatisticalAnalysis = results.some(r =>
      r.result?.analysis?.includes('Statistical')
    );
    const hasClinicalValidation = results.some(r =>
      r.result?.validation?.includes('Clinical')
    );

    // For clinical queries, need both
    if (query.toLowerCase().includes('clinical')) {
      return hasStatisticalAnalysis && hasClinicalValidation;
    }

    // For general queries, statistical analysis is enough
    return hasStatisticalAnalysis;
  }

  /**
   * Evaluate overall success
   */
  async evaluateSuccess(query, plan, executionResult, context) {
    const evaluation = {
      success: false,
      confidence: 0,
      completeness: 0,
      issues: [],
      strengths: []
    };

    // Check if required agents were used
    if (executionResult.agentsUsed.length > 0) {
      evaluation.strengths.push(`${executionResult.agentsUsed.length} agents successfully engaged`);
      evaluation.completeness += 30;
    }

    // Check if results were obtained
    if (executionResult.results.length > 0) {
      evaluation.strengths.push('All agents returned results');
      evaluation.completeness += 30;
    }

    // Check for errors
    const errors = executionResult.results.filter(r => r.error);
    if (errors.length > 0) {
      evaluation.issues.push(`${errors.length} agents reported errors`);
      evaluation.completeness -= 20;
    }

    // Check success criteria
    const criteriaMap = await this.checkSuccessCriteria(
      plan.successCriteria,
      executionResult.results,
      query
    );

    if (criteriaMap) {
      evaluation.strengths.push('Success criteria met');
      evaluation.completeness += 40;
    }

    // Calculate final metrics
    evaluation.completeness = Math.max(0, Math.min(100, evaluation.completeness));
    evaluation.confidence = evaluation.completeness / 100;
    evaluation.success = evaluation.completeness >= 60;

    console.log(`\n📊 Evaluation Results:`);
    console.log(`   - Success: ${evaluation.success ? '✅' : '❌'}`);
    console.log(`   - Confidence: ${(evaluation.confidence * 100).toFixed(0)}%`);
    console.log(`   - Completeness: ${evaluation.completeness}%`);

    return evaluation;
  }

  /**
   * Generate final response
   */
  async generateFinalResponse(query, plan, executionResult, evaluation) {
    const response = {
      summary: '',
      details: [],
      recommendations: [],
      nextSteps: []
    };

    // Generate summary based on results
    if (evaluation.success) {
      response.summary = `Successfully completed analysis for: "${query}". ` +
        `${executionResult.agentsUsed.length} specialized agents collaborated to provide comprehensive results.`;
    } else {
      response.summary = `Partially completed analysis for: "${query}". ` +
        `Some challenges were encountered but useful insights were obtained.`;
    }

    // Add details from each agent
    executionResult.results.forEach(r => {
      if (r.result && !r.error) {
        response.details.push({
          agent: r.agentId,
          capability: r.capability,
          keyFindings: r.result
        });
      }
    });

    // Add recommendations based on agent results
    if (executionResult.results.some(r => r.result?.recommendation)) {
      response.recommendations = executionResult.results
        .filter(r => r.result?.recommendation)
        .map(r => r.result.recommendation);
    }

    // Suggest next steps
    if (evaluation.completeness < 100) {
      response.nextSteps.push('Consider running additional analyses for complete coverage');
    }
    if (plan.estimatedComplexity === 'high') {
      response.nextSteps.push('Review results with domain expert');
    }

    return response;
  }

  /**
   * Attempt error recovery
   */
  async attemptErrorRecovery(error, query, context) {
    console.log('\n🔧 Attempting error recovery...');

    // Try simpler workflow
    const fallbackPlan = {
      intent: 'basic_analysis',
      requiredCapabilities: ['data_analysis'],
      workflowType: 'sequential',
      successCriteria: ['Any result obtained'],
      estimatedComplexity: 'low'
    };

    try {
      const recoveryResult = await this.executePlan(fallbackPlan, query, context);
      return {
        recovered: true,
        result: recoveryResult,
        message: 'Executed simplified workflow'
      };
    } catch (recoveryError) {
      return {
        recovered: false,
        message: 'Recovery failed: ' + recoveryError.message
      };
    }
  }

  /**
   * Log communication trace
   */
  logTrace(eventType, from, to, message) {
    const trace = {
      timestamp: new Date().toISOString(),
      eventType,
      from,
      to,
      message,
      sequenceNumber: this.communicationTrace.length + 1
    };

    this.communicationTrace.push(trace);

    // Visual logging for monitoring
    const arrow = to ? `→ ${to}` : '';
    const prefix = {
      'START': '🚀',
      'PLAN': '📋',
      'ROUTE': '🔄',
      'EXECUTION': '⚙️',
      'RESULT': '📊',
      'EVALUATION': '✅',
      'ERROR': '❌',
      'ITERATION': '🔁'
    }[eventType] || '📝';

    console.log(`   ${prefix} [${from}] ${arrow}: ${
      typeof message === 'string' ? message : JSON.stringify(message).substring(0, 100)
    }`);
  }

  /**
   * Calculate total workflow duration
   */
  calculateTotalDuration() {
    if (this.communicationTrace.length < 2) return 0;

    const start = new Date(this.communicationTrace[0].timestamp);
    const end = new Date(this.communicationTrace[this.communicationTrace.length - 1].timestamp);

    return (end - start) / 1000; // Duration in seconds
  }

  /**
   * Get communication summary
   */
  getCommunicationSummary() {
    const summary = {
      totalEvents: this.communicationTrace.length,
      eventTypes: {},
      agentInteractions: {},
      duration: this.calculateTotalDuration()
    };

    // Count event types
    this.communicationTrace.forEach(trace => {
      summary.eventTypes[trace.eventType] =
        (summary.eventTypes[trace.eventType] || 0) + 1;

      // Count agent interactions
      if (trace.from && trace.to) {
        const interaction = `${trace.from} → ${trace.to}`;
        summary.agentInteractions[interaction] =
          (summary.agentInteractions[interaction] || 0) + 1;
      }
    });

    return summary;
  }
}

// Export singleton instance
const piOrchestrator = new PIOrchestrator();

export default piOrchestrator;
export { PIOrchestrator };