/**
 * Cross-Benchmark Evaluation Runner
 *
 * Runs Power Agent on published benchmark tasks from:
 * - N-Power AI (Ruan et al., bioRxiv 2025) — 12 tasks
 * - Sebo & Wang (Family Practice 2025) — 24 tasks
 * - PowerGPT (Lu et al., arXiv 2025) — 8 tasks
 *
 * Usage:
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=sebo-wang-24
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=powergpt-8
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=all
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai --evaluate-only
 *   node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai --task=npa-s1-ss
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE_URL = process.env.POWER_AGENT_API_URL ||
  'https://power-agent-api-927325869269.us-central1.run.app';

const API_ENDPOINT = `${API_BASE_URL}/api/analyze-biostat`;

const TASK_TIMEOUT = 600000;    // 10 min
const MAX_RETRIES = 2;
const RETRY_DELAY = 5000;

const BENCHMARKS = {
  'n-power-ai': {
    dir: path.join(__dirname, 'n-power-ai'),
    name: 'N-Power AI (Ruan et al.)',
    paper: 'bioRxiv 2025.02.06.636776',
  },
  'sebo-wang-24': {
    dir: path.join(__dirname, 'sebo-wang-24'),
    name: 'Sebo & Wang 24-Scenario',
    paper: 'Family Practice 2025',
  },
  'powergpt-8': {
    dir: path.join(__dirname, 'powergpt-8'),
    name: 'PowerGPT 8-Scenario',
    paper: 'arXiv:2509.12471',
  },
  'verma-textbook': {
    dir: path.join(__dirname, 'verma-textbook'),
    name: 'Verma Textbook (73 Tasks)',
    paper: 'Springer 978-981-15-5204-5',
  },
};

const anthropic = new Anthropic();

// ─── API Interaction (SSE Streaming) ─────────────────────────────────────────

async function runSingleTask(task) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`  Retry ${attempt}/${MAX_RETRIES}...`);
        await sleep(RETRY_DELAY);
      }

      const start = Date.now();
      const sessionId = `xbench-${task.id}-${Date.now()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TASK_TIMEOUT);

      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: task.question,
          sessionId,
          mode: 'full_analysis',
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        clearTimeout(timeoutId);
        throw new Error(`API returned ${res.status}: ${await res.text().catch(() => '')}`);
      }

      // Read SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const steps = [];
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              steps.push(data);

              // Log progress for key steps
              if (data.step === 'r_execution_complete' || data.step === 'complete' || data.step === 'error') {
                if (data.step === 'error') {
                  console.log(`    [${data.step}] ${data.message || ''}`);
                }
              }
            } catch (_) { /* skip non-JSON lines */ }
          }
        }
      }

      clearTimeout(timeoutId);
      const duration = Date.now() - start;

      const isComplete = steps.some(s =>
        s.step === 'complete' || s.step === 'r_execution_complete' ||
        s.step === 'chatbot_conclusion_complete'
      );
      const hasError = steps.some(s => s.step === 'error');

      if (isComplete || steps.length > 3) {
        return {
          taskId: task.id,
          response: { sessionId, steps, status: 'completed', duration },
          success: true,
        };
      }

      if (hasError && attempt === MAX_RETRIES) {
        const errMsg = steps.find(s => s.step === 'error')?.message || 'Unknown error';
        return { taskId: task.id, response: { sessionId, steps, status: 'error', duration }, success: false, error: errMsg };
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log(`    Timeout after ${TASK_TIMEOUT / 1000}s`);
      }
      if (attempt === MAX_RETRIES) {
        return { taskId: task.id, response: null, success: false, error: err.message };
      }
    }
  }
}

// ─── LLM Value Extraction ────────────────────────────────────────────────────

