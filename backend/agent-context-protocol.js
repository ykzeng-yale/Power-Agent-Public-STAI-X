/**
 * Agent Context Protocol (ACP)
 * Implements proper context passing, task refinement, and resource sharing
 * Following MCP-inspired patterns for multi-agent communication
 */

class AgentContextProtocol {
  constructor() {
    this.sessionState = new Map();
    this.sharedMemory = new Map();
    this.executionContext = {};
  }

  /**
   * Create a refined task with full context for the next agent
   */
  createRefinedTask(evaluation, previousResults, originalQuery, targetAgent) {
    const refinedTask = {
      // Task metadata
      taskId: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      targetAgent,
      originAgent: evaluation.evaluator,
      timestamp: new Date().toISOString(),
      iteration: previousResults.iteration || 1,

      // Refined query - specific to what needs fixing
      refinedQuery: this.generateRefinedQuery(evaluation, originalQuery, targetAgent),

      // Complete context
      context: {
        originalQuery,
        previousAttempts: previousResults.attempts || [],
        lastResults: previousResults.outputs,
        evaluationFeedback: evaluation,
        dataResources: previousResults.data || {},
        sharedMemory: this.getSharedMemory(targetAgent)
      },

      // Specific instructions
      instructions: this.generateSpecificInstructions(evaluation, targetAgent),

      // Resources to pass
      resources: {
        data: previousResults.rawData || null,
        preprocessedData: previousResults.preprocessedData || null,
        intermediateResults: previousResults.intermediateResults || {},
        errorLogs: previousResults.errors || [],
        visualizations: previousResults.visualizations || []
      },

      // Success criteria for this refined task
      successCriteria: this.defineSuccessCriteria(evaluation, targetAgent),

      // Constraints and parameters
      constraints: {
        maxExecutionTime: 30000, // 30 seconds
        requiredOutputs: this.getRequiredOutputs(targetAgent, evaluation),
        validationRules: this.getValidationRules(targetAgent)
      }
    };

    return refinedTask;
  }

  /**
   * Generate a refined, specific query for the target agent
   */
  generateRefinedQuery(evaluation, originalQuery, targetAgent) {
    const issues = evaluation.issues || [];
    const recommendations = evaluation.recommendations || [];

    switch (targetAgent) {
      case 'biostat-coding-agent':
        return this.refineBiostatQuery(issues, recommendations, originalQuery);

      case 'data-manager-agent':
        return this.refineDataManagerQuery(issues, recommendations, originalQuery);

      case 'clinical-judge-agent':
        return this.refineClinicalQuery(issues, recommendations, originalQuery);

      default:
        return originalQuery;
    }
  }

  /**
   * Refine query for Biostatistics Coding Agent
   */
  refineBiostatQuery(issues, recommendations, originalQuery) {
    let refinedQuery = `Re-analyze the data with the following improvements:\n`;

    // Add specific statistical issues to address
    if (issues.includes('Not statistically significant')) {
      refinedQuery += `- Previous p-value was > 0.05. Apply the following:\n`;
      refinedQuery += `  • Check for outliers and remove if justified\n`;
      refinedQuery += `  • Consider non-parametric tests if normality violated\n`;
      refinedQuery += `  • Increase statistical power through pooled analysis\n`;
    }

    if (issues.includes('Effect size too small')) {
      refinedQuery += `- Effect size was below clinical threshold. Actions:\n`;
      refinedQuery += `  • Calculate standardized effect sizes (Cohen's d, Hedge's g)\n`;
      refinedQuery += `  • Perform subgroup analysis to identify responders\n`;
      refinedQuery += `  • Check for confounding variables\n`;
    }

    if (issues.includes('Missing data not addressed')) {
      refinedQuery += `- Handle missing data properly:\n`;
      refinedQuery += `  • Implement multiple imputation (5+ imputations)\n`;
      refinedQuery += `  • Report missing data patterns\n`;
      refinedQuery += `  • Perform sensitivity analysis\n`;
    }

    refinedQuery += `\nOriginal request: ${originalQuery}`;
    return refinedQuery;
  }

