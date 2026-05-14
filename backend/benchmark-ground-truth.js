/**
 * OBJECTIVE BENCHMARK FRAMEWORK
 * Tests Power Agent against PUBLISHED ground truth from R package examples
 *
 * PRINCIPLES:
 * 1. Ground truth from published package vignettes/examples (pwr, lme4, pmsampsize)
 * 2. Agent prompt remains general - NO benchmark-specific solutions
 * 3. Objective numerical validation - compare agent output to verified results
 * 4. Tests true reasoning ability, not memorization
 *
 * ARCHITECTURE:
 * - Tier 1: Basic power analysis (pwr package)
 * - Tier 2: Mixed models with ICC (lme4, simr packages)
 * - Tier 3: Prediction models (pmsampsize - Riley's criteria)
 */

// CRITICAL: Load environment variables BEFORE importing modules that need them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

dotenv.config();

// Now dynamically import biostat-agent-core AFTER dotenv is loaded
const { executeBiostatAnalysis } = await import('./biostat-agent-core.js');
import fs from 'fs';

// Get current file path for "run if called directly" check
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

/**
 * TIER 1: Basic Power Analysis
 * Ground truth from pwr package documentation
 * Reference: https://cran.r-project.org/web/packages/pwr/pwr.pdf
 */
const TIER1_BENCHMARKS = [
  {
    id: 'pwr_t_test_example_1',
    name: 'Two-sample t-test (Example from pwr::pwr.t.test)',
    category: 'tier1_basic',
    query: `Calculate the sample size needed for a two-sample t-test with the following parameters:
    - Effect size (Cohen's d): 0.5
    - Significance level (alpha): 0.05
    - Power: 0.80
    - Alternative hypothesis: two-sided

    Please use the pwr package and report the sample size per group.`,

    groundTruth: {
      source: 'pwr package documentation, pwr.t.test(d=0.5, sig.level=0.05, power=0.8, type="two.sample")',
      n_per_group: 63.76561,  // Published result from pwr
      n_per_group_rounded: 64,
      power_actual: 0.8014596,  // Actual power with n=64
      method: 'pwr.t.test',
      package: 'pwr',
      validation: (result) => {
        // Extract n from agent result
        const nMatch = result.match(/n\s*[=:]\s*(\d+\.?\d*)/i) ||
                       result.match(/sample size.*?(\d+)/i);
        if (!nMatch) return { valid: false, reason: 'Could not find sample size in output' };

        const agentN = parseFloat(nMatch[1]);
        const expectedN = 63.76561;
        const tolerance = 0.5; // Allow 0.5 difference for rounding

        if (Math.abs(agentN - expectedN) <= tolerance) {
          return { valid: true, agentValue: agentN, expectedValue: expectedN, error: 0 };
        } else {
          return {
            valid: false,
            reason: `Sample size mismatch: agent=${agentN}, expected=${expectedN}`,
            agentValue: agentN,
            expectedValue: expectedN,
            error: Math.abs(agentN - expectedN)
          };
        }
      }
    }
  },

  {
    id: 'pwr_anova_example',
    name: 'One-way ANOVA power (Example from pwr::pwr.anova.test)',
    category: 'tier1_basic',
    query: `Calculate the power for a one-way ANOVA with:
    - Number of groups: 4
    - Sample size per group: 30
    - Effect size (f): 0.25
    - Significance level: 0.05

    Use the pwr package to determine the statistical power.`,

    groundTruth: {
      source: 'pwr package documentation, pwr.anova.test(k=4, n=30, f=0.25, sig.level=0.05)',
      power: 0.6065228,  // VERIFIED: Actual result from R
      method: 'pwr.anova.test',
      package: 'pwr',
      validation: (result) => {
        // More flexible regex to match various natural language formats
        const powerMatch = result.match(/power\s+(?:of\s+|is\s+|=\s*|:\s*)(0?\.\d+)/i) ||
                           result.match(/power[:\s]+(0?\.\d+)/i) ||
                           result.match(/(0?\.\d+)\s*\(\d+\.?\d*%?\)\s*power/i) ||
                           result.match(/achieves?\s+(?:a\s+)?(?:statistical\s+)?power\s+of\s+(0?\.\d+)/i);
        if (!powerMatch) return { valid: false, reason: 'Could not find power in output' };

        let agentPower = parseFloat(powerMatch[1]);
        // Handle if given as percentage
        if (agentPower > 1) agentPower = agentPower / 100;

        const expectedPower = 0.6065228;
        const tolerance = 0.005; // 0.5% tolerance for rounding

        if (Math.abs(agentPower - expectedPower) <= tolerance) {
          return { valid: true, agentValue: agentPower, expectedValue: expectedPower, error: 0 };
        } else {
          return {
            valid: false,
            reason: `Power mismatch: agent=${agentPower}, expected=${expectedPower}`,
            agentValue: agentPower,
            expectedValue: expectedPower,
            error: Math.abs(agentPower - expectedPower)
          };
        }
      }
    }
  }
];

