/**
 * IMPROVED File Parser Utility - Professional Grade
 * Handles parsing of various file formats for biostatistics analysis
 *
 * Multi-Strategy Approach:
 * - PDF: pdf-parse (primary) → pdfjs-dist (fallback) → Document AI (premium)
 * - DOCX: mammoth (primary) → raw extraction (fallback)
 * - Data files: Direct R processing
 *
 * Supports: PDF, DOCX, CSV, Excel, JSON, XML, and more
 */

import { promises as fs } from 'fs';
import path from 'path';
import { Worker } from 'node:worker_threads';
import { getOpaqueInputMetadata } from './scientific-input-formats.js';

/**
 * Parse file content based on file type with multi-strategy fallbacks
 * @param {Buffer|string} content - File content
 * @param {string} fileName - File name with extension
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<{text: string, metadata: object}>}
 */
export async function parseFile(content, fileName, mimeType) {
  const ext = path.extname(fileName).toLowerCase();

  console.log(`📄 Parsing file: ${fileName} (${ext}, ${mimeType})`);

  const opaque = getOpaqueInputMetadata(fileName);
  if (opaque) return { text: null, metadata: { ...opaque, fileName } };

  try {
    // Handle different file types
    switch (ext) {
      case '.pdf':
        return await parsePDF(content, fileName);

      case '.docx':
        return await parseDOCX(content, fileName);

      case '.txt':
      case '.md':
      case '.rtf':
        return parseText(content, fileName);

      case '.json':
        return parseJSON(content, fileName);

      case '.xml':
        return parseXML(content, fileName);

      case '.csv':
      case '.tsv':
        return parseCSV(content, fileName);

      case '.xlsx':
      case '.xls':
        return parseExcel(content, fileName);

      case '.rdata':
      case '.rda':
      case '.rds':
        return parseRData(content, fileName);

      default:
        // Try to parse as text if unknown
        return parseText(content, fileName);
    }
  } catch (error) {
    console.error(`❌ Error parsing file ${fileName}:`, error.message);
    return {
      text: content.toString('utf-8'),
      metadata: {
        error: error.message,
        parsedAs: 'raw_text'
      }
    };
  }
}

/**
 * Parse PDF files with multi-strategy fallback
 * Strategy 1: pdf-parse (fast, requires canvas)
 * Strategy 2: pdfjs-dist (pure JS, reliable)
 */
async function parsePDF(content, fileName) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  // Strategy 1: Try pdf-parse (faster but needs canvas)
  try {
    console.log('   📊 Strategy 1: Trying pdf-parse...');
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const data = await parser.getText();
      console.log(`   ✅ pdf-parse SUCCESS: ${data.total} pages, ${data.text.length} characters`);
      return {
        text: data.text,
        metadata: { pages: data.total, parsedAs: 'pdf-parse-v2', fileName,
          has_embedded_text: data.pages.some(page => page.text.trim().length > 0),
          extraction_scope: 'Embedded page text only; scanned images, figures, tables and mathematical layout are not certified or OCR processed.' }
      };
    } finally { await parser.destroy(); }
  } catch (error) {
    console.warn(`   ⚠️  pdf-parse failed: ${error.message}`);
  }

  // Strategy 2: Try pdfjs-dist (pure JavaScript fallback)
  try {
    console.log('   📊 Strategy 2: Trying pdfjs-dist (pure JS)...');
    const extracted = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./file-parser-pdf-worker.js', import.meta.url), { workerData: { bytes: buffer }, env: {}, execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 } });
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Fallback PDF extraction timed out')); }, 30000);
      worker.once('message', value => { clearTimeout(timer); worker.terminate(); value.success ? resolve(value) : reject(new Error(value.error)); });
      worker.once('error', () => { clearTimeout(timer); worker.terminate(); reject(new Error('Fallback PDF extraction unavailable')); });
    });
    const numPages = extracted.pages, fullText = extracted.text;
    console.log(`   ✅ pdfjs-dist SUCCESS: ${numPages} pages, ${fullText.length} characters`);

    return {
      text: fullText,
      metadata: {
        pages: numPages,
        parsedAs: 'pdfjs-dist',
        strategy: 'isolated-pure-js-fallback',
        has_embedded_text: fullText.trim().length > 0,
        extraction_scope: 'Embedded PDF text only; no OCR, figure or mathematical-layout certification.',
        fileName: fileName
      }
    };
  } catch (error) {
    console.error(`   ❌ pdfjs-dist failed: ${error.message}`);
  }

  // All strategies failed
  console.error(`   ❌ ALL PDF parsing strategies failed for ${fileName}`);
  return {
    text: `[PDF file: ${fileName}]\n\n⚠️ PDF PARSING FAILED\n\nBoth parsing strategies failed:\n1. pdf-parse (canvas-based)\n2. pdfjs-dist (pure JavaScript)\n\nPlease provide the text content manually.`,
    metadata: {
      parsedAs: 'pdf_failed',
      error: 'All PDF parsing strategies failed',
      fileName: fileName
    }
  };
}