function buildExtractionPrompt(task, agentResponse) {
  const gt = task.ground_truth;
  const gtKeys = Object.keys(gt);
  const isPower = gtKeys.includes('power') && gtKeys.length === 1;
  const gtValue = isPower ? gt.power : (gt.sample_size || gt.sample_size_per_group ||
    gt.total_sample_size || gt.n1 || gt.sample_size_per_group);
  const gtUnit = task.ground_truth_unit || 'total';

  const responseText = typeof agentResponse === 'string'
    ? agentResponse
    : JSON.stringify(agentResponse, null, 2);

  return `You are an expert biostatistician. Extract the FINAL numerical answer from this Power Agent response.

## TASK
Question: ${task.question}

Expected answer type: ${isPower ? 'POWER (decimal, e.g., 0.80)' : `SAMPLE SIZE (${gtUnit})`}

## AGENT RESPONSE
${responseText.substring(0, 8000)}

## INSTRUCTIONS
1. Find the agent's FINAL RECOMMENDED ${isPower ? 'power value' : 'sample size'}.
2. Look at CONCLUSION/SUMMARY/RECOMMENDATION sections first.
3. If multiple values mentioned, extract the FINAL answer.
4. For sample size: extract the value matching "${gtUnit}" (per group vs total).
5. For power: extract as decimal (0.80, not 80%).
6. If the agent couldn't compute an answer, return null.

## OUTPUT FORMAT
Respond with ONLY a JSON object:
{
  "extracted_value": <number or null>,
  "unit": "<per group|total|pairs|power|null>",
  "confidence": "<high|medium|low>",
  "reasoning": "<one sentence explaining extraction>"
}`;
}

async function extractValue(task, agentResponse) {
  const prompt = buildExtractionPrompt(task, agentResponse);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text;
    const json = extractJson(text);
    return json;
  } catch (err) {
    console.error(`  Extraction error for ${task.id}: ${err.message}`);
    return { extracted_value: null, unit: null, confidence: 'low', reasoning: 'Extraction failed' };
  }
}

