/**
 * Agent Registry System
 * Central catalog for agent discovery and capability matching
 * Follows the Agent Directory Service (ADS) pattern
 */

class AgentRegistry {
  constructor() {
    this.agents = new Map();
    this.capabilities = new Map();
    this.initializeRegistry();
  }

  /**
   * Initialize with built-in agents
   */
  initializeRegistry() {
    // Register Biostatistics Coding Agent
    this.register({
      id: 'biostat-coding-agent',
      name: 'Biostatistics Coding Agent',
      description: 'Expert in R code generation and statistical analysis',
      endpoint: '/api/analyze-biostat',
      capabilities: [
        'statistical_analysis',
        'r_code_execution',
        'sample_size_calculation',
        'power_analysis',
        'survival_analysis',
        'mixed_effects_models',
        'clinical_trial_design',
        'data_analysis'
      ],
      inputFormats: ['text', 'csv', 'json'],
      outputFormats: ['json', 'sse', 'html'],
      model: 'claude-sonnet-4-6',
      maxIterations: null, // No limit for debugging capacity
      tools: ['web_search', 'code_execution'],
      metadata: {
        version: '1.0',
        author: 'biostat-team',
        lastUpdated: new Date().toISOString()
      }
    });

    // Register PI Routing Agent
    this.register({
      id: 'pi-routing-agent',
      name: 'Planning & Inference Agent',
      description: 'Routes queries to appropriate agents or provides direct answers',
      endpoint: 'internal:routeQuery',
      capabilities: [
        'query_routing',
        'direct_answer',
        'intent_classification',
        'capability_matching'
      ],
      inputFormats: ['text'],
      outputFormats: ['json'],
      model: 'claude-sonnet-4-6',
      tools: [],
      metadata: {
        version: '1.0',
        author: 'biostat-team'
      }
    });

    // Register Data Manager Agent
    this.register({
      id: 'data-manager-agent',
      name: 'Data Manager Agent',
      description: 'Orchestrates file analysis and data processing',
      endpoint: '/api/analyze-file',
      capabilities: [
        'file_classification',
        'data_quality_assessment',
        'preliminary_analysis',
        'document_analysis',
        'content_classification'
      ],
      inputFormats: ['csv', 'txt', 'pdf', 'docx', 'xlsx'],
      outputFormats: ['json'],
      model: 'claude-sonnet-4-6',
      tools: ['code_execution'],
      metadata: {
        version: '1.0',
        author: 'biostat-team'
      }
    });

    // Register Clinical Judge Agent (future agent example)
    this.register({
      id: 'clinical-judge-agent',
      name: 'Clinical Judge Agent',
      description: 'Evaluates clinical relevance and validity of statistical analyses',
      endpoint: '/api/judge-clinical',
      capabilities: [
        'clinical_validation',
        'result_interpretation',
        'clinical_significance',
        'safety_assessment',
        'protocol_compliance'
      ],
      inputFormats: ['json'],
      outputFormats: ['json'],
      model: 'claude-sonnet-4-6',
      tools: ['web_search'],
      metadata: {
        version: '1.0',
        author: 'clinical-team',
        status: 'planned'
      }
    });

    // Register Report Generator Agent (future)
    this.register({
      id: 'report-generator-agent',
      name: 'Report Generator Agent',
      description: 'Creates formatted reports from analysis results',
      endpoint: '/api/generate-report',
      capabilities: [
        'report_generation',
        'visualization',
        'latex_formatting',
        'markdown_generation',
        'pdf_creation'
      ],
      inputFormats: ['json'],
      outputFormats: ['pdf', 'html', 'markdown'],
      model: 'claude-sonnet-4-6',
      tools: [],
      metadata: {
        version: '1.0',
        author: 'biostat-team',
        status: 'planned'
      }
    });
  }

  /**
   * Register a new agent
   */
  register(agent) {
    this.agents.set(agent.id, agent);

    // Index capabilities for fast lookup
    agent.capabilities.forEach(capability => {
      if (!this.capabilities.has(capability)) {
        this.capabilities.set(capability, new Set());
      }
      this.capabilities.get(capability).add(agent.id);
    });

    console.log(`✅ Registered agent: ${agent.name} with ${agent.capabilities.length} capabilities`);
    return agent;
  }