/**
 * Parse DOCX files - MULTI-STRATEGY APPROACH
 * Strategy 1: mammoth (excellent formatting)
 * Strategy 2: Manual ZIP extraction (basic)
 */
async function parseDOCX(content, fileName) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  // Strategy 1: Try mammoth
  try {
    console.log('   📊 Strategy 1: Trying mammoth for DOCX...');
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: buffer });

    console.log(`   ✅ mammoth SUCCESS: ${result.value.length} characters extracted`);
    return {
      text: result.value,
      metadata: {
        messages: result.messages,
        parsedAs: 'mammoth',
        strategy: 'native',
        fileName: fileName
      }
    };
  } catch (error) {
    console.warn(`   ⚠️  mammoth failed: ${error.message}`);
  }

  // All strategies failed
  console.error(`   ❌ ALL DOCX parsing strategies failed for ${fileName}`);
  return {
    text: `[Word document: ${fileName}]\n\n⚠️ DOCX PARSING FAILED\n\nPlease:\n- Ensure mammoth package is installed\n- OR provide text content manually`,
    metadata: {
      parsedAs: 'docx_failed',
      error: 'Mammoth parsing failed',
      fileName: fileName
    }
  };
}

/**
 * Parse plain text files
 */
function parseText(content, fileName) {
  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  console.log(`   ✅ Text file parsed: ${text.length} characters`);
  return {
    text: text,
    metadata: {
      parsedAs: 'text',
      original_format: path.extname(fileName).slice(1).toLowerCase(),
      extraction_scope: path.extname(fileName).toLowerCase() === '.rtf' ? 'Original RTF source text; formatting markup is not interpreted.' : 'UTF-8 source text.',
      fileName: fileName,
      size: text.length
    }
  };
}

/**
 * Parse JSON files
 */
function parseJSON(content, fileName) {
  try {
    const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
    const data = JSON.parse(text);

    // Pretty print JSON for better readability
    const formatted = JSON.stringify(data, null, 2);

    console.log(`   ✅ JSON parsed: ${formatted.length} characters`);
    return {
      text: formatted,
      metadata: {
        parsedAs: 'json',
        fileName: fileName,
        isValid: true,
        structure: typeof data,
        keys: Array.isArray(data) ? data.length : Object.keys(data).length
      }
    };
  } catch (error) {
    return {
      text: Buffer.isBuffer(content) ? content.toString('utf-8') : content,
      metadata: {
        parsedAs: 'json_invalid',
        error: error.message,
        fileName: fileName
      }
    };
  }
}

/**
 * Parse XML files
 */
function parseXML(content, fileName) {
  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  console.log(`   ✅ XML file parsed: ${text.length} characters`);
  return {
    text: text,
    metadata: {
      parsedAs: 'xml',
      fileName: fileName,
      size: text.length
    }
  };
}

/**
 * Parse CSV/TSV files
 */
function parseCSV(content, fileName) {
  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  const lines = text.split('\n').filter(line => line.trim());

  console.log(`   ✅ CSV parsed: ${lines.length} rows`);
  return {
    text: text,
    metadata: {
      parsedAs: 'csv',
      fileName: fileName,
      rows: lines.length,
      preview: lines.slice(0, 5).join('\n')
    }
  };
}

/**
 * Parse Excel files (placeholder - requires xlsx library)
 */
function parseExcel(content, fileName) {
  console.log(`   ℹ️  Excel file detected - will be processed by R`);
  return {
    text: `[Excel file: ${fileName}]\nData file detected. Will be processed by R for analysis.\n\nFile uploaded successfully.`,
    metadata: {
      parsedAs: 'excel',
      fileName: fileName,
      note: 'Excel files are processed by R during analysis'
    }
  };
}

/**
 * Parse R data files (placeholder - requires R to load)
 */
function parseRData(content, fileName) {
  console.log(`   ℹ️  R data file detected`);
  return {
    text: `[R data file: ${fileName}]\nR dataset detected. Will be loaded and processed during analysis.\n\nFile uploaded successfully.`,
    metadata: {
      parsedAs: 'rdata',
      fileName: fileName,
      note: 'R data files are loaded directly in R environment'
    }
  };
}

/**
 * Detect file type from content (when extension is ambiguous)
 */
export function detectFileType(content, fileName) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);

  // PDF signature
  if (buffer.slice(0, 4).toString() === '%PDF') {
    return 'pdf';
  }

  // ZIP-based formats (DOCX, XLSX)
  if (buffer.slice(0, 2).toString('hex') === '504b') {
    if (fileName.endsWith('.docx')) return 'docx';
    if (fileName.endsWith('.xlsx')) return 'xlsx';
    return 'zip';
  }

  // CSV/Text - try to detect by content
  try {
    const text = buffer.toString('utf-8', 0, Math.min(1000, buffer.length));
    if (text.includes(',') && text.includes('\n')) {
      return 'csv';
    }
    if (text.startsWith('{') || text.startsWith('[')) {
      return 'json';
    }
    if (text.startsWith('<?xml')) {
      return 'xml';
    }
  } catch (e) {
    // Binary file
  }

  return 'unknown';
}
