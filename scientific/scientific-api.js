import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runScientificAnalysis } from './scientific-harness.js';
import { ScientificRExecutor } from './scientific-r-executor.js';

export async function prepareScientificContext(body, workspace, { supabase, datasetBucket, parseFile } = {}) {
  const files = [];
  const supplied = [...(body.sessionFiles || [])];
  if (body.dataset) supplied.push({ ...body.dataset, name: body.dataset.name || 'dataset.csv' });
  if (supplied.length > 10) throw new Error('At most ten source files are supported per request');
  for (let index = 0; index < supplied.length; index++) {
    const file = supplied[index];
    const originalName = file.name || file.file_name || `source-${index + 1}.txt`;
    const name = path.basename(originalName).replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!name || name === '.' || name === '..') throw new Error('Invalid file name');
    const target = path.join(workspace.directory, `source-${index + 1}-${name}`);
    const fullText = file.full_content || file.preliminary_analysis?.full_content;
    let buffer = null;
    if (file.content) buffer = Buffer.from(file.content, 'base64');
    else if (fullText && /\.(csv|tsv|txt|md|json)$/i.test(name)) buffer = Buffer.from(fullText);
    else if (file.gcsPath && datasetBucket) {
      if (!file.gcsPath.startsWith('user-uploads/') || file.gcsPath.split('/').includes('..')) throw new Error('Invalid dataset storage path');
      [buffer] = await datasetBucket.file(file.gcsPath).download();
    } else if ((file.download_url || file.storage_url) && supabase) {
      const url = new URL(file.download_url || file.storage_url);
      const configured = new URL(process.env.SUPABASE_URL);
      if (url.origin !== configured.origin) throw new Error('Source file is outside configured upload storage');
      const marker = '/storage/v1/object/public/user-uploads/';
      if (!url.pathname.startsWith(marker)) throw new Error('Invalid uploaded source path');
      const storagePath = decodeURIComponent(url.pathname.slice(marker.length));
      if (storagePath.split('/').includes('..')) throw new Error('Invalid uploaded source path');
      const downloaded = await supabase.storage.from('user-uploads').download(storagePath);
      if (downloaded.error) throw new Error(`Could not download source file ${name}`);
      buffer = Buffer.from(await downloaded.data.arrayBuffer());
    }
    if (buffer && buffer.length > 10000000) throw new Error(`Source file ${name} exceeds 10 MB`);
    if (buffer) await fs.writeFile(target, buffer);
    let text = fullText || null;
    if (!text && buffer && parseFile && /\.(pdf|docx?|txt|md|csv|tsv|json)$/i.test(name)) {
      const parsed = await parseFile(buffer, name, file.type || file.contentType || 'application/octet-stream');
      text = parsed.text || null;
    }
    if (!buffer && !text) throw new Error(`Source file ${name} has no accessible content`);
    files.push({ name: originalName, local_path: buffer ? target : null, text: text?.slice(0, 100000) || null,
      text_truncated: Boolean(text?.length > 100000), preliminary_analysis: file.preliminary_analysis?.analysis || file.preliminaryAnalysis || null });
  }
  return { source_files: files, inline_data: body.data ?? null };
}

