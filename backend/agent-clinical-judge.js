/**
 * Clinical Judge Agent
 * Evaluates statistical analysis results for clinical validity and relevance
 * Acts as a quality control layer for the biostatistics coding agent
 */

import BaseAgent from './base-agent.js';
import Anthropic from '@anthropic-ai/sdk';
import tavilySearchTool from './tavily-search-tool.js';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class ClinicalJudgeAgent extends BaseAgent {
  constructor() {
    super({
      id: 'clinical-judge-agent',
      name: 'Clinical Judge Agent',
      description: 'Evaluates clinical relevance and validity of statistical analyses',
      capabilities: [
        'clinical_validation',
        'result_interpretation',
        'clinical_significance',
        'safety_assessment',
        'protocol_compliance',
        'regulatory_compliance',
        'effect_size_evaluation',
        'risk_assessment'
      ],
      model: 'claude-sonnet-4-6',  // Sonnet 4.6 for reliable structured JSON output generation
      maxIterations: 1, // Single pass evaluation
      tools: ['web_search'],
      metadata: {
        version: '1.0',
        author: 'clinical-team',
        status: 'active'
      }
    });

    // Clinical significance thresholds
    this.thresholds = {
      minimalClinicallyImportantDifference: {
        default: 0.5, // Default Cohen's d
        customizable: true
      },
      pValueThreshold: {
        standard: 0.05,
        stringent: 0.01,
        bonferroni: null // Calculated based on number of comparisons
      },
      sampleSizeMinimum: {
        pilot: 10,
        standard: 30,
        clinical: 100
      }
    };
  }

  /**
   * Validate input request
   */
  async validate(request) {
    if (!request.analysisResults) {
      return {
        valid: false,
        reason: 'Missing analysisResults field'
      };
    }

    if (!request.context) {
      return {
        valid: false,
        reason: 'Missing context field (study design, population, etc.)'
      };
    }

    return { valid: true };
  }

  /**
   * Execute clinical evaluation
   * NOW SUPPORTS INTELLIGENT FEEDBACK MODE with constructive suggestions
   */
  async execute(request) {
    const { analysisResults, context, requirements = {}, executionDetails, executionTrace } = request;

    console.log('🏥 Clinical Judge Agent: Starting evaluation...');

    try {
      // INTELLIGENT FEEDBACK MODE: Use new AI-driven structured feedback
      // Triggered when we have rich execution context (from hierarchical orchestration)
      if (executionDetails && (executionDetails.fullOutput || executionDetails.rCode)) {
        console.log('   🧠 Using INTELLIGENT FEEDBACK mode with structured suggestions');

        // Extract user query from context or execution trace
        const userQuery = context.userQuery ||
                         executionTrace?.query ||
                         'Statistical analysis evaluation';

        // Build biostat result object for intelligent feedback
        const biostatResult = {
          rCode: executionDetails.rCode,
          fullOutput: executionDetails.fullOutput,
          fullCode: executionDetails.rCode,
          output: executionDetails.fullOutput,
          outputFiles: executionDetails.outputFiles || [],
          executionSuccess: executionDetails.executionSuccess !== false,
          executionIterations: executionDetails.iterations || 0,
          error: request.warnings?.[0] || null,
          success: executionDetails.executionSuccess !== false,
          iterations: executionDetails.iterations || 0
        };

        // Generate intelligent structured feedback
        const intelligentFeedback = await this.generateIntelligentFeedback(
          biostatResult,
          userQuery,
          context
        );

        console.log(`   → Intelligent feedback: ${intelligentFeedback.judgment}`);
        console.log(`   → Issues found: ${intelligentFeedback.issues.length}`);
        console.log(`   → Suggestions provided: ${intelligentFeedback.suggestions.length}`);

        // Map intelligent feedback to expected return format for orchestrator
        // CRITICAL: This maintains backward compatibility while adding structured feedback
        return {
          // New structured feedback (for PI Agent to use)
          judgment: intelligentFeedback.judgment,
          confidence: intelligentFeedback.confidence,
          summary: intelligentFeedback.summary,
          issues: intelligentFeedback.issues,
          suggestions: intelligentFeedback.suggestions,
          strengths: intelligentFeedback.strengths,
          reasoning: intelligentFeedback.reasoning,
          recommendedActions: intelligentFeedback.recommendedActions,

          // Backward compatibility fields (for old orchestrator code)
          approved: intelligentFeedback.judgment === 'PASS',
          interpretation: intelligentFeedback.summary,
          recommendations: intelligentFeedback.suggestions.map(s => s.description),

          // Mock statistical validity for backward compatibility
          statisticalValidity: {
            score: intelligentFeedback.confidence * 100,
            issues: intelligentFeedback.issues.filter(i =>
              i.type === 'statistical_error' || i.type === 'incorrect_method'
            ).map(i => i.description),
            strengths: intelligentFeedback.strengths,
            interpretation: intelligentFeedback.judgment === 'PASS' ? 'High validity' :
                           intelligentFeedback.judgment === 'CONDITIONAL_PASS' ? 'Moderate validity' :
                           'Low validity - review recommended'
          },

          // Mock clinical significance
          clinicalSignificance: {
            rating: intelligentFeedback.issues.some(i => i.type === 'clinical_inappropriateness')
              ? 'Clinically inappropriate'
              : 'Clinically appropriate',
            explanation: intelligentFeedback.reasoning
          },

          // Mock protocol compliance
          protocolCompliance: {
            compliant: !intelligentFeedback.issues.some(i =>
              i.severity === 'CRITICAL' || i.type === 'assumption_violation'
            ),
            violations: intelligentFeedback.issues
              .filter(i => i.severity === 'CRITICAL')
              .map(i => i.description)
          },

          // Mock safety assessment
          safetyAssessment: {
            riskLevel: intelligentFeedback.issues.some(i => i.severity === 'CRITICAL') ? 'High' : 'Low',
            concerns: intelligentFeedback.issues.filter(i => i.severity === 'CRITICAL').map(i => i.description)
          },

          // Include full intelligent feedback for future use
          fullEvaluation: intelligentFeedback,

          timestamp: new Date().toISOString()
        };
      }

      // FALLBACK MODE: Use traditional multi-step evaluation
      // For backward compatibility with direct calls
      console.log('   📋 Using TRADITIONAL multi-step evaluation mode');

      // Step 1: Extract key statistical findings
      const findings = await this.extractFindings(analysisResults);
      console.log(`   📊 Extracted ${Object.keys(findings).length} key findings`);

      // Step 2: Evaluate statistical validity
      const statisticalValidity = await this.evaluateStatisticalValidity(
        findings,
        context
      );
      console.log(`   ✅ Statistical validity: ${statisticalValidity.score}/100`);

      // Step 3: Assess clinical significance
      const clinicalSignificance = await this.assessClinicalSignificance(
        findings,
        context,
        requirements
      );
      console.log(`   💊 Clinical significance: ${clinicalSignificance.rating}`);

      // Step 4: Check protocol compliance
      const protocolCompliance = await this.checkProtocolCompliance(
        analysisResults,
        context,
        requirements
      );
      console.log(`   📋 Protocol compliance: ${protocolCompliance.compliant ? 'Yes' : 'No'}`);

      // Step 5: Evaluate safety considerations
      const safetyAssessment = await this.evaluateSafety(
        findings,
        context
      );
      console.log(`   ⚠️  Safety assessment: ${safetyAssessment.riskLevel}`);

      // Step 6: Generate comprehensive judgment
      const judgment = await this.generateJudgment(
        findings,
        statisticalValidity,
        clinicalSignificance,
        protocolCompliance,
        safetyAssessment,
        context
      );

      // Step 7: Provide recommendations
      const recommendations = await this.generateRecommendations(
        judgment,
        findings,
        context
      );

      return {
        judgment,
        statisticalValidity,
        clinicalSignificance,
        protocolCompliance,
        safetyAssessment,
        recommendations,
        findings,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Clinical evaluation error:', error);
      throw error;
    }
  }

  /**
   * Extract key statistical findings from analysis results
   */
  async extractFindings(analysisResults) {
    const findings = {
      pValues: [],
      effectSizes: [],
      confidenceIntervals: [],
      sampleSize: null,
      powerAnalysis: null,
      assumptions: [],
      multipleComparisons: false
    };

    try {
      // Convert results to string for analysis
      const resultsText = typeof analysisResults === 'string'
        ? analysisResults
        : JSON.stringify(analysisResults, null, 2);

      // Extract p-values
      const pValueMatches = resultsText.match(/p[- ]?(?:value)?[:\s=]+([0-9.e-]+)/gi) || [];
      findings.pValues = pValueMatches.map(match => {
        const value = match.match(/([0-9.e-]+)/)[1];
        return parseFloat(value);
      }).filter(p => !isNaN(p));

      // Extract effect sizes (Cohen's d, R², etc.)
      const effectMatches = resultsText.match(/(?:cohen'?s?\s*d|effect\s*size|r-?squared?)[:\s=]+([0-9.-]+)/gi) || [];
      findings.effectSizes = effectMatches.map(match => {
        const value = match.match(/([0-9.-]+)/)[1];
        return parseFloat(value);
      }).filter(e => !isNaN(e));

      // Extract confidence intervals
      const ciMatches = resultsText.match(/\[([0-9.-]+)[,\s]+([0-9.-]+)\]/g) || [];
      findings.confidenceIntervals = ciMatches.map(match => {
        const values = match.match(/([0-9.-]+)/g);
        return {
          lower: parseFloat(values[0]),
          upper: parseFloat(values[1])
        };
      });

      // Extract sample size
      const sampleMatches = resultsText.match(/n[:\s=]+(\d+)/i);
      if (sampleMatches) {
        findings.sampleSize = parseInt(sampleMatches[1]);
      }

      // Check for multiple comparisons
      findings.multipleComparisons = findings.pValues.length > 1;

    } catch (error) {
      console.error('Error extracting findings:', error);
    }

    return findings;
  }

  /**
   * Evaluate statistical validity
   */
  async evaluateStatisticalValidity(findings, context) {
    let score = 100;
    const issues = [];
    const strengths = [];

    // Check sample size adequacy
    if (findings.sampleSize) {
      const minSize = context.studyType === 'pilot' ? 10 : 30;
      if (findings.sampleSize < minSize) {
        score -= 20;
        issues.push(`Small sample size (n=${findings.sampleSize})`);
      } else if (findings.sampleSize >= 100) {
        strengths.push(`Adequate sample size (n=${findings.sampleSize})`);
      }
    }

    // Check for multiple comparisons adjustment
    if (findings.multipleComparisons && findings.pValues.length > 3) {
      const bonferroniThreshold = 0.05 / findings.pValues.length;
      const unadjustedSignificant = findings.pValues.filter(p => p < 0.05).length;
      const adjustedSignificant = findings.pValues.filter(p => p < bonferroniThreshold).length;

      if (unadjustedSignificant > adjustedSignificant) {
        score -= 15;
        issues.push('Multiple comparisons without apparent adjustment');
      }
    }

    // Check effect size reporting
    if (findings.effectSizes.length === 0 && findings.pValues.length > 0) {
      score -= 10;
      issues.push('Effect sizes not reported alongside p-values');
    } else if (findings.effectSizes.length > 0) {
      strengths.push('Effect sizes properly reported');
    }

    // Check confidence interval reporting
    if (findings.confidenceIntervals.length > 0) {
      strengths.push('Confidence intervals provided');
    } else if (findings.pValues.length > 0) {
      score -= 5;
      issues.push('Confidence intervals not reported');
    }

    return {
      score,
      issues,
      strengths,
      interpretation: score >= 80 ? 'High validity' :
                     score >= 60 ? 'Moderate validity' :
                     'Low validity - review recommended'
    };
  }

  /**
   * Assess clinical significance
   */
  async assessClinicalSignificance(findings, context, requirements) {
    const mcid = requirements.mcid || this.thresholds.minimalClinicallyImportantDifference.default;

    // Evaluate effect sizes against MCID
    const clinicallySignificant = findings.effectSizes.filter(es => Math.abs(es) >= mcid);
    const statisticallySignificant = findings.pValues.filter(p => p < 0.05);

    // Determine clinical significance rating
    let rating = 'Not significant';
    let explanation = '';

    if (clinicallySignificant.length > 0 && statisticallySignificant.length > 0) {
      rating = 'Clinically and statistically significant';
      explanation = 'Results show both statistical significance and meaningful clinical effect';
    } else if (clinicallySignificant.length > 0) {
      rating = 'Clinically significant, not statistically significant';
      explanation = 'Effect size suggests clinical importance but lacks statistical significance (possibly underpowered)';
    } else if (statisticallySignificant.length > 0) {
      rating = 'Statistically significant, unclear clinical significance';
      explanation = 'Statistical significance achieved but clinical meaningfulness uncertain';
    } else {
      explanation = 'Neither statistical nor clinical significance demonstrated';
    }

    // Consider context-specific factors
    const contextFactors = await this.evaluateContextualSignificance(findings, context);

    return {
      rating,
      explanation,
      mcidThreshold: mcid,
      clinicallySignificantEffects: clinicallySignificant,
      contextFactors
    };
  }

  /**
   * Evaluate contextual clinical significance
   */
  async evaluateContextualSignificance(findings, context) {
    const prompt = `Evaluate the clinical significance of these statistical findings in context:

Findings:
- P-values: ${findings.pValues.join(', ') || 'None'}
- Effect sizes: ${findings.effectSizes.join(', ') || 'None'}
- Sample size: ${findings.sampleSize || 'Unknown'}

Context:
${JSON.stringify(context, null, 2)}

Consider:
1. Disease severity and patient population
2. Treatment burden and risks
3. Cost-effectiveness
4. Alternative treatments available
5. Patient quality of life impact

Provide a brief assessment of contextual clinical significance.`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        temperature: 0.2,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      return response.content[0].text;
    } catch (error) {
      console.error('Error evaluating contextual significance:', error);
      return 'Unable to evaluate contextual significance';
    }
  }

  /**
   * Check protocol compliance
   */
  async checkProtocolCompliance(analysisResults, context, requirements) {
    const violations = [];
    const compliances = [];

    // Check if required analyses were performed
    if (requirements.requiredAnalyses) {
      for (const required of requirements.requiredAnalyses) {
        const resultsText = JSON.stringify(analysisResults).toLowerCase();
        if (!resultsText.includes(required.toLowerCase())) {
          violations.push(`Missing required analysis: ${required}`);
        } else {
          compliances.push(`Required analysis performed: ${required}`);
        }
      }
    }

    // Check statistical assumptions
    if (context.assumptionsRequired) {
      const assumptionKeywords = ['normality', 'homogeneity', 'independence', 'linearity'];
      const resultsText = JSON.stringify(analysisResults).toLowerCase();

      for (const assumption of assumptionKeywords) {
        if (context.assumptionsRequired.includes(assumption) &&
            !resultsText.includes(assumption)) {
          violations.push(`Assumption not verified: ${assumption}`);
        }
      }
    }

    // Check regulatory requirements
    if (requirements.regulatory) {
      // FDA or EMA specific requirements
      if (requirements.regulatory.includes('FDA') || requirements.regulatory.includes('EMA')) {
        if (!analysisResults.includes('intention-to-treat') &&
            !analysisResults.includes('ITT')) {
          violations.push('Missing intention-to-treat analysis');
        }
        if (!analysisResults.includes('per-protocol') &&
            !analysisResults.includes('PP')) {
          violations.push('Missing per-protocol analysis');
        }
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
      compliances,
      recommendation: violations.length > 0
        ? 'Address protocol violations before submission'
        : 'Analysis meets protocol requirements'
    };
  }

  /**
   * Evaluate safety considerations
   */
  async evaluateSafety(findings, context) {
    let riskLevel = 'Low';
    const concerns = [];
    const mitigations = [];

    // Check for adverse effects in the data
    if (context.adverseEvents) {
      if (context.adverseEvents.serious > 0) {
        riskLevel = 'High';
        concerns.push(`Serious adverse events reported (n=${context.adverseEvents.serious})`);
        mitigations.push('Require detailed safety monitoring plan');
      } else if (context.adverseEvents.total > 0) {
        riskLevel = 'Moderate';
        concerns.push(`Adverse events reported (n=${context.adverseEvents.total})`);
        mitigations.push('Standard safety monitoring recommended');
      }
    }

    // Evaluate risk based on effect direction
    if (findings.effectSizes.some(es => es < -0.5)) {
      if (riskLevel === 'Low') riskLevel = 'Moderate';
      concerns.push('Negative effect sizes observed');
      mitigations.push('Consider risk-benefit analysis');
    }

    // Check sample size for safety assessment
    if (findings.sampleSize && findings.sampleSize < 100) {
      concerns.push('Limited sample size for comprehensive safety assessment');
      mitigations.push('Recommend larger safety database');
    }

    return {
      riskLevel,
      concerns,
      mitigations,
      recommendation: riskLevel === 'High'
        ? 'Immediate safety review required'
        : riskLevel === 'Moderate'
        ? 'Enhanced safety monitoring recommended'
        : 'Standard safety monitoring sufficient'
    };
  }

  /**
   * Generate comprehensive judgment
   */
  async generateJudgment(
    findings,
    statisticalValidity,
    clinicalSignificance,
    protocolCompliance,
    safetyAssessment,
    context
  ) {
    const prompt = `As a clinical research expert, provide a comprehensive judgment on this statistical analysis:

Statistical Validity: ${statisticalValidity.interpretation} (Score: ${statisticalValidity.score}/100)
Issues: ${statisticalValidity.issues.join(', ') || 'None'}
Strengths: ${statisticalValidity.strengths.join(', ') || 'None'}

Clinical Significance: ${clinicalSignificance.rating}
Explanation: ${clinicalSignificance.explanation}

Protocol Compliance: ${protocolCompliance.compliant ? 'Compliant' : 'Non-compliant'}
${protocolCompliance.violations.length > 0 ? `Violations: ${protocolCompliance.violations.join(', ')}` : ''}

Safety Assessment: ${safetyAssessment.riskLevel} risk
${safetyAssessment.concerns.length > 0 ? `Concerns: ${safetyAssessment.concerns.join(', ')}` : ''}

Study Context: ${JSON.stringify(context, null, 2)}

Provide:
1. Overall quality assessment (Excellent/Good/Acceptable/Poor)
2. Key strengths of the analysis
3. Critical limitations
4. Overall recommendation (Approve/Conditional Approval/Revision Required/Reject)
5. Brief rationale for the recommendation`;

    try {
      const response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 800,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const judgmentText = response.content[0].text;

      // Parse structured judgment
      return this.parseJudgment(judgmentText);

    } catch (error) {
      console.error('Error generating judgment:', error);
      return {
        overallQuality: 'Unable to assess',
        strengths: [],
        limitations: [],
        recommendation: 'Review required',
        rationale: 'Automated judgment generation failed'
      };
    }
  }

  /**
   * Parse judgment text into structured format
   */
  parseJudgment(judgmentText) {
    const judgment = {
      overallQuality: 'Acceptable',
      strengths: [],
      limitations: [],
      recommendation: 'Conditional Approval',
      rationale: ''
    };

    // Extract overall quality
    const qualityMatch = judgmentText.match(/overall quality[:\s]+(\w+)/i);
    if (qualityMatch) {
      judgment.overallQuality = qualityMatch[1];
    }

    // Extract recommendation
    const recMatch = judgmentText.match(/recommendation[:\s]+([^.\n]+)/i);
    if (recMatch) {
      judgment.recommendation = recMatch[1].trim();
    }

    // Extract sections
    const sections = judgmentText.split(/\n\d+\.\s+/);
    if (sections.length > 1) {
      judgment.rationale = sections[sections.length - 1].trim();
    }

    // Simple extraction for strengths and limitations
    if (judgmentText.includes('strength')) {
      const strengthSection = judgmentText.split(/strength/i)[1].split(/\n\d+\./)[0];
      judgment.strengths = strengthSection.split(/[;,\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
    }

    if (judgmentText.includes('limitation')) {
      const limitSection = judgmentText.split(/limitation/i)[1].split(/\n\d+\./)[0];
      judgment.limitations = limitSection.split(/[;,\n]/)
        .map(s => s.trim())
        .filter(s => s.length > 10);
    }

    return judgment;
  }

  /**
   * Generate actionable recommendations
   */
  async generateRecommendations(judgment, findings, context) {
    const recommendations = [];

    // Based on judgment outcome
    if (judgment.recommendation.includes('Revision')) {
      recommendations.push({
        priority: 'High',
        action: 'Address identified limitations before resubmission',
        details: judgment.limitations.join('; ')
      });
    }

    // Based on statistical validity
    if (findings.sampleSize && findings.sampleSize < 30) {
      recommendations.push({
        priority: 'High',
        action: 'Increase sample size',
        details: `Current n=${findings.sampleSize}. Recommend minimum n=30 for standard analysis`
      });
    }

    // Based on missing analyses
    if (findings.effectSizes.length === 0) {
      recommendations.push({
        priority: 'Medium',
        action: 'Report effect sizes',
        details: 'Include Cohen\'s d or other appropriate effect size measures'
      });
    }

    // Based on multiple comparisons
    if (findings.multipleComparisons && findings.pValues.length > 3) {
      recommendations.push({
        priority: 'Medium',
        action: 'Apply multiple comparisons correction',
        details: `${findings.pValues.length} comparisons detected. Consider Bonferroni or FDR correction`
      });
    }

    // Based on clinical significance
    if (judgment.overallQuality === 'Poor' || judgment.overallQuality === 'Acceptable') {
      recommendations.push({
        priority: 'High',
        action: 'Consider clinical expert consultation',
        details: 'Statistical results require clinical contextualization'
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder = { High: 0, Medium: 1, Low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * Infer the domain expertise needed based on user query and context
   * Determines what kind of expert the Clinical Judge should be
   */
  inferDomainExpertise(userQuery, context) {
    const queryLower = userQuery.toLowerCase();

    // Determine primary clinical/research domain
    let primaryDomain = 'General Biostatistics';

    if (queryLower.includes('cardio') || queryLower.includes('heart') ||
        queryLower.includes('blood pressure') || queryLower.includes('cardiovascular')) {
      primaryDomain = 'Cardiovascular Medicine';
    } else if (queryLower.includes('oncology') || queryLower.includes('cancer') ||
               queryLower.includes('tumor') || queryLower.includes('chemotherapy')) {
      primaryDomain = 'Oncology';
    } else if (queryLower.includes('neuro') || queryLower.includes('brain') ||
               queryLower.includes('alzheimer') || queryLower.includes('parkinson')) {
      primaryDomain = 'Neurology';
    } else if (queryLower.includes('diabetes') || queryLower.includes('endocrine') ||
               queryLower.includes('metabolic')) {
      primaryDomain = 'Endocrinology/Metabolism';
    } else if (queryLower.includes('infectious') || queryLower.includes('vaccine') ||
               queryLower.includes('epidemic') || queryLower.includes('virus')) {
      primaryDomain = 'Infectious Disease/Epidemiology';
    } else if (queryLower.includes('mental health') || queryLower.includes('psychiatr') ||
               queryLower.includes('depression') || queryLower.includes('anxiety')) {
      primaryDomain = 'Psychiatry/Mental Health';
    } else if (queryLower.includes('public health') || queryLower.includes('population health') ||
               queryLower.includes('community')) {
      primaryDomain = 'Public Health';
    }

    // Determine study design expertise needed
    let studyDesign = 'Randomized Controlled Trials (RCTs)';

    if (queryLower.includes('stepped wedge') || queryLower.includes('sw-crt') ||
        queryLower.includes('swcrt')) {
      studyDesign = 'Stepped-Wedge Cluster Randomized Trials';
    } else if (queryLower.includes('cluster') && queryLower.includes('randomized')) {
      studyDesign = 'Cluster Randomized Trials (CRTs)';
    } else if (queryLower.includes('crossover') || queryLower.includes('cross-over')) {
      studyDesign = 'Crossover Trials';
    } else if (queryLower.includes('observational') || queryLower.includes('cohort')) {
      studyDesign = 'Observational Studies';
    } else if (queryLower.includes('case-control') || queryLower.includes('case control')) {
      studyDesign = 'Case-Control Studies';
    } else if (queryLower.includes('longitudinal') || queryLower.includes('repeated measures')) {
      studyDesign = 'Longitudinal Studies with Repeated Measures';
    } else if (queryLower.includes('survival') || queryLower.includes('time-to-event')) {
      studyDesign = 'Survival Analysis Studies';
    } else if (queryLower.includes('non-inferiority') || queryLower.includes('noninferiority')) {
      studyDesign = 'Non-Inferiority Trials';
    } else if (queryLower.includes('equivalence')) {
      studyDesign = 'Equivalence Trials';
    } else if (queryLower.includes('adaptive')) {
      studyDesign = 'Adaptive Clinical Trials';
    } else if (queryLower.includes('factorial')) {
      studyDesign = 'Factorial Trials';
    } else if (queryLower.includes('pragmatic')) {
      studyDesign = 'Pragmatic Clinical Trials';
    }

    // Determine methodological focus
    let methodologicalFocus = 'Statistical Analysis';

    if (queryLower.includes('sample size') || queryLower.includes('power') ||
        queryLower.includes('calculate n') || queryLower.includes('how many participants')) {
      methodologicalFocus = 'Sample Size Calculation and Power Analysis';
    } else if (queryLower.includes('survival') || queryLower.includes('kaplan') ||
               queryLower.includes('cox') || queryLower.includes('hazard')) {
      methodologicalFocus = 'Survival Analysis';
    } else if (queryLower.includes('mixed') || queryLower.includes('random effect') ||
               queryLower.includes('hierarchical') || queryLower.includes('multilevel')) {
      methodologicalFocus = 'Mixed-Effects and Hierarchical Modeling';
    } else if (queryLower.includes('bayesian')) {
      methodologicalFocus = 'Bayesian Statistical Methods';
    } else if (queryLower.includes('regression') || queryLower.includes('linear model')) {
      methodologicalFocus = 'Regression Modeling';
    } else if (queryLower.includes('missing data') || queryLower.includes('imputation')) {
      methodologicalFocus = 'Missing Data Methods';
    } else if (queryLower.includes('propensity') || queryLower.includes('matching')) {
      methodologicalFocus = 'Causal Inference and Propensity Score Methods';
    } else if (queryLower.includes('meta-analysis') || queryLower.includes('systematic review')) {
      methodologicalFocus = 'Meta-Analysis';
    }

    return {
      primaryDomain,
      studyDesign,
      methodologicalFocus
    };
  }

  /**
   * Generate structured intelligent feedback with constructive suggestions
   * Uses Claude's natural language understanding - NO hardcoded patterns or regex
   * GENERALIZABLE to ANY biostatistics or clinical trial task
   * NOW WITH WEB SEARCH for domain-specific expertise
   */
  async generateIntelligentFeedback(biostatResult, userQuery, context) {
    console.log('🧠 Clinical Judge: Generating intelligent structured feedback...');

    // Determine domain expertise needed based on user query
    const domainContext = this.inferDomainExpertise(userQuery, context);
    console.log(`   🎯 Domain expertise: ${domainContext.primaryDomain}`);
    console.log(`   🔬 Study design: ${domainContext.studyDesign}`);

    const prompt = `You are a Clinical Judge with expertise in ${domainContext.primaryDomain} and ${domainContext.studyDesign} study designs. Your role is to evaluate biostatistical analysis from both a methodological AND clinical/practical perspective.

YOUR EXPERTISE PROFILE:
- Primary Domain: ${domainContext.primaryDomain}
- Study Design Expertise: ${domainContext.studyDesign}
- Methodological Focus: ${domainContext.methodologicalFocus}

IMPORTANT: If you need current best practices, guidelines, or domain-specific knowledge to properly evaluate this analysis, USE WEB SEARCH to find:
- Current clinical guidelines for ${domainContext.primaryDomain}
- Statistical methods best practices for ${domainContext.studyDesign}
- Recommended sample size approaches for this study type
- Field-specific validation criteria

USER'S ORIGINAL QUERY:
"${userQuery}"

BIOSTATISTICAL ANALYSIS PROVIDED:

R Code Executed:
\`\`\`r
${biostatResult.rCode || biostatResult.fullCode || 'No R code provided'}
\`\`\`

Analysis Output:
\`\`\`
${biostatResult.fullOutput || biostatResult.output || 'No output provided'}
\`\`\`

Output Files Generated:
${(biostatResult.outputFiles || []).length > 0
  ? biostatResult.outputFiles.map(f => `- ${f.filename || f.name || f}: ${f.type || 'file'}`).join('\n')
  : 'No output files generated'}

Execution Summary:
- Success: ${biostatResult.executionSuccess || biostatResult.success || false}
- Iterations: ${biostatResult.executionIterations || biostatResult.iterations || 0}
- Error: ${biostatResult.error || 'none'}

Study Context:
${JSON.stringify(context, null, 2)}

YOUR TASK AS A DOMAIN EXPERT:
Evaluate this biostatistical analysis through the lens of a ${domainContext.primaryDomain} expert familiar with ${domainContext.studyDesign} studies. Consider:

1. **Clinical/Field Appropriateness**: Does the statistical approach match real-world ${domainContext.primaryDomain} research standards?
2. **Methodological Rigor**: Are the ${domainContext.studyDesign} design principles properly implemented?
3. **Practical Applicability**: Would this analysis be acceptable in ${domainContext.primaryDomain} journals or regulatory submissions?
4. **Domain-Specific Requirements**: Are field-specific guidelines and best practices followed?

CRITICAL: Your feedback must be:
1. SPECIFIC to what is actually present (or missing) in the analysis
2. ACTIONABLE with clear steps to address each issue
3. CLINICALLY/DOMAIN INFORMED - reference actual guidelines, practices, or standards from ${domainContext.primaryDomain} when relevant
4. METHODOLOGICALLY SOUND for ${domainContext.studyDesign} designs
5. CONSTRUCTIVE focusing on how to improve, not just what's wrong

If you need to verify current best practices or guidelines, SEARCH for them using web search.

RESPONSE FORMAT (JSON only, no markdown):
{
  "judgment": "PASS" | "FAIL" | "CONDITIONAL_PASS",
  "confidence": 0.0-1.0,
  "summary": "One sentence overall assessment",

  "issues": [
    {
      "type": "missing_output" | "incorrect_method" | "insufficient_context" | "statistical_error" | "clinical_inappropriateness" | "incomplete_analysis" | "poor_documentation" | "assumption_violation" | "data_quality" | "interpretation_error",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "description": "Detailed description of the specific issue",
      "location": "Where in the analysis this issue occurs (e.g., 'R code line 15-20', 'output section on power calculation', 'missing from entire analysis')",
      "evidence": "Specific evidence from the analysis showing this issue"
    }
  ],

  "suggestions": [
    {
      "issue_index": 0,
      "action": "add_analysis" | "fix_code" | "enhance_output" | "validate_assumptions" | "improve_documentation" | "correct_interpretation" | "add_visualization" | "strengthen_justification",
      "priority": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "description": "What specifically needs to be done",
      "specificInstructions": "Step-by-step guidance for implementing this fix. Be detailed and technical.",
      "expectedOutcome": "What the corrected analysis should include or demonstrate"
    }
  ],

  "strengths": [
    "Specific positive aspects of the analysis that should be maintained"
  ],

  "reasoning": "Detailed step-by-step explanation of your clinical judgment process",

  "recommendedActions": {
    "immediate": ["Actions that must be taken before this analysis can be considered complete"],
    "followUp": ["Optional improvements that would enhance quality but aren't blocking"],
    "escalate": true/false
  }
}

EXAMPLES OF GOOD VS BAD FEEDBACK:

BAD (too vague):
{
  "issues": [{"description": "Missing some analyses"}],
  "suggestions": [{"description": "Add more analysis"}]
}

GOOD (specific and actionable):
{
  "issues": [{
    "type": "missing_output",
    "severity": "HIGH",
    "description": "No structured output file (CSV/Excel) containing sample size results",
    "location": "Output files array is empty",
    "evidence": "Expected CSV with columns for group_size, total_n, power, effect_size based on user query requesting 'generate CSV output', but no files in outputFiles array"
  }],
  "suggestions": [{
    "action": "add_analysis",
    "priority": "HIGH",
    "description": "Generate CSV file with sample size calculation results",
    "specificInstructions": "Add R code using write.csv() to create a file named 'sample_size_results.csv'. Include columns: parameter (character), value (numeric), interpretation (character). Rows should include: sample_size_per_group, total_sample_size, power, alpha, effect_size, standard_deviation. Ensure file is written to working directory and captured in output_files.",
    "expectedOutcome": "CSV file appears in outputFiles array with properly formatted sample size parameters"
  }]
}

Analyze the biostatistical analysis and provide your structured feedback NOW:`;

    try {
      // Call Claude with Tavily web search for domain-specific research
      // Use extended thinking mode for deeper clinical reasoning
      let response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }],
        tools: [
          tavilySearchTool.getClaudeToolDefinition('statistical'),  // R/stats methods
          tavilySearchTool.getClaudeToolDefinition('medical'),      // Medical literature
          tavilySearchTool.getClaudeToolDefinition('general')       // General web search
        ],
        // Enable extended thinking for thorough clinical analysis
        thinking: {
          type: 'enabled',
          budget_tokens: 2000  // Allow deep reasoning about clinical appropriateness
        }
      });

      // Handle tool use (Tavily web search)
      // Allow sufficient iterations for thorough research without limiting capacity
      let usedWebSearch = false;
      const MAX_TOOL_ITERATIONS = 10;  // Sufficient for comprehensive clinical research
      let toolIteration = 0;
      let currentResponse = response;
      const conversationMessages = [{
        role: 'user',
        content: prompt
      }];

      while (currentResponse.stop_reason === 'tool_use' && toolIteration < MAX_TOOL_ITERATIONS) {
        toolIteration++;
        usedWebSearch = true;

        // Add assistant's tool use request to conversation
        conversationMessages.push({
          role: 'assistant',
          content: currentResponse.content,
        });

        // Handle each tool use
        const toolResults = [];
        for (const block of currentResponse.content) {
          if (block.type === 'tool_use') {
            console.log(`   [Tavily] Clinical Judge requesting: ${block.name}("${block.input.query}")`);

            let searchResult;
            try {
              if (block.name === 'tavily_medical_search') {
                searchResult = await tavilySearchTool.searchMedical(block.input.query);
              } else if (block.name === 'tavily_r_documentation_search') {
                searchResult = await tavilySearchTool.searchRDocumentation(block.input.query);
              } else if (block.name === 'tavily_web_search') {
                searchResult = await tavilySearchTool.search(block.input.query, {
                  max_results: block.input.max_results || 3
                });
              } else {
                searchResult = { success: false, error: 'Unknown tool: ' + block.name };
              }

              const formattedResult = tavilySearchTool.formatResultsForAgent(searchResult);
              console.log(`   [Tavily] ${searchResult.success ? 'Found' : 'Failed'}: ${searchResult.results?.length || 0} results`);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: formattedResult
              });
            } catch (error) {
              console.error('   [Tavily] Search error:', error.message);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: `Search failed: ${error.message}. Please continue without web search.`,
                is_error: true
              });
            }
          }
        }

        // Add tool results to conversation
        conversationMessages.push({
          role: 'user',
          content: toolResults
        });

        // Get next response with tool results
        currentResponse = await anthropic.messages.create({
          model: this.model,
          max_tokens: 4096,
          temperature: 0.3,
          messages: conversationMessages,
          tools: [
            tavilySearchTool.getClaudeToolDefinition('statistical'),
            tavilySearchTool.getClaudeToolDefinition('medical'),
            tavilySearchTool.getClaudeToolDefinition('general')
          ],
          thinking: {
            type: 'enabled',
            budget_tokens: 2000
          }
        });
      }

      if (usedWebSearch) {
        console.log(`   ✓ Web search used: ${toolIteration} iteration(s)`);
      }

      // Extract feedback text from final response
      // CRITICAL FIX: Handle thinking blocks and multiple content blocks properly
      console.log(`   📝 Response has ${currentResponse.content.length} content blocks`);

      // Filter out thinking blocks and concatenate all text blocks
      const textBlocks = currentResponse.content.filter(block => block.type === 'text');
      const thinkingBlocks = currentResponse.content.filter(block => block.type === 'thinking');

      if (thinkingBlocks.length > 0) {
        console.log(`   🧠 Model used extended thinking (${thinkingBlocks.length} thinking block(s))`);
      }

      if (textBlocks.length === 0) {
        console.error('   ❌ CRITICAL: No text blocks in response!');
        console.error('   Response content:', JSON.stringify(currentResponse.content, null, 2));
        throw new Error('No text content in Claude response - only thinking blocks or empty response');
      }

      // Concatenate all text blocks (model might split response across multiple blocks)
      const feedbackText = textBlocks.map(block => block.text).join('\n');
      console.log(`   📄 Extracted text length: ${feedbackText.length} characters`);

      // Log first 500 chars for debugging
      if (feedbackText.length > 0) {
        console.log(`   📋 Response preview: ${feedbackText.substring(0, 500)}...`);
      }

      // Extract JSON from response - improved regex to handle nested objects properly
      // Look for complete JSON object from first { to matching }
      let feedback;
      try {
        // Try to find JSON in the response - handle nested objects properly
        const jsonStart = feedbackText.indexOf('{');
        const jsonEnd = feedbackText.lastIndexOf('}');

        if (jsonStart === -1 || jsonEnd === -1 || jsonStart >= jsonEnd) {
          console.error('   ❌ JSON extraction failed: No valid { } boundaries');
          console.error(`   jsonStart: ${jsonStart}, jsonEnd: ${jsonEnd}`);
          console.error(`   Full text: ${feedbackText}`);
          throw new Error('No valid JSON boundaries found in feedback response');
        }

        const jsonStr = feedbackText.substring(jsonStart, jsonEnd + 1);
        console.log(`   🔍 Attempting to parse JSON (${jsonStr.length} chars)...`);
        feedback = JSON.parse(jsonStr);
        console.log('   ✅ JSON parsed successfully');
      } catch (parseError) {
        console.error('   ⚠️  First JSON parse attempt failed:', parseError.message);
        console.error('   Trying regex fallback...');

        // If that fails, try a more conservative regex approach
        const jsonMatch = feedbackText.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (!jsonMatch) {
          console.error('   ❌ Regex JSON extraction also failed');
          console.error('   Full response text:', feedbackText);
          throw new Error('No valid JSON found in feedback response: ' + parseError.message);
        }

        try {
          feedback = JSON.parse(jsonMatch[0]);
          console.log('   ✅ JSON parsed successfully via regex fallback');
        } catch (secondError) {
          console.error('   ❌ Both JSON parse methods failed');
          console.error('   Original error:', parseError.message);
          console.error('   Regex fallback error:', secondError.message);
          console.error('   Matched text:', jsonMatch[0]);
          throw new Error('Failed to parse JSON from feedback: ' + secondError.message);
        }
      }

      // Validate structure
      if (!feedback.judgment || !feedback.issues || !feedback.suggestions) {
        console.error('   ❌ Invalid feedback structure:', feedback);
        console.error('   Missing fields:', {
          hasJudgment: !!feedback.judgment,
          hasIssues: !!feedback.issues,
          hasSuggestions: !!feedback.suggestions
        });
        throw new Error('Invalid feedback structure - missing required fields');
      }

      console.log(`   ✓ Generated ${feedback.issues.length} issues and ${feedback.suggestions.length} suggestions`);
      console.log(`   → Judgment: ${feedback.judgment} (confidence: ${feedback.confidence})`);

      return feedback;

    } catch (error) {
      console.error('❌ Error generating intelligent feedback:', error);
      console.error('   Error type:', error.constructor.name);
      console.error('   Error stack:', error.stack);

      // Fallback to simple PASS/FAIL if AI feedback fails
      return {
        judgment: biostatResult.executionSuccess ? 'CONDITIONAL_PASS' : 'FAIL',
        confidence: 0.5,
        summary: 'Unable to generate detailed feedback due to processing error',
        issues: biostatResult.error ? [{
          type: 'statistical_error',
          severity: 'CRITICAL',
          description: biostatResult.error,
          location: 'Execution',
          evidence: biostatResult.error
        }] : [],
        suggestions: [],
        strengths: [],
        reasoning: 'Fallback evaluation used due to AI feedback error',
        recommendedActions: {
          immediate: ['Review execution logs for errors'],
          followUp: [],
          escalate: true
        }
      };
    }
  }
}

// Export singleton instance
const clinicalJudgeAgent = new ClinicalJudgeAgent();

export default clinicalJudgeAgent;
export { ClinicalJudgeAgent };