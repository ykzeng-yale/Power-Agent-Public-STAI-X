/**
 * PDF Report Generator
 *
 * Generates publication-quality PDF reports by:
 * 1. Using LLM to generate report narrative (reuses report-generator.js prompt style)
 * 2. Discovering PNG figures in workspace_output
 * 3. Building an Rmd file that weaves narrative + figure references
 * 4. Rendering to PDF via rmarkdown::render() through the R process pool
 * 5. Falls back to markdown-only report if PDF rendering fails
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Workspace base directory (mirrors r-process-pool.js logic)
const WORKSPACE_BASE = process.env.WORKSPACE_BASE_DIR ||
  (fsSync.existsSync('/workspace') ? '/workspace' : path.join(process.env.TMPDIR || '/tmp', 'r-workspace'));

const WORKSPACE_OUTPUT = path.join(WORKSPACE_BASE, 'output');

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
        const waitTime = Math.pow(2, attempt) * 5000;
        console.log(`[PDF-REPORT] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Discover figure files in the workspace output directory
 * @returns {Array<{name: string, path: string, caption: string}>}
 */
async function discoverFigures() {
  const figures = [];
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.svg'];

  try {
    if (!fsSync.existsSync(WORKSPACE_OUTPUT)) return figures;

    const files = await fs.readdir(WORKSPACE_OUTPUT);
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (imageExtensions.includes(ext)) {
        const fullPath = path.join(WORKSPACE_OUTPUT, file);
        const baseName = path.basename(file, ext)
          .replace(/_/g, ' ')
          .replace(/\b\w/g, c => c.toUpperCase());

        figures.push({
          name: file,
          path: fullPath,
          caption: baseName
        });
      }
    }
  } catch (error) {
    console.warn('[PDF-REPORT] Error discovering figures:', error.message);
  }

  return figures;
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
 * Generate the report narrative using LLM
 */
async function generateNarrative(options) {
  const {
    query,
    rCode,
    rOutput,
    previousExecutions = [],
    sessionId = 'default',
    figures = []
  } = options;

  const executionContext = previousExecutions.length > 0
    ? buildExecutionContext(previousExecutions)
    : `**R Code:**\n\`\`\`r\n${rCode}\n\`\`\`\n\n**Output:**\n\`\`\`\n${rOutput}\n\`\`\``;

  const figureList = figures.length > 0
    ? `\n\n**Available Figures (reference these in your report):**\n${figures.map((f, i) => `- Figure ${i + 1}: ${f.name} (${f.caption})`).join('\n')}`
    : '';

  const response = await callAnthropicWithRetry({
    model: 'claude-opus-4-6',
    max_tokens: 12000,
    messages: [{
      role: 'user',
      content: `You are a senior biostatistician consultant writing a comprehensive analysis report for a PDF document.

**User's Research Question:**
${query}

**Complete Analysis Performed (R Code and Output):**
${executionContext}
${figureList}

Write a detailed report in **markdown format** with the following structure. The markdown will be embedded into an Rmd document and rendered to PDF, so:

1. Use standard markdown headers (##, ###) — do NOT use # for top-level (the Rmd template provides the title)
2. Use LaTeX math notation where appropriate: $n = \\frac{(z_{\\alpha/2} + z_\\beta)^2 \\sigma^2}{\\delta^2}$ for inline, or $$...$$ for display math
3. Use standard markdown tables with pipes (|)
4. If figures are available, reference them using this exact format on its own line:
   ![Caption text](filename.png)
   Where filename.png is the exact name from the available figures list above.
5. Do NOT include raw R code blocks — the analysis code will be appended separately

## Report Structure:

## Executive Summary
[3-5 sentences: statistical question, key numerical findings, main recommendation]

## Background and Objectives
[Research question, study design type, primary and secondary endpoints]

## Statistical Methods
### Analysis Framework
[Statistical framework used]

### Key Parameters
| Parameter | Value | Justification |
|-----------|-------|---------------|
| ... | ... | ... |

### Assumptions
[All statistical assumptions made]

## Results
### Primary Findings
| Metric | Value |
|--------|-------|
| ... | ... |

### Detailed Results
[All numerical findings from R output]

${figures.length > 0 ? '### Diagnostic Plots\n[Reference each available figure with interpretation]' : ''}

### Sensitivity Analysis
[How results change under different assumptions]

## Statistical Details
### Formulas and Calculations
[Relevant statistical formulas in LaTeX notation]

### Design Effect and Adjustments
[For complex designs: ICC, clustering, stratification factors]

### Confidence Intervals and Uncertainty
[Report CIs, standard errors, or simulation-based uncertainty]

## Interpretation and Clinical Significance
[Professional interpretation, strength of evidence, limitations]

## Recommendations
### Primary Recommendation
### Implementation Considerations

## References
[MANDATORY: Include numbered references for ALL R packages used, methodological papers for each statistical method applied, and R itself. Use APA format with DOIs. NEVER fabricate citations.]

---
*Generated by Power Agent — AI-Powered Biostatistics Assistant*

**GUIDELINES:**
1. Formal academic tone suitable for grant applications
2. Use ALL specific numbers from R output — never generalize
3. Include LaTeX formulas for key statistical calculations
4. Create tables for parameter summaries and results
5. Address statistical assumptions explicitly
6. Aim for 3-4 pages of substantive content`
    }]
  });

  return response.content[0].text;
}

