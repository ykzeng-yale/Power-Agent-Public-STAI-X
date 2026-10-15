import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';

// Isolate the fallback pdfjs version from pdf-parse v2's global worker registry.
// Without this, one parser's WorkerMessageHandler can break the other version.
try {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const packageDirectory = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  const task = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes), useSystemFonts: true,
    standardFontDataUrl: path.join(packageDirectory, 'standard_fonts') + path.sep });
  const document = await task.promise;
  try {
    const parts = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index); const content = await page.getTextContent();
      parts.push(content.items.map(item => item.str).join(' '));
    }
    parentPort.postMessage({ success: true, text: parts.join('\n\n'), pages: document.numPages });
  } finally { await document.destroy(); }
} catch { parentPort.postMessage({ success: false, error: 'Fallback PDF text extraction failed' }); }
