/**
 * Base Agent Class
 * Abstract base class that all agents must extend
 * Provides common functionality and enforces agent interface
 */

import { EventEmitter } from 'events';

class BaseAgent extends EventEmitter {
  constructor(config) {
    super();

    // Required configuration
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.capabilities = config.capabilities || [];
    this.model = config.model;
    this.metadata = config.metadata || {};

    // Optional configuration
    this.maxIterations = config.maxIterations || 10;
    this.timeout = config.timeout || 60000; // 60 seconds default
    this.retryAttempts = config.retryAttempts || 3;
    this.tools = config.tools || [];

    // Runtime state
    this.status = 'idle';
    this.currentTask = null;
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0
    };

    // Validate required methods are implemented
    this.validateImplementation();
  }

  /**
   * Validate that child class implements required methods
   */
  validateImplementation() {
    const requiredMethods = ['execute', 'validate'];

    for (const method of requiredMethods) {
      if (typeof this[method] !== 'function') {
        throw new Error(
          `Agent ${this.name} must implement ${method}() method`
        );
      }
    }
  }

  /**
   * Process a request - wraps execute with error handling and metrics
   */
  async process(request) {
    const startTime = Date.now();
    this.status = 'processing';
    this.currentTask = request.taskId || null;
    this.metrics.totalRequests++;

    try {
      // Emit start event
      this.emit('taskStart', {
        agentId: this.id,
        taskId: request.taskId,
        request
      });

      // Validate input
      const validationResult = await this.validate(request);
      if (!validationResult.valid) {
        throw new Error(`Validation failed: ${validationResult.reason}`);
      }

      // Execute with timeout
      const result = await this.executeWithTimeout(request);

      // Update metrics
      this.metrics.successfulRequests++;
      const responseTime = Date.now() - startTime;
      this.updateAverageResponseTime(responseTime);

      // Emit completion event
      this.emit('taskComplete', {
        agentId: this.id,
        taskId: request.taskId,
        result,
        responseTime
      });

      this.status = 'idle';
      this.currentTask = null;

      return {
        success: true,
        result,
        metrics: {
          responseTime,
          agentId: this.id
        }
      };

    } catch (error) {
      // Handle errors
      this.metrics.failedRequests++;

      this.emit('taskError', {
        agentId: this.id,
        taskId: request.taskId,
        error: error.message
      });

      this.status = 'idle';
      this.currentTask = null;

      return {
        success: false,
        error: error.message,
        metrics: {
          responseTime: Date.now() - startTime,
          agentId: this.id
        }
      };
    }
  }

  /**
   * Execute with timeout wrapper
   */
  async executeWithTimeout(request) {
    return Promise.race([
      this.execute(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Agent execution timeout')), this.timeout)
      )
    ]);
  }

  /**
   * Update average response time
   */
  updateAverageResponseTime(newTime) {
    const total = this.metrics.averageResponseTime *
                  (this.metrics.successfulRequests - 1) + newTime;
    this.metrics.averageResponseTime = total / this.metrics.successfulRequests;
  }

  /**
   * Check if agent can handle capability
   */
  hasCapability(capability) {
    return this.capabilities.includes(capability);
  }

  /**
   * Check if agent can handle multiple capabilities
   */
  hasCapabilities(capabilities) {
    return capabilities.every(cap => this.hasCapability(cap));
  }

  /**
   * Get agent health status
   */
  getHealth() {
    return {
      status: this.status,
      currentTask: this.currentTask,
      metrics: this.metrics,
      lastChecked: new Date().toISOString()
    };
  }

  /**
   * Reset agent metrics
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0
    };
  }

  /**
   * Abstract methods - must be implemented by child classes
   */

  /**
   * Execute the agent's main task
   * @param {Object} request - The request to process
   * @returns {Promise<Object>} - The result
   */
  async execute(request) {
    throw new Error('execute() method must be implemented by child class');
  }

  /**
   * Validate the input request
   * @param {Object} request - The request to validate
   * @returns {Promise<Object>} - Validation result {valid: boolean, reason?: string}
   */
  async validate(request) {
    throw new Error('validate() method must be implemented by child class');
  }

  /**
   * Optional methods - can be overridden by child classes
   */

  /**
   * Initialize agent (optional)
   */
  async initialize() {
    // Override in child class if needed
    return true;
  }

  /**
   * Cleanup agent resources (optional)
   */
  async cleanup() {
    // Override in child class if needed
    return true;
  }

  /**
   * Transform input before processing (optional)
   */
  async transformInput(input) {
    // Override in child class if needed
    return input;
  }

  /**
   * Transform output before returning (optional)
   */
  async transformOutput(output) {
    // Override in child class if needed
    return output;
  }
}

export default BaseAgent;
export { BaseAgent };