/**
 * Build an Rmd file from narrative + figures
 */
async function buildRmdFile(narrative, figures, outputDir) {
  let rmdContent;
  const templatePath = '/app/r-utils/report_template.Rmd';
  const localTemplatePath = path.join(process.cwd(), 'r-utils', 'report_template.Rmd');

  try {
    if (fsSync.existsSync(templatePath)) {
      rmdContent = await fs.readFile(templatePath, 'utf-8');
    } else if (fsSync.existsSync(localTemplatePath)) {
      rmdContent = await fs.readFile(localTemplatePath, 'utf-8');
    } else {
      // Inline fallback template
      rmdContent = `---
title: "Biostatistical Analysis Report"
date: "\`r format(Sys.time(), '%B %d, %Y')\`"
output:
  pdf_document:
    latex_engine: xelatex
    toc: true
    number_sections: true
    fig_caption: true
geometry: "margin=1in"
fontsize: 11pt
---

\`\`\`{r setup, include=FALSE}
knitr::opts_chunk$set(echo = FALSE, warning = FALSE, message = FALSE,
  fig.align = "center", fig.width = 8, fig.height = 6, dpi = 300, out.width = "90%")
\`\`\`

{{REPORT_CONTENT}}
`;
    }
  } catch (err) {
    console.warn('[PDF-REPORT] Could not read template, using inline fallback');
    rmdContent = `---
title: "Biostatistical Analysis Report"
date: "\`r format(Sys.time(), '%B %d, %Y')\`"
output:
  pdf_document:
    latex_engine: xelatex
    toc: true
    number_sections: true
    fig_caption: true
geometry: "margin=1in"
fontsize: 11pt
---

\`\`\`{r setup, include=FALSE}
knitr::opts_chunk$set(echo = FALSE, warning = FALSE, message = FALSE,
  fig.align = "center", fig.width = 8, fig.height = 6, dpi = 300, out.width = "90%")
\`\`\`

{{REPORT_CONTENT}}
`;
  }

  // Process figure references in the narrative
  // Convert ![Caption](filename.png) to absolute paths
  let processedNarrative = narrative;
  for (const fig of figures) {
    const relativePattern = new RegExp(`!\\[([^\\]]*)\\]\\(${fig.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
    processedNarrative = processedNarrative.replace(relativePattern, `![$1](${fig.path})`);
  }

  // Replace the placeholder with the narrative content
  const finalContent = rmdContent.replace('{{REPORT_CONTENT}}', processedNarrative);

  // Write the Rmd file
  const rmdPath = path.join(outputDir, 'analysis_report.Rmd');
  await fs.writeFile(rmdPath, finalContent, 'utf-8');

  // Copy header.tex to the output directory so Rmd can find it
  const headerSrc = fsSync.existsSync('/app/r-utils/header.tex')
    ? '/app/r-utils/header.tex'
    : path.join(process.cwd(), 'r-utils', 'header.tex');
  if (fsSync.existsSync(headerSrc)) {
    await fs.copyFile(headerSrc, path.join(outputDir, 'header.tex'));
  }

  return rmdPath;
}

/**
 * Generate a PDF report from R execution results
 *
 * @param {Object} options - Report generation options
 * @param {string} options.query - User's original query
 * @param {string} options.rCode - R code that was executed
 * @param {string} options.rOutput - R execution output
 * @param {Array} options.previousExecutions - All previous R executions
 * @param {string} options.sessionId - Session ID for file naming
 * @param {Object} options.rPool - RProcessPool instance for rendering
 * @returns {Promise<Object>} Report metadata with PDF path, markdown content, and file info
 */
export async function generatePdfReport(options) {
  const {
    query,
    rCode,
    rOutput,
    previousExecutions = [],
    sessionId = 'default',
    rPool
  } = options;

  console.log('[PDF-REPORT] Starting PDF report generation...');

  try {
    // 1. Discover figures in workspace output
    const figures = await discoverFigures();
    console.log(`[PDF-REPORT] Found ${figures.length} figure(s): ${figures.map(f => f.name).join(', ')}`);

    // 2. Generate narrative via LLM
    console.log('[PDF-REPORT] Generating report narrative...');
    const narrative = await generateNarrative({
      query, rCode, rOutput, previousExecutions, sessionId, figures
    });
    console.log(`[PDF-REPORT] Narrative generated (${narrative.length} chars)`);

    // 3. Save the markdown version (always available as fallback)
    const outputDir = WORKSPACE_OUTPUT;
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('Z')[0];
    const mdFilename = `analysis_report_${timestamp}.md`;
    const mdPath = path.join(outputDir, mdFilename);
    await fs.writeFile(mdPath, narrative, 'utf-8');
    console.log(`[PDF-REPORT] Markdown saved: ${mdPath}`);

    // 4. Build Rmd and render to PDF (if R pool available)
    let pdfResult = null;
    if (rPool) {
      try {
        console.log('[PDF-REPORT] Building Rmd file...');
        const rmdPath = await buildRmdFile(narrative, figures, outputDir);
        console.log(`[PDF-REPORT] Rmd file written: ${rmdPath}`);

        console.log('[PDF-REPORT] Rendering PDF...');
        pdfResult = await rPool.renderRmd(rmdPath, {
          timeout: 120000,
          sessionId: `pdf-${sessionId}`
        });

        if (pdfResult.success) {
          console.log(`[PDF-REPORT] PDF rendered: ${pdfResult.pdfPath}`);
        } else {
          console.warn(`[PDF-REPORT] PDF rendering failed: ${pdfResult.error}`);
        }
      } catch (pdfError) {
        console.warn('[PDF-REPORT] PDF rendering error:', pdfError.message);
      }
    } else {
      console.log('[PDF-REPORT] No R pool provided, skipping PDF rendering');
    }

    // 5. Build result with both markdown and PDF (if available)
    const result = {
      success: true,
      // Markdown report (always available)
      markdown: {
        filename: mdFilename,
        filepath: mdPath,
        content: narrative,
        size: narrative.length
      }
    };

    // Add PDF if rendering succeeded
    if (pdfResult?.success && pdfResult.pdfPath && fsSync.existsSync(pdfResult.pdfPath)) {
      const pdfStats = fsSync.statSync(pdfResult.pdfPath);
      const pdfFilename = `analysis_report_${timestamp}.pdf`;
      const pdfDestPath = path.join(outputDir, pdfFilename);

      // Move PDF to output directory if it's not already there
      if (pdfResult.pdfPath !== pdfDestPath) {
        await fs.copyFile(pdfResult.pdfPath, pdfDestPath);
      }

      result.pdf = {
        filename: pdfFilename,
        filepath: pdfDestPath,
        size: pdfStats.size
      };
      console.log(`[PDF-REPORT] PDF report ready: ${pdfFilename} (${(pdfStats.size / 1024).toFixed(1)} KB)`);
    }

    return result;

  } catch (error) {
    console.error('[PDF-REPORT] Error generating report:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

export default { generatePdfReport };
