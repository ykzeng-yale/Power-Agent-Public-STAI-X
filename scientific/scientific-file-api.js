import express from 'express';
import { promises as fs } from 'node:fs';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { prepareScientificContext } from './scientific-api.js';
import { createScientificPublicAdmission, getScientificAccessPolicy } from './scientific-public-access.js';

export function registerScientificFileRoutes(app, { authenticateUser, parseFile, classifyFile, summarizeDocument } = {}) {
  const executor = new ScientificRExecutor({ root: process.env.SCIENTIFIC_WORKSPACE || '/tmp/power-agent-scientific', timeoutMs: 30000 });
  const admission = createScientificPublicAdmission(getScientificAccessPolicy());
  app.post('/api/analyze-file', authenticateUser, express.raw({ type: '*/*', limit: '10mb' }), async (req, res) => {
    if (typeof req.query.fileName !== 'string' || !req.query.fileName.trim() || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ success: false, error: 'A fileName and nonempty raw file body are required' });
    const lease = admission.acquire(req);
    if (!lease.accepted) { res.setHeader('Retry-After', String(lease.retryAfterSeconds)); return res.status(429).json({ success: false, error: lease.reason, message: lease.message, retryAfterSeconds: lease.retryAfterSeconds }); }
    let workspace = null;
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      if (req.aborted || res.destroyed) return;
      if (executor.restrictedLinux) { await fs.mkdir(executor.root, { recursive: true, mode: 0o711 }); await fs.chmod(executor.root, 0o711); }
      workspace = await executor.createWorkspace();
      const context = await prepareScientificContext({ dataset: { name: req.query.fileName, content: req.body.toString('base64'), contentType: req.query.fileType } }, workspace, { parseFile, executor, signal: controller.signal });
      const file = context.source_files[0], extracted = file.text && !file.text_truncated ? file.text : file.full_text_path ? await fs.readFile(file.full_text_path, 'utf8') : null;
      if (/_failed$/.test(file.parsed_metadata?.parsedAs || '') || file.parsed_metadata?.has_embedded_text === false) return res.status(422).json({ success: false, error: 'file_text_extraction_unavailable', message: 'The original file was received, but readable text could not be extracted. Provide a text version or an OCR-processed document.', parsedMetadata: file.parsed_metadata });
      const classificationInput = extracted || JSON.stringify(file.observed_data_profile || file.parsed_metadata || {});
      let classification = null;
      const opaqueInput = file.parsed_metadata?.parsedAs?.startsWith('opaque-');
      if (opaqueInput) classification = { contentType: file.parsed_metadata.data_format ? 'data' : 'document', confidence: null, reasoning: file.parsed_metadata.scope };
      else if (classifyFile && classificationInput && !controller.signal.aborted) classification = await classifyFile(req.query.fileName, classificationInput);
      const supportedClassification = opaqueInput || classification && ['data', 'document'].includes(classification.contentType) && Number.isFinite(classification.confidence);
      if (!supportedClassification) classification = { ...classification, contentType: file.worksheets.length || file.observed_data_profile ? 'data' : 'document', confidence: null, reasoning: 'Advisory model classification unavailable; observed file parsing retained.' };
      if (controller.signal.aborted) return;
      let analysis, method, interpretationReceipt = null;
      if (file.worksheets.length || file.observed_data_profile) {
        const profile = file.observed_data_profile;
        analysis = [file.worksheets.length ? `${file.worksheets.length} worksheet(s) normalized from original workbook bytes. Every worksheet remains available to the analysis.` : 'Observed preliminary data summary.',
          profile ? `${profile.rows} rows and ${profile.columns} columns were read using ${profile.reader}.` : 'Original data and parsed worksheet ranges are available; the preliminary R reader did not return a profile.',
          profile ? JSON.stringify(profile.variables, null, 2) : '',
          'This describes the uploaded data. It does not estimate power or choose the statistical model.'].filter(Boolean).join('\n\n');
        method = context.input_preparation_executions.some(e => e.success) ? 'restricted_code_execution' : 'worksheet_normalization';
      } else if (extracted && summarizeDocument) {
        const interpretation = await summarizeDocument(req.query.fileName, extracted, req.query.fileName.split('.').pop().toLowerCase(), true);
        analysis = typeof interpretation === 'string' ? interpretation : interpretation.text;
        interpretationReceipt = typeof interpretation === 'object' ? interpretation.model_receipt : null;
        method = 'document_text_analysis';
      } else {
        analysis = 'Original file received and retained for the scientific workflow. No preliminary scientific interpretation was produced.';
        method = 'raw_input_available';
      }
      if (controller.signal.aborted) return;
      return res.json({ success: true, fileName: req.query.fileName, fileType: file.worksheets.length || file.observed_data_profile || file.parsed_metadata?.data_format ? 'data' : classification.contentType, analysis, method,
        extractedText: file.worksheets.length ? null : extracted, parsedMetadata: file.parsed_metadata,
        structuredData: file.observed_data_profile, worksheets: file.worksheets.map(({ local_path, read_path, ...metadata }) => metadata),
        rawFileSha256: file.sha256, rawFileSize: file.size_bytes, classification,
        modelCalls: { classification: classification.model_receipt || null, interpretation: interpretationReceipt },
        execution: context.input_preparation_executions[0] || null,
        analyzedAt: new Date().toISOString(), scope: 'Preliminary file context only. Full original bytes must accompany analysis; this preview does not create accepted scientific findings.',
        interpretationScope: method === 'document_text_analysis' ? 'Document interpretation uses the first 5000 text characters; full extracted text is returned separately.' : null });
    } catch (error) {
      if (!res.destroyed && !controller.signal.aborted) res.status(422).json({ success: false, error: 'file_preparation_failed', message: error.message });
    } finally {
      lease.release();
      if (workspace?.directory) await fs.rm(workspace.directory, { recursive: true, force: true }).catch(() => {});
    }
  });
}