  /**
   * Find agents by capability
   */
  findByCapability(capability) {
    const agentIds = this.capabilities.get(capability);
    if (!agentIds) return [];

    return Array.from(agentIds).map(id => this.agents.get(id));
  }

  /**
   * Find agents by multiple capabilities (AND operation)
   */
  findByCapabilities(capabilities) {
    const agents = [];

    for (const [id, agent] of this.agents) {
      const hasAll = capabilities.every(cap =>
        agent.capabilities.includes(cap)
      );
      if (hasAll) {
        agents.push(agent);
      }
    }

    return agents;
  }

  /**
   * Get agent by ID
   */
  getAgent(id) {
    return this.agents.get(id);
  }

  /**
   * Get all agents
   */
  getAllAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by status (active, planned, deprecated)
   */
  getAgentsByStatus(status = 'active') {
    return this.getAllAgents().filter(agent =>
      (agent.metadata?.status || 'active') === status
    );
  }

  /**
   * Match agent based on query requirements
   */
  matchAgent(requirements) {
    const { capabilities, inputFormat, outputFormat, preferredModel } = requirements;

    let candidates = this.getAllAgents();

    // Filter by capabilities
    if (capabilities && capabilities.length > 0) {
      candidates = candidates.filter(agent =>
        capabilities.some(cap => agent.capabilities.includes(cap))
      );
    }

    // Filter by input format
    if (inputFormat) {
      candidates = candidates.filter(agent =>
        agent.inputFormats.includes(inputFormat)
      );
    }

    // Filter by output format
    if (outputFormat) {
      candidates = candidates.filter(agent =>
        agent.outputFormats.includes(outputFormat)
      );
    }

    // Sort by model preference
    if (preferredModel) {
      candidates.sort((a, b) => {
        if (a.model === preferredModel) return -1;
        if (b.model === preferredModel) return 1;
        return 0;
      });
    }

    return candidates;
  }

  /**
   * Calculate capability score for ranking
   */
  calculateCapabilityScore(agent, requiredCapabilities) {
    const matchCount = requiredCapabilities.filter(cap =>
      agent.capabilities.includes(cap)
    ).length;

    return matchCount / requiredCapabilities.length;
  }

  /**
   * Get agent health status (for monitoring)
   */
  async getAgentHealth(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const startTime = Date.now();
    let status = 'healthy';
    let responseTime = null;
    let error = null;

    try {
      // For agents with endpoints, perform a health check
      if (agent.endpoint) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

        try {
          const response = await fetch(`${agent.endpoint}/health`, {
            method: 'GET',
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          responseTime = Date.now() - startTime;

          if (response.ok) {
            status = 'healthy';
          } else if (response.status >= 500) {
            status = 'unhealthy';
            error = `HTTP ${response.status}`;
          } else {
            status = 'degraded';
            error = `HTTP ${response.status}`;
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          status = 'unhealthy';
          error = fetchError.message;
          responseTime = Date.now() - startTime;
        }
      } else {
        // For local agents, check if they're registered and available
        const isRegistered = this.agents.has(agentId);
        status = isRegistered ? 'healthy' : 'unhealthy';
        responseTime = Date.now() - startTime;
      }
    } catch (err) {
      status = 'unhealthy';
      error = err.message;
      responseTime = Date.now() - startTime;
    }

    return {
      agentId,
      status,
      lastChecked: new Date().toISOString(),
      responseTime,
      error
    };
  }

  /**
   * Export registry as JSON (for persistence)
   */
  exportRegistry() {
    return {
      agents: Array.from(this.agents.entries()),
      capabilities: Array.from(this.capabilities.entries()).map(([key, value]) => [
        key,
        Array.from(value)
      ]),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Import registry from JSON
   */
  importRegistry(data) {
    this.agents = new Map(data.agents);
    this.capabilities = new Map(data.capabilities.map(([key, value]) => [
      key,
      new Set(value)
    ]));
  }

  /**
   * Get capability statistics
   */
  getCapabilityStats() {
    const stats = {};

    for (const [capability, agentIds] of this.capabilities) {
      stats[capability] = {
        count: agentIds.size,
        agents: Array.from(agentIds)
      };
    }

    return stats;
  }
}

// Singleton instance
const agentRegistry = new AgentRegistry();

export default agentRegistry;
export { AgentRegistry };