  /**
   * Refine query for Data Manager Agent
   */
  refineDataManagerQuery(issues, recommendations, originalQuery) {
    let refinedQuery = `Investigate and fix data quality issues:\n`;

    if (issues.includes('Outliers not examined')) {
      refinedQuery += `- Outlier detection required:\n`;
      refinedQuery += `  • Use IQR method (1.5 * IQR beyond Q1/Q3)\n`;
      refinedQuery += `  • Apply Mahalanobis distance for multivariate outliers\n`;
      refinedQuery += `  • Document outliers found and rationale for handling\n`;
    }

    if (issues.includes('Data quality unknown')) {
      refinedQuery += `- Comprehensive data quality assessment:\n`;
      refinedQuery += `  • Check completeness (% missing per variable)\n`;
      refinedQuery += `  • Verify data types and ranges\n`;
      refinedQuery += `  • Identify duplicate records\n`;
      refinedQuery += `  • Validate against expected distributions\n`;
    }

    refinedQuery += `\nPrepare cleaned dataset for re-analysis.`;
    return refinedQuery;
  }

  /**
   * Refine query for Clinical Judge Agent
   */
  refineClinicalQuery(issues, recommendations, originalQuery) {
    let refinedQuery = `Provide clinical interpretation with focus on:\n`;

    if (issues.includes('Missing clinical interpretation')) {
      refinedQuery += `- Clinical significance assessment:\n`;
      refinedQuery += `  • Compare effect size to MCID (Minimal Clinically Important Difference)\n`;
      refinedQuery += `  • Evaluate clinical relevance regardless of p-value\n`;
      refinedQuery += `  • Consider patient-reported outcomes\n`;
    }

    if (issues.includes('Safety not assessed')) {
      refinedQuery += `- Safety evaluation:\n`;
      refinedQuery += `  • Review adverse events\n`;
      refinedQuery += `  • Calculate NNH (Number Needed to Harm)\n`;
      refinedQuery += `  • Risk-benefit analysis\n`;
    }

    return refinedQuery;
  }

  /**
   * Generate specific instructions for the target agent
   */
  generateSpecificInstructions(evaluation, targetAgent) {
    const instructions = {
      priority: 'high',
      steps: [],
      avoidActions: [],
      requiredChecks: []
    };

    // Add specific steps based on issues
    evaluation.issues?.forEach(issue => {
      if (issue.includes('p-value')) {
        instructions.steps.push('Recalculate p-values with appropriate corrections');
        instructions.requiredChecks.push('Verify test assumptions before applying');
      }

      if (issue.includes('outlier')) {
        instructions.steps.push('Identify and document all outliers');
        instructions.steps.push('Apply robust statistical methods if outliers retained');
      }

      if (issue.includes('missing')) {
        instructions.steps.push('Implement proper missing data handling');
        instructions.avoidActions.push('Do not use complete case analysis');
      }
    });

    // Add agent-specific instructions
    switch (targetAgent) {
      case 'biostat-coding-agent':
        instructions.requiredChecks.push('Test all statistical assumptions');
        instructions.requiredChecks.push('Report all effect sizes with CIs');
        break;

      case 'data-manager-agent':
        instructions.requiredChecks.push('Document all data transformations');
        instructions.requiredChecks.push('Preserve original data for comparison');
        break;

      case 'clinical-judge-agent':
        instructions.requiredChecks.push('Consider clinical context');
        instructions.requiredChecks.push('Evaluate practical significance');
        break;
    }

    return instructions;
  }

  /**
   * Define success criteria for the refined task
   */
  defineSuccessCriteria(evaluation, targetAgent) {
    const criteria = [];

    // General criteria
    if (evaluation.scores?.statistical < 60) {
      criteria.push({
        metric: 'statistical_validity',
        threshold: 80,
        required: true
      });
    }

    if (evaluation.scores?.clinical < 60) {
      criteria.push({
        metric: 'clinical_significance',
        threshold: 70,
        required: true
      });
    }

    // Agent-specific criteria
    switch (targetAgent) {
      case 'biostat-coding-agent':
        criteria.push({
          metric: 'p_value',
          threshold: 0.05,
          condition: 'less_than'
        });
        criteria.push({
          metric: 'effect_size',
          threshold: 0.3,
          condition: 'greater_than'
        });
        break;

      case 'data-manager-agent':
        criteria.push({
          metric: 'data_completeness',
          threshold: 95,
          condition: 'greater_than'
        });
        criteria.push({
          metric: 'outliers_handled',
          value: true,
          required: true
        });
        break;

      case 'clinical-judge-agent':
        criteria.push({
          metric: 'interpretation_provided',
          value: true,
          required: true
        });
        criteria.push({
          metric: 'recommendations_count',
          threshold: 2,
          condition: 'greater_than'
        });
        break;
    }

    return criteria;
  }