function extractJson(text) {
  try { return JSON.parse(text.trim()); } catch (_) { /* continue */ }
  const match = text.match(/\{[\s\S]*\}/);
  if (match) return JSON.parse(match[0]);
  throw new Error('No JSON found');
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function evaluateTask(task, extraction) {
  const gt = task.ground_truth;
  const tol = task.tolerance;
  let extracted = extraction.extracted_value;

  // Handle comma-separated numbers (e.g., "438,350" -> NaN, should be separate values)
  if (typeof extracted === 'string') {
    extracted = parseFloat(String(extracted).replace(/,/g, ''));
  }
  if (extracted != null && isNaN(extracted)) extracted = null;

  if (extracted == null) {
    return {
      taskId: task.id,
      pass: false,
      extracted: null,
      expected: null,
      diff: null,
      percentError: null,
      reason: 'No value extracted',
    };
  }

  // Determine expected value and tolerance
  const gtKeys = Object.keys(gt);
  const isPower = gtKeys.includes('power') && gtKeys.length === 1;
  const tolIsNumber = typeof tol === 'number';

  let expected, tolerance;
  if (isPower) {
    expected = gt.power;
    tolerance = tolIsNumber ? tol : (tol.power || 0.03);
  } else if (gt.mdd != null) {
    expected = gt.mdd;
    tolerance = tolIsNumber ? tol : 0.1;
  } else if (gt.n1 && gt.n2) {
    // Special case: unequal groups — just check n1
    expected = gt.n1;
    tolerance = tolIsNumber ? tol : (tol.sample_size || 40);
  } else {
    expected = gt.sample_size || gt.sample_size_per_group || gt.total_sample_size;
    tolerance = tolIsNumber ? tol : (tol.sample_size || 5);
  }

  const diff = Math.abs(extracted - expected);
  const percentError = expected !== 0 ? ((extracted - expected) / expected * 100) : 0;
  const pass = diff <= tolerance;

  return {
    taskId: task.id,
    pass,
    extracted,
    expected,
    tolerance,
    diff: Math.round(diff * 1000) / 1000,
    percentError: Math.round(percentError * 10) / 10,
    reason: pass
      ? `Within tolerance (diff=${diff.toFixed(2)} <= ${tolerance})`
      : `OUTSIDE tolerance (diff=${diff.toFixed(2)} > ${tolerance})`,
  };
}

// ─── Response Text Extraction ────────────────────────────────────────────────

function extractResponseText(result) {
  if (!result?.response?.steps) return '';
  const steps = result.response.steps;

  // Collect all meaningful text from SSE events
  const parts = [];
  for (const s of steps) {
    // Various step formats from the SSE stream
    if (s.step === 'chatbot_conclusion_complete' || s.step === 'chatbot_intro_complete') {
      if (s.content) parts.push(s.content);
      if (s.message) parts.push(s.message);
    }
    if (s.step === 'r_execution_complete') {
      if (s.output) parts.push(`R Output:\n${s.output}`);
      if (s.data?.output) parts.push(`R Output:\n${s.data.output}`);
      if (s.result) parts.push(`R Result:\n${typeof s.result === 'string' ? s.result : JSON.stringify(s.result)}`);
    }
    if (s.step === 'complete') {
      if (s.content) parts.push(s.content);
      if (s.summary) parts.push(s.summary);
      if (s.finalResponse) parts.push(s.finalResponse);
    }
    // Catch-all for data fields
    if (s.data && typeof s.data === 'object') {
      if (s.data.content) parts.push(s.data.content);
      if (s.data.text) parts.push(s.data.text);
      if (s.data.message && s.step !== 'error') parts.push(s.data.message);
      if (s.data.output) parts.push(s.data.output);
      if (s.data.finalResponse) parts.push(s.data.finalResponse);
    }
    // Stream chunks
    if (s.step === 'chatbot_conclusion_stream' || s.step === 'chatbot_stream') {
      if (s.chunk) parts.push(s.chunk);
      if (s.content) parts.push(s.content);
    }
  }

  // If no structured text found, dump all steps
  if (parts.length === 0) {
    return steps.map(s => JSON.stringify(s)).join('\n');
  }

  return parts.join('\n\n');
}

// ─── Main Workflow ───────────────────────────────────────────────────────────

async function loadBenchmarkTasks(benchmarkKey) {
  const bm = BENCHMARKS[benchmarkKey];
  const tasksPath = path.join(bm.dir, 'tasks.json');
  const content = await readFile(tasksPath, 'utf-8');
  return JSON.parse(content).tasks;
}

async function runBenchmark(benchmarkKey, opts = {}) {
  const bm = BENCHMARKS[benchmarkKey];
  const tasks = await loadBenchmarkTasks(benchmarkKey);
  const taskFilter = opts.task;

  const filteredTasks = taskFilter
    ? tasks.filter(t => t.id === taskFilter || t.id.startsWith(taskFilter))
    : tasks;

  if (filteredTasks.length === 0) {
    console.error(`No tasks found${taskFilter ? ` matching "${taskFilter}"` : ''}`);
    return null;
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`CROSS-BENCHMARK: ${bm.name}`);
  console.log(`Paper: ${bm.paper}`);
  console.log(`Tasks: ${filteredTasks.length}`);
  console.log(`${'='.repeat(60)}\n`);

  // Run tasks
  const rawResponses = [];
  for (let i = 0; i < filteredTasks.length; i++) {
    const task = filteredTasks[i];
    console.log(`[${i + 1}/${filteredTasks.length}] ${task.id}: ${task.title || task.test_type || task.test}`);

    const result = await runSingleTask(task);
    rawResponses.push({
      taskId: task.id,
      success: result.success,
      response: result.response,
      error: result.error || null,
      timestamp: new Date().toISOString(),
    });

    console.log(`  ${result.success ? 'OK' : 'FAIL'} (${result.response?.duration ? (result.response.duration / 1000).toFixed(1) + 's' : 'N/A'})`);

    // Small delay between tasks
    if (i < filteredTasks.length - 1) await sleep(2000);
  }

  // Save raw responses (merge with existing if running a subset)
  const rawPath = path.join(bm.dir, 'raw-responses', 'power-agent.json');
  await mkdir(path.dirname(rawPath), { recursive: true });
  let allResponses = rawResponses;
  if (taskFilter) {
    try {
      const existing = JSON.parse(await readFile(rawPath, 'utf-8'));
      const newIds = new Set(rawResponses.map(r => r.taskId));
      const kept = existing.filter(r => !newIds.has(r.taskId));
      allResponses = [...kept, ...rawResponses];
    } catch (e) { /* no existing file */ }
  }
  await writeFile(rawPath, JSON.stringify(allResponses, null, 2));
  console.log(`\nRaw responses saved to: ${rawPath} (${allResponses.length} total)`);

  return { benchmarkKey, tasks: filteredTasks, rawResponses };
}

async function evaluateBenchmark(benchmarkKey, opts = {}) {
  const bm = BENCHMARKS[benchmarkKey];

  // Load tasks and raw responses
  const tasks = await loadBenchmarkTasks(benchmarkKey);
  const rawPath = path.join(bm.dir, 'raw-responses', 'power-agent.json');
  if (!existsSync(rawPath)) {
    console.error(`No raw responses found at ${rawPath}. Run the benchmark first.`);
    return null;
  }
  const rawResponses = JSON.parse(await readFile(rawPath, 'utf-8'));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`EVALUATING: ${bm.name}`);
  console.log(`${'='.repeat(60)}\n`);

  const evaluations = [];
  for (const task of tasks) {
    const raw = rawResponses.find(r => r.taskId === task.id);
    if (!raw || !raw.success) {
      evaluations.push({
        taskId: task.id,
        pass: false,
        extracted: null,
        expected: null,
        reason: raw ? 'Task execution failed' : 'No response found',
      });
      console.log(`  ${task.id}: SKIP (no successful response)`);
      continue;
    }

    // Extract response text
    const responseText = extractResponseText(raw);

    // LLM extraction
    const extraction = await extractValue(task, responseText || raw.response);
    console.log(`  ${task.id}: extracted=${extraction.extracted_value} (${extraction.confidence})`);

    // Evaluate
    const result = evaluateTask(task, extraction);
    result.extraction = extraction;
    evaluations.push(result);

    console.log(`    -> ${result.pass ? 'PASS' : 'FAIL'}: expected=${result.expected}, got=${result.extracted}, diff=${result.diff}, ${result.percentError}% error`);

    await sleep(300); // Rate limit LLM calls
  }

  // Compute summary stats
  const total = evaluations.length;
  const passed = evaluations.filter(e => e.pass).length;
  const failed = total - passed;
  const passRate = total > 0 ? (passed / total * 100).toFixed(1) : '0';
  const errors = evaluations
    .filter(e => e.percentError != null && !isNaN(e.percentError))
    .map(e => Math.abs(e.percentError));
  const mape = errors.length > 0
    ? (errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1)
    : 'N/A';

  const summary = {
    benchmark: benchmarkKey,
    name: bm.name,
    paper: bm.paper,
    total,
    passed,
    failed,
    passRate: `${passRate}%`,
    mape: `${mape}%`,
    evaluations,
    timestamp: new Date().toISOString(),
  };

  // Save evaluation
  const evalPath = path.join(bm.dir, 'evaluation.json');
  await writeFile(evalPath, JSON.stringify(summary, null, 2));
  console.log(`\nEvaluation saved to: ${evalPath}`);

  // Generate comparison table
  const compTable = generateComparisonTable(benchmarkKey, summary);
  const compPath = path.join(bm.dir, 'comparison-table.md');
  await writeFile(compPath, compTable);
  console.log(`Comparison table saved to: ${compPath}`);

  // Print summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`RESULTS: ${bm.name}`);
  console.log(`${'─'.repeat(40)}`);
  console.log(`Total: ${total}`);
  console.log(`Passed: ${passed} (${passRate}%)`);
  console.log(`Failed: ${failed}`);
  console.log(`MAPE: ${mape}%`);
  console.log(`${'─'.repeat(40)}\n`);

  return summary;
}

