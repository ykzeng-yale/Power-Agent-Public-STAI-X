/**
 * LLM-Based Judge Evaluator
 * Replaces regex-based score extraction with flexible LLM evaluation
 *
 * PURPOSE:
 * When agent output format varies, regex extraction fails. This module uses
 * Claude as a judge to evaluate agent output against benchmarks.
 *
 * ARCHITECTURE:
 * - Input: Agent's final output (any format) + Benchmark expectations
 * - Processing: LLM analyzes output for correctness, completeness, quality
 * - Output: Structured evaluation with scores and reasoning
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Evaluate agent output using LLM as a judge
 *
 * @param {Object} params - Evaluation parameters
 * @param {string} params.agentOutput - Final output from agent (any format)
 * @param {Object} params.benchmark - Benchmark expectations
 * @param {string} params.benchmark.query - Original user query
 * @param {string} params.benchmark.expectedResult - Expected result description
 * @param {Array} params.benchmark.criteria - Evaluation criteria
 * @param {string} params.rCode - R code executed (optional)
 * @param {string} params.executionOutput - R execution output (optional)
 * @param {Array} params.outputFiles - Generated files (optional)
 * @param {number} params.iterations - Number of iterations taken (optional)
 * @returns {Object} Structured evaluation result
 */
export async function evaluateWithLLM(params) {
  const {
    agentOutput,
    benchmark,
    rCode = null,
    executionOutput = null,
    outputFiles = [],
    iterations = null
  } = params;

  // Build evaluation prompt
  const evaluationPrompt = buildEvaluationPrompt({
    agentOutput,
    benchmark,
    rCode,
    executionOutput,
    outputFiles,
    iterations
  });

  console.log('[LLM Judge] Starting evaluation...');
  console.log(`[LLM Judge] Query: ${benchmark.query.substring(0, 100)}...`);

  try {
    // Call Claude for evaluation
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',  // Sonnet 4.6 for high-quality evaluation
      max_tokens: 2000,
      temperature: 0,  // Deterministic evaluation
      system: getJudgeSystemPrompt(),
      messages: [{
        role: 'user',
        content: evaluationPrompt
      }]
    });

    // Parse evaluation response
    const evaluationText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const evaluation = parseEvaluationResponse(evaluationText);

    console.log(`[LLM Judge] Evaluation complete: ${evaluation.finalScore}/100`);
    console.log(`[LLM Judge] Breakdown: ${JSON.stringify(evaluation.aspectScores)}`);

    return evaluation;

  } catch (error) {
    console.error('[LLM Judge] Evaluation failed:', error);

    // Return fallback evaluation
    return {
      success: false,
      finalScore: 0,
      aspectScores: {},
      reasoning: `Evaluation error: ${error.message}`,
      passed: false
    };
  }
}

/**
 * Build evaluation prompt for LLM judge
 */
function buildEvaluationPrompt(params) {
  const { agentOutput, benchmark, rCode, executionOutput, outputFiles, iterations } = params;

  let prompt = `You are evaluating a biostatistical agent's response to the following query:

**USER QUERY:**
${benchmark.query}

**EXPECTED RESULT:**
${benchmark.expectedResult || 'Correct biostatistical analysis with appropriate methodology'}

**EVALUATION CRITERIA:**
${benchmark.criteria ? benchmark.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n') : `
1. Method Correctness - Uses appropriate statistical test for the query
2. Parameter Accuracy - User-specified values are correctly applied
3. Execution Success - Code runs without errors
4. Output Completeness - All requested elements are present
5. Clinical Validity - Results are clinically reasonable
`}

**AGENT'S FINAL OUTPUT:**
${agentOutput}
`;

  // Add optional context
  if (rCode) {
    prompt += `\n\n**R CODE EXECUTED:**\n\`\`\`r\n${rCode.substring(0, 2000)}\n\`\`\`\n`;
  }

  if (executionOutput) {
    prompt += `\n\n**EXECUTION OUTPUT:**\n${executionOutput.substring(0, 1000)}\n`;
  }

  if (outputFiles && outputFiles.length > 0) {
    prompt += `\n\n**OUTPUT FILES GENERATED:**\n`;
    outputFiles.forEach(file => {
      prompt += `- ${file.name} (${file.size} bytes, ${file.type})\n`;
    });
  }

  if (iterations !== null) {
    prompt += `\n\n**ITERATIONS:** ${iterations}\n`;
  }

  prompt += `\n\n**INSTRUCTIONS:**
Evaluate the agent's response based on the criteria above. For each criterion:
1. Determine if it was satisfied (Yes/No)
2. Provide brief reasoning
3. Assign a score (0-100)

Then calculate a final score and determine if the response passes (≥80/100).

**IMPORTANT:**
- Focus on correctness and completeness, not format
- Check if methodology matches the query type
- Verify numerical results make sense
- Consider clinical plausibility

Provide your evaluation in this exact JSON format:
\`\`\`json
{
  "aspectScores": {
    "methodCorrectness": 0-100,
    "parameterAccuracy": 0-100,
    "executionSuccess": 0-100,
    "outputCompleteness": 0-100,
    "clinicalValidity": 0-100
  },
  "reasoning": {
    "methodCorrectness": "Brief explanation...",
    "parameterAccuracy": "Brief explanation...",
    "executionSuccess": "Brief explanation...",
    "outputCompleteness": "Brief explanation...",
    "clinicalValidity": "Brief explanation..."
  },
  "finalScore": 0-100,
  "passed": true/false,
  "summary": "Brief overall assessment (1-2 sentences)"
}
\`\`\``;

  return prompt;
}