  /**
   * Get required outputs for the target agent
   */
  getRequiredOutputs(targetAgent, evaluation) {
    const outputs = {
      'biostat-coding-agent': [
        'p_values',
        'effect_sizes',
        'confidence_intervals',
        'test_assumptions',
        'r_code'
      ],
      'data-manager-agent': [
        'cleaned_data',
        'quality_report',
        'transformation_log',
        'outlier_report'
      ],
      'clinical-judge-agent': [
        'clinical_interpretation',
        'safety_assessment',
        'recommendations',
        'approval_status'
      ]
    };

    return outputs[targetAgent] || [];
  }

  /**
   * Get validation rules for the target agent
   */
  getValidationRules(targetAgent) {
    return {
      'biostat-coding-agent': [
        'p_values_between_0_and_1',
        'effect_sizes_with_direction',
        'confidence_intervals_include_estimate'
      ],
      'data-manager-agent': [
        'no_data_loss',
        'transformations_reversible',
        'outliers_documented'
      ],
      'clinical-judge-agent': [
        'interpretation_evidence_based',
        'recommendations_actionable',
        'safety_considered'
      ]
    }[targetAgent] || [];
  }

  /**
   * Store results in shared memory for future reference
   */
  storeInSharedMemory(agentId, key, value) {
    if (!this.sharedMemory.has(agentId)) {
      this.sharedMemory.set(agentId, new Map());
    }
    this.sharedMemory.get(agentId).set(key, value);
  }

  /**
   * Get shared memory for an agent
   */
  getSharedMemory(agentId) {
    return this.sharedMemory.get(agentId) || new Map();
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId, state) {
    this.sessionState.set(sessionId, {
      ...this.sessionState.get(sessionId),
      ...state,
      lastUpdated: new Date().toISOString()
    });
  }

  /**
   * Generate execution context for agent communication
   */
  generateExecutionContext(refinedTask, previousContext = {}) {
    return {
      // Preserve previous context
      ...previousContext,

      // Add new context
      taskId: refinedTask.taskId,
      refinedQuery: refinedTask.refinedQuery,
      instructions: refinedTask.instructions,
      resources: refinedTask.resources,
      constraints: refinedTask.constraints,
      successCriteria: refinedTask.successCriteria,

      // Execution metadata
      startTime: Date.now(),
      maxRetries: 3,
      timeout: refinedTask.constraints.maxExecutionTime,

      // Communication protocol
      protocol: {
        version: '1.0',
        format: 'json',
        encoding: 'utf-8'
      },

      // Callback information
      callback: {
        onSuccess: 'reportSuccess',
        onFailure: 'reportFailure',
        onProgress: 'reportProgress'
      }
    };
  }

  /**
   * Validate if task execution met success criteria
   */
  validateTaskExecution(results, successCriteria) {
    const validation = {
      success: true,
      failedCriteria: [],
      passedCriteria: []
    };

    successCriteria.forEach(criterion => {
      const value = this.extractMetricValue(results, criterion.metric);

      let passed = false;
      if (criterion.condition === 'less_than') {
        passed = value < criterion.threshold;
      } else if (criterion.condition === 'greater_than') {
        passed = value > criterion.threshold;
      } else if (criterion.value !== undefined) {
        passed = value === criterion.value;
      }

      if (passed) {
        validation.passedCriteria.push(criterion.metric);
      } else if (criterion.required) {
        validation.failedCriteria.push(criterion.metric);
        validation.success = false;
      }
    });

    return validation;
  }

  /**
   * Extract metric value from results
   */
  extractMetricValue(results, metric) {
    // Navigate nested results to find metric
    const paths = metric.split('_');
    let value = results;

    for (const path of paths) {
      if (value && typeof value === 'object') {
        value = value[path];
      }
    }

    return value;
  }
}

export default AgentContextProtocol;
export { AgentContextProtocol };