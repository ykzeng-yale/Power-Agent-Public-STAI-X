/**
 * Professional Report Generator
 *
 * This module creates polished markdown reports from R execution results.
 * Uses LLM to interpret results and generate professional narratives.
 *
 * Architecture:
 * 1. R code generates: calculations, plots, tables
 * 2. This module: Takes R results + LLM interpretation → Creates markdown
 * 3. Saves to /workspace/output/analysis_report_[timestamp].md
 * 4. Returns file metadata with download URL
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

/**
 * Call Anthropic API with retry logic for 529 overloaded errors
 */
async function callAnthropicWithRetry(params, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create(params);
    } catch (error) {
      const isOverloaded = error.status === 529 ||
        (error.message && error.message.includes('overloaded'));

      if (isOverloaded && attempt < maxRetries) {
        const waitTime = Math.pow(2, attempt) * 5000; // 5s, 10s, 20s
        console.log(`[REPORT-GEN] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Generate a professional markdown report from R execution results
 *
 * @param {Object} options - Report generation options
 * @param {string} options.query - User's original query
 * @param {string} options.rCode - R code that was executed
 * @param {string} options.rOutput - R execution output
 * @param {Array} options.previousExecutions - All previous R executions in this session
 * @param {string} options.sessionId - Session ID for file naming
 * @returns {Promise<Object>} Report metadata with file path and content
 */
export async function generateReport(options) {
  const {
    query,
    rCode,
    rOutput,
    previousExecutions = [],
    sessionId = 'default'
  } = options;

  console.log('📝 Generating professional markdown report...');

  try {
    // Build context from all executions
    const executionContext = previousExecutions.length > 0
      ? buildExecutionContext(previousExecutions)
      : `**R Code:**\n\`\`\`r\n${rCode}\n\`\`\`\n\n**Output:**\n\`\`\`\n${rOutput}\n\`\`\``;

    // Use Claude Opus for high-quality, detailed report generation
    // 12000 tokens allows comprehensive grant-application-ready reports (~30 pages)
    const response = await callAnthropicWithRetry({
      model: 'claude-opus-4-6',  // Sonnet 4.6 for professional reports
      max_tokens: 12000,
      messages: [{
        role: 'user',
        content: `You are a senior biostatistician consultant writing a comprehensive analysis report suitable for grant applications and scientific publications.

**User's Research Question:**
${query}

**Complete Analysis Performed (R Code and Output):**
${executionContext}

Create a detailed, professional markdown report with the following structure. This report should be suitable for inclusion in NIH/NSF grant applications or as supplementary materials for publications.

# Biostatistical Analysis Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Analysis Type:** [Identify the type: sample size calculation, power analysis, simulation study, etc.]
**Report ID:** ${sessionId}_${Date.now()}

---

## Executive Summary

[3-5 sentences summarizing:
- The primary statistical question addressed
- Key numerical findings (specific sample sizes, power achieved, effect sizes)
- Main recommendation with confidence level]

---

## Background and Objectives

[Detailed context including:
- Research question being addressed
- Type of study design (RCT, observational, cluster randomized, etc.)
- Primary and secondary endpoints if applicable
- Clinical/scientific significance of the analysis]

---

## Statistical Methods

### Analysis Framework
[Describe the statistical framework used]

### Key Parameters
[Create a table of all input parameters:]

| Parameter | Value | Justification |
|-----------|-------|---------------|
| [e.g., Effect size] | [value] | [brief rationale] |

### Software and Packages
[List R packages used with version references]

### Assumptions
[Clearly state all statistical assumptions made]

---

## Results

### Primary Findings

[Present main results with specific numbers in a clear table format:]

| Metric | Value |
|--------|-------|
| [Key outcome 1] | [value] |
| [Key outcome 2] | [value] |

### Detailed Numerical Results
[Bullet points with ALL specific numerical findings from the R output]

### Sensitivity Analysis (if applicable)
[How results change under different assumptions - create tables showing parameter variations]

---

## Statistical Details

### Formulas and Calculations
[Include relevant statistical formulas in LaTeX notation where appropriate]

### Design Effect and Adjustments
[For complex designs: ICC, clustering, stratification factors]

### Confidence Intervals and Uncertainty
[Report confidence intervals, standard errors, or simulation-based uncertainty]

### Power Curve / Sample Size Curve (if generated)
[Reference any plots generated]

---

## R Code Used

\`\`\`r
${rCode}
\`\`\`

---

## Interpretation and Clinical Significance

[Professional interpretation including:
- What these results mean for the proposed research
- How the findings compare to similar studies in the literature
- Implications for study feasibility and resource planning
- Limitations of the analysis]

---

## Recommendations for Grant Application

### Primary Recommendation
[Clear, actionable recommendation with specific numbers]

### Implementation Considerations
- Recruitment timeline considerations
- Budget implications (if relevant)
- Potential challenges and mitigations

### Alternative Scenarios
[If applicable: what if assumptions change? Provide contingency recommendations]

---

## References

[If relevant statistical methods or formulas were used, cite key references]

---

*Generated by Power Agent - AI-Powered Biostatistics Assistant*
*This report is intended for use in research planning and grant applications.*

---

**CRITICAL GUIDELINES FOR REPORT GENERATION:**
1. Write in formal academic/consulting biostatistician tone
2. Extract and use ALL specific numbers from the R output - never generalize
3. Include LaTeX formulas for key statistical calculations (e.g., $$n = \\frac{...}{...}$$)
4. Create tables for parameter summaries and results
5. Be authoritative and precise - this is for grant reviewers
6. Include sensitivity analysis discussion if the R output contains multiple scenarios
7. Aim for 3-4 pages of substantive content
8. Use proper markdown formatting with headers, tables, and code blocks
9. Address practical implementation concerns (timeline, budget implications if relevant)
10. The report should stand alone as a complete statistical justification document`
      }]
    });

    const reportContent = response.content[0].text;
    console.log(`   ✅ Report generated (${reportContent.length} chars)`);

    // Create output directory if it doesn't exist
    // Use relative path from backend directory: ./output
    const outputDir = path.join(process.cwd(), 'output');
    await fs.mkdir(outputDir, { recursive: true });
    console.log(`   📁 Output directory: ${outputDir}`);

    // Generate filename with timestamp
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('Z')[0];
    const filename = `analysis_report_${timestamp}.md`;
    const filepath = path.join(outputDir, filename);

    // Save report to file
    await fs.writeFile(filepath, reportContent, 'utf-8');
    console.log(`   ✅ Report saved: ${filepath}`);

    return {
      success: true,
      filename,
      filepath,
      content: reportContent,
      size: reportContent.length
    };

  } catch (error) {
    console.error('❌ Error generating report:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Build execution context from multiple R executions
 */
function buildExecutionContext(executions) {
  let context = '**Iterative Analysis (Multiple Steps):**\n\n';

  executions.forEach((exec, index) => {
    context += `### Iteration ${index + 1}\n`;
    context += `**Code:**\n\`\`\`r\n${exec.code}\n\`\`\`\n\n`;
    context += `**Output:**\n\`\`\`\n${exec.output}\n\`\`\`\n\n`;
  });

  return context;
}

/**
 * Generate a simple report without LLM (fallback)
 * Used when LLM generation fails or for very simple queries
 */
export async function generateSimpleReport(options) {
  const {
    query,
    rCode,
    rOutput,
    sessionId = 'default'
  } = options;

  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .split('Z')[0];

  const reportContent = `# Biostatistical Analysis Report

**Date:** ${new Date().toISOString().split('T')[0]}
**Report ID:** ${sessionId}_${Date.now()}

## Query
${query}

## R Code Executed
\`\`\`r
${rCode}
\`\`\`

## Results
\`\`\`
${rOutput}
\`\`\`

---
*Generated by Power Agent - AI-Powered Biostatistics Assistant*
`;

  const outputDir = path.join(process.cwd(), 'output');
  await fs.mkdir(outputDir, { recursive: true });

  const filename = `analysis_report_${timestamp}.md`;
  const filepath = path.join(outputDir, filename);

  await fs.writeFile(filepath, reportContent, 'utf-8');
  console.log(`   ✅ Simple report saved: ${filepath}`);

  return {
    success: true,
    filename,
    filepath,
    content: reportContent,
    size: reportContent.length
  };
}

export default {
  generateReport,
  generateSimpleReport
};