// ─── Comparison Table Generation ─────────────────────────────────────────────

function generateComparisonTable(benchmarkKey, summary) {
  const evals = summary.evaluations;

  if (benchmarkKey === 'n-power-ai') {
    return generateNPowerAITable(evals);
  } else if (benchmarkKey === 'sebo-wang-24') {
    return generateSeboWangTable(evals);
  } else if (benchmarkKey === 'powergpt-8') {
    return generatePowerGPTTable(evals);
  } else if (benchmarkKey === 'verma-textbook') {
    return generateVermaTextbookTable(evals);
  }
  return '';
}

function generateNPowerAITable(evals) {
  const lines = [
    '# N-Power AI Benchmark: Power Agent vs. Published Results',
    '',
    '## Sample Size Tasks',
    '',
    '| Scenario | GT | Power Agent | % Error | N-Power AI | GPT o1 | GPT 4o | Claude 3.5 |',
    '|----------|-----|-------------|---------|------------|--------|--------|------------|',
  ];

  const ssPublished = {
    'npa-s1-ss': { gt: 37, npower: '37 (0%)', gpto1: '35 (-5%)', gpt4o: '35 (-5%)', claude: '35 (-5%)' },
    'npa-s2-ss': { gt: 42, npower: '42 (0%)', gpto1: '41 (-2%)', gpt4o: '41 (-2%)', claude: '37 (-12%)' },
    'npa-s3-ss': { gt: 42, npower: '42 (0%)', gpto1: '51 (+21%)', gpt4o: '51 (+21%)', claude: '40 (-5%)' },
    'npa-s4-ss': { gt: 13, npower: '13 (0%)', gpto1: '22 (+69%)', gpt4o: '33 (+154%)', claude: '20 (+54%)' },
    'npa-s5-ss': { gt: 13069, npower: '13069 (0%)', gpto1: '13000 (-1%)', gpt4o: '2596 (-80%)', claude: '3738 (-71%)' },
    'npa-s6-ss': { gt: 294, npower: '294 (0%)', gpto1: '144 (-51%)', gpt4o: '14 (-95%)', claude: '596 (+103%)' },
  };

  const scenarioNames = {
    'npa-s1-ss': 'S1: One-sample t',
    'npa-s2-ss': 'S2: Two-sample t',
    'npa-s3-ss': 'S3: Paired t',
    'npa-s4-ss': 'S4: ANOVA',
    'npa-s5-ss': 'S5: Chi-square',
    'npa-s6-ss': 'S6: Cox PH',
  };

  for (const e of evals.filter(e => e.taskId.endsWith('-ss'))) {
    const pub = ssPublished[e.taskId];
    const name = scenarioNames[e.taskId] || e.taskId;
    const agentVal = e.extracted != null ? `${e.extracted} (${e.percentError > 0 ? '+' : ''}${e.percentError}%)` : 'N/A';
    const passIcon = e.pass ? '' : '';
    lines.push(`| ${name} | ${pub.gt} | ${passIcon} ${agentVal} | ${e.percentError ?? 'N/A'}% | ${pub.npower} | ${pub.gpto1} | ${pub.gpt4o} | ${pub.claude} |`);
  }

  lines.push('', '## Power Estimation Tasks', '',
    '| Scenario | GT | Power Agent | % Error | N-Power AI | GPT o1 | GPT 4o | Claude 3.5 |',
    '|----------|-----|-------------|---------|------------|--------|--------|------------|');

  const pwrPublished = {
    'npa-s1-power': { gt: 0.90, npower: '0.90 (0%)', gpto1: '0.91 (+1%)', gpt4o: '0.085 (-91%)', claude: '0.93 (+3%)' },
    'npa-s2-power': { gt: 0.81, npower: '0.81 (0%)', gpto1: '0.65 (-20%)', gpt4o: '0.88 (+9%)', claude: '0.85 (+5%)' },
    'npa-s3-power': { gt: 0.81, npower: '0.81 (0%)', gpto1: '0.71 (-12%)', gpt4o: '0.70 (-14%)', claude: '0.82 (+1%)' },
    'npa-s4-power': { gt: 0.81, npower: '0.81 (0%)', gpto1: '0.70 (-14%)', gpt4o: '0.69 (-15%)', claude: '0.83 (+2%)' },
    'npa-s5-power': { gt: 0.80, npower: '0.80 (0%)', gpto1: '0.96 (+20%)', gpt4o: '1.00 (+25%)', claude: '0.95 (+19%)' },
    'npa-s6-power': { gt: 0.80, npower: '0.80 (0%)', gpto1: '0.86 (+7%)', gpt4o: '0.43 (-46%)', claude: '0.89 (+11%)' },
  };

  const powerNames = {
    'npa-s1-power': 'S1: One-sample t',
    'npa-s2-power': 'S2: Two-sample t',
    'npa-s3-power': 'S3: Paired t',
    'npa-s4-power': 'S4: ANOVA',
    'npa-s5-power': 'S5: Chi-square',
    'npa-s6-power': 'S6: Cox PH',
  };

  for (const e of evals.filter(e => e.taskId.endsWith('-power'))) {
    const pub = pwrPublished[e.taskId];
    const name = powerNames[e.taskId] || e.taskId;
    const agentVal = e.extracted != null ? `${e.extracted} (${e.percentError > 0 ? '+' : ''}${e.percentError}%)` : 'N/A';
    const passIcon = e.pass ? '' : '';
    lines.push(`| ${name} | ${pub.gt} | ${passIcon} ${agentVal} | ${e.percentError ?? 'N/A'}% | ${pub.npower} | ${pub.gpto1} | ${pub.gpt4o} | ${pub.claude} |`);
  }

  const passed = evals.filter(e => e.pass).length;
  lines.push('', `**Power Agent: ${passed}/${evals.length} tasks passed (${(passed / evals.length * 100).toFixed(0)}%)**`);
  lines.push(`**N-Power AI: 12/12 (100%) | GPT o1: best standalone LLM | Claude 3.5 Sonnet: variable**`);

  return lines.join('\n');
}

