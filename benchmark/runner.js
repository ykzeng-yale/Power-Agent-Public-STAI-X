/**
 * Power Agent Benchmark Test Runner
 *
 * Executes benchmark tasks against the Power Agent API and collects results
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { config } from './config.js';
import { evaluateTask, batchEvaluate } from './evaluator/llm-judge.js';
import { computeAggregateStats, compareToTargets, generateSummary } from './evaluator/scoring.js';

/**
 * Load tasks from tier files
 */
async function loadTasks(tiers = [1, 2, 3, 4]) {
  const allTasks = [];

  for (const tier of tiers) {
    const filePath = path.join(config.paths.tasks, `tier${tier}`, 'tasks.json');
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      // Add tier info to each task
      const tasks = data.tasks.map((task) => ({
        ...task,
        tier,
        tierName: data.name,
      }));
      allTasks.push(...tasks);
      console.log(`Loaded ${tasks.length} tasks from Tier ${tier}`);
    } catch (error) {
      console.error(`Failed to load tasks from tier ${tier}:`, error.message);
    }
  }

  return allTasks;
}

/**
 * Create a new session with the Power Agent API
 */
async function createSession() {
  const response = await fetch(`${config.api.baseUrl}${config.api.sessionEndpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  const data = await response.json();
  return data.session_id;
}

/**
 * Send a message to the Power Agent API
 */
async function sendMessage(sessionId, message) {
  const response = await fetch(`${config.api.baseUrl}${config.api.messageEndpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session_id: sessionId,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send message: ${response.status}`);
  }

  return response;
}

/**
 * Poll for session completion
 */
async function waitForCompletion(sessionId, timeout = config.api.timeout) {
  const startTime = Date.now();
  const pollInterval = config.api.pollInterval;

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(
        `${config.api.baseUrl}${config.api.stepsEndpoint}/${sessionId}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get steps: ${response.status}`);
      }

      const data = await response.json();
      const steps = data.steps || [];

      // Check for completion indicators
      const isComplete = steps.some(
        (step) =>
          step.type === 'session_complete' ||
          step.type === 'chatbot_conclusion_complete' ||
          step.type === 'outputs' ||
          (step.type === 'error' && step.data?.fatal)
      );

      if (isComplete) {
        return {
          sessionId,
          steps,
          status: 'completed',
          duration: Date.now() - startTime,
        };
      }

      // Check for errors
      const errorStep = steps.find((step) => step.type === 'error');
      if (errorStep && errorStep.data?.fatal) {
        return {
          sessionId,
          steps,
          status: 'error',
          error: errorStep.data.message,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      console.error(`Polling error for session ${sessionId}:`, error.message);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  // Timeout
  return {
    sessionId,
    steps: [],
    status: 'timeout',
    duration: timeout,
  };
}

/**
 * Run a single benchmark task
 */
async function runTask(task, options = {}) {
  const { verbose = false, retryOnError = true } = options;

  if (verbose) {
    console.log(`\nRunning task: ${task.id}`);
    console.log(`Question: ${task.question.substring(0, 80)}...`);
  }

  let attempts = 0;
  const maxAttempts = retryOnError ? config.retry.maxAttempts : 1;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      // Create new session
      const sessionId = await createSession();
      if (verbose) console.log(`Session created: ${sessionId}`);

      // Send the question
      await sendMessage(sessionId, task.question);
      if (verbose) console.log('Message sent, waiting for completion...');

      // Wait for completion
      const result = await waitForCompletion(sessionId);

      if (result.status === 'completed') {
        if (verbose) {
          console.log(`Task completed in ${result.duration}ms`);
          console.log(`Steps collected: ${result.steps.length}`);
        }
        return {
          task,
          response: result,
          success: true,
        };
      } else if ((result.status === 'error' || result.status === 'timeout') && attempts < maxAttempts) {
        console.log(`Task ${task.id} ${result.status}, retrying... (attempt ${attempts}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, config.retry.delayMs));
        continue;
      } else {
        return {
          task,
          response: result,
          success: false,
          error: result.error || `Status: ${result.status}`,
        };
      }
    } catch (error) {
      console.error(`Error running task ${task.id}:`, error.message);

      if (attempts < maxAttempts) {
        console.log(`Retrying... (attempt ${attempts})`);
        await new Promise((resolve) => setTimeout(resolve, config.retry.delayMs));
        continue;
      }

      return {
        task,
        response: null,
        success: false,
        error: error.message,
      };
    }
  }

  return {
    task,
    response: null,
    success: false,
    error: 'Max attempts exceeded',
  };
}

