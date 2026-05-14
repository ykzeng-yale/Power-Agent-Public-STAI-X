/**
 * PI Agent Orchestrator
 * Central orchestrator that uses Claude API for intelligent task breakdown,
 * feedback evaluation, and dynamic agent routing
 */

import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class PIAgentOrchestrator {
  constructor() {
    this.model = 'claude-sonnet-4-6';  // Sonnet 4.6 for orchestration
  }

  /**
   * Extract JSON from Claude response
   */
  extractJSON(content) {
    if (Array.isArray(content)) {
      const textBlock = content.find(block => block.type === 'text');
      if (textBlock) content = textBlock.text;
    }

    // Try to find JSON in code blocks
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[1]);
    }

    // Try to find JSON directly
    const directMatch = content.match(/\{[\s\S]*\}/);
    if (directMatch) {
      return JSON.parse(directMatch[0]);
    }

    throw new Error('No valid JSON found in response');
  }

  /**
   * Analyze user query and break it down into specific tasks
   */
  async analyzeAndBreakdown(query, context) {
    console.log('   🧠 PI Agent: Analyzing query and breaking down into tasks...');

    const hasDataset = !!(context.dataset || context.datasetInfo ||
                          context.uploadedFiles?.length > 0 ||
                          context.files?.length > 0);

    const prompt = `You are the PI (Planning/Inference) Agent, the central orchestrator for a multi-agent biostatistics system.

ANALYZE this user query and BREAK IT DOWN into specific tasks that need to be executed.

User Query: "${query}"

Context:
- Has Dataset: ${hasDataset}
- Study Type: ${context.studyType || 'not specified'}
- Additional Context: ${JSON.stringify(context, null, 2)}

Available Agents:
1. biostat_coding_agent: Generates and executes R code for statistical analysis (runs on Cloud Run, ~90s)
2. clinical_judge_agent: Validates clinical appropriateness and statistical rigor (Claude API, ~15s)
3. data_manager_agent: Handles data quality assessment (Claude API, ~15s, only if dataset provided)

CRITICAL RULES:
1. If you create a biostat_coding_agent task, you MUST create a clinical_judge_agent task immediately after
2. Clinical validation is MANDATORY for ALL statistical analyses - no exceptions
3. Clinical judge task must have HIGH or CRITICAL priority
4. Data manager is optional (only if user provided a dataset)

YOUR JOB:
1. Understand what the user wants
2. Determine which agents are needed and in what order
3. ALWAYS include clinical_judge_agent if biostat_coding_agent is used
4. Skip data_manager if no dataset provided
5. Prioritize tasks (HIGH/MEDIUM/LOW)

RESPONSE FORMAT (JSON only, no other text):
{
  "understanding": "Brief summary of what user wants (1-2 sentences)",
  "tasks": [
    {
      "id": "task-1",
      "type": "statistical_analysis",
      "agent": "biostat_coding_agent",
      "priority": "HIGH",
      "description": "What this task needs to accomplish",
      "requires_cloud_run": true,
      "estimated_duration": "90s"
    },
    {
      "id": "task-2",
      "type": "clinical_validation",
      "agent": "clinical_judge_agent",
      "priority": "MEDIUM",
      "description": "What validation is needed",
      "requires_cloud_run": false,
      "estimated_duration": "15s"
    }
  ],
  "skip_agents": ["list of agents to skip"],
  "skip_reason": "Why these agents are skipped",
  "parallel_execution_possible": false,
  "reasoning": "Step-by-step explanation of your plan"
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,  // Maximum for Claude Sonnet 4
        messages: [{ role: 'user', content: prompt }]
      });

      const plan = this.extractJSON(response.content);
      console.log(`      ✓ PI Agent created ${plan.tasks.length} tasks`);
      return plan;

    } catch (error) {
      console.error('❌ PI Agent breakdown error:', error);
      // Fallback to simple plan
      return this.createFallbackPlan(query, hasDataset);
    }
  }

  /**
   * Evaluate feedback from a task execution
   * ENHANCED: Now detects structured judge feedback and generates remediation tasks
   */
  async evaluateFeedback(taskResult, originalQuery, executionHistory) {
    console.log('   🧠 PI Agent: Evaluating task result...');

    // INTELLIGENT FEEDBACK DETECTION: Check if this is structured judge feedback
    if (taskResult.judgment && taskResult.suggestions && Array.isArray(taskResult.suggestions)) {
      console.log('   🎯 INTELLIGENT FEEDBACK DETECTED!');
      console.log(`      → Judgment: ${taskResult.judgment}`);
      console.log(`      → Issues: ${taskResult.issues?.length || 0}`);
      console.log(`      → Suggestions: ${taskResult.suggestions.length}`);
      console.log(`      → Confidence: ${taskResult.confidence || 'N/A'}`);

      // Generate remediation tasks from structured suggestions
      const remediationTasks = this.generateRemediationTasks(
        { ...taskResult, agentType: taskResult.agentType || 'clinical_judge' },
        { id: 'current-task', agent: 'biostat_coding_agent' },
        originalQuery
      );

      // Return structured evaluation with remediation tasks
      return {
        task_success: taskResult.judgment === 'PASS',
        output_complete: taskResult.judgment === 'PASS',
        issues_found: (taskResult.issues || []).map(i => i.description),
        next_action: {
          type: remediationTasks.length > 0 ? 'ADD_REMEDIATION_TASKS' : 'APPROVE',
          tasks: remediationTasks,
          reason: taskResult.summary || `Judge returned ${taskResult.judgment}`,
          instructions: remediationTasks.length > 0
            ? `Execute ${remediationTasks.length} remediation task(s) to address judge feedback`
            : 'Analysis meets all quality criteria'
        },
        confidence: taskResult.confidence || 0.8,
        reasoning: taskResult.reasoning || taskResult.summary,
        structured_feedback: taskResult // Preserve full structured feedback
      };
    }

    // LEGACY MODE: Use LLM-based evaluation for non-structured feedback
    console.log('   📋 Using LLM-based evaluation (legacy mode)');

    // Pass FULL content - no truncation
    const rCodeLength = taskResult.rCode ? taskResult.rCode.length : 0;
    const outputLength = taskResult.fullOutput ? taskResult.fullOutput.length : 0;

    const prompt = `You are the PI Agent. Evaluate the result from a sub-agent execution.

Original User Query: "${originalQuery}"

Task Executed: ${taskResult.taskType || 'unknown'}
Agent: ${taskResult.agent || 'unknown'}

Task Result Summary:
- Success: ${taskResult.executionSuccess || taskResult.success || false}
- Has Output: ${!!(taskResult.fullOutput || taskResult.output)}
- Has R Code: ${!!taskResult.rCode}
- R Code Length: ${rCodeLength} characters
- Output Length: ${outputLength} characters
- Output Files: ${(taskResult.outputFiles || []).length} files
- Iterations Completed: ${taskResult.executionIterations || taskResult.iterations || 0}
- Error: ${taskResult.error || 'none'}

FULL R CODE:
\`\`\`r
${taskResult.rCode || 'none'}
\`\`\`

FULL OUTPUT:
\`\`\`
${taskResult.fullOutput || 'none'}
\`\`\`

Execution History (${executionHistory.length} previous actions):
${JSON.stringify(executionHistory.slice(-3), null, 2)}

EVALUATE:
1. Did this task execute successfully? (R code ran without error?)
2. Does the output contain reasonable statistical results?
3. Are there CRITICAL issues that prevent answering the query?

⚠️ **IMPORTANT EVALUATION CRITERIA:**
- If R code executed successfully AND produced output, APPROVE unless there's a CRITICAL error
- Don't reject for minor issues like "could be more detailed" or "missing plots"
- The biostat agent already iterated multiple times - trust its work
- Only REJECT if there's NO output, NO R code, or FATAL errors

DECISIONS:
- APPROVE: R code executed successfully with reasonable output (USE THIS MOST OF THE TIME!)
- ROUTE_TO_AGENT: Only if you need clinical validation (very rare)
- RERUN_WITH_FIXES: Only for FATAL errors (code didn't run at all)
- REQUEST_MANUAL_REVIEW: Only for truly impossible tasks

✅ **Default to APPROVE if:**
- Success = true
- Has R code (rCodeLength > 0)
- Has output (outputLength > 0)
- No fatal error

RESPONSE FORMAT (JSON only):
{
  "task_success": true/false,
  "output_complete": true/false,
  "issues_found": ["list of specific issues, if any"],
  "next_action": {
    "type": "APPROVE" | "ROUTE_TO_AGENT" | "RERUN_WITH_FIXES" | "REQUEST_MANUAL_REVIEW",
    "agent": "agent_name (if routing to agent)",
    "reason": "brief explanation",
    "instructions": "specific guidance for next step"
  },
  "confidence": 0.9,
  "reasoning": "detailed step-by-step explanation"
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,  // Maximum for Claude Sonnet 4
        messages: [{ role: 'user', content: prompt }]
      });

      const evaluation = this.extractJSON(response.content);
      console.log(`      ✓ PI Agent: ${evaluation.next_action.type}`);
      return evaluation;

    } catch (error) {
      console.error('❌ PI Agent evaluation error:', error);
      // Fallback evaluation
      return {
        task_success: !!taskResult.executionSuccess,
        output_complete: !!(taskResult.fullOutput || taskResult.output),
        issues_found: taskResult.error ? [taskResult.error] : [],
        next_action: {
          type: taskResult.error ? 'REQUEST_MANUAL_REVIEW' : 'APPROVE',
          reason: 'Fallback evaluation due to PI Agent error',
          instructions: 'Manual review recommended'
        },
        confidence: 0.5,
        reasoning: 'Fallback evaluation used'
      };
    }
  }

  /**
   * Decide the next step based on current workflow state
   */
  async decideNextStep(currentState, evaluation) {
    console.log('   🧠 PI Agent: Deciding next step...');

    const prompt = `You are the PI Agent. Based on the current workflow state and evaluation, decide the next step.

Current Workflow State:
- Completed Tasks: ${currentState.completedTasks.length}
- Pending Tasks: ${currentState.pendingTasks.length}
- Current Iteration: ${currentState.iteration}
- Issues Found: ${currentState.issues.join(', ') || 'none'}

Latest Evaluation:
${JSON.stringify(evaluation, null, 2)}

Pending Tasks Queue:
${JSON.stringify(currentState.pendingTasks.map(t => ({ id: t.id, agent: t.agent, description: t.description })), null, 2)}

DECIDE what to do next:
- CONTINUE: Execute the next pending task
- COMPLETE: Workflow is done, all requirements met
- ABORT: Critical issue, cannot proceed
- ADD_TASK: Need to add a new task to the queue

RESPONSE FORMAT (JSON only):
{
  "decision": "CONTINUE" | "COMPLETE" | "ABORT" | "ADD_TASK",
  "next_task": {
    "id": "task-X",
    "type": "task_type",
    "agent": "agent_name",
    "priority": "HIGH/MEDIUM/LOW",
    "description": "what this task should do",
    "instructions": "specific instructions based on feedback"
  },
  "reasoning": "why this decision makes sense"
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 8192,  // Maximum for Claude Sonnet 4
        messages: [{ role: 'user', content: prompt }]
      });

      const decision = this.extractJSON(response.content);
      console.log(`      ✓ PI Agent decision: ${decision.decision}`);
      return decision;

    } catch (error) {
      console.error('❌ PI Agent decision error:', error);
      // Fallback decision
      return {
        decision: currentState.pendingTasks.length > 0 ? 'CONTINUE' : 'COMPLETE',
        reasoning: 'Fallback decision due to PI Agent error'
      };
    }
  }

  /**
   * Generate targeted remediation tasks from judge feedback
   * INTELLIGENT FEEDBACK-DRIVEN SUBTASK GENERATION
   */
  generateRemediationTasks(judgeResult, originalTask, query) {
    console.log('   🧠 PI Agent: Analyzing judge feedback for remediation tasks...');

    // Check if judge provided structured feedback with suggestions
    if (!judgeResult.suggestions || judgeResult.suggestions.length === 0) {
      console.log('      → No structured suggestions found, no remediation tasks generated');
      return [];
    }

    console.log(`      → Found ${judgeResult.suggestions.length} suggestions from ${judgeResult.agentType || 'judge'}`);

    const remediationTasks = [];

    // Process each suggestion and create targeted remediation task
    judgeResult.suggestions.forEach((suggestion, index) => {
      const issue = judgeResult.issues?.[suggestion.issue_index] || {};

      // Determine target agent based on suggestion action type
      let targetAgent = originalTask.agent || 'biostat_coding_agent';
      if (suggestion.action === 'clinical_review' || suggestion.action === 'validate_assumptions') {
        targetAgent = 'clinical_judge_agent';
      } else if (suggestion.action === 'check_data_quality' || suggestion.action === 'verify_data') {
        targetAgent = 'data_manager_agent';
      } else if (suggestion.action.includes('code') || suggestion.action.includes('analysis') || suggestion.action.includes('output')) {
        targetAgent = 'biostat_coding_agent';
      }

      // Create remediation task with detailed instructions from judge
      const remediationTask = {
        id: `${originalTask.id}-remediation-${index + 1}`,
        type: `remediation_${suggestion.action}`,
        agent: targetAgent,
        priority: suggestion.priority || 'HIGH',
        description: suggestion.description,

        // CRITICAL: Include judge's specific instructions
        instructions: `REMEDIATION TASK (from ${judgeResult.agentType || 'judge'})

ISSUE IDENTIFIED:
Type: ${issue.type || 'unspecified'}
Severity: ${issue.severity || 'HIGH'}
Description: ${issue.description || 'See suggestion'}
Location: ${issue.location || 'N/A'}
Evidence: ${issue.evidence || 'N/A'}

REQUIRED FIX:
${suggestion.specificInstructions || suggestion.description}

EXPECTED OUTCOME:
${suggestion.expectedOutcome || 'Issue resolved'}

ORIGINAL QUERY:
${query}`,

        // Metadata for tracking
        parentTask: originalTask.id,
        remediationFor: {
          issue_type: issue.type,
          issue_severity: issue.severity,
          issue_index: suggestion.issue_index,
          suggestion_action: suggestion.action,
          judge_agent: judgeResult.agentType || 'unknown'
        },
        metadata: {
          is_remediation: true,
          original_issue: issue,
          judge_suggestion: suggestion,
          judge_confidence: judgeResult.confidence || 0.8
        }
      };

      remediationTasks.push(remediationTask);
      console.log(`      ✓ Created remediation task: ${remediationTask.id}`);
      console.log(`        → Agent: ${targetAgent}, Priority: ${remediationTask.priority}`);
      console.log(`        → Action: ${suggestion.action}`);
    });

    return remediationTasks;
  }

  /**
   * Fallback plan when PI Agent API fails
   */
  createFallbackPlan(query, hasDataset) {
    console.log('      ⚠️  Using fallback plan (PI Agent unavailable)');

    const tasks = [
      {
        id: 'task-1',
        type: 'statistical_analysis',
        agent: 'biostat_coding_agent',
        priority: 'HIGH',
        description: 'Execute statistical analysis',
        requires_cloud_run: true,
        estimated_duration: '90s'
      },
      {
        id: 'task-2',
        type: 'clinical_validation',
        agent: 'clinical_judge_agent',
        priority: 'MEDIUM',
        description: 'Validate clinical appropriateness',
        requires_cloud_run: false,
        estimated_duration: '15s'
      }
    ];

    if (hasDataset) {
      tasks.splice(1, 0, {
        id: 'task-1.5',
        type: 'data_quality',
        agent: 'data_manager_agent',
        priority: 'HIGH',
        description: 'Assess data quality',
        requires_cloud_run: false,
        estimated_duration: '15s'
      });
    }

    return {
      understanding: 'Statistical analysis requested (fallback plan)',
      tasks: tasks,
      skip_agents: hasDataset ? [] : ['data_manager_agent'],
      skip_reason: hasDataset ? '' : 'No dataset provided',
      parallel_execution_possible: false,
      reasoning: 'Simple sequential workflow (fallback)'
    };
  }
}

export default PIAgentOrchestrator;