function generateSeboWangTable(evals) {
  const lines = [
    '# Sebo & Wang 24-Scenario: Power Agent vs. ChatGPT',
    '',
    '| Task | GT | Power Agent | % Error | Pass | GPT-4o Best | GPT-4o % Error |',
    '|------|-----|-------------|---------|------|-------------|----------------|',
  ];

  const gpt4oBest = {
    'sw-V1': { val: 25, err: '4.2%' }, 'sw-V2': { val: 23, err: '-11.5%' },
    'sw-V3': { val: 505, err: '0.2%' }, 'sw-V4': { val: 897, err: '0%' },
    'sw-V5': { val: 18, err: '-5.3%' }, 'sw-V6': { val: 23, err: '-4.2%' },
    'sw-V7': { val: 39, err: '-4.9%' }, 'sw-V8': { val: 42, err: '0%' },
    'sw-V9': { val: 24, err: '14.3%' }, 'sw-V10': { val: 49, err: '4.3%' },
    'sw-V11': { val: '622 & 778', err: '-2.2%' }, 'sw-V12': { val: 19, err: '0%' },
    'sw-V13': { val: 129, err: '0%' }, 'sw-V14': { val: 248, err: '-1.2%' },
    'sw-A1': { val: 272, err: '0%' }, 'sw-A2': { val: 322, err: '0%' },
    'sw-A3': { val: 52, err: '0%' }, 'sw-A4': { val: 189, err: '0%' },
    'sw-A5': { val: 23, err: '0%' }, 'sw-A6': { val: 44, err: '-6.4%' },
    'sw-A7': { val: 35, err: '6.1%' }, 'sw-A8': { val: 88, err: '0%' },
    'sw-A9': { val: 382, err: '0%' }, 'sw-A10': { val: 286, err: '-0.7%' },
  };

  for (const e of evals) {
    const gpt = gpt4oBest[e.taskId] || { val: '?', err: '?' };
    const agentVal = e.extracted != null ? e.extracted : 'N/A';
    const pass = e.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${e.taskId} | ${e.expected} | ${agentVal} | ${e.percentError ?? 'N/A'}% | ${pass} | ${gpt.val} | ${gpt.err} |`);
  }

  const passed = evals.filter(e => e.pass).length;
  const errors = evals.filter(e => e.percentError != null).map(e => Math.abs(e.percentError));
  const mape = errors.length > 0 ? (errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1) : 'N/A';

  lines.push('', `**Power Agent: ${passed}/${evals.length} passed, MAPE: ${mape}%**`);
  lines.push(`**ChatGPT-4o (best round): MAPE 2.8%**`);

  return lines.join('\n');
}

function generatePowerGPTTable(evals) {
  const lines = [
    '# PowerGPT 8-Scenario: Power Agent Results',
    '',
    '| Task | Test | GT | Power Agent | % Error | Pass |',
    '|------|------|-----|-------------|---------|------|',
  ];

  const testNames = {
    'pgpt-1': 'One-sample t', 'pgpt-2': 'Two-sample t', 'pgpt-3': 'Paired t',
    'pgpt-4': 'ANOVA', 'pgpt-5': '1-prop z', 'pgpt-6': '2-prop z',
    'pgpt-7': 'Cox PH', 'pgpt-8': 'Log-rank',
  };

  for (const e of evals) {
    const test = testNames[e.taskId] || e.taskId;
    const agentVal = e.extracted != null ? e.extracted : 'N/A';
    const pass = e.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${e.taskId} | ${test} | ${e.expected} | ${agentVal} | ${e.percentError ?? 'N/A'}% | ${pass} |`);
  }

  const passed = evals.filter(e => e.pass).length;
  lines.push('', `**Power Agent: ${passed}/${evals.length} passed (${(passed / evals.length * 100).toFixed(0)}%)**`);
  lines.push(`**PowerGPT study: 94.1% accuracy (tool-assisted), Reference group: 55.4%**`);

  return lines.join('\n');
}