/**
 * Run multiple benchmark tasks
 */
async function runBenchmark(tasks, options = {}) {
  const {
    concurrency = 1, // Run one at a time by default to avoid overwhelming the API
    verbose = false,
    outputDir = config.paths.results,
    runId = `benchmark_${Date.now()}`,
  } = options;

  console.log('\n' + '═'.repeat(60));
  console.log('POWER AGENT BENCHMARK');
  console.log('═'.repeat(60));
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Run ID: ${runId}`);
  console.log('═'.repeat(60) + '\n');

  const results = [];
  const startTime = Date.now();

  // Process tasks (with limited concurrency)
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, Math.min(i + concurrency, tasks.length));
    const batchPromises = batch.map((task) => runTask(task, { verbose }));
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Progress update
    const completed = results.length;
    const successful = results.filter((r) => r.success).length;
    console.log(
      `Progress: ${completed}/${tasks.length} tasks (${successful} successful)`
    );

    // Small delay between batches
    if (i + concurrency < tasks.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const totalDuration = Date.now() - startTime;

  // Summary
  console.log('\n' + '─'.repeat(40));
  console.log('TASK EXECUTION SUMMARY');
  console.log('─'.repeat(40));
  console.log(`Total tasks: ${results.length}`);
  console.log(`Successful: ${results.filter((r) => r.success).length}`);
  console.log(`Failed: ${results.filter((r) => !r.success).length}`);
  console.log(`Total duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(
    `Average time per task: ${(totalDuration / results.length / 1000).toFixed(1)}s`
  );

  // Save raw results
  await mkdir(outputDir, { recursive: true });
  const rawResultsPath = path.join(outputDir, `${runId}_raw.json`);
  await writeFile(rawResultsPath, JSON.stringify(results, null, 2));
  console.log(`\nRaw results saved to: ${rawResultsPath}`);

  return {
    runId,
    results,
    totalDuration,
    successRate: results.filter((r) => r.success).length / results.length,
  };
}

/**
 * Evaluate benchmark results using LLM-as-judge
 */
