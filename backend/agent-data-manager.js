/**
 * Data Manager Orchestrator Agent
 * Orchestrates file analysis by delegating to specialized agents
 * Acts as the entry point for all file-based analysis requests
 */

import BaseAgent from './base-agent.js';
import agentRouter from './agent-router.js';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class DataManagerAgent extends BaseAgent {
  constructor() {
    super({
      id: 'data-manager-agent',
      name: 'Data Manager Orchestrator',
      description: 'Orchestrates file analysis and data processing',
      capabilities: [
        'file_classification',
        'data_quality_assessment',
        'orchestration',
        'workflow_management',
        'agent_coordination',
        'result_aggregation'
      ],
      model: 'claude-sonnet-4-6', // Sonnet 4.6 for orchestration
      maxIterations: 1, // Single orchestration pass
      metadata: {
        version: '2.0',
        author: 'biostat-team',
        status: 'active'
      }
    });

    // Configure internal agent endpoints
    this.agentEndpoints = {
      'biostat-coding-agent': process.env.BIOSTAT_AGENT_URL || 'http://localhost:3001/api/analyze-biostat',
      'clinical-judge-agent': process.env.CLINICAL_AGENT_URL || 'http://localhost:3001/api/judge-clinical',
      'report-generator-agent': process.env.REPORT_AGENT_URL || 'http://localhost:3001/api/generate-report'
    };
  }

  /**
   * Validate input request
   */
  async validate(request) {
    if (!request.fileContent && !request.filePath) {
      return {
        valid: false,
        reason: 'Missing fileContent or filePath'
      };
    }

    if (!request.fileName) {
      return {
        valid: false,
        reason: 'Missing fileName'
      };
    }

    return { valid: true };
  }

  /**
   * Execute orchestration workflow
   */
  async execute(request) {
    const { fileName, fileContent, analysisType = 'auto', options = {} } = request;

    console.log('📊 Data Manager Orchestrator: Starting workflow...');
    console.log(`   📁 File: ${fileName}`);

    const workflowSteps = [];

    try {
      // Step 1: Classify file content
      const classification = await this.classifyContent(fileName, fileContent);
      console.log(`   🏷️  Classification: ${classification.contentType} (confidence: ${classification.confidence})`);

      workflowSteps.push({
        step: 'classification',
        result: classification,
        timestamp: new Date().toISOString()
      });

      // Step 2: Determine workflow based on classification
      const workflow = await this.determineWorkflow(
        classification,
        analysisType,
        options
      );
      console.log(`   🔄 Workflow selected: ${workflow.type}`);

      workflowSteps.push({
        step: 'workflow_selection',
        result: workflow,
        timestamp: new Date().toISOString()
      });

      // Step 3: Execute workflow by delegating to agents
      const analysisResult = await this.executeWorkflow(
        workflow,
        fileName,
        fileContent,
        classification,
        options
      );

      workflowSteps.push({
        step: 'analysis',
        result: analysisResult,
        timestamp: new Date().toISOString()
      });

      // Step 4: Optional - Clinical validation for statistical results
      let clinicalValidation = null;
      if (workflow.requiresClinicalValidation && analysisResult.success) {
        console.log('   🏥 Requesting clinical validation...');
        clinicalValidation = await this.requestClinicalValidation(
          analysisResult.data,
          classification,
          options.clinicalContext
        );

        workflowSteps.push({
          step: 'clinical_validation',
          result: clinicalValidation,
          timestamp: new Date().toISOString()
        });
      }

      // Step 5: Aggregate results
      const aggregatedResult = await this.aggregateResults(
        classification,
        analysisResult,
        clinicalValidation,
        workflowSteps
      );

      console.log('   ✅ Workflow completed successfully');

      return aggregatedResult;

    } catch (error) {
      console.error('❌ Orchestration error:', error);
      throw error;
    }
  }

  /**
   * Classify file content using AI
   */
  async classifyContent(fileName, fileContent) {
    // Analyze first 2000 characters for efficiency
    const sampleContent = fileContent.substring(0, 2000);

    const prompt = `Classify this file content:

Filename: ${fileName}
Content Sample:
${sampleContent}

Determine:
1. Content type: "data" (structured data like CSV, numerical data) or "document" (text, reports, papers)
2. Data structure: If data, describe structure (tabular, time series, etc.)
3. Domain: Statistical, clinical, research, general
4. Recommended analysis type

Return as JSON:
{
  "contentType": "data" or "document",
  "dataStructure": "...",
  "domain": "...",
  "recommendedAnalysis": "...",
  "confidence": 0.0-1.0,
  "reasoning": "..."
}`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0.1,
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

      // Fallback classification
      const hasNumbers = /\d+[,.\s]+\d+/.test(sampleContent);
      const hasDelimiters = /[,\t|]/.test(sampleContent);

      return {
        contentType: hasNumbers && hasDelimiters ? 'data' : 'document',
        dataStructure: 'unknown',
        domain: 'general',
        recommendedAnalysis: 'basic',
        confidence: 0.5,
        reasoning: 'Fallback classification based on content patterns'
      };

    } catch (error) {
      console.error('Classification error:', error);
      return {
        contentType: 'unknown',
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Determine workflow based on classification
   */
  async determineWorkflow(classification, analysisType, options) {
    const workflows = {
      'statistical_data': {
        type: 'statistical_analysis',
        agents: ['biostat-coding-agent'],
        requiresClinicalValidation: options.clinicalValidation || false,
        capabilities: ['statistical_analysis', 'r_code_execution']
      },
      'clinical_data': {
        type: 'clinical_analysis',
        agents: ['biostat-coding-agent', 'clinical-judge-agent'],
        requiresClinicalValidation: true,
        capabilities: ['clinical_trial_design', 'clinical_validation']
      },
      'document': {
        type: 'document_analysis',
        agents: ['document-analyzer'],
        requiresClinicalValidation: false,
        capabilities: ['document_analysis', 'text_extraction']
      },
      'mixed': {
        type: 'hybrid_analysis',
        agents: ['biostat-coding-agent', 'document-analyzer'],
        requiresClinicalValidation: false,
        capabilities: ['data_analysis', 'document_analysis']
      }
    };

    // Select workflow based on classification
    if (classification.contentType === 'data') {
      if (classification.domain === 'clinical') {
        return workflows.clinical_data;
      }
      return workflows.statistical_data;
    } else if (classification.contentType === 'document') {
      return workflows.document;
    }

    // Default workflow
    return workflows.statistical_data;
  }

  /**
   * Execute the selected workflow
   */
  async executeWorkflow(workflow, fileName, fileContent, classification, options) {
    console.log(`   🚀 Executing ${workflow.type} workflow...`);

    switch (workflow.type) {
      case 'statistical_analysis':
      case 'clinical_analysis':
        return await this.executeStatisticalWorkflow(
          fileName,
          fileContent,
          classification,
          options
        );

      case 'document_analysis':
        return await this.executeDocumentWorkflow(
          fileName,
          fileContent,
          classification,
          options
        );

      case 'hybrid_analysis':
        return await this.executeHybridWorkflow(
          fileName,
          fileContent,
          classification,
          options
        );

      default:
        throw new Error(`Unknown workflow type: ${workflow.type}`);
    }
  }

  /**
   * Execute statistical analysis workflow
   */
  async executeStatisticalWorkflow(fileName, fileContent, classification, options) {
    console.log('   📈 Delegating to Biostatistics Coding Agent...');

    // Prepare query for the coding agent
    const query = options.query ||
      `Perform ${classification.recommendedAnalysis || 'comprehensive statistical'} analysis on ${fileName}. ` +
      `The data appears to be ${classification.dataStructure || 'structured data'}. ` +
      `Provide summary statistics, visualizations, and key insights.`;

    // Call the biostatistics coding agent
    try {
      // For now, we'll simulate the call since we need to refactor the actual endpoint
      // In production, this would be an actual HTTP call or internal method call
      const agentRequest = {
        query,
        data: fileContent,
        mode: 'preliminary_analysis', // Use fast mode for file analysis
        fileName,
        metadata: {
          classification,
          orchestratedBy: this.id
        }
      };

      // Simulate agent response
      console.log('   ⏳ Waiting for Biostatistics Coding Agent...');

      // In real implementation, this would be:
      // const response = await this.callAgent('biostat-coding-agent', agentRequest);

      // For now, return a structured response
      return {
        success: true,
        agentId: 'biostat-coding-agent',
        data: {
          analysis: 'Statistical analysis would be performed here',
          query,
          fileName,
          classification,
          note: 'Full integration pending - would call biostat agent endpoint'
        }
      };

    } catch (error) {
      console.error('Statistical workflow error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute document analysis workflow
   */
  async executeDocumentWorkflow(fileName, fileContent, classification, options) {
    console.log('   📄 Performing document analysis...');

    // Use Claude directly for document analysis
    const prompt = `Analyze this document and provide a comprehensive summary:

Filename: ${fileName}
Classification: ${JSON.stringify(classification)}
Content: ${fileContent.substring(0, 5000)}

Provide:
1. Document type and purpose
2. Key findings or main points
3. Statistical information (if any)
4. Recommendations or conclusions
5. Quality assessment`;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      return {
        success: true,
        agentId: 'document-analyzer',
        data: {
          analysis: response.content[0].text,
          fileName,
          classification,
          documentType: classification.dataStructure
        }
      };

    } catch (error) {
      console.error('Document workflow error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Execute hybrid analysis workflow
   */
  async executeHybridWorkflow(fileName, fileContent, classification, options) {
    console.log('   🔄 Executing hybrid workflow...');

    // Execute both statistical and document analysis
    const [statResult, docResult] = await Promise.all([
      this.executeStatisticalWorkflow(fileName, fileContent, classification, options),
      this.executeDocumentWorkflow(fileName, fileContent, classification, options)
    ]);

    return {
      success: statResult.success && docResult.success,
      agentId: 'hybrid',
      data: {
        statistical: statResult.data,
        document: docResult.data,
        combined: true
      }
    };
  }

  /**
   * Request clinical validation from clinical judge agent
   */
  async requestClinicalValidation(analysisResults, classification, clinicalContext) {
    console.log('   🏥 Requesting clinical validation...');

    try {
      // Import the clinical judge agent
      const clinicalJudge = await import('./agent-clinical-judge.js');
      const agent = clinicalJudge.default;

      // Prepare validation request
      const validationRequest = {
        analysisResults,
        context: {
          ...clinicalContext,
          fileClassification: classification,
          studyType: clinicalContext?.studyType || 'observational',
          population: clinicalContext?.population || 'general'
        },
        requirements: {
          mcid: clinicalContext?.mcid || 0.5,
          regulatory: clinicalContext?.regulatory || [],
          requiredAnalyses: clinicalContext?.requiredAnalyses || []
        }
      };

      // Execute validation
      const result = await agent.process(validationRequest);

      return result;

    } catch (error) {
      console.error('Clinical validation error:', error);
      return {
        success: false,
        error: error.message,
        note: 'Clinical validation failed but analysis continues'
      };
    }
  }

  /**
   * Aggregate results from multiple agents
   */
  async aggregateResults(classification, analysisResult, clinicalValidation, workflowSteps) {
    const aggregated = {
      success: true,
      fileName: analysisResult.data?.fileName,
      classification,
      timestamp: new Date().toISOString(),
      workflow: {
        steps: workflowSteps,
        duration: this.calculateDuration(workflowSteps)
      },
      results: {
        primary: analysisResult.data
      }
    };

    // Add clinical validation if available
    if (clinicalValidation && clinicalValidation.success) {
      aggregated.results.clinical = clinicalValidation.result;

      // Add overall recommendation
      aggregated.recommendation = this.generateOverallRecommendation(
        analysisResult,
        clinicalValidation
      );
    }

    // Add metadata
    aggregated.metadata = {
      orchestrator: this.id,
      agents: this.extractAgentIds(workflowSteps),
      version: this.metadata.version
    };

    return aggregated;
  }

  /**
   * Calculate workflow duration
   */
  calculateDuration(steps) {
    if (steps.length < 2) return 0;

    const start = new Date(steps[0].timestamp);
    const end = new Date(steps[steps.length - 1].timestamp);

    return (end - start) / 1000; // Duration in seconds
  }

  /**
   * Extract agent IDs from workflow steps
   */
  extractAgentIds(steps) {
    const agentIds = new Set();

    steps.forEach(step => {
      if (step.result?.agentId) {
        agentIds.add(step.result.agentId);
      }
    });

    return Array.from(agentIds);
  }

  /**
   * Generate overall recommendation
   */
  generateOverallRecommendation(analysisResult, clinicalValidation) {
    const clinicalJudgment = clinicalValidation?.result?.judgment;

    if (!clinicalJudgment) {
      return {
        summary: 'Analysis completed successfully',
        confidence: 'moderate',
        nextSteps: ['Review statistical results', 'Consider clinical context']
      };
    }

    const recommendation = {
      summary: clinicalJudgment.recommendation || 'Review required',
      confidence: this.mapQualityToConfidence(clinicalJudgment.overallQuality),
      nextSteps: []
    };

    // Add next steps based on clinical recommendations
    if (clinicalValidation?.result?.recommendations) {
      recommendation.nextSteps = clinicalValidation.result.recommendations
        .filter(r => r.priority === 'High')
        .map(r => r.action);
    }

    return recommendation;
  }

  /**
   * Map quality assessment to confidence level
   */
  mapQualityToConfidence(quality) {
    const mapping = {
      'Excellent': 'high',
      'Good': 'moderate-high',
      'Acceptable': 'moderate',
      'Poor': 'low',
      'Unable to assess': 'unknown'
    };

    return mapping[quality] || 'moderate';
  }

  /**
   * Call external agent (for future implementation)
   */
  async callAgent(agentId, request) {
    const endpoint = this.agentEndpoints[agentId];

    if (!endpoint) {
      throw new Error(`No endpoint configured for agent: ${agentId}`);
    }

    try {
      const response = await axios.post(endpoint, request, {
        headers: {
          'Content-Type': 'application/json',
          'X-Orchestrator-ID': this.id,
          'X-Request-ID': request.requestId || Date.now().toString()
        },
        timeout: 60000 // 60 second timeout
      });

      return response.data;

    } catch (error) {
      console.error(`Error calling agent ${agentId}:`, error);
      throw error;
    }
  }
}

// Export singleton instance
const dataManagerAgent = new DataManagerAgent();

export default dataManagerAgent;
export { DataManagerAgent };