/**
 * System prompt for judge
 */
function getJudgeSystemPrompt() {
  return `You are an expert biostatistician and evaluator. Your role is to assess the quality and correctness of biostatistical analyses.

You evaluate responses based on:
- Statistical methodology appropriateness
- Numerical accuracy and parameter usage
- Execution success and error handling
- Completeness of deliverables
- Clinical plausibility of results

You provide objective, evidence-based evaluations with clear reasoning. You distinguish between minor format issues and substantive methodological errors.

You are NOT lenient - a passing score (80+/100) requires demonstrable correctness across all major dimensions.`;
}

/**
 * Parse LLM evaluation response
 */
function parseEvaluationResponse(evaluationText) {
  // Extract JSON from response
  const jsonMatch = evaluationText.match(/```json\n([\s\S]*?)\n```/);

  if (!jsonMatch) {
    console.warn('[LLM Judge] Could not parse JSON from response, attempting direct parse...');
    // Try to parse entire response as JSON
    try {
      const parsed = JSON.parse(evaluationText);
      return normalizeEvaluation(parsed);
    } catch (e) {
      console.error('[LLM Judge] JSON parse failed:', e.message);
      return {
        success: false,
        finalScore: 0,
        aspectScores: {},
        reasoning: {},
        passed: false,
        summary: 'Failed to parse evaluation response'
      };
    }
  }

  try {
    const evaluation = JSON.parse(jsonMatch[1]);
    return normalizeEvaluation(evaluation);
  } catch (error) {
    console.error('[LLM Judge] JSON parse error:', error.message);
    return {
      success: false,
      finalScore: 0,
      aspectScores: {},
      reasoning: {},
      passed: false,
      summary: 'Failed to parse evaluation JSON'
    };
  }
}

/**
 * Normalize evaluation structure
 */
function normalizeEvaluation(evaluation) {
  return {
    success: true,
    finalScore: evaluation.finalScore || 0,
    aspectScores: evaluation.aspectScores || {},
    reasoning: evaluation.reasoning || {},
    passed: evaluation.passed === true,
    summary: evaluation.summary || 'Evaluation completed',

    // Add metadata
    evaluatedAt: new Date().toISOString(),
    evaluator: 'llm-judge-claude-sonnet-4'
  };
}

/**
 * Batch evaluate multiple agent outputs
 *
 * @param {Array} evaluations - Array of evaluation parameters
 * @returns {Array} Array of evaluation results
 */
export async function batchEvaluate(evaluations) {
  console.log(`[LLM Judge] Starting batch evaluation of ${evaluations.length} responses...`);

  const results = [];

  for (let i = 0; i < evaluations.length; i++) {
    const params = evaluations[i];
    console.log(`[LLM Judge] Evaluating ${i + 1}/${evaluations.length}...`);

    try {
      const result = await evaluateWithLLM(params);
      results.push({
        ...result,
        testCase: params.testCase || `Test ${i + 1}`
      });
    } catch (error) {
      console.error(`[LLM Judge] Error evaluating test ${i + 1}:`, error);
      results.push({
        success: false,
        finalScore: 0,
        aspectScores: {},
        reasoning: { error: error.message },
        passed: false,
        testCase: params.testCase || `Test ${i + 1}`
      });
    }

    // Rate limiting: small delay between evaluations
    if (i < evaluations.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  // Calculate summary statistics
  const summary = calculateBatchSummary(results);
  console.log('[LLM Judge] Batch evaluation complete:');
  console.log(`  Pass rate: ${summary.passRate}% (${summary.passed}/${summary.total})`);
  console.log(`  Average score: ${summary.averageScore.toFixed(1)}/100`);

  return {
    results,
    summary
  };
}

/**
 * Calculate summary statistics for batch evaluation
 */
function calculateBatchSummary(results) {
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const scores = results.map(r => r.finalScore);
  const averageScore = scores.reduce((sum, s) => sum + s, 0) / total;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);

  return {
    total,
    passed,
    failed: total - passed,
    passRate: Math.round((passed / total) * 100),
    averageScore,
    minScore,
    maxScore
  };
}

export default {
  evaluateWithLLM,
  batchEvaluate
};
