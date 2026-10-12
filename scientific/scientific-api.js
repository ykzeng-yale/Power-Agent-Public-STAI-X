import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runScientificAnalysis } from './scientific-harness.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { createSourceSearch, createSourceReader } from './scientific-sources.js';
import { createHash } from 'node:crypto';
import { getHostedScientificOptions } from './hosted-scientific-config.js';
import { issueAnonymousAnalysisTicket } from './scientific-access-ticket.js';
import { getScientificAccessPolicy, createScientificPublicAdmission } from './scientific-public-access.js';
import { normalizeWorkbook, profileTabularFile } from './scientific-file-data.js';
import { createScientificReportFiles } from './scientific-report-adapter.js';
import { createScientificDocumentRevisions, hostedDocumentRevisionCapability, documentDeliveryRecord } from './scientific-document-adapter.js';
import { getOpaqueInputMetadata } from './scientific-input-formats.js';
import { createLegacyScientificEventAdapter } from './scientific-legacy-events.js';

const sourceAccessDenied = () => Object.assign(new Error('Stored source file does not belong to the authenticated session. Attach its content directly.'),
  { statusCode: 403, code: 'source_access_denied' });

export async function prepareScientificContext(body, workspace, { supabase, datasetBucket, parseFile, ownedSessionId, executor, signal, onInputPrepared } = {}) {
  if (body.sessionFiles !== undefined && !Array.isArray(body.sessionFiles)) throw new Error('sessionFiles must be an array');
  const files = [], preparation = [];
  const supplied = [...(body.sessionFiles || [])];
  if (body.dataset) supplied.push({ ...body.dataset, name: body.dataset.name || 'dataset.csv' });
  if (supplied.length > 10) throw new Error('At most ten source files are supported per request');
  for (let index = 0; index < supplied.length; index++) {
    const file = supplied[index];
    if (!file || typeof file !== 'object') throw new Error('Invalid source file');
    const originalName = file.name || file.file_name || `source-${index + 1}.txt`;
    const name = path.basename(originalName).replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!name || name === '.' || name === '..') throw new Error('Invalid file name');
    const target = path.join(workspace.directory, `source-${index + 1}-${name}`);
    const suppliedText = file.full_content || file.preliminary_analysis?.full_content;
    if (suppliedText !== undefined && suppliedText !== null && typeof suppliedText !== 'string') throw new Error('Extracted file content must be text');
    let buffer = null;
    const encoded = file.content || file.context_content_base64;
    if (encoded) buffer = Buffer.from(encoded, 'base64');
    else if (suppliedText && /\.(csv|tsv|txt|md|json)$/i.test(name)) buffer = Buffer.from(suppliedText);
    else if ((!suppliedText || ownedSessionId) && file.gcsPath && datasetBucket) {
      if (!file.gcsPath.startsWith('user-uploads/') || file.gcsPath.split('/').includes('..')) throw new Error('Invalid dataset storage path');
      if (!ownedSessionId || !file.gcsPath.startsWith(`user-uploads/${ownedSessionId}/`)) throw sourceAccessDenied();
      [buffer] = await datasetBucket.file(file.gcsPath).download();
    } else if ((!suppliedText || ownedSessionId) && (file.download_url || file.storage_url) && supabase) {
      const url = new URL(file.download_url || file.storage_url);
      const configured = new URL(process.env.SUPABASE_URL);
      if (url.origin !== configured.origin) throw new Error('Source file is outside configured upload storage');
      const marker = '/storage/v1/object/public/user-uploads/';
      if (!url.pathname.startsWith(marker)) throw new Error('Invalid uploaded source path');
      const storagePath = decodeURIComponent(url.pathname.slice(marker.length));
      if (storagePath.split('/').includes('..')) throw new Error('Invalid uploaded source path');
      if (!ownedSessionId || !storagePath.startsWith(`${ownedSessionId}/`)) throw sourceAccessDenied();
      const downloaded = await supabase.storage.from('user-uploads').download(storagePath);
      if (downloaded.error) throw new Error(`Could not download source file ${name}`);
      buffer = Buffer.from(await downloaded.data.arrayBuffer());
    }
    if (buffer && buffer.length > 10000000) throw new Error(`Source file ${name} exceeds 10 MB`);
    const digest = buffer ? createHash('sha256').update(buffer).digest('hex') : null;
    if (file.sha256 && digest && file.sha256 !== digest) throw new Error(`Source file ${name} does not match its supplied SHA-256`);
    if (buffer) await fs.writeFile(target, buffer, { mode: 0o400 });
    let text = suppliedText || null, parsedMetadata = null, workbook = null, profile = null;
    let textOrigin = text ? 'client_supplied_extraction' : null;
    const opaque = getOpaqueInputMetadata(name);
    if (buffer && opaque) {
      text = null; textOrigin = 'opaque_original_bytes; required_reader_status_in_metadata'; parsedMetadata = opaque;
    } else if (buffer && /\.(xlsx|xls)$/i.test(name)) {
      workbook = await normalizeWorkbook(buffer, target, workspace);
      parsedMetadata = { parsedAs: 'excel-normalized', parser: workbook.parser, parser_version: workbook.parser_version, date1904: workbook.date1904 };
      text = JSON.stringify({ worksheets: workbook.worksheets.map(({ preview_rows, ...sheet }) => ({ ...sheet, preview_rows })) }, null, 2);
      textOrigin = 'worksheet_metadata_and_bounded_preview; full_data_in_csv_sidecars';
    } else if (buffer && parseFile && /\.(pdf|docx?|txt|md|rtf|csv|tsv|json|xml)$/i.test(name)) {
      const parsed = await parseFile(buffer, name, file.type || file.contentType || 'application/octet-stream');
      parsedMetadata = parsed.metadata || null;
      const failed = /_failed$/.test(parsedMetadata?.parsedAs || '') || Boolean(parsedMetadata?.error && !parsed.text);
      text = failed ? null : parsed.text || null;
      textOrigin = failed ? 'extraction_unavailable; original_bytes_retained' : 'server_parsed_original_bytes';
    } else if (buffer && /\.(csv|tsv|txt|md|json|xml)$/i.test(name)) {
      text = buffer.toString('utf8'); textOrigin = 'original_utf8_text';
    }
    if (!buffer && !text) throw new Error(`Source file ${name} has no accessible content`);
    let textPath = null;
    if (text) { textPath = target + '.extracted.txt'; await fs.writeFile(textPath, text, { mode: 0o400 }); }
    const adopted = ['prior_generated_artifact', 'derived_report', 'document_revision'].includes(file.source_kind) || file.inherited_generated_input === true;
    const entry = { name: originalName, local_path: buffer ? target : null, read_path: buffer ? target : textPath,
      sha256: digest, size_bytes: buffer?.length || 0, text: text?.slice(0, 100000) || null,
      text_truncated: Boolean(text?.length > 100000), full_text_path: textPath, full_text_characters: text?.length || 0,
      full_text_sha256: text ? createHash('sha256').update(text).digest('hex') : null, text_origin: textOrigin,
      parsed_metadata: parsedMetadata, worksheets: workbook?.worksheets || [],
      source_kind: adopted ? (['derived_report', 'document_revision'].includes(file.source_kind) ? file.source_kind : 'prior_generated_artifact') : 'user_upload', input_role: 'adopted_input', inherited_generated_input: adopted,
      supplied_provenance: adopted ? { artifact_id: file.artifact_id || null, producing_run_id: file.producing_run_id || null,
        producing_evidence_id: file.producing_evidence_id || null, producer_record_sha256: file.producer_record_sha256 || null, original_source_sha256: file.original_source_sha256 || null,
        byte_sha256_verified: Boolean(file.sha256 && digest),
        scope: 'Client-supplied producer metadata. Byte SHA is computed only when original bytes are available; a supplied SHA is compared in that case. An inherited artifact is not independent numerical ground truth or current execution evidence.' } : null,
      preliminary_analysis: file.preliminary_analysis?.analysis || file.preliminaryAnalysis || null };
    if (executor && (/\.(csv|tsv)$/i.test(name) || workbook?.worksheets[0]?.row_count)) {
      const dataPath = workbook ? workbook.worksheets[0].local_path : target;
      profile = await profileTabularFile(dataPath, executor, workspace, { delimiter: /\.tsv$/i.test(name) ? '\t' : ',', signal });
      entry.observed_data_profile = profile.profile;
      entry.profile_scope = workbook ? 'Preliminary profile of the first worksheet only; every worksheet remains available as full CSV and raw workbook.' : 'Preliminary full-table reader profile; original bytes retained for analysis.';
      preparation.push({ source_name: originalName, ...profile.execution });
    }
    files.push(entry);
    await onInputPrepared?.({ source: { ...entry, text: undefined }, execution: profile?.execution || null });
  }
  return { source_files: files, inline_data: body.data ?? null,
    preliminary_analysis: body.preliminaryAnalysis ?? null, input_preparation_executions: preparation,
    context_scope: 'Original adopted inputs and raw bytes with explicit extraction/normalization lineage. Preliminary summaries are not scientific findings or current answer evidence.' };
}