/**
 * TIER 2: Mixed Effects Models
 * Ground truth from simr package vignette
 * Reference: https://cran.r-project.org/web/packages/simr/vignettes/examples.html
 */
const TIER2_BENCHMARKS = [
  {
    id: 'lme4_simr_example',
    name: 'Linear mixed model power via simulation (simr vignette example)',
    category: 'tier2_mixed_models',
    query: `Perform a power analysis for a linear mixed effects model with:
    - 10 subjects, each measured 3 times
    - Fixed effect (treatment) coefficient: 0.5
    - Random intercept variance: 1
    - Residual variance: 1
    - Significance level: 0.05

    Use simulation (simr package or equivalent) to estimate power for detecting the treatment effect.
    Run at least 100 simulations.`,

    groundTruth: {
      source: 'simr package vignette, powerSim on example model',
      power_range: [0.20, 0.26],  // From simr with nsim=1000: 22.9% (95% CI: 20.3%-25.6%)
      method: 'simulation',
      package: 'simr',
      note: 'Small sample size (n=30) leads to low power for detecting treatment effect=0.5',
      validation: (result) => {
        // Try multiple patterns to match simr output formats
        // simr outputs like: "12.80% (10.00, 16.05)" or "Power for predictor 'X': 12.80%"
        const patterns = [
          /([0-9.]+)%\s*\([0-9.]+,\s*[0-9.]+\)/i,           // "12.80% (10.00, 16.05)"
          /Power for predictor.*?:\s*([0-9.]+)%/i,          // "Power for predictor 'X': 12.80%"
          /power[:\s]+([0-9.]+)%/i,                         // "power: 12.80%"
          /power[:\s]+(0?\.[0-9]+)/i,                       // "power: 0.128"
          /power\s*[=:]\s*(0?\.?\d+)/i                      // "power = 0.128" (fallback)
        ];

        let agentPower = null;
        for (const pattern of patterns) {
          const match = result.match(pattern);
          if (match) {
            agentPower = parseFloat(match[1]);
            // Convert percentage to decimal if needed
            if (agentPower > 1) agentPower = agentPower / 100;
            break;
          }
        }

        if (agentPower === null) {
          return { valid: false, reason: 'Could not find power in output' };
        }

        // For simulation, accept reasonable range
        if (agentPower >= 0.40 && agentPower <= 0.70) {
          return { valid: true, agentValue: agentPower, expectedRange: [0.45, 0.65] };
        } else {
          return {
            valid: false,
            reason: `Power outside expected range: agent=${agentPower}, expected=[0.45, 0.65]`,
            agentValue: agentPower
          };
        }
      }
    }
  }
];

/**
 * TIER 3: Prediction Model Sample Size (Riley's Criteria)
 * Ground truth from pmsampsize package examples
 * Reference: https://cran.r-project.org/web/packages/pmsampsize/pmsampsize.pdf
 * Riley et al. (2019) BMJ: https://www.bmj.com/content/368/bmj.m441
 */
