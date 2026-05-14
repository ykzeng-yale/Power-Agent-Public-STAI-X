/**
 * Power Agent Benchmark Reporting System
 *
 * Generates detailed reports from benchmark evaluation results
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { config } from './config.js';

/**
 * Generate HTML report from evaluation results
 */
export function generateHTMLReport(evaluations, stats, comparison) {
  const passed = evaluations.filter((e) => e.passed);
  const failed = evaluations.filter((e) => !e.passed);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Power Agent Benchmark Report</title>
  <style>
    :root {
      --primary: #2563eb;
      --success: #16a34a;
      --warning: #ca8a04;
      --danger: #dc2626;
      --bg: #f8fafc;
      --card: #ffffff;
      --text: #1e293b;
      --muted: #64748b;
      --border: #e2e8f0;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    h2 {
      font-size: 1.25rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid var(--border);
    }

    .subtitle {
      color: var(--muted);
      margin-bottom: 2rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .card {
      background: var(--card);
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .card-title {
      font-size: 0.875rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .card-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .card-value.success { color: var(--success); }
    .card-value.warning { color: var(--warning); }
    .card-value.danger { color: var(--danger); }

    .progress-bar {
      height: 8px;
      background: var(--border);
      border-radius: 4px;
      margin-top: 0.5rem;
      overflow: hidden;
    }

    .progress-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .progress-fill.success { background: var(--success); }
    .progress-fill.warning { background: var(--warning); }
    .progress-fill.danger { background: var(--danger); }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1rem;
    }

    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      background: var(--bg);
      font-weight: 600;
    }

    tr:hover {
      background: var(--bg);
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .badge.success { background: #dcfce7; color: #166534; }
    .badge.danger { background: #fee2e2; color: #991b1b; }
    .badge.warning { background: #fef9c3; color: #854d0e; }

    .section {
      margin-bottom: 2rem;
    }

    .chart-container {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .bar-chart {
      flex: 1;
      min-width: 300px;
    }

    .bar {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .bar-label {
      width: 150px;
      font-size: 0.875rem;
    }

    .bar-track {
      flex: 1;
      height: 24px;
      background: var(--border);
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      display: flex;
      align-items: center;
      padding-left: 8px;
      color: white;
      font-size: 0.75rem;
      font-weight: 600;
    }

    .details-toggle {
      cursor: pointer;
      color: var(--primary);
    }

    .details-content {
      display: none;
      padding: 1rem;
      background: var(--bg);
      border-radius: 4px;
      margin-top: 0.5rem;
    }

    .details-content.active {
      display: block;
    }

    .error-list {
      list-style: none;
      padding: 0;
    }

    .error-list li {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
    }

    .error-list li:last-child {
      border-bottom: none;
    }

    @media (max-width: 768px) {
      body { padding: 1rem; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Power Agent Benchmark Report</h1>
    <p class="subtitle">Generated: ${new Date().toLocaleString()}</p>

    <!-- Summary Cards -->
    <div class="grid">
      <div class="card">
        <div class="card-title">Total Tasks</div>
        <div class="card-value">${stats.total}</div>
      </div>
      <div class="card">
        <div class="card-title">Pass Rate</div>
        <div class="card-value ${stats.passRate >= 0.8 ? 'success' : stats.passRate >= 0.6 ? 'warning' : 'danger'}">
          ${(stats.passRate * 100).toFixed(1)}%
        </div>
        <div class="progress-bar">
          <div class="progress-fill ${stats.passRate >= 0.8 ? 'success' : stats.passRate >= 0.6 ? 'warning' : 'danger'}"
               style="width: ${stats.passRate * 100}%"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Average Score</div>
        <div class="card-value ${stats.averageScore >= 80 ? 'success' : stats.averageScore >= 60 ? 'warning' : 'danger'}">
          ${stats.averageScore.toFixed(1)}
        </div>
      </div>
      <div class="card">
        <div class="card-title">Median Score</div>
        <div class="card-value">${stats.medianScore.toFixed(1)}</div>
      </div>
    </div>

    <!-- Score Distribution -->
    <div class="card section">
      <h2>Score Distribution</h2>
      <div class="bar-chart">
        ${Object.entries(stats.scoreDistribution).map(([range, count]) => {
          const colors = {
            excellent: '#16a34a',
            good: '#22c55e',
            acceptable: '#eab308',
            poor: '#f97316',
            failing: '#dc2626',
          };
          const labels = {
            excellent: 'Excellent (90-100)',
            good: 'Good (80-89)',
            acceptable: 'Acceptable (70-79)',
            poor: 'Poor (50-69)',
            failing: 'Failing (0-49)',
          };
          const pct = (count / stats.total) * 100;
          return `
            <div class="bar">
              <div class="bar-label">${labels[range]}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${colors[range]}">
                  ${count} (${pct.toFixed(1)}%)
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Performance by Tier -->
    <div class="card section">
      <h2>Performance by Tier</h2>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Tasks</th>
            <th>Pass Rate</th>
            <th>Avg Score</th>
            <th>Target</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${['tier1', 'tier2', 'tier3', 'tier4'].map((tier) => {
            const data = stats.byTier[tier];
            if (!data) return '';
            const target = config.targets.byTier[tier] * 100;
            const actual = data.passRate * 100;
            return `
              <tr>
                <td><strong>${tier.toUpperCase()}</strong></td>
                <td>${data.total}</td>
                <td>${actual.toFixed(1)}%</td>
                <td>${data.averageScore.toFixed(1)}</td>
                <td>${target}%</td>
                <td>
                  <span class="badge ${actual >= target ? 'success' : 'danger'}">
                    ${actual >= target ? 'Met' : 'Not Met'}
                  </span>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>

    <!-- Performance by Criterion -->
    <div class="card section">
      <h2>Performance by Criterion</h2>
      <div class="bar-chart">
        ${Object.entries(stats.byCategory).map(([category, data]) => {
          const maxScores = {
            templateSelection: 20,
            parameterExtraction: 20,
            calculationAccuracy: 30,
            codeQuality: 15,
            interpretationQuality: 15,
          };
          const pct = (data.average / maxScores[category]) * 100;
          const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#eab308' : '#dc2626';
          return `
            <div class="bar">
              <div class="bar-label">${category}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width: ${pct}%; background: ${color}">
                  ${data.average.toFixed(1)}/${maxScores[category]} (${pct.toFixed(0)}%)
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <!-- Target Comparison -->
    <div class="card section">
      <h2>Target Metrics</h2>
      ${comparison.allTargetsMet
        ? '<p class="badge success" style="font-size: 1rem; padding: 0.5rem 1rem;">All targets met!</p>'
        : `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
            <div>
              <h3 style="color: var(--success); margin-bottom: 0.5rem;">Targets Met</h3>
              <ul style="list-style: none;">
                ${comparison.met.map((m) => `<li>✓ ${m}</li>`).join('')}
              </ul>
            </div>
            <div>
              <h3 style="color: var(--danger); margin-bottom: 0.5rem;">Targets Not Met</h3>
              <ul style="list-style: none;">
                ${comparison.notMet.map((m) => `<li>✗ ${m}</li>`).join('')}
              </ul>
            </div>
          </div>
        `
      }
    </div>

    <!-- Common Errors -->
    ${Object.keys(stats.commonErrors).length > 0 ? `
      <div class="card section">
        <h2>Common Errors</h2>
        <ul class="error-list">
          ${Object.entries(stats.commonErrors).map(([error, count]) => `
            <li>
              <span>${error}</span>
              <span class="badge warning">${count}x</span>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    <!-- Detailed Results -->
    <div class="card section">
      <h2>Detailed Results</h2>
      <table>
        <thead>
          <tr>
            <th>Task ID</th>
            <th>Template</th>
            <th>Difficulty</th>
            <th>Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${evaluations.map((e) => `
            <tr>
              <td>${e.taskId}</td>
              <td>${e.template}</td>
              <td><span class="badge ${e.difficulty === 'basic' ? 'success' : e.difficulty === 'intermediate' ? 'warning' : 'danger'}">${e.difficulty}</span></td>
              <td>${e.totalScore}</td>
              <td><span class="badge ${e.passed ? 'success' : 'danger'}">${e.passed ? 'Pass' : 'Fail'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate JSON report for programmatic consumption
 */
export function generateJSONReport(evaluations, stats, comparison) {
  return {
    summary: {
      total: stats.total,
      passed: stats.passed,
      failed: stats.failed,
      passRate: stats.passRate,
      averageScore: stats.averageScore,
      medianScore: stats.medianScore,
      allTargetsMet: comparison.allTargetsMet,
    },
    scoreDistribution: stats.scoreDistribution,
    byTier: stats.byTier,
    byCategory: stats.byCategory,
    byDifficulty: stats.byDifficulty,
    byTemplate: stats.byTemplate,
    targets: comparison,
    commonErrors: stats.commonErrors,
    evaluations: evaluations.map((e) => ({
      taskId: e.taskId,
      tier: e.tier,
      template: e.template,
      difficulty: e.difficulty,
      totalScore: e.totalScore,
      passed: e.passed,
      scores: e.scores,
      justification: e.justification,
      criticalErrors: e.criticalErrors,
    })),
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
    },
  };
}

/**
 * Generate CSV export of results
 */
export function generateCSVReport(evaluations) {
  const headers = [
    'Task ID',
    'Tier',
    'Template',
    'Difficulty',
    'Total Score',
    'Passed',
    'Template Selection',
    'Parameter Extraction',
    'Calculation Accuracy',
    'Code Quality',
    'Interpretation',
    'Sample Size Error',
    'Critical Errors',
  ];

  const rows = evaluations.map((e) => [
    e.taskId,
    e.tier,
    e.template,
    e.difficulty,
    e.totalScore,
    e.passed ? 'Yes' : 'No',
    e.scores?.templateSelection || 0,
    e.scores?.parameterExtraction || 0,
    e.scores?.calculationAccuracy || 0,
    e.scores?.codeQuality || 0,
    e.scores?.interpretationQuality || 0,
    e.sampleSizeError || '',
    (e.criticalErrors || []).join('; '),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * Generate all report formats
 */
export async function generateAllReports(evaluations, stats, comparison, outputDir) {
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  // HTML Report
  const htmlReport = generateHTMLReport(evaluations, stats, comparison);
  const htmlPath = path.join(outputDir, `report_${timestamp}.html`);
  await writeFile(htmlPath, htmlReport);
  console.log(`HTML report saved to: ${htmlPath}`);

  // JSON Report
  const jsonReport = generateJSONReport(evaluations, stats, comparison);
  const jsonPath = path.join(outputDir, `report_${timestamp}.json`);
  await writeFile(jsonPath, JSON.stringify(jsonReport, null, 2));
  console.log(`JSON report saved to: ${jsonPath}`);

  // CSV Report
  const csvReport = generateCSVReport(evaluations);
  const csvPath = path.join(outputDir, `report_${timestamp}.csv`);
  await writeFile(csvPath, csvReport);
  console.log(`CSV report saved to: ${csvPath}`);

  return {
    html: htmlPath,
    json: jsonPath,
    csv: csvPath,
  };
}

/**
 * CLI interface for generating reports from existing results
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
Usage: node report.js <evaluations_file> [options]

Arguments:
  evaluations_file    Path to the evaluations JSON file

Options:
  --output <dir>      Output directory (default: ./results/reports)
  --format <type>     Output format: html, json, csv, all (default: all)
    `);
    process.exit(1);
  }

  const evaluationsFile = args[0];
  const outputDir = args.includes('--output')
    ? args[args.indexOf('--output') + 1]
    : path.join(config.paths.results, 'reports');
  const format = args.includes('--format')
    ? args[args.indexOf('--format') + 1]
    : 'all';

  try {
    const content = await readFile(evaluationsFile, 'utf-8');
    const evaluations = JSON.parse(content);

    // Import scoring functions
    const { computeAggregateStats, compareToTargets } = await import('./evaluator/scoring.js');

    const stats = computeAggregateStats(evaluations);
    const comparison = compareToTargets(stats);

    if (format === 'all') {
      await generateAllReports(evaluations, stats, comparison, outputDir);
    } else {
      await mkdir(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      switch (format) {
        case 'html':
          {
            const html = generateHTMLReport(evaluations, stats, comparison);
            const htmlPath = path.join(outputDir, `report_${timestamp}.html`);
            await writeFile(htmlPath, html);
            console.log(`HTML report saved to: ${htmlPath}`);
          }
          break;
        case 'json':
          {
            const json = generateJSONReport(evaluations, stats, comparison);
            const jsonPath = path.join(outputDir, `report_${timestamp}.json`);
            await writeFile(jsonPath, JSON.stringify(json, null, 2));
            console.log(`JSON report saved to: ${jsonPath}`);
          }
          break;
        case 'csv':
          {
            const csv = generateCSVReport(evaluations);
            const csvPath = path.join(outputDir, `report_${timestamp}.csv`);
            await writeFile(csvPath, csv);
            console.log(`CSV report saved to: ${csvPath}`);
          }
          break;
        default:
          console.error(`Unknown format: ${format}`);
          process.exit(1);
      }
    }
  } catch (error) {
    console.error('Error generating report:', error);
    process.exit(1);
  }
}

// Export functions
export default {
  generateHTMLReport,
  generateJSONReport,
  generateCSVReport,
  generateAllReports,
};

// Run CLI if executed directly
if (process.argv[1].endsWith('report.js')) {
  main();
}
