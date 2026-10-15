import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proposalScope = 'Proposed document revision based on the accepted analysis and a separate model call. It is not independently accepted scientific evidence or a claim that the entire document is correct. The original input is unchanged.';

export function hostedDocumentRevisionCapability(query, context, available) {
  const sources = (context.source_files || []).filter(file => /\.(pdf|docx)$/i.test(file.name) && file.local_path && file.full_text_path)
    .map(file => ({ name: file.name, sha256: file.sha256 }));
  const required = /\b(corrected|revis(?:e|ed|ion)|amend(?:ed)?|rewrite|edit|propos(?:e|ed|al)|updated)\b/i.test(query) && /\b(docx|word|document|protocol)\b/i.test(query) || /\bcorrect\s+(?:(?:the|this|my|uploaded)\s+)?(?:docx|word|document|protocol)\b/i.test(query);
  const targetsUploadedDocx = /\b(?:uploaded|original|supplied)\s+(?:docx|word)\b|\bdocx\s+(?:enrollment|sentence|claim|protocol)\b/i.test(query);
  const requiredSources = required ? (targetsUploadedDocx ? sources.filter(file => /\.docx$/i.test(file.name)) : sources) : [];
  return { stage: available && sources.length ? 'post_scientific_acceptance' : 'unavailable', supported_source_formats: ['docx', 'pdf'], output_format: 'docx',
    eligible_sources: sources, required_by_request: required, required_source_names: requiredSources.map(file => file.name), required_sources: requiredSources,
    conditional_request: required && /\b(if|when|unless)\b/i.test(query), scope: proposalScope };
}

export function documentDeliveryRecord(capability, revisions) {
  const required = capability?.required_by_request === true;
  const delivered = (revisions.files || []).length > 0;
  const requiredSources = capability?.required_sources || [];
  const matches = (source, name, sha) => source.name === name && source.sha256 === sha;
  const requiredDelivered = requiredSources.length > 0 && requiredSources.every(source =>
    (revisions.records || []).some(record => matches(source, record.source_name, record.original_source_sha256) && record.status === 'proposal_generated') &&
    (revisions.files || []).some(file => matches(source, file.original_source_name, file.original_source_sha256)));
  const complete = !required || requiredDelivered;
  return { required_by_request: required, required_source_names: capability?.required_source_names || [], conditional_request: capability?.conditional_request === true,
    status: complete && delivered ? 'proposal_delivered' : required ? (capability?.conditional_request ? 'conditional_revision_unresolved' : delivered ? 'partial_proposal_delivery' : 'required_proposal_not_delivered') : 'no_proposal_delivered', complete,
    unavailable_reason: revisions.unavailable_reason || null, omitted_documents: revisions.omitted_documents || 0, scope: proposalScope, records: revisions.records || [],
    files: (revisions.files || []).map(({ name, artifact_id, sha256, original_source_sha256 }) => ({ name, artifact_id, sha256, original_source_sha256 })) };
}

export function documentRevisionReceiptLines(result) {
  if (!result.documentDelivery) return [];
  return [`Document delivery status: ${result.documentDelivery.status}; explicitly requested: ${result.documentDelivery.required_by_request}.`,
    `Required source documents: ${(result.documentDelivery.required_source_names || []).join(', ') || 'none identified'}; conditional request: ${result.documentDelivery.conditional_request === true}.`,
    'This receipt was produced after numerical acceptance. It supersedes earlier analyst statements about whether a revision file was delivered; it does not replace scientific findings.',
    ...(result.documentCorrections || []).map(record => `${record.source_name}: ${record.status}; original source SHA-256 ${record.original_source_sha256}; ${record.reason || record.scope || ''}`),
    ...(result.documentRevisionFiles || []).map(file => `Delivered proposal: ${file.name}; SHA-256 ${file.sha256}; original source SHA-256 ${file.original_source_sha256}.`),
    ...(result.documentDelivery.unavailable_reason ? [result.documentDelivery.unavailable_reason] : []),
    `Omitted document inputs: ${result.documentDelivery.omitted_documents || 0}.`, result.documentDelivery.scope];
}