export function registerScientificRoutes(app, dependencies) {
  const { authenticateUser, requireCredits, deductCredits, recordAnonymousUsage, supabase, createSession, saveMessage, saveWorkflowStep, updateSessionStatus, trackGeneratedFile, storage } = dependencies;
  const executor = new ScientificRExecutor({ root: process.env.SCIENTIFIC_WORKSPACE || '/tmp/power-agent-scientific' });
  const analyze = dependencies.analyze || runScientificAnalysis;
  const persistence = async fn => { try { await fn(); } catch { /* optional database availability must not invent scientific success */ } };
  const handler = async (req, res) => {
    const body = req.body || {};
    const stream = req.path !== '/api/scientific-analysis' || body.stream !== false;
    const workflowMode = req.path === '/api/analyze-multi-agent' || req.path === '/api/analyze-hierarchical' ? 'multi' : body.workflowMode || 'single';
    if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 50000 || !['single', 'multi'].includes(workflowMode)) return res.status(400).json({ success: false, scientificStatus: 'failed', error: 'A valid query and workflowMode (single or multi) are required' });
    let sessionId = null;
    // A client-supplied UUID is not authorization to read service-role history.
    // Anonymous requests rely on explicit client context, never arbitrary DB ids.
    if (req.user && body.sessionId && /^[0-9a-f-]{36}$/i.test(body.sessionId)) {
      const existing = await supabase.from('chat_sessions').select('user_id').eq('session_id', body.sessionId).single();
      if (existing.error || existing.data?.user_id !== req.user.id) return res.status(403).json({ success: false, scientificStatus: 'failed', error: 'Session does not belong to the authenticated user' });
      sessionId = body.sessionId;
    }
    if (req.user && !req.creditExempt && deductCredits) {
      const charged = await deductCredits(req.user.id, 5, sessionId);
      if (!charged?.success) return res.status(402).json({ success: false, scientificStatus: 'failed', error: 'Atomic credit reservation failed; analysis was not started' });
    } else if (!req.user && req.anonFingerprint && recordAnonymousUsage) {
      const reserved = await recordAnonymousUsage(req.anonFingerprint, req.ip);
      if (!reserved?.success) return res.status(403).json({ success: false, scientificStatus: 'failed', error: 'Anonymous analysis allowance could not be reserved' });
    }
    let keepAlive = null, sequence = 0, workspace = null, cleanupDirectory = null;
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); clearInterval(keepAlive); });
    const send = async (step, data = {}) => {
      if (stream && !res.destroyed) {
        res.write(`data: ${JSON.stringify({ step, timestamp: Date.now(), sessionId, iteration: data.call || 1, ...data })}\n\n`);
        res.flush?.();
      }
      if (sessionId && saveWorkflowStep) await persistence(() => saveWorkflowStep(sessionId, data.call || 1, step, ++sequence, data, data.status || 'completed'));
    };
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      keepAlive = setInterval(() => { if (!res.destroyed) { res.write(': keepalive\n\n'); res.flush?.(); } }, 10000);
    }
    try {
      if (req.user && !sessionId && createSession) await persistence(async () => { sessionId = (await createSession(req.user.id)).session_id; });
      const priorConversation = Array.isArray(body.conversationHistory) ? body.conversationHistory.slice(-8).filter(m => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').map(m => ({ role: m.role, content: m.content.slice(0, 12000) })) : [];
      if (sessionId && supabase) await persistence(async () => {
        const previous = await supabase.from('messages').select('role,content').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(8);
        priorConversation.push(...(previous.data || []).reverse().map(m => ({ role: m.role, content: m.content.slice(0, 12000) })));
      });
      if (sessionId && saveMessage) await persistence(() => saveMessage(sessionId, 'user', body.query, { agent_type: workflowMode }));
      if (sessionId && updateSessionStatus) await persistence(() => updateSessionStatus(sessionId, 'running', { agent: workflowMode, current_step: 'Design specification' }));
      // Restricted child identities need to traverse the common parent, but
      // cannot list it or access another run's 0700 directory.
      if (executor.restrictedLinux) {
        await fs.mkdir(executor.root, { recursive: true, mode: 0o711 });
        await fs.chmod(executor.root, 0o711);
      }
      workspace = await executor.createWorkspace();
      cleanupDirectory = workspace.directory;
      const context = await prepareScientificContext(body, workspace, dependencies);
      const search = process.env.TAVILY_API_KEY ? async query => {
        const response = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 4, include_domains: ['cran.r-project.org', 'stat.ethz.ch', 'r-project.org', 'pubmed.ncbi.nlm.nih.gov', 'pmc.ncbi.nlm.nih.gov', 'doi.org', 'onlinelibrary.wiley.com', 'academic.oup.com'] }), signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`Source search failed (HTTP ${response.status})`);
        const found = await response.json();
        return { results: (found.results || []).map(r => ({ title: r.title, url: r.url, content: r.content })) };
      } : null;
      const result = await analyze(body.query, { workflowMode, workspace, executor, context, conversationHistory: priorConversation, search,
        signal: controller.signal, maxModelCalls: 18, maxExecutions: 8, maxRepairs: 1, deadlineMs: 540000,
        onEvent: async event => {
          const mapped = { ...event, title: `${event.role || 'Scientific workflow'}: ${event.type.replace(/_/g, ' ')}`, status: event.type === 'agent_start' ? 'running' : event.success === false ? 'error' : 'completed' };
          await send(event.type === 'agent_start' ? 'thinking' : event.type, mapped);
        }
      });
      result.sessionId = sessionId;
      result.executionEnvironment = { platform: process.platform, nodeVersion: process.version, deploymentRevision: process.env.K_REVISION || null,
        restrictedLinuxWorker: executor.restrictedLinux, worker: executor.restrictedLinux ? 'scientific-r-worker.py' : 'fresh Rscript process',
        perExecutionTimeoutMs: 120000, maxOutputBytes: 2000000, networkInWorker: executor.restrictedLinux ? 'denied' : 'not sandboxed' };
      result.outputFiles = [...new Map(result.outputFiles.map(file => [file.name, file])).values()];
      // Persist real outputs where configured; an unavailable export must not be
      // described as a downloadable file. The full JSON record remains in SSE.
      if (storage) for (const file of result.outputFiles) {
        try {
          const blob = storage.bucket(process.env.POWER_AGENT_RESULTS_BUCKET || 'power-agent-results-476822').file(`scientific/${result.runId}/${file.name}`);
          await blob.save(await fs.readFile(file.path), { resumable: false });
          [file.download_url] = await blob.getSignedUrl({ action: 'read', expires: Date.now() + 24 * 60 * 60 * 1000 });
          if (sessionId && trackGeneratedFile) await persistence(() => trackGeneratedFile(sessionId, null, file));
        } catch { file.export_error = 'File export unavailable; execution record is retained'; }
      }
      const message = result.answer?.summary || result.error || 'The analysis did not produce an accepted answer.';
      await send('chatbot_conclusion_start', { title: 'Scientific result', status: 'running' });
      await send('chatbot_conclusion_stream', { text: message, fullText: message });
      await send('chatbot_conclusion_complete', { message, fullText: message, scientificStatus: result.scientificStatus });
      const downloadable = result.outputFiles.filter(file => file.download_url);
      if (downloadable.length) await send('outputs', { files: downloadable, title: 'Downloadable outputs', status: 'completed' });
      if (sessionId && saveMessage) await persistence(() => saveMessage(sessionId, 'assistant', message, { agent_type: workflowMode }));
      if (sessionId && updateSessionStatus) await persistence(() => updateSessionStatus(sessionId, result.success ? 'completed' : result.scientificStatus === 'needs_clarification' ? 'completed' : 'error', {
        successful_completion: result.success, current_step: result.scientificStatus, total_iterations: result.iterations, current_iteration: result.iterations
      }));
      if (stream) { await send('complete', { ...result, conversationLength: result.trace.filter(t => t.type === 'model_call').length }); clearInterval(keepAlive); res.end(); }
      else res.json(result);
    } catch (error) {
      clearInterval(keepAlive);
      if (stream) { await send('error', { success: false, scientificStatus: 'failed', message: error.message, title: 'Scientific workflow failed', status: 'error' }); res.end(); }
      else res.status(500).json({ success: false, scientificStatus: 'failed', error: error.message });
    } finally {
      clearInterval(keepAlive);
      // Uploaded exports and the in-memory execution record are retained before
      // removing only this request's private workspace, including on abort.
      if (cleanupDirectory) await fs.rm(cleanupDirectory, { recursive: true, force: true }).catch(() => {});
    }
  };
  for (const route of ['/api/analyze-biostat', '/api/analyze-multi-agent', '/api/analyze-hierarchical', '/api/scientific-analysis']) app.post(route, authenticateUser, requireCredits(5), handler);
}