async function evaluateBenchmark(benchmarkResults, options = {}) {
  const {
    outputDir = config.paths.results,
    runId = benchmarkResults.runId,
    verbose = false,
  } = options;

  console.log('\n' + '═'.repeat(60));
  console.log('EVALUATING RESULTS WITH LLM-AS-JUDGE');
  console.log('═'.repeat(60) + '\n');

  const successfulResults = benchmarkResults.results.filter((r) => r.success);
  console.log(`Evaluating ${successfulResults.length} successful task results...\n`);

  const evaluations = [];

  for (let i = 0; i < successfulResults.length; i++) {
    const result = successfulResults[i];
    if (verbose) {
      console.log(`Evaluating ${result.task.id}...`);
    }

    const evaluation = await evaluateTask(result.task, result.response);
    evaluations.push(evaluation);

    // Progress
    if ((i + 1) % 10 === 0 || i === successfulResults.length - 1) {
      console.log(`Evaluated: ${i + 1}/${successfulResults.length}`);
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Compute statistics
  const stats = computeAggregateStats(evaluations);
  const comparison = compareToTargets(stats);
  const summary = generateSummary(stats, comparison);

  // Print summary
  console.log('\n' + summary);

  // Save results
  await mkdir(outputDir, { recursive: true });

  const evaluationsPath = path.join(outputDir, `${runId}_evaluations.json`);
  await writeFile(evaluationsPath, JSON.stringify(evaluations, null, 2));

  const statsPath = path.join(outputDir, `${runId}_stats.json`);
  await writeFile(statsPath, JSON.stringify({ stats, comparison }, null, 2));

  const summaryPath = path.join(outputDir, `${runId}_summary.txt`);
  await writeFile(summaryPath, summary);

  console.log(`\nResults saved to:`);
  console.log(`  - Evaluations: ${evaluationsPath}`);
  console.log(`  - Statistics: ${statsPath}`);
  console.log(`  - Summary: ${summaryPath}`);

  return {
    evaluations,
    stats,
    comparison,
    summary,
  };
}

/**
 * Run a subset of tasks (for testing)
 */
async function runSample(options = {}) {
  const { tasksPerTier = 2, tiers = [1, 2, 3, 4], ...runOptions } = options;

  const allTasks = await loadTasks(tiers);

  // Sample tasks from each tier
  const sampledTasks = [];
  for (const tier of tiers) {
    const tierTasks = allTasks.filter((t) => t.tier === tier);
    const sampled = tierTasks.slice(0, tasksPerTier);
    sampledTasks.push(...sampled);
  }

  console.log(`\nRunning sample benchmark with ${sampledTasks.length} tasks`);

  const results = await runBenchmark(sampledTasks, {
    ...runOptions,
    runId: `sample_${Date.now()}`,
  });

  return results;
}

/**
 * Main CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  switch (command) {
    case 'run':
      {
        const tiers = args.includes('--tiers')
          ? args[args.indexOf('--tiers') + 1].split(',').map(Number)
          : [1, 2, 3, 4];
        const verbose = args.includes('--verbose');
        const concurrency = args.includes('--concurrency')
          ? parseInt(args[args.indexOf('--concurrency') + 1])
          : 1;

        const tasks = await loadTasks(tiers);
        const results = await runBenchmark(tasks, { verbose, concurrency });
        await evaluateBenchmark(results, { verbose });
      }
      break;

    case 'sample':
      {
        const tasksPerTier = args.includes('--tasks')
          ? parseInt(args[args.indexOf('--tasks') + 1])
          : 2;
        const verbose = args.includes('--verbose');

        const results = await runSample({ tasksPerTier, verbose });
        await evaluateBenchmark(results, { verbose });
      }
      break;

    case 'evaluate':
      {
        const resultsFile = args[1];
        if (!resultsFile) {
          console.error('Please provide a results file path');
          process.exit(1);
        }
        const content = await readFile(resultsFile, 'utf-8');
        const benchmarkResults = JSON.parse(content);
        const verbose = args.includes('--verbose');
        await evaluateBenchmark(
          { results: benchmarkResults, runId: path.basename(resultsFile, '_raw.json') },
          { verbose }
        );
      }
      break;

    case 'list':
      {
        const tasks = await loadTasks();
        console.log('\nAvailable benchmark tasks:');
        console.log('─'.repeat(60));
        const byTier = tasks.reduce((acc, task) => {
          acc[task.tier] = acc[task.tier] || [];
          acc[task.tier].push(task);
          return acc;
        }, {});

        for (const [tier, tierTasks] of Object.entries(byTier)) {
          console.log(`\nTier ${tier} (${tierTasks.length} tasks):`);
          for (const task of tierTasks.slice(0, 5)) {
            console.log(`  ${task.id}: ${task.template}`);
          }
          if (tierTasks.length > 5) {
            console.log(`  ... and ${tierTasks.length - 5} more`);
          }
        }
      }
      break;

    case 'help':
    default:
      console.log(`
Power Agent Benchmark Runner

Usage:
  node runner.js <command> [options]

Commands:
  run           Run the full benchmark
  sample        Run a sample benchmark (2 tasks per tier by default)
  evaluate      Evaluate existing results file
  list          List all available tasks
  help          Show this help message

Options:
  --tiers <n,n,n>     Tiers to run (default: 1,2,3,4)
  --tasks <n>         Tasks per tier for sample run (default: 2)
  --verbose           Show detailed output
  --concurrency <n>   Number of concurrent tasks (default: 1)

Examples:
  node runner.js run --verbose
  node runner.js sample --tasks 3
  node runner.js run --tiers 1,2 --concurrency 2
  node runner.js evaluate results/benchmark_123_raw.json
      `);
  }
}

// Export functions for use as module
export {
  loadTasks,
  runTask,
  runBenchmark,
  evaluateBenchmark,
  runSample,
};

// Run CLI if executed directly
if (process.argv[1].endsWith('runner.js')) {
  main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
}