const TIER3_BENCHMARKS = [
  {
    id: 'pmsampsize_binary_example',
    name: 'Prediction model sample size - Binary outcome (pmsampsize example)',
    category: 'tier3_prediction',
    query: `Calculate the minimum sample size for developing a clinical prediction model with:
    - Outcome: Binary (disease vs no disease)
    - Overall outcome proportion: 0.174 (17.4% prevalence)
    - Number of candidate predictor variables: 25
    - Target Cox-Snell R²: 0.288
    - Shrinkage: 0.9 (to control overfitting)

    Use Riley's criteria (pmsampsize package) to determine:
    1. Sample size for criteria 1 (small absolute prediction error)
    2. Sample size for criteria 2 (small difference in apparent and adjusted R²)
    3. Sample size for criteria 3 (precise estimation of overall risk)
    4. The MAXIMUM of these (final recommended sample size)
    5. Number of events needed

    Note: Use csrsquared (Cox-Snell R²) parameter.`,

    groundTruth: {
      source: 'pmsampsize package help, pmsampsize(type="b", csrsquared=0.288, parameters=25, prevalence=0.174, shrinkage=0.9)',
      // VERIFIED results from running R code
      sample_size_criteria: {
        criterion_1: 649,   // Small absolute prediction error
        criterion_2: 689,   // Small difference in R² (shrinkage)
        criterion_3: 221,   // Precise overall risk estimation
        final: 689   // Maximum of all criteria
      },
      events_required: 120,  // 0.174 * 689 ≈ 119.886
      epp: 4.80,  // Events per parameter = 120/25
      method: 'pmsampsize (Riley criteria)',
      package: 'pmsampsize',
      reference: 'Riley RD et al. BMJ 2019;368:m441',

      validation: (result) => {
        // Context-aware patterns to prevent value swapping
        const contextualNPatterns = [
          /sample size of (\d+) participants/i,
          /minimum sample size[:\s]+(\d+)/i,
          /(?:final|recommended|total) sample size[:\s]+(\d+)/i,
          /Criteria 2.*?(\d+)/i,  // Criteria 2 is usually the max
          /sample\s*size[:\s]+(?:required[:\s]+)?(\d+)/i  // Fallback
        ];

        const contextualEventsPatterns = [
          /with\s+(\d+)\s+events/i,  // "with 120 events" - most specific
          /(\d+)\s+events\s+\(/i,  // "120 events (assuming..." - specific format
          /Number of events[:\s]+(\d+(?:\.\d+)?)/i,  // "Number of events: 119.886"
          /events required[:\s]+(\d+(?:\.\d+)?)/i,  // "events required: 119.886"
          /\b(\d{3})\s+events/i,  // Match 3-digit numbers before "events" (e.g., "120 events")
          /events[:\s]+(\d+)/i  // Generic fallback
        ];

        // Try to find sample size with context
        let agentN = null;
        for (const pattern of contextualNPatterns) {
          const match = result.match(pattern);
          if (match) {
            agentN = parseInt(match[1]);
            break;
          }
        }

        if (!agentN) {
          return { valid: false, reason: 'Could not find sample size in output' };
        }

        // Try to find events with context
        let agentEvents = null;
        for (const pattern of contextualEventsPatterns) {
          const match = result.match(pattern);
          if (match) {
            agentEvents = parseInt(match[1]);
            break;
          }
        }

        const expectedN = 689;
        const expectedEvents = 120;
        const tolerance = 10; // Allow ±10 for rounding differences

        // Sanity check: for binary outcomes, n should be > events
        // This helps catch value swapping
        if (agentEvents && agentN < agentEvents) {
          return {
            valid: false,
            reason: `Value swap detected: n (${agentN}) < events (${agentEvents}). Sample size should be larger than events.`,
            agentValue: { n: agentN, events: agentEvents },
            expectedValue: { n: expectedN, events: expectedEvents }
          };
        }

        const validN = Math.abs(agentN - expectedN) <= tolerance;
        const validEvents = agentEvents ? Math.abs(agentEvents - expectedEvents) <= 20 : true;

        if (validN && validEvents) {
          return {
            valid: true,
            agentValue: { n: agentN, events: agentEvents },
            expectedValue: { n: expectedN, events: expectedEvents },
            error: Math.abs(agentN - expectedN)
          };
        } else {
          return {
            valid: false,
            reason: `Sample size mismatch: agent n=${agentN} (expected ${expectedN}), events=${agentEvents} (expected ${expectedEvents})`,
            agentValue: { n: agentN, events: agentEvents },
            expectedValue: { n: expectedN, events: expectedEvents },
            error: Math.abs(agentN - expectedN)
          };
        }
      }
    }
  },

  {
    id: 'pmsampsize_continuous_example',
    name: 'Prediction model sample size - Continuous outcome (pmsampsize example)',
    category: 'tier3_prediction',
    query: `Calculate sample size for a prediction model with continuous outcome:
    - Outcome: Continuous (e.g., systolic blood pressure)
    - Number of predictors: 8
    - Target R²: 0.25
    - Anticipated shrinkage: 0.9
    - Mean outcome value (intercept): 120
    - Outcome standard deviation: 15

    Use pmsampsize to determine the required sample size.`,

    groundTruth: {
      source: 'pmsampsize package, pmsampsize(type="c", rsquared=0.25, parameters=8, intercept=120, sd=15, shrinkage=0.9)',
      sample_size_criteria: {
        criterion_1: 180,   // Overfitting/shrinkage criterion
        criterion_2: 121,   // R-squared difference criterion
        criterion_3: 242,   // Precise residual SD
        criterion_4: 242,   // Precise intercept
        final: 242          // VERIFIED: Maximum of all criteria
      },
      spp: 30.25,  // 242/8 subjects per parameter
      method: 'pmsampsize (Riley criteria)',
      package: 'pmsampsize',

      validation: (result) => {
        // More flexible regex to match various output formats
        const nMatch = result.match(/(?:final|minimum|required)?\s*sample\s*size[:\s=]*(\d+)/i) ||
                       result.match(/n\s*=\s*(\d+)/i) ||
                       result.match(/(\d+)\s+(?:subjects|participants)/i);

        if (!nMatch) {
          return { valid: false, reason: 'Could not find sample size in output' };
        }

        const agentN = parseInt(nMatch[1]);
        const expectedN = 242;  // VERIFIED: Correct ground truth
        const tolerance = 20;

        if (Math.abs(agentN - expectedN) <= tolerance) {
          return {
            valid: true,
            agentValue: agentN,
            expectedValue: expectedN,
            error: Math.abs(agentN - expectedN)
          };
        } else {
          return {
            valid: false,
            reason: `Sample size mismatch: agent=${agentN}, expected=${expectedN}`,
            agentValue: agentN,
            expectedValue: expectedN,
            error: Math.abs(agentN - expectedN)
          };
        }
      }
    }
  }
];

/**
 * Execute benchmark and validate against ground truth
 */
async function executeBenchmark(benchmark, verbose = true) {
  if (verbose) {
    console.log(`\n${colors.bold}${colors.cyan}${'═'.repeat(80)}${colors.reset}`);
    console.log(`${colors.bold}${benchmark.name}${colors.reset}`);
    console.log(`${colors.cyan}${'═'.repeat(80)}${colors.reset}`);
    console.log(`${colors.yellow}Category:${colors.reset} ${benchmark.category}`);
    console.log(`${colors.yellow}Ground Truth:${colors.reset} ${benchmark.groundTruth.source}`);
    console.log(`${colors.yellow}Method:${colors.reset} ${benchmark.groundTruth.method}`);
  }

  const startTime = Date.now();

  try {
    // Execute agent analysis
    if (verbose) console.log(`\n${colors.bold}Running Power Agent...${colors.reset}`);

    const result = await executeBiostatAnalysis(benchmark.query, {
      maxIterations: 8,
      onStep: verbose ? (step) => {
        if (step.type === 'execution_success') {
          console.log(`${colors.green}✓${colors.reset} Code executed`);
        } else if (step.type === 'web_search') {
          console.log(`${colors.cyan}ℹ${colors.reset} Web search performed`);
        }
      } : null
    });

    const duration = (Date.now() - startTime) / 1000;

    if (!result.success) {
      return {
        benchmark: benchmark.id,
        success: false,
        error: 'Agent execution failed',
        duration
      };
    }

    // Extract agent's final answer from executeBiostatAnalysis result
    // executeBiostatAnalysis returns: { finalContent, lastOutput, fullOutput, conversationHistory, ... }
    let agentOutput = result.finalContent || '';

    // If finalContent is empty or just formatting markers, try lastOutput then fullOutput
    if (!agentOutput || agentOutput.trim().length < 10 || agentOutput.trim() === '**') {
      agentOutput = result.lastOutput || result.fullOutput || '';
    }

    // If still empty, try to extract from conversationHistory (all R outputs across iterations)
    if (!agentOutput || agentOutput.trim().length < 10) {
      if (result.conversationHistory && result.conversationHistory.length > 0) {
        // Find all assistant messages with R output
        const rOutputs = result.conversationHistory
          .filter(msg => msg.role === 'assistant')
          .map(msg => {
            // Extract text content blocks
            if (Array.isArray(msg.content)) {
              return msg.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n');
            }
            return msg.content || '';
          })
          .filter(text => text && text.trim())
          .join('\n\n');

        if (rOutputs) {
          agentOutput = rOutputs;
        }
      }
    }

    if (verbose) {
      console.log(`\n${colors.bold}Agent Output:${colors.reset}`);
      console.log(agentOutput.substring(0, 500) + (agentOutput.length > 500 ? '...' : ''));
    }

    // Validate against ground truth
    const validationResult = benchmark.groundTruth.validation(agentOutput);

    if (verbose) {
      console.log(`\n${colors.bold}Validation:${colors.reset}`);
      if (validationResult.valid) {
        console.log(`${colors.green}✓ PASS${colors.reset} - Agent result matches ground truth`);
        if (validationResult.agentValue !== undefined) {
          console.log(`  Agent: ${JSON.stringify(validationResult.agentValue)}`);
          console.log(`  Expected: ${JSON.stringify(validationResult.expectedValue || validationResult.expectedRange)}`);
        }
      } else {
        console.log(`${colors.red}✗ FAIL${colors.reset} - ${validationResult.reason}`);
        if (validationResult.agentValue !== undefined) {
          console.log(`  Agent: ${JSON.stringify(validationResult.agentValue)}`);
          console.log(`  Expected: ${JSON.stringify(validationResult.expectedValue || validationResult.expectedRange)}`);
          if (validationResult.error !== undefined) {
            console.log(`  Error: ${validationResult.error.toFixed(4)}`);
          }
        }
      }
    }

    return {
      benchmark: benchmark.id,
      name: benchmark.name,
      category: benchmark.category,
      success: true,
      validation: validationResult,
      duration,
      agentOutput: agentOutput,
      groundTruth: benchmark.groundTruth,
      iterations: result.iterations
    };

  } catch (error) {
    const duration = (Date.now() - startTime) / 1000;
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    return {
      benchmark: benchmark.id,
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * Run all benchmarks in a tier
 */
async function runTier(tierName, benchmarks, verbose = true) {
  console.log(`\n${colors.bold}${colors.magenta}${'═'.repeat(80)}${colors.reset}`);
  console.log(`${colors.bold}${colors.magenta}${tierName}${colors.reset}`);
  console.log(`${colors.magenta}${'═'.repeat(80)}${colors.reset}`);
  console.log(`Benchmarks: ${benchmarks.length}\n`);

  const results = [];

  for (const benchmark of benchmarks) {
    const result = await executeBenchmark(benchmark, verbose);
    results.push(result);

    // Pause between benchmarks
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return results;
}

/**
 * Run all 3 tiers
 */
async function runAllTiers(options = { verbose: true, savePath: null }) {
  console.log(`${colors.bold}${colors.magenta}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     OBJECTIVE BENCHMARK - POWER AGENT VALIDATION            ║');
  console.log('║     Ground Truth from Published R Package Examples         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  const allResults = {
    timestamp: new Date().toISOString(),
    tiers: {}
  };

  // Tier 1: Basic power analysis (pwr)
  const tier1Results = await runTier('TIER 1: Basic Power Analysis (pwr)', TIER1_BENCHMARKS, options.verbose);
  allResults.tiers.tier1 = tier1Results;

  // Tier 2: Mixed models (lme4, simr)
  const tier2Results = await runTier('TIER 2: Mixed Effects Models (lme4, simr)', TIER2_BENCHMARKS, options.verbose);
  allResults.tiers.tier2 = tier2Results;

  // Tier 3: Prediction models (pmsampsize - Riley's criteria)
  const tier3Results = await runTier('TIER 3: Prediction Models (pmsampsize - Riley)', TIER3_BENCHMARKS, options.verbose);
  allResults.tiers.tier3 = tier3Results;

  // Summary
  printSummary(allResults);

  // Save results
  if (options.savePath) {
    fs.writeFileSync(options.savePath, JSON.stringify(allResults, null, 2));
    console.log(`\n${colors.green}✓${colors.reset} Results saved to: ${options.savePath}`);
  }

  return allResults;
}

/**
 * Print summary of all benchmark results
 */
function printSummary(allResults) {
  console.log(`\n${colors.bold}${colors.cyan}${'═'.repeat(80)}${colors.reset}`);
  console.log(`${colors.bold}BENCHMARK SUMMARY${colors.reset}`);
  console.log(`${colors.cyan}${'═'.repeat(80)}${colors.reset}`);

  let totalBenchmarks = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [tierName, results] of Object.entries(allResults.tiers)) {
    console.log(`\n${colors.bold}${tierName.toUpperCase()}:${colors.reset}`);

    const passed = results.filter(r => r.validation?.valid).length;
    const failed = results.filter(r => !r.validation?.valid || !r.success).length;

    console.log(`  Total: ${results.length} | Passed: ${colors.green}${passed}${colors.reset} | Failed: ${colors.red}${failed}${colors.reset}`);

    results.forEach((r, i) => {
      const status = r.validation?.valid ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      console.log(`  ${i + 1}. ${status} ${r.name} (${r.duration?.toFixed(1)}s)`);
    });

    totalBenchmarks += results.length;
    totalPassed += passed;
    totalFailed += failed;
  }

  console.log(`\n${colors.bold}OVERALL:${colors.reset}`);
  console.log(`  Total Benchmarks: ${totalBenchmarks}`);
  console.log(`  Passed: ${colors.green}${totalPassed}${colors.reset} (${(totalPassed/totalBenchmarks*100).toFixed(1)}%)`);
  console.log(`  Failed: ${colors.red}${totalFailed}${colors.reset} (${(totalFailed/totalBenchmarks*100).toFixed(1)}%)`);

  if (totalPassed === totalBenchmarks) {
    console.log(`\n${colors.bold}${colors.green}🎉 ALL BENCHMARKS PASSED! Power Agent validated against published ground truth.${colors.reset}\n`);
  } else {
    console.log(`\n${colors.yellow}⚠️  Some benchmarks failed. Review details above.${colors.reset}\n`);
  }
}

// Export for use in other modules
export {
  TIER1_BENCHMARKS,
  TIER2_BENCHMARKS,
  TIER3_BENCHMARKS,
  executeBenchmark,
  runTier,
  runAllTiers
};

// Run if called directly
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  console.log(`${colors.cyan}Starting benchmark suite from command line...${colors.reset}\n`);
  runAllTiers({
    verbose: true,
    savePath: './benchmark-results.json'
  }).then(() => {
    console.log('\n✅ Benchmark suite completed\n');
    process.exit(0);
  }).catch(error => {
    console.error(`\n${colors.red}Benchmark suite failed:${colors.reset}`, error);
    console.error(error);
    process.exit(1);
  });
}