function generateVermaTextbookTable(evals) {
  const lines = [
    '# Verma Textbook (30 Illustrations): Power Agent Results',
    '',
    '| Task | Test | GT | Power Agent | % Error | Pass |',
    '|------|------|----|-------------|---------|------|',
  ];

  for (const e of evals) {
    const agentVal = e.extracted != null ? e.extracted : 'N/A';
    const pass = e.pass ? 'PASS' : 'FAIL';
    lines.push(`| ${e.taskId} | ${e.extraction?.test_type || ''} | ${e.expected} | ${agentVal} | ${e.percentError ?? 'N/A'}% | ${pass} |`);
  }

  const passed = evals.filter(e => e.pass).length;
  const errors = evals.filter(e => e.percentError != null).map(e => Math.abs(e.percentError));
  const mape = errors.length > 0 ? (errors.reduce((a, b) => a + b, 0) / errors.length).toFixed(1) : 'N/A';

  lines.push('', `**Power Agent: ${passed}/${evals.length} passed (${(passed / evals.length * 100).toFixed(1)}%), MAPE: ${mape}%**`);

  return lines.join('\n');
}

// ─── Update Cross-Benchmark README ──────────────────────────────────────────

async function updateCrossBenchmarkReadme(results) {
  const readmePath = path.join(__dirname, 'README.md');
  let content = await readFile(readmePath, 'utf-8').catch(() => '');

  // Build results section
  const rows = results.map(r => {
    if (!r) return null;
    const bmInfo = BENCHMARKS[r.benchmark];
    return `| ${bmInfo.name} | ${r.total} | ${r.passed}/${r.total} (${r.passRate}) | MAPE: ${r.mape} | [${bmInfo.paper}](${r.benchmark}/) |`;
  }).filter(Boolean);

  const resultsSection = [
    '',
    '## Latest Results',
    '',
    '| Benchmark | Tasks | Power Agent | Accuracy | Paper |',
    '|-----------|-------|-------------|----------|-------|',
    ...rows,
    '',
    `*Last updated: ${new Date().toISOString().split('T')[0]}*`,
  ].join('\n');

  // Read existing README and update results section, or append
  if (content.includes('## Latest Results')) {
    content = content.replace(/## Latest Results[\s\S]*?(?=\n## |\n$|$)/, resultsSection.trim());
  } else {
    content += '\n' + resultsSection;
  }

  await writeFile(readmePath, content);
  console.log(`Updated: ${readmePath}`);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const benchmarkArg = args.find(a => a.startsWith('--benchmark='))?.split('=')[1];
  const taskArg = args.find(a => a.startsWith('--task='))?.split('=')[1];
  const evaluateOnly = args.includes('--evaluate-only');
  const verbose = args.includes('--verbose');

  if (!benchmarkArg) {
    console.log(`
Cross-Benchmark Evaluation Runner

Usage:
  node cross-benchmark/run-cross-benchmark.js --benchmark=<name> [options]

Benchmarks:
  n-power-ai    N-Power AI (12 tasks, Ruan et al.)
  sebo-wang-24  Sebo & Wang (24 tasks)
  powergpt-8    PowerGPT (8 tasks, Lu et al.)
  all           Run all benchmarks

Options:
  --task=<id>       Run only a specific task
  --evaluate-only   Skip running, just evaluate existing responses
  --verbose         Show detailed output

Examples:
  node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai
  node cross-benchmark/run-cross-benchmark.js --benchmark=all --evaluate-only
  node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai --task=npa-s1-ss
`);
    return;
  }

  const benchmarks = benchmarkArg === 'all'
    ? Object.keys(BENCHMARKS)
    : [benchmarkArg];

  if (benchmarks.some(b => !BENCHMARKS[b])) {
    console.error(`Unknown benchmark: ${benchmarkArg}. Available: ${Object.keys(BENCHMARKS).join(', ')}, all`);
    process.exit(1);
  }

  const allResults = [];

  for (const bk of benchmarks) {
    if (!evaluateOnly) {
      await runBenchmark(bk, { task: taskArg, verbose });
    }
    const result = await evaluateBenchmark(bk);
    allResults.push(result);
  }

  // Update cross-benchmark README with results
  const validResults = allResults.filter(Boolean);
  if (validResults.length > 0) {
    await updateCrossBenchmarkReadme(validResults);
  }

  // Final summary
  if (validResults.length > 1) {
    console.log(`\n${'='.repeat(60)}`);
    console.log('CROSS-BENCHMARK SUMMARY');
    console.log(`${'='.repeat(60)}`);
    for (const r of validResults) {
      console.log(`  ${r.name}: ${r.passed}/${r.total} (${r.passRate}), MAPE: ${r.mape}`);
    }
    console.log(`${'='.repeat(60)}\n`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
