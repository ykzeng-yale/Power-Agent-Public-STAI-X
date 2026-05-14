/**
 * LLM-Based Benchmark Judge
 *
 * Uses Claude to judge whether agent output meets benchmark expectations
 * More robust than regex for natural language outputs
 *
 * Created: October 19, 2025
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Use LLM to judge if agent output meets benchmark criteria
 *
 * @param {Object} benchmark - Benchmark specification
 * @param {string} agentOutput - Agent's final output
 * @param {Object} groundTruth - Expected ground truth values
 * @returns {Promise<Object>} - Judgment with pass/fail and extracted values
 */
export async function judgeAgentOutput(benchmark, agentOutput, groundTruth) {

  const judgePrompt = `You are a statistical validation expert. Your task is to determine if an AI agent's output correctly solves a power analysis problem.

**Benchmark Problem:**
${benchmark.query}

**Expected Ground Truth:**
${JSON.stringify(groundTruth, null, 2)}

**Agent's Output:**
${agentOutput}

**Your Task:**
1. Extract the numerical results from the agent's output
2. Compare them to the ground truth values
3. Determine if the agent's answer is CORRECT

**Important Validation Rules:**

For **sample size calculations (n)**:
- Allow ≤5% relative error (e.g., n=64 vs n=63.76 is PASS)
- Round to nearest integer is acceptable
- Report both values and relative error

For **power calculations**:
- Allow ≤2% absolute error (e.g., 0.80 vs 0.81 is PASS)
- Allow ≤3% relative error for powers <0.50
- Report both values and absolute difference

For **pmsampsize results**:
- Sample size: ≤5% relative error
- Events: ≤10% relative error (smaller numbers, more variability)
- EPP (events per parameter): ≤10% relative error
- Check if agent used CORRECT parameter names:
  - Binary: csrsquared (NOT rsquared)
  - Continuous: rsquared AND intercept (both required)
  - Prevalence for binary outcomes

For **mixed effects (simr)**:
- Power estimates: Allow ±0.10 absolute (Monte Carlo variability)
- Check if agent used appropriate nsim (≥1000 recommended)

**Respond in JSON format:**
\`\`\`json
{
  "verdict": "PASS" or "FAIL",
  "confidence": 0.0 to 1.0,
  "extracted_values": {
    "key1": value1,
    "key2": value2,
    ...
  },
  "ground_truth_values": {
    "key1": expected1,
    "key2": expected2,
    ...
  },
  "comparison": {
    "key1": {"match": true/false, "error": "X%", "reason": "..."},
    ...
  },
  "critical_checks": {
    "used_correct_package": true/false,
    "used_correct_parameters": true/false,
    "calculations_accurate": true/false,
    "interpretation_correct": true/false
  },
  "reasoning": "Brief explanation of why PASS or FAIL",
  "issues": ["list", "of", "any", "problems", "found"]
}
\`\`\`

Be strict but fair. Small rounding differences are acceptable. Major errors or wrong methods are FAIL.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: judgePrompt
      }]
    });

    const responseText = response.content[0].text;

    // Extract JSON from response
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) ||
                     responseText.match(/{[\s\S]*}/);

    if (!jsonMatch) {
      throw new Error('Could not extract JSON from judge response');
    }

    const judgment = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    return {
      ...judgment,
      raw_response: responseText,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ LLM Judge Error:', error.message);
    return {
      verdict: 'ERROR',
      confidence: 0,
      reasoning: `Judge failed: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Enhanced benchmark validation using LLM judge
 *
 * @param {Object} result - Agent execution result
 * @param {Object} benchmark - Benchmark specification
 * @returns {Promise<Object>} - Enhanced validation result
 */
export async function validateWithLLMJudge(result, benchmark) {

  console.log('\n🤖 LLM Judge Validation');
  console.log('━'.repeat(80));

  const judgment = await judgeAgentOutput(
    benchmark,
    result.finalOutput,
    benchmark.groundTruth
  );

  console.log(`\nVerdict: ${judgment.verdict === 'PASS' ? '✅' : '❌'} ${judgment.verdict}`);
  console.log(`Confidence: ${(judgment.confidence * 100).toFixed(1)}%`);
  console.log(`\nReasoning: ${judgment.reasoning}`);

  if (judgment.extracted_values) {
    console.log('\n📊 Extracted Values:');
    console.log(JSON.stringify(judgment.extracted_values, null, 2));
  }

  if (judgment.comparison) {
    console.log('\n📏 Comparison:');
    for (const [key, comp] of Object.entries(judgment.comparison)) {
      const icon = comp.match ? '✅' : '❌';
      console.log(`${icon} ${key}: ${comp.error || comp.reason}`);
    }
  }

  if (judgment.critical_checks) {
    console.log('\n🔍 Critical Checks:');
    for (const [check, passed] of Object.entries(judgment.critical_checks)) {
      const icon = passed ? '✅' : '❌';
      console.log(`${icon} ${check}: ${passed}`);
    }
  }

  if (judgment.issues && judgment.issues.length > 0) {
    console.log('\n⚠️  Issues Found:');
    judgment.issues.forEach(issue => console.log(`  - ${issue}`));
  }

  return {
    passed: judgment.verdict === 'PASS',
    judgment,
    benchmark: benchmark.name,
    timestamp: new Date().toISOString()
  };
}

/**
 * Batch validate multiple benchmarks with LLM judge
 */
export async function validateBenchmarksWithLLM(results, benchmarks) {

  console.log('\n🤖 LLM JUDGE BATCH VALIDATION');
  console.log('='.repeat(80));

  const validations = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const benchmark = benchmarks[i];

    console.log(`\n[${i + 1}/${results.length}] Validating: ${benchmark.name}`);

    const validation = await validateWithLLMJudge(result, benchmark);
    validations.push(validation);

    // Small delay to avoid rate limiting
    if (i < results.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📊 VALIDATION SUMMARY\n');

  const passed = validations.filter(v => v.passed).length;
  const total = validations.length;

  console.log(`Tests Passed: ${passed}/${total} (${(passed/total*100).toFixed(1)}%)\n`);

  validations.forEach((v, i) => {
    const icon = v.passed ? '✅' : '❌';
    const confidence = v.judgment.confidence
      ? ` (${(v.judgment.confidence * 100).toFixed(0)}% confidence)`
      : '';
    console.log(`${icon} ${v.benchmark}${confidence}`);
  });

  return {
    passed,
    total,
    rate: passed / total,
    validations
  };
}

export default {
  judgeAgentOutput,
  validateWithLLMJudge,
  validateBenchmarksWithLLM
};
