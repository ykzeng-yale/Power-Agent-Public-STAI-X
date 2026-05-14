/**
 * Document Corrector Module
 *
 * Generates corrected versions of SAP/protocol documents.
 * For DOCX: preserves original formatting via JSZip XML manipulation.
 * For PDF: creates a new DOCX with corrected content (PDF editing is impractical).
 *
 * Flow:
 * 1. LLM identifies statistical corrections needed (structured JSON)
 * 2. Corrections applied to original document
 * 3. Returns corrected document buffer + corrections summary
 */

import Anthropic from '@anthropic-ai/sdk';
import JSZip from 'jszip';

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
        const waitTime = Math.pow(2, attempt) * 5000;
        console.log(`[DOC-CORRECTOR] API overloaded, retry ${attempt + 1}/${maxRetries} in ${waitTime/1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      throw error;
    }
  }
}

// ============================================================
// Step 1: LLM identifies corrections
// ============================================================

/**
 * Use LLM to identify statistical corrections needed in the document.
 *
 * @param {string} extractedText - Full text extracted from the document
 * @param {string} analysisReport - The analysis report already generated
 * @param {string} query - User's original query
 * @returns {Promise<Array>} Array of corrections: [{ find, replace, reason, severity }]
 */
async function identifyCorrections(extractedText, analysisReport, query) {
  console.log('[DOC-CORRECTOR] Identifying corrections...');

  // Truncate if too long (keep within token limits)
  const maxDocLen = 40000;
  const docText = extractedText.length > maxDocLen
    ? extractedText.substring(0, maxDocLen) + '\n\n... [truncated]'
    : extractedText;

  const maxReportLen = 10000;
  const reportText = analysisReport.length > maxReportLen
    ? analysisReport.substring(0, maxReportLen) + '\n\n... [truncated]'
    : analysisReport;

  const response = await callAnthropicWithRetry({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `You are an expert biostatistician reviewing a Statistical Analysis Plan (SAP) or study protocol document. Your job is to identify ONLY statistical and methodological corrections needed.

**User's Query:** ${query}

**Analysis Report (our findings):**
${reportText}

**Original Document Text:**
${docText}

---

TASK: Compare the original document against our analysis findings. Identify specific text passages in the document that need correction based on the statistical analysis results.

RULES:
1. The "find" field MUST contain an EXACT verbatim substring from the original document text above - character for character, including punctuation and whitespace
2. Keep corrections MINIMAL - only change what is statistically incorrect or needs updating based on our analysis
3. Do NOT suggest style/grammar/formatting changes - ONLY statistical and methodological corrections
4. Each "find" string must be long enough to be unique in the document (include surrounding context if needed)
5. The "replace" text should preserve the same writing style and tone as the original
6. Focus on: sample sizes, power values, effect sizes, statistical test choices, alpha levels, formulas, assumptions, analysis methods
7. If the document is already correct, return an empty array []

Return ONLY a valid JSON array (no markdown fencing, no explanation text):
[
  {
    "find": "exact text from document to replace",
    "replace": "corrected text",
    "reason": "brief explanation of why this correction is needed",
    "severity": "critical|major|minor"
  }
]

If no corrections are needed, return: []`
    }]
  });

  const responseText = response.content[0].text.trim();
  console.log(`[DOC-CORRECTOR] LLM response: ${responseText.substring(0, 200)}...`);

  try {
    // Parse JSON - handle potential markdown fencing
    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const corrections = JSON.parse(jsonStr);

    if (!Array.isArray(corrections)) {
      console.warn('[DOC-CORRECTOR] LLM did not return an array, got:', typeof corrections);
      return [];
    }

    // Validate each correction has required fields
    const valid = corrections.filter(c =>
      c.find && c.replace && c.reason &&
      typeof c.find === 'string' && typeof c.replace === 'string' &&
      c.find !== c.replace
    );

    console.log(`[DOC-CORRECTOR] Found ${valid.length} valid corrections (${corrections.length} total from LLM)`);
    return valid;
  } catch (parseError) {
    console.warn('[DOC-CORRECTOR] Failed to parse LLM corrections JSON:', parseError.message);
    return [];
  }
}

// ============================================================
// Step 2a: Apply corrections to DOCX (preserving formatting)
// ============================================================

/**
 * Apply text corrections to a DOCX file while preserving all formatting.
 * DOCX is a ZIP of XML files. We modify <w:t> text elements in word/document.xml.
 *
 * @param {Buffer} originalBuffer - Original DOCX file buffer
 * @param {Array} corrections - Array of { find, replace } objects
 * @returns {Promise<Buffer>} Corrected DOCX file buffer
 */
async function applyDocxCorrections(originalBuffer, corrections) {
  console.log(`[DOC-CORRECTOR] Applying ${corrections.length} corrections to DOCX...`);

  const zip = await JSZip.loadAsync(originalBuffer);

  // Process main document body and headers/footers
  const xmlFiles = [
    'word/document.xml',
    'word/header1.xml', 'word/header2.xml', 'word/header3.xml',
    'word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml'
  ];

  let totalApplied = 0;

  for (const xmlPath of xmlFiles) {
    const file = zip.file(xmlPath);
    if (!file) continue;

    let xml = await file.async('string');
    let modified = false;

    for (const correction of corrections) {
      const result = replaceTextInDocxXml(xml, correction.find, correction.replace);
      if (result.applied) {
        xml = result.xml;
        modified = true;
        totalApplied++;
        console.log(`   ✅ Applied in ${xmlPath}: "${correction.find.substring(0, 50)}..." → "${correction.replace.substring(0, 50)}..."`);
      }
    }

    if (modified) {
      zip.file(xmlPath, xml);
    }
  }

  console.log(`[DOC-CORRECTOR] Applied ${totalApplied}/${corrections.length} corrections in DOCX`);

  const correctedBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return correctedBuffer;
}

/**
 * Replace text in DOCX XML, handling Word's text-splitting across <w:r> runs.
 *
 * Word often splits text across multiple runs like:
 *   <w:r><w:t>sam</w:t></w:r><w:r><w:t>ple size</w:t></w:r>
 *
 * Algorithm:
 * 1. Find all paragraphs (<w:p>)
 * 2. For each paragraph, concatenate all <w:t> text to get full paragraph text
 * 3. If the "find" string exists in concatenated text, locate the run boundaries
 * 4. Modify <w:t> values surgically, preserving all <w:rPr> formatting
 *
 * @param {string} xml - The DOCX XML string
 * @param {string} find - Text to find
 * @param {string} replace - Replacement text
 * @returns {{ xml: string, applied: boolean }}
 */
function replaceTextInDocxXml(xml, find, replace) {
  if (!find || !replace || find === replace) return { xml, applied: false };

  // Strategy 1: Try simple <w:t> replacement first (works when text is in a single run)
  if (xml.includes(escapeXml(find))) {
    const escapedFind = escapeXml(find);
    const escapedReplace = escapeXml(replace);
    xml = xml.replace(escapedFind, escapedReplace);
    return { xml, applied: true };
  }

  // Strategy 2: Handle text split across multiple <w:r> runs within <w:p> paragraphs
  // Extract paragraphs
  const paragraphRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let applied = false;

  xml = xml.replace(paragraphRegex, (paragraph) => {
    if (applied) return paragraph; // Only apply once per correction

    // Extract all <w:t> values from this paragraph, with positions
    const runs = [];
    const runRegex = /<w:r[ >][\s\S]*?<\/w:r>/g;
    let runMatch;
    let fullText = '';

    while ((runMatch = runRegex.exec(paragraph)) !== null) {
      const runXml = runMatch[0];
      const tMatch = runXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
      const text = tMatch ? tMatch[1] : '';
      runs.push({
        startInFullText: fullText.length,
        text: text,
        runXml: runXml,
        offset: runMatch.index
      });
      fullText += text;
    }

    // Check if the find text exists in the concatenated paragraph text
    const findEscaped = escapeXml(find);
    const findIdx = fullText.indexOf(findEscaped);
    if (findIdx === -1) return paragraph; // Not in this paragraph

    const findEnd = findIdx + findEscaped.length;
    const replaceEscaped = escapeXml(replace);

    // Determine which runs are affected
    let newParagraph = paragraph;
    let offsetAdjustment = 0;

    for (let i = 0; i < runs.length; i++) {
      const run = runs[i];
      const runStart = run.startInFullText;
      const runEnd = runStart + run.text.length;

      // Skip runs entirely before the match
      if (runEnd <= findIdx) continue;
      // Stop after runs entirely past the match
      if (runStart >= findEnd) break;

      // This run overlaps with the find text
      const overlapStart = Math.max(findIdx, runStart) - runStart;
      const overlapEnd = Math.min(findEnd, runEnd) - runStart;

      let newText;
      if (runStart <= findIdx && runEnd >= findEnd) {
        // Entire find text is within this single run
        newText = run.text.substring(0, overlapStart) + replaceEscaped + run.text.substring(overlapEnd);
      } else if (runStart <= findIdx) {
        // This is the first run containing part of the match
        newText = run.text.substring(0, overlapStart) + replaceEscaped;
      } else if (runEnd >= findEnd) {
        // This is the last run containing part of the match
        newText = run.text.substring(overlapEnd);
      } else {
        // This run is entirely within the match - clear it
        newText = '';
      }

      // Replace the <w:t> content in this run's XML
      const oldRunXml = run.runXml;
      const newRunXml = oldRunXml.replace(
        /<w:t([^>]*)>[\s\S]*?<\/w:t>/,
        `<w:t$1>${newText}</w:t>`
      );

      const pos = newParagraph.indexOf(oldRunXml, run.offset + offsetAdjustment - 10);
      if (pos !== -1) {
        newParagraph = newParagraph.substring(0, pos) + newRunXml + newParagraph.substring(pos + oldRunXml.length);
        offsetAdjustment += newRunXml.length - oldRunXml.length;
      }
    }

    applied = true;
    return newParagraph;
  });

  return { xml, applied };
}

/**
 * Escape text for XML content
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ============================================================
// Step 2b: Create DOCX from corrected text (for PDF input)
// ============================================================

/**
 * Create a new DOCX document from corrected text content.
 * Used when input is PDF (can't edit PDF in place).
 *
 * @param {string} extractedText - Original extracted text
 * @param {Array} corrections - Array of { find, replace } objects
 * @returns {Promise<Buffer>} New DOCX file buffer
 */
async function createDocxFromCorrectedText(extractedText, corrections) {
  console.log('[DOC-CORRECTOR] Creating DOCX from corrected PDF text...');

  // Apply corrections to the plain text
  let correctedText = extractedText;
  for (const correction of corrections) {
    correctedText = correctedText.replace(correction.find, correction.replace);
  }

  // Use the docx library to create a formatted document
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } = await import('docx');

  const lines = correctedText.split('\n');
  const children = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines but add spacing
    if (!trimmed) {
      children.push(new Paragraph({ spacing: { after: 100 } }));
      continue;
    }

    // Detect headings (ALL CAPS lines or lines that look like section headers)
    const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length > 3 && /[A-Z]/.test(trimmed);
    const isNumberedSection = /^\d+(\.\d+)*\s+[A-Z]/.test(trimmed);

    if (isAllCaps && trimmed.length < 100) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: trimmed, bold: true, size: 28 })],
        spacing: { before: 300, after: 150 }
      }));
    } else if (isNumberedSection) {
      // Check nesting level
      const numMatch = trimmed.match(/^(\d+(\.\d+)*)/);
      const dots = (numMatch[1].match(/\./g) || []).length;
      const level = dots === 0 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

      children.push(new Paragraph({
        heading: level,
        children: [new TextRun({ text: trimmed, bold: true, size: dots === 0 ? 26 : 24 })],
        spacing: { before: 200, after: 100 }
      }));
    } else {
      // Regular paragraph
      children.push(new Paragraph({
        children: [new TextRun({ text: trimmed, size: 22, font: 'Calibri' })],
        spacing: { after: 80, line: 276 }
      }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 }
        }
      },
      children
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

// ============================================================
// Main entry point
// ============================================================

/**
 * Generate a corrected version of a SAP/protocol document.
 *
 * @param {Object} options
 * @param {Buffer} options.originalBuffer - Original file buffer
 * @param {string} options.fileName - Original filename
 * @param {string} options.fileExt - File extension (docx, pdf, doc)
 * @param {string} options.extractedText - Full extracted text content
 * @param {string} options.analysisReport - Analysis report content (markdown)
 * @param {string} options.query - User's original query
 * @returns {Promise<Object>} { success, correctedBuffer, corrections, format, correctedFileName }
 */
export async function generateCorrectedDocument(options) {
  const { originalBuffer, fileName, fileExt, extractedText, analysisReport, query } = options;

  console.log(`[DOC-CORRECTOR] Starting document correction for: ${fileName} (${fileExt})`);

  if (!extractedText || extractedText.trim().length < 50) {
    console.log('[DOC-CORRECTOR] Document text too short, skipping correction');
    return { success: false, reason: 'text_too_short', corrections: [] };
  }

  // Step 1: Identify corrections
  const corrections = await identifyCorrections(extractedText, analysisReport, query);

  if (corrections.length === 0) {
    console.log('[DOC-CORRECTOR] No corrections needed');
    return { success: false, reason: 'no_corrections', corrections: [] };
  }

  console.log(`[DOC-CORRECTOR] Applying ${corrections.length} corrections...`);

  // Step 2: Apply corrections based on file type
  let correctedBuffer;
  let outputExt = 'docx';

  if (fileExt === 'docx' || fileExt === 'doc') {
    // DOCX: preserve formatting via XML manipulation
    correctedBuffer = await applyDocxCorrections(originalBuffer, corrections);
  } else if (fileExt === 'pdf') {
    // PDF: create new DOCX with corrected content
    correctedBuffer = await createDocxFromCorrectedText(extractedText, corrections);
    outputExt = 'docx'; // PDF input → DOCX output
  } else {
    console.warn(`[DOC-CORRECTOR] Unsupported format: ${fileExt}`);
    return { success: false, reason: 'unsupported_format', corrections };
  }

  // Generate output filename
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const correctedFileName = `${baseName}_corrected.${outputExt}`;

  console.log(`[DOC-CORRECTOR] Corrected document generated: ${correctedFileName} (${correctedBuffer.length} bytes, ${corrections.length} corrections)`);

  return {
    success: true,
    correctedBuffer,
    corrections,
    format: outputExt,
    correctedFileName
  };
}

export default { generateCorrectedDocument };