// Document processing has a separate, server-owned budget. Its failure must
// never change the accepted scientific result or become numerical evidence.
export async function createScientificDocumentRevisions(result, query, context, {
  workspace, correctDocument, signal, onEvent, maxDocuments = 2, maxDurationMs = 90000
} = {}) {
  const budget = { max_documents: Math.min(2, Math.max(0, maxDocuments)), max_duration_ms: Math.min(90000, Math.max(1, maxDurationMs)), scope: 'Separate document processing; outside numerical execution evidence.' };
  const files = [], records = [], started = Date.now();
  if (!result.success || result.scientificStatus !== 'completed' || !result.answer || !correctDocument) return { files, records, budget, elapsed_ms: 0,
    unavailable_reason: !correctDocument ? 'Document revision postprocessor unavailable' : 'Numerical analysis was not accepted' };
  const candidates = (context.source_files || []).filter(file => /\.(pdf|docx)$/i.test(file.name) && file.local_path && file.full_text_path);
  const analysisReport = JSON.stringify({ answer: result.answer, review: result.review, referenceAudit: result.referenceAudit, scientificStatus: result.scientificStatus }, null, 2);
  for (const [index, file] of candidates.slice(0, budget.max_documents).entries()) {
    const remaining = budget.max_duration_ms - (Date.now() - started);
    if (signal?.aborted || remaining <= 0) break;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timer = null;
    const record = { source_name: file.name, original_source_sha256: file.sha256, status: 'failed', corrections: [], model_receipt: null, scope: proposalScope };
    try {
      const [originalBuffer, extractedText] = await Promise.all([fs.readFile(file.local_path), fs.readFile(file.full_text_path, 'utf8')]);
      if (file.sha256 && hash(originalBuffer) !== file.sha256) throw new Error('Original document changed before revision');
      if (signal?.aborted) break;
      await onEvent?.({ type: 'document_correction', title: 'Proposing source-anchored document revisions', status: 'running', source_name: file.name, scope: proposalScope });
      if (controller.signal.aborted) throw Object.assign(new Error('Document processing cancelled'), { code: 'document_processing_cancelled' });
      const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('Document processing time budget exhausted'), { code: 'document_processing_timeout' })); }, Math.max(1, budget.max_duration_ms - (Date.now() - started))); });
      const aborted = new Promise((resolve, reject) => controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('Document processing cancelled'), { code: signal?.aborted ? 'document_processing_cancelled' : 'document_processing_timeout' })), { once: true }));
      const revision = await Promise.race([correctDocument({ originalBuffer, fileName: file.name, fileExt: file.name.split('.').pop().toLowerCase(), extractedText, analysisReport, query, signal: controller.signal, timeoutMs: remaining }), timeout, aborted]);
      if (signal?.aborted) break;
      record.model_receipt = revision.model_receipt || null;
      record.application_receipt = revision.application_receipt || null;
      record.corrections = Array.isArray(revision.corrections) ? revision.corrections : [];
      record.reason = revision.reason || null;
      if (revision.success && Buffer.isBuffer(revision.correctedBuffer) && record.corrections.length) {
        if (revision.correctedBuffer.length > 2000000 || !revision.correctedBuffer.length) throw new Error('Document revision exceeds the supported output bound');
        if (revision.format !== 'docx') throw new Error('Unsupported document revision output format');
        const name = path.basename(revision.correctedFileName || `${file.name.replace(/\.[^.]+$/, '')}_corrected.docx`).replace(/[^A-Za-z0-9_.-]/g, '_');
        if (!/\.docx$/i.test(name)) throw new Error('Invalid document revision file name');
        const filename = path.join(workspace.directory, `document-revision-${index + 1}-${name}`), bytes = revision.correctedBuffer;
        await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o400 });
        const artifact = { artifact_id: `revision-${result.runId}-${index + 1}`, name, path: filename, type: 'docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: bytes.length, sha256: hash(bytes), content_base64: bytes.toString('base64'), source_kind: 'document_revision', producer_kind: 'source_anchored_document_revision',
          source_run_id: result.runId, original_source_sha256: file.sha256, original_source_name: file.name,
          model_receipt: record.model_receipt, application_receipt: record.application_receipt, scope: proposalScope };
        files.push(artifact); record.status = 'proposal_generated'; record.artifact_id = artifact.artifact_id;
      } else record.status = 'no_revision_generated';
    } catch (error) {
      record.status = error.code === 'document_processing_timeout' ? 'timed_out' : error.code === 'document_processing_cancelled' ? 'cancelled' : 'failed';
      record.reason = error.message;
    } finally {
      clearTimeout(timer); controller.abort(); signal?.removeEventListener('abort', abort);
      records.push(record);
      await onEvent?.({ ...record, type: 'document_correction', title: 'Document revision proposal result', revision_status: record.status,
        status: record.status === 'proposal_generated' ? 'completed' : 'warning', message: record.status === 'proposal_generated' ? `${record.corrections.length} source-anchored revision proposal(s) exported for author review.` : 'No document revision was produced; this does not establish that the document is correct.' });
    }
  }
  return { files, records, budget, elapsed_ms: Date.now() - started, omitted_documents: Math.max(0, candidates.length - records.length) };
}
