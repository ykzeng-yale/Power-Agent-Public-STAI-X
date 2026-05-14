/**
 * Validate Collected Test Results with LLM Judge
 *
 * Uses LLM judge to validate test results we already collected
 */

import dotenv from 'dotenv';
import { Storage } from '@google-cloud/storage';
import { judgeAgentOutput } from './llm-benchmark-judge.js';

dotenv.config();

const storage = new Storage();

// Test results we already have from the test run
const testResults = [
  {
    id: 'test-1-simple-ttest',
    name: 'Simple t-test (should use pwr)',
    gcsPath: 'gs://power-agent-results-476822/results/2025-10-19T06-31-53-771Z_result.json',
    query: `I'm designing a randomized controlled trial comparing two treatments.
    I expect a medium effect size (Cohen's d = 0.5) and want 80% power with α=0.05.
    How many participants do I need per group?`,
    expectedResults: {
      package: 'pwr',
      function: 'pwr.t.test',
      n_per_group: 63.76561,
      effect_size: 0.5,
      power: 0.8,
      alpha: 0.05
    }
  },
  {
    id: 'test-2-regression-pwrss',
    name: 'Regression with covariates (should use pwrss)',
    gcsPath: 'gs://power-agent-results-476822/results/2025-10-19T06-39-25-289Z_result.json',
    query: `I'm studying the effect of a new drug on blood pressure, controlling for
    age, sex, and baseline BP. I expect the full model R² = 0.30 and the model without
    the drug effect R² = 0.20. I have 3 covariates being tested.
    What sample size do I need for 80% power?`,
    expectedResults: {
      package: 'pwrss',
      function: 'pwrss.f.reg',
      r2_full: 0.30,
      r2_reduced: 0.20,
      power: 0.8
    }
  },
  {
    id: 'test-3-mixed-lme4-simr',
    name: 'Repeated measures (should use lme4+simr)',
    gcsPath: 'gs://power-agent-results-476822/results/2025-10-19T06-41-36-456Z_result.json',
    query: `I'm planning a longitudinal study where participants are measured at
    baseline and 3 follow-ups (4 time points total). Treatment group gets intervention,
    control gets placebo. I expect ICC = 0.05 and want to detect a treatment × time
    interaction. What sample size do I need for 80% power?`,
    expectedResults: {
      package: 'lme4 + simr',
      method: 'Monte Carlo simulation',
      icc: 0.05,
      power_target: 0.8
    }
  }
];

async function downloadResultFromGCS(gcsPath) {
  const [, , bucket, ...pathParts] = gcsPath.split('/');
  const filePath = pathParts.join('/');

  const file = storage.bucket(bucket).file(filePath);
  const [contents] = await file.download();
  return JSON.parse(contents.toString());
}

async function validateWithLLMJudge() {
  console.log('\n🤖 LLM JUDGE VALIDATION OF COLLECTED RESULTS\n');
  console.log('=' .repeat(80));

  const validations = [];

  for (const test of testResults) {
    console.log(`\n📋 [${test.id}] ${test.name}`);
    console.log('-'.repeat(80));

    try {
      // Download result from GCS
      console.log(`📥 Downloading from: ${test.gcsPath}`);
      const result = await downloadResultFromGCS(test.gcsPath);

      const agentOutput = result.output || result.cell_outputs || '';

      console.log(`\n📝 Agent Output (first 300 chars):`);
      console.log(agentOutput.substring(0, 300) + '...\n');

      // Use LLM judge to validate
      console.log('🤖 Invoking LLM Judge...');
      const judgment = await judgeAgentOutput(
        { query: test.query, name: test.name },
        agentOutput,
        test.expectedResults
      );

      // Display results
      const icon = judgment.verdict === 'PASS' ? '✅' : '❌';
      console.log(`\n${icon} VERDICT: ${judgment.verdict}`);
      console.log(`📊 Confidence: ${(judgment.confidence * 100).toFixed(1)}%`);
      console.log(`\n💭 Reasoning: ${judgment.reasoning}`);

      if (judgment.extracted_values) {
        console.log(`\n📊 Extracted Values:`);
        console.log(JSON.stringify(judgment.extracted_values, null, 2));
      }

      if (judgment.critical_checks) {
        console.log(`\n🔍 Critical Checks:`);
        for (const [check, passed] of Object.entries(judgment.critical_checks)) {
          const checkIcon = passed ? '✅' : '❌';
          console.log(`  ${checkIcon} ${check}: ${passed}`);
        }
      }

      if (judgment.issues && judgment.issues.length > 0) {
        console.log(`\n⚠️  Issues:`);
        judgment.issues.forEach(issue => console.log(`  - ${issue}`));
      }

      validations.push({
        test: test.id,
        name: test.name,
        verdict: judgment.verdict,
        confidence: judgment.confidence,
        judgment
      });

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`\n❌ ERROR: ${error.message}`);
      validations.push({
        test: test.id,
        name: test.name,
        verdict: 'ERROR',
        error: error.message
      });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 VALIDATION SUMMARY\n');

  const passed = validations.filter(v => v.verdict === 'PASS').length;
  const total = validations.length;

  console.log(`Tests Passed: ${passed}/${total} (${(passed/total*100).toFixed(1)}%)\n`);

  validations.forEach(v => {
    const icon = v.verdict === 'PASS' ? '✅' : (v.verdict === 'ERROR' ? '⚠️' : '❌');
    const confidence = v.confidence ? ` (${(v.confidence * 100).toFixed(0)}% confidence)` : '';
    console.log(`${icon} ${v.name}${confidence}`);
  });

  return validations;
}

// Run validation
validateWithLLMJudge()
  .then(results => {
    const allPassed = results.every(r => r.verdict === 'PASS');
    process.exit(allPassed ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
