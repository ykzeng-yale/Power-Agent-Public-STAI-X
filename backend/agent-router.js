/**
 * Agent Router
 * Intelligent routing system that matches requests to agents based on capabilities
 * Uses the agent registry for discovery and capability matching
 */

import agentRegistry from './agent-registry.js';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class AgentRouter {
  constructor() {
    this.registry = agentRegistry;
    this.routingHistory = new Map();
    this.routingMetrics = {
      totalRoutes: 0,
      successfulRoutes: 0,
      failedRoutes: 0,
      routesByAgent: new Map()
    };
  }

  /**
   * Route a request to the most appropriate agent
   */
  async route(request) {
    console.log('🚦 Agent Router: Processing request...');
    const startTime = Date.now();
    this.routingMetrics.totalRoutes++;

    try {
      // Step 1: Analyze request to determine required capabilities
      const requiredCapabilities = await this.analyzeRequest(request);
      console.log(`   📋 Required capabilities: ${requiredCapabilities.join(', ')}`);

      // Step 2: Find matching agents
      const candidates = this.registry.matchAgent({
        capabilities: requiredCapabilities,
        inputFormat: request.inputFormat,
        outputFormat: request.outputFormat
      });

      if (candidates.length === 0) {
        throw new Error(`No agents found for capabilities: ${requiredCapabilities.join(', ')}`);
      }

      // Step 3: Score and rank agents
      const scoredAgents = this.scoreAgents(candidates, requiredCapabilities, request);
      console.log(`   🔍 Found ${scoredAgents.length} candidate agents`);

      // Step 4: Select best agent
      const selectedAgent = scoredAgents[0];
      console.log(`   ✅ Selected agent: ${selectedAgent.agent.name} (score: ${selectedAgent.score.toFixed(2)})`);

      // Step 5: Record routing decision
      this.recordRoutingDecision(request, selectedAgent, requiredCapabilities);

      // Step 6: Return routing decision
      this.routingMetrics.successfulRoutes++;
      return {
        success: true,
        agent: selectedAgent.agent,
        reasoning: selectedAgent.reasoning,
        score: selectedAgent.score,
        alternatives: scoredAgents.slice(1).map(s => ({
          agent: s.agent.name,
          score: s.score
        })),
        routingTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('❌ Routing error:', error);
      this.routingMetrics.failedRoutes++;

      return {
        success: false,
        error: error.message,
        routingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Analyze request to determine required capabilities
   */
  async analyzeRequest(request) {
    // If capabilities are explicitly provided, use them
    if (request.capabilities && Array.isArray(request.capabilities)) {
      return request.capabilities;
    }

    // Otherwise, use AI to infer capabilities
    const { query, fileType, context } = request;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: `Analyze this request and determine what capabilities are needed.

Request: ${query || 'No query provided'}
File Type: ${fileType || 'none'}
Context: ${context || 'none'}

Available capabilities:
- statistical_analysis: Statistical tests and analysis
- r_code_execution: Execute R code
- sample_size_calculation: Calculate sample sizes
- power_analysis: Perform power analysis
- survival_analysis: Survival and time-to-event analysis
- mixed_effects_models: Mixed effects and hierarchical models
- clinical_trial_design: Clinical trial design and analysis
- data_analysis: General data analysis
- file_classification: Classify file content type
- data_quality_assessment: Assess data quality
- preliminary_analysis: Quick preliminary analysis
- document_analysis: Analyze text documents
- clinical_validation: Validate clinical relevance
- result_interpretation: Interpret statistical results

Return ONLY a JSON array of required capabilities, like:
["capability1", "capability2"]`
        }]
      });

      const content = response.content[0].text.trim();
      const match = content.match(/\[.*\]/);

      if (match) {
        return JSON.parse(match[0]);
      }

      // Default fallback
      return ['data_analysis'];

    } catch (error) {
      console.error('Failed to analyze request:', error);
      // Default capabilities
      return ['data_analysis'];
    }
  }

  /**
   * Score agents based on multiple criteria
   */
  scoreAgents(candidates, requiredCapabilities, request) {
    return candidates.map(agent => {
      let score = 0;
      let reasoning = [];

      // 1. Capability match score (0-40 points)
      const capabilityScore = this.registry.calculateCapabilityScore(
        agent,
        requiredCapabilities
      ) * 40;
      score += capabilityScore;
      reasoning.push(`Capability match: ${capabilityScore.toFixed(1)}/40`);

      // 2. Agent status score (0-20 points)
      const status = agent.metadata?.status || 'active';
      const statusScore = status === 'active' ? 20 : status === 'beta' ? 10 : 0;
      score += statusScore;
      reasoning.push(`Status (${status}): ${statusScore}/20`);

      // 3. Model efficiency score (0-20 points)
      const modelScore = this.scoreModel(agent.model, request.priority);
      score += modelScore;
      reasoning.push(`Model efficiency: ${modelScore}/20`);

      // 4. Historical performance score (0-20 points)
      const performanceScore = this.getHistoricalPerformance(agent.id);
      score += performanceScore;
      reasoning.push(`Historical performance: ${performanceScore}/20`);

      // 5. Workload balance bonus (0-10 points)
      const workloadScore = this.calculateWorkloadScore(agent.id);
      score += workloadScore;
      if (workloadScore > 0) {
        reasoning.push(`Workload balance: +${workloadScore}`);
      }

      return {
        agent,
        score,
        reasoning: reasoning.join(', ')
      };
    }).sort((a, b) => b.score - a.score);
  }

  /**
   * Score model based on efficiency and request priority
   */
  scoreModel(model, priority = 'balanced') {
    const modelScores = {
      // Sonnet 4.6 - unified model
      'claude-sonnet-4-6': {
        speed: 15, balanced: 18, quality: 20
      }
    };

    const scores = modelScores[model];
    if (!scores) return 10; // Default middle score

    return scores[priority] || scores.balanced;
  }

  /**
   * Get historical performance score for an agent
   */
  getHistoricalPerformance(agentId) {
    const history = this.routingHistory.get(agentId);
    if (!history || history.length === 0) {
      return 10; // Default neutral score for new agents
    }

    const recentHistory = history.slice(-10); // Last 10 interactions
    const successRate = recentHistory.filter(h => h.success).length / recentHistory.length;
    const avgResponseTime = recentHistory.reduce((sum, h) => sum + h.responseTime, 0) / recentHistory.length;

    // Success rate (0-10 points)
    const successScore = successRate * 10;

    // Response time score (0-10 points)
    let timeScore = 10;
    if (avgResponseTime > 10000) timeScore = 5; // Over 10s
    else if (avgResponseTime > 5000) timeScore = 7; // Over 5s
    else if (avgResponseTime > 2000) timeScore = 9; // Over 2s

    return (successScore + timeScore) / 2;
  }

  /**
   * Calculate workload balance score
   */
  calculateWorkloadScore(agentId) {
    const routeCounts = this.routingMetrics.routesByAgent;
    const agentCount = routeCounts.get(agentId) || 0;

    if (routeCounts.size === 0) return 0;

    const avgCount = Array.from(routeCounts.values())
      .reduce((sum, count) => sum + count, 0) / routeCounts.size;

    // Give bonus to underutilized agents
    if (agentCount < avgCount * 0.5) return 10;
    if (agentCount < avgCount * 0.75) return 5;
    return 0;
  }

  /**
   * Record routing decision for learning
   */
  recordRoutingDecision(request, selectedAgent, capabilities) {
    const decision = {
      timestamp: Date.now(),
      requestType: capabilities.join(','),
      agentId: selectedAgent.agent.id,
      agentName: selectedAgent.agent.name,
      score: selectedAgent.score,
      success: null, // Will be updated after execution
      responseTime: null // Will be updated after execution
    };

    // Update routing count
    const currentCount = this.routingMetrics.routesByAgent.get(selectedAgent.agent.id) || 0;
    this.routingMetrics.routesByAgent.set(selectedAgent.agent.id, currentCount + 1);

    // Store decision for later update
    if (!this.routingHistory.has(selectedAgent.agent.id)) {
      this.routingHistory.set(selectedAgent.agent.id, []);
    }
    this.routingHistory.get(selectedAgent.agent.id).push(decision);

    return decision;
  }

  /**
   * Update routing decision with execution results
   */
  updateRoutingOutcome(agentId, success, responseTime) {
    const history = this.routingHistory.get(agentId);
    if (history && history.length > 0) {
      const lastDecision = history[history.length - 1];
      lastDecision.success = success;
      lastDecision.responseTime = responseTime;
    }
  }

  /**
   * Get routing statistics
   */
  getStatistics() {
    return {
      metrics: this.routingMetrics,
      agentUtilization: Array.from(this.routingMetrics.routesByAgent.entries())
        .map(([agentId, count]) => ({
          agentId,
          agent: this.registry.getAgent(agentId)?.name,
          routeCount: count,
          percentage: (count / this.routingMetrics.totalRoutes * 100).toFixed(1)
        }))
        .sort((a, b) => b.routeCount - a.routeCount),
      successRate: this.routingMetrics.totalRoutes > 0
        ? (this.routingMetrics.successfulRoutes / this.routingMetrics.totalRoutes * 100).toFixed(1)
        : 0
    };
  }

  /**
   * Reset routing metrics
   */
  resetMetrics() {
    this.routingMetrics = {
      totalRoutes: 0,
      successfulRoutes: 0,
      failedRoutes: 0,
      routesByAgent: new Map()
    };
    this.routingHistory.clear();
  }

  /**
   * Execute request through selected agent (convenience method)
   */
  async executeWithRouting(request) {
    // Step 1: Route to best agent
    const routingResult = await this.route(request);

    if (!routingResult.success) {
      return {
        success: false,
        error: `Routing failed: ${routingResult.error}`
      };
    }

    // Step 2: Execute through agent (would need agent instances)
    // This is a placeholder - actual execution would depend on agent implementation
    console.log(`   🚀 Would execute through: ${routingResult.agent.name}`);
    console.log(`   📍 Endpoint: ${routingResult.agent.endpoint}`);

    // Return routing decision for now
    return {
      success: true,
      routing: routingResult,
      execution: 'Not implemented - would call agent endpoint here'
    };
  }
}

// Singleton instance
const agentRouter = new AgentRouter();

export default agentRouter;
export { AgentRouter };