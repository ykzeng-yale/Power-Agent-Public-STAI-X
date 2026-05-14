/**
 * File Parser Utility
 * Handles parsing of various file formats for biostatistics analysis
 * Supports: PDF, DOCX, CSV, Excel, JSON, XML, and more
 */

import { promises as fs } from 'fs';
import path from 'path';

/**
 * Parse file content based on file type
 * @param {Buffer|string} content - File content
 * @param {string} fileName - File name with extension
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<{text: string, metadata: object}>}
 */
export async function parseFile(content, fileName, mimeType) {
  const ext = path.extname(fileName).toLowerCase();

  console.log(`📄 Parsing file: ${fileName} (${ext}, ${mimeType})`);

  try {
    // Handle different file types
    switch (ext) {
      case '.pdf':
        return await parsePDF(content, fileName);

      case '.docx':
      case '.doc':
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
 * Parse PDF files
 * Uses Python PyMuPDF (fitz) for high-quality extraction
 */
async function parsePDF(content, fileName) {
  try {
    // Save buffer to temp file
    const tmpPath = `/tmp/${Date.now()}_${fileName}`;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await fs.writeFile(tmpPath, buffer);

    // Call Python extraction script
    const { execSync } = await import('child_process');
    const result = execSync(
      `python3 "${path.join(path.dirname(import.meta.url.replace('file://', '')), 'pdf-extractor.py')}" "${tmpPath}" "pdf"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 } // 50MB buffer
    );

    // Clean up temp file
    try { await fs.unlink(tmpPath); } catch (e) { /* ignore */ }

    const data = JSON.parse(result);

    if (data.success) {
      console.log(`   ✅ PDF extracted: ${data.char_count} chars, ${data.word_count} words, ${data.metadata.pages} pages`);
      return {
        text: data.text,
        metadata: {
          pages: data.metadata.pages,
          title: data.metadata.title || fileName,
          author: data.metadata.author || '',
          parsedAs: 'pdf',
          fileName: fileName,
          charCount: data.char_count,
          wordCount: data.word_count
        }
      };
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.warn(`⚠️ PDF parsing failed: ${error.message}`);

    let errorMessage = `[PDF file: ${fileName}]\n\n⚠️ PDF PARSING FAILED\n\n`;
    errorMessage += `Content extraction failed: ${error.message}\n\nFile uploaded successfully but text content could not be extracted automatically.\n\nPlease provide the text content manually if needed for analysis.`;

    return {
      text: errorMessage,
      metadata: {
        parsedAs: 'pdf_fallback',
        error: error.message,
        fileName: fileName
      }
    };
  }
}

/**
 * Parse DOCX files
 * Uses Python python-docx for high-quality extraction with table support
 */
async function parseDOCX(content, fileName) {
  try {
    // First try mammoth (if available)
    try {
      const mammoth = await import('mammoth');
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      const result = await mammoth.extractRawText({ buffer: buffer });

      if (result.value && result.value.length > 100) {
        console.log(`   ✅ DOCX extracted via mammoth: ${result.value.length} chars`);
        return {
          text: result.value,
          metadata: {
            messages: result.messages,
            parsedAs: 'docx',
            fileName: fileName,
            charCount: result.value.length
          }
        };
      }
    } catch (mammothError) {
      console.log(`   ⚠️ Mammoth not available, trying Python fallback`);
    }

    // Fallback to Python extraction (better table support)
    const tmpPath = `/tmp/${Date.now()}_${fileName}`;
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    await fs.writeFile(tmpPath, buffer);

    const { execSync } = await import('child_process');
    const result = execSync(
      `python3 "${path.join(path.dirname(import.meta.url.replace('file://', '')), 'pdf-extractor.py')}" "${tmpPath}" "docx"`,
      { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
    );

    // Clean up temp file
    try { await fs.unlink(tmpPath); } catch (e) { /* ignore */ }

    const data = JSON.parse(result);

    if (data.success) {
      console.log(`   ✅ DOCX extracted via Python: ${data.char_count} chars, ${data.word_count} words`);
      return {
        text: data.text,
        metadata: {
          parsedAs: 'docx',
          fileName: fileName,
          ...data.metadata,
          charCount: data.char_count,
          wordCount: data.word_count
        }
      };
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.warn(`⚠️ DOCX parsing failed: ${error.message}`);
    return {
      text: `[Word document: ${fileName}]\nContent extraction failed: ${error.message}\n\nFile uploaded successfully but text content could not be extracted.`,
      metadata: {
        parsedAs: 'docx_fallback',
        error: error.message,
        fileName: fileName
      }
    };
  }
}

/**
 * Parse plain text files
 */
function parseText(content, fileName) {
  const text = Buffer.isBuffer(content) ? content.toString('utf-8') : content;
  return {
    text: text,
    metadata: {
      parsedAs: 'text',
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