export function registerScientificRoutes(app, dependencies) {
  const { authenticateUser, requireCredits, deductCredits, recordAnonymousUsage, supabase, createSession, saveMessage, saveWorkflowStep, updateSessionStatus, trackGeneratedFile, storage } = dependencies;
  const capacity = { single: getHostedScientificOptions('single'), multi: getHostedScientificOptions('multi') };
  const access = dependencies.scientificAccessPolicy || getScientificAccessPolicy();
  const admission = createScientificPublicAdmission(access);
  const requireScientificAccess = access.mode === 'public'
    ? (req, res, next) => next()
    : requireCredits(5);
  const executor = new ScientificRExecutor({ root: process.env.SCIENTIFIC_WORKSPACE || '/tmp/power-agent-scientific', timeoutMs: capacity.multi.maxRExecutionMs });
  const analyze = dependencies.analyze || runScientificAnalysis;
  const persistence = async fn => { try { await fn(); } catch { /* optional database availability must not invent scientific success */ } };
  const handler = async (req, res) => {
    const body = req.body || {};
    const stream = req.path !== '/api/scientific-analysis' || body.stream !== false;
    const legacyStream = stream && req.path !== '/api/scientific-analysis';
    const workflowMode = req.path === '/api/analyze-multi-agent' || req.path === '/api/analyze-hierarchical' ? 'multi' : body.workflowMode || (req.path === '/api/analyze-biostat' ? 'multi' : 'single');
    if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 50000 || !['single', 'multi'].includes(workflowMode)) return res.status(400).json({ success: false, scientificStatus: 'failed', error: 'A valid query and workflowMode (single or multi) are required' });
    let sessionId = null;
    let sessionMarkedRunning = false, sessionFinalized = false;
    // Listen before DB authorization/reservation awaits. A close during those
    // awaits must not disappear before the analysis cancellation signal exists.
    let keepAlive = null, sequence = 0, workspace = null, cleanupDirectory = null;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); clearInterval(keepAlive); });
    req.on('aborted', () => controller.abort());
    const disconnected = () => controller.signal.aborted || req.aborted || res.destroyed || res.writableEnded;
    if (disconnected()) { controller.abort(); return; }
    const send = async (step, data = {}) => {
      if (stream && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), sessionId, iteration: data.call || 1, ...data })}\n\n`);
        res.flush?.();
      }
      if (sessionId && saveWorkflowStep && step !== 'scientific_result') await persistence(() => saveWorkflowStep(sessionId, data.iteration || data.call || 1, step, ++sequence, data, data.status || 'completed'));
    };
    let publicLease = null;
    try {
      if (access.mode === 'public') {
        publicLease = admission.acquire(req);
        if (!publicLease.accepted) {
          res.setHeader('Retry-After', String(publicLease.retryAfterSeconds));
          return res.status(429).json({ success: false, scientificStatus: 'failed', error: publicLease.reason,
            accessMode: 'public', message: publicLease.message, retryAfterSeconds: publicLease.retryAfterSeconds });
        }
      }
      // A client-supplied UUID is not authorization to read service-role history.
      // Anonymous requests rely on explicit client context, never arbitrary DB ids.
      if (req.user && body.sessionId && /^[0-9a-f-]{36}$/i.test(body.sessionId)) {
        const existing = await supabase.from('chat_sessions').select('user_id').eq('session_id', body.sessionId).single();
        if (disconnected()) return;
        if (existing.error || existing.data?.user_id !== req.user.id) return res.status(403).json({ success: false, scientificStatus: 'failed', error: 'Session does not belong to the authenticated user' });
        sessionId = body.sessionId;
      }
      if (access.mode !== 'public' && req.user && !req.creditExempt && deductCredits) {
        const charged = await deductCredits(req.user.id, 5, sessionId);
        if (disconnected()) return;
        if (!charged?.success) return res.status(402).json({ success: false, scientificStatus: 'failed', error: 'Atomic credit reservation failed; analysis was not started' });
      } else if (access.mode !== 'public' && !req.user && req.anonFingerprint && recordAnonymousUsage) {
        const reserved = await recordAnonymousUsage(req.anonFingerprint, req.ip);
        if (disconnected()) return;
        if (!reserved?.success) return res.status(403).json({ success: false, scientificStatus: 'failed', error: 'Anonymous analysis allowance could not be reserved' });
      }
      if (disconnected()) return;
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        keepAlive = setInterval(() => { if (!res.destroyed) { res.write(': keepalive\n\n'); res.flush?.(); } }, 10000);
      }
      if (req.user && !sessionId && createSession) await persistence(async () => { sessionId = (await createSession(req.user.id)).session_id; });
      if (disconnected()) return;
      const priorConversation = Array.isArray(body.conversationHistory) ? body.conversationHistory.slice(-8).filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 12000) })) : [];
      if (sessionId && supabase) await persistence(async () => {
        const previous = await supabase.from('messages').select('role,content').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(8);
        priorConversation.push(...(previous.data || []).reverse().map(m => ({ role: m.role, content: m.content.slice(0, 12000) })));
      });
      if (disconnected()) return;
      if (sessionId && saveMessage) await persistence(() => saveMessage(sessionId, 'user', body.query, { agent_type: workflowMode }));
      if (disconnected()) return;
      if (sessionId && updateSessionStatus) {
        await persistence(() => updateSessionStatus(sessionId, 'running', { agent: workflowMode, current_step: 'Design specification' }));
        sessionMarkedRunning = true;
      }
      if (disconnected()) return;
      // Restricted child identities need to traverse the common parent, but
      // cannot list it or access another run's 0700 directory.
      if (executor.restrictedLinux) {
        await fs.mkdir(executor.root, { recursive: true, mode: 0o711 });
        await fs.chmod(executor.root, 0o711);
      }
      if (disconnected()) return;
      workspace = await executor.createWorkspace();
      cleanupDirectory = workspace.directory;
      if (disconnected()) return;
      const legacy = legacyStream ? createLegacyScientificEventAdapter({ workspace, workflowMode }) : null;
      const sendLegacy = async events => { for (const { step, ...data } of events) await send(step, data); };
      if (legacy) await sendLegacy(legacy.intro());
      const context = await prepareScientificContext(body, workspace, { ...dependencies, executor, ownedSessionId: req.user ? sessionId : null,
        signal: controller.signal, onInputPrepared: async receipt => legacy ? sendLegacy(await legacy.event({ type: 'input_prepared', ...receipt })) : send('input_prepared', { role: 'input_preparation', title: 'Input file prepared',
          status: receipt.execution?.success === false ? 'error' : 'completed', ...receipt }) });
      if (disconnected()) return;
      context.document_revision_capability = hostedDocumentRevisionCapability(body.query, context, Boolean(dependencies.correctDocument));
      if (context.document_revision_capability.stage === 'post_scientific_acceptance') context.document_revision_support = 'post_scientific_acceptance';
      const search = createSourceSearch();
      const readSource = createSourceReader();
      const result = await analyze(body.query, { workflowMode, workspace, executor, context, conversationHistory: priorConversation, search, readSource,
        signal: controller.signal, ...capacity[workflowMode],
        onEvent: async event => {
          if (event.type === 'model_content') return; // Provider thinking is not a public workflow step.
          if (legacy) { await sendLegacy(await legacy.event(event)); return; }
          const mapped = { ...event, title: `${event.role || 'Scientific workflow'}: ${event.type.replace(/_/g, ' ')}`, status: event.type === 'agent_start' ? 'running' : event.success === false ? 'error' : 'completed' };
          await send(event.type === 'agent_start' ? 'thinking' : event.type, mapped);
        }
      });
      result.sessionId = sessionId;
      result.accessMode = access.mode;
      result.inputPreparation = { source_files: context.source_files.map(({ text, ...metadata }) => metadata), executions: context.input_preparation_executions };
      result.executionEnvironment = { platform: process.platform, nodeVersion: process.version, deploymentRevision: process.env.K_REVISION || null,
        restrictedLinuxWorker: executor.restrictedLinux, worker: executor.restrictedLinux ? 'scientific-r-worker.py' : 'fresh Rscript process',
        perExecutionTimeoutMs: capacity[workflowMode].maxRExecutionMs, maxOutputBytes: 2000000, networkInWorker: executor.restrictedLinux ? 'denied' : 'not sandboxed' };
      result.outputFiles = [...new Map(result.outputFiles.map(file => [file.artifact_id || file.name, file])).values()];
      const revisions = await createScientificDocumentRevisions(result, body.query, context, { workspace, correctDocument: dependencies.correctDocument, signal: controller.signal,
        onEvent: async event => legacy ? sendLegacy(await legacy.event(event)) : send('document_correction', event) });
      result.documentCorrections = revisions.records;
      result.documentProcessing = { budget: revisions.budget, elapsed_ms: revisions.elapsed_ms, omitted_documents: revisions.omitted_documents || 0 };
      result.documentRevisionFiles = revisions.files;
      result.documentDelivery = documentDeliveryRecord(context.document_revision_capability, revisions);
      result.productSuccess = result.success && result.documentDelivery.complete;
      result.productStatus = result.productSuccess ? 'completed' : result.success ? 'partial_delivery' : 'scientific_analysis_not_accepted';
      const report = await createScientificReportFiles(result, body.query, { workspace, executor, signal: controller.signal });
      result.reportFiles = report.files; result.reportRendering = report.rendering;
      // Persist real outputs where configured; an unavailable export must not be
      // described as a downloadable file. The full JSON record remains in SSE.
      if (storage) for (const file of [...result.outputFiles, ...result.reportFiles, ...result.documentRevisionFiles]) {
        try {
          const bytes = await fs.readFile(file.path);
          if (file.sha256 && createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Captured artifact changed before export');
          const blob = storage.bucket(process.env.POWER_AGENT_RESULTS_BUCKET || 'power-agent-results-476822').file(`scientific/${result.runId}/${file.artifact_id || 'output'}/${file.name}`);
          await blob.save(bytes, { resumable: false, contentType: file.mime_type || 'application/octet-stream' });
          [file.download_url] = await blob.getSignedUrl({ action: 'read', expires: Date.now() + 24 * 60 * 60 * 1000 });
          if (sessionId && trackGeneratedFile) await persistence(() => trackGeneratedFile(sessionId, null, file));
        } catch { file.export_error = 'File export unavailable; execution record is retained'; }
      }
      const message = result.answer?.summary || result.error || 'The analysis did not produce an accepted answer.';
      if (!legacy) {
        await send('chatbot_conclusion_start', { title: 'Scientific result', status: 'running' });
        await send('chatbot_conclusion_stream', { text: message, fullText: message });
        await send('chatbot_conclusion_complete', { message, fullText: message, scientificStatus: result.scientificStatus });
      }
      const downloadable = [...result.outputFiles, ...result.reportFiles, ...result.documentRevisionFiles].filter(file => file.download_url || file.content_base64);
      if (!legacy && downloadable.length) await send('outputs', { files: downloadable, title: 'Downloadable outputs', status: 'completed' });
      if (sessionId && saveMessage) await persistence(() => saveMessage(sessionId, 'assistant', message, { agent_type: workflowMode }));
      if (sessionId && updateSessionStatus) await persistence(() => updateSessionStatus(sessionId, result.productSuccess ? 'completed' : result.scientificStatus === 'needs_clarification' ? 'completed' : 'error', {
        successful_completion: result.productSuccess, current_step: result.productSuccess ? result.scientificStatus : result.productStatus, total_iterations: result.iterations, current_iteration: result.iterations
      }));
      sessionFinalized = true;
      const publicResult = { ...result, scientificSuccess: result.success, success: result.productSuccess, trace: result.trace.filter(event => event.type !== 'model_content') };
      if (stream) { if (legacy) await sendLegacy(legacy.finish(publicResult)); else await send(result.productSuccess ? 'complete' : 'scientific_result', { ...publicResult, conversationLength: result.trace.filter(t => t.type === 'model_call').length }); clearInterval(keepAlive); res.end(); }
      else res.json(publicResult);
    } catch (error) {
      clearInterval(keepAlive);
      if (stream && res.headersSent) { await send('error', { success: false, scientificStatus: 'failed', message: error.message, code: error.code || null, title: 'Scientific workflow failed', status: 'error' });
        if (legacyStream) await send('scientific_result', { success: false, scientificStatus: 'failed', error: error.message, code: error.code || null, workflowMode });
        res.end(); }
      else res.status(error.statusCode || 500).json({ success: false, scientificStatus: 'failed', error: error.message, code: error.code || null });
    } finally {
      publicLease?.release?.();
      clearInterval(keepAlive);
      if (sessionMarkedRunning && !sessionFinalized && (controller.signal.aborted || req.aborted)) {
        await persistence(() => updateSessionStatus(sessionId, 'error', { successful_completion: false, current_step: 'Cancelled by client' }));
      }
      // Uploaded exports and the in-memory execution record are retained before
      // removing only this request's private workspace, including on abort.
      if (cleanupDirectory) await fs.rm(cleanupDirectory, { recursive: true, force: true }).catch(() => {});
    }
  };
  app.post('/api/scientific-analysis-ticket', authenticateUser, requireScientificAccess, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const connection = { accessMode: access.mode, creditRequired: access.creditRequired };
    if (req.user) return res.json({ authenticated: true, ...connection });
    try { return res.json({ ...issueAnonymousAnalysisTicket(req.anonFingerprint, req.headers.origin || 'https://power-agent.io'), ...connection }); }
    catch { return res.status(503).json({ error: 'analysis_transport_unavailable', message: 'The analysis connection could not be prepared.' }); }
  });
  for (const route of ['/api/analyze-biostat', '/api/analyze-multi-agent', '/api/analyze-hierarchical', '/api/scientific-analysis']) app.post(route, authenticateUser, requireScientificAccess, handler);
}
