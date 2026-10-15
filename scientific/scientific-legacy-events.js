import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { documentRevisionReceiptLines } from './scientific-document-adapter.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = value => String(value ?? '');
const escaped = value => text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Prose is raw Markdown; the original thin client escapes HTML once. Only the
// inert numeric pipe entity protects table delimiters in that agreed renderer.
const cell = value => text(value).replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
const json = value => JSON.stringify(value, null, 2);
const statuses = { routing: 'Request routing', planner: 'Statistical planning', candidate: 'Statistical analysis', reference: 'Deterministic reference check', verification: 'Independent review', repair: 'Analysis repair', rereview: 'Independent re-review' };

export function formatLegacyScientificAnswer(result) {
  const answer = result.answer;
  if (!(result.scientificSuccess ?? result.success) || result.scientificStatus !== 'completed' || !answer) return null;
  const sections = [result.documentDelivery ? 'Analyst narrative submitted before final review and document post-processing. Actual delivery receipts below govern file availability; the original narrative is retained.' : null,
    text(answer.summary), answer.method ? `## Method\n\n${text(answer.method)}` : null];
  if (answer.results?.length) sections.push('## Computed results\n\n| Quantity | Value | Unit |\n|---|---|---|\n' + answer.results.map(row => `| ${cell(row.metric)} | ${cell(row.value)} | ${cell(row.unit)} |`).join('\n'));
  if (answer.assumptions?.length) sections.push('## Assumptions\n\n' + answer.assumptions.map(value => '- ' + text(value)).join('\n'));
  if (answer.limitations?.length) sections.push('## Limitations\n\n' + answer.limitations.map(value => '- ' + text(value)).join('\n'));
  const review = result.review;
  sections.push('## Verification record\n\n' + [
    `Workflow: ${text(result.workflowMode)}.`, review ? `Reviewer verdict: ${text(review.verdict)}. ${text(review.summary || '')}` : 'Reviewer verdict: unavailable.',
    `Deterministic reference audit: ${text(result.referenceAudit?.status || 'unavailable')}.`,
    'Review and reference checks have their recorded scope; they do not certify every possible design or scientific assumption.'
  ].join('\n\n'));
  if (answer.evidence_ids?.length) sections.push('Executed evidence: ' + answer.evidence_ids.map(text).join(', '));
  if (answer.citations?.length) sections.push('## Sources\n\n' + answer.citations.map(source => '- ' + text(source.title) + ': ' + text(source.url) + (source.supports ? '\n  Scope: ' + text(source.supports) : '')).join('\n'));
  const delivery = documentRevisionReceiptLines(result);
  if (delivery.length) sections.push('## Actual document proposal receipts\n\n' + delivery.join('\n\n'));
  return sections.filter(Boolean).join('\n\n');
}

// The original UI requires download_url and caches decoded text as content.
// Only captured, hash-verified bytes can create these transport fields.
export function legacyScientificFiles(files) {
  return (files || []).flatMap(file => {
    if (!file.content_base64 || !file.sha256) return [];
    const bytes = Buffer.from(file.content_base64, 'base64');
    if (!bytes.length || bytes.length > 2000000 || sha(bytes) !== file.sha256) return [];
    const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(file.mime_type || '') ? file.mime_type : 'application/octet-stream';
    const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
    const result = { ...file, size: bytes.length, download_url: /^https?:\/\//.test(file.download_url || '') ? file.download_url : dataUrl };
    if (['md', 'txt', 'r', 'csv', 'json', 'html'].includes(file.type)) result.content = bytes.toString('utf8');
    return [result];
  });
}

async function capturedImages(files, workspace) {
  const images = [], warnings = [];
  for (const file of files || []) {
    if (!['png', 'jpg', 'jpeg'].includes(file.type)) continue;
    try {
      const target = path.resolve(file.path || ''), root = path.resolve(workspace.directory) + path.sep;
      if (!target.startsWith(root + 'artifacts' + path.sep)) throw new Error('Image is outside the captured artifact directory');
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes;
      try { const info = await handle.stat(); if (!info.isFile() || info.nlink !== 1 || info.size > 2000000) throw new Error('Invalid captured image'); bytes = await handle.readFile(); }
      finally { await handle.close(); }
      if (bytes.length > 2000000 || sha(bytes) !== file.sha256) throw new Error('Captured image SHA mismatch');
      images.push({ filename: file.name, format: file.type === 'png' ? 'image/png' : 'image/jpeg', data: bytes.toString('base64'), sha256: file.sha256, artifact_id: file.artifact_id });
    } catch { warnings.push(`Preview unavailable for captured image ${file.name}; no image bytes were substituted.`); }
  }
  return { images, warnings };
}

export function createLegacyScientificEventAdapter({ workspace, workflowMode = 'multi' } = {}) {
  let groups = 0, serial = 0;
  const identifiers = new Map(), pendingCalls = new Map(), documentGroups = new Map();
  const group = key => { key ||= `event:${++serial}`; if (!identifiers.has(key)) identifiers.set(key, ++groups); return identifiers.get(key); };
  const frame = (step, data, key) => ({ step, iteration: group(key), ...data, display_scope: 'Numbered public workflow groups; actual model-call and evidence identifiers are recorded separately.' });
  const intro = `Workflow: ${workflowMode === 'multi' ? 'planner + analyst + independent reviewer' : 'single workflow with shared-context verification'}. Steps report actual submissions, executions and checks. Private model thoughts are not displayed.`;
  return {
    intro: () => [{ step: 'chatbot_intro_start', title: 'Scientific workflow', status: 'running' }, { step: 'chatbot_intro_stream', text: intro, fullText: intro }, { step: 'chatbot_intro_complete', message: intro, fullText: intro }],
    async event(event) {
      const role = event.role || 'workflow';
      if (event.type === 'model_content') return [];
      if (event.type === 'phase_start') return [frame('phase', { title: `${statuses[role] || role} phase started`, status: 'completed', message: 'Phase-start receipt; this does not report a completed scientific analysis.', role, phase: event.phase, model_call_number: event.call ?? null })];
      if (event.type === 'agent_start') { pendingCalls.set(event.call, event); return [frame('model_call', { title: `${role}: model call ${event.call}`, status: 'running', message: `Request sent to ${event.model}.`, role, model_call_number: event.call }, `call:${event.call}`)]; }
      if (event.type === 'model_call') { pendingCalls.delete(event.call); return [frame('model_call', { title: `${role}: model call ${event.call}`, status: 'completed', message: `Response recorded from ${event.model}; elapsed ${event.elapsed_ms ?? event.elapsedMs ?? 'unavailable'} ms.`, role, model_call_number: event.call, output: json({ requested_model: event.requested_model, actual_model: event.model, usage: event.usage, stop_reason: event.stop_reason }) }, `call:${event.call}`)]; }
      if (event.type === 'design') {
        const plan = event.plan;
        const events = [frame('planning', { title: 'Statistical design specification', status: plan.ready ? 'completed' : 'needs_info', message: plan.method || plan.family || 'Design specification recorded.', output: json(plan), plan })];
        if (!plan.ready) events.push(frame('needs_info', { title: 'Study inputs needed', status: 'needs_info', content: (plan.clarification_questions || []).map(question => '- ' + text(question)).join('\n'), missing_information: plan.missing_information }));
        return events;
      }
      if (event.type === 'code') return [frame('code', { title: `${role}: R code submitted (${event.evidence_id})`, status: 'completed', message: event.message || 'Submitted for a fresh restricted R execution.', role, evidence_id: event.evidence_id, code: event.code }, `evidence:${event.evidence_id}`)];
      if (event.type === 'execution') {
        const preview = event.success && workspace ? await capturedImages(event.output_files, workspace) : { images: [], warnings: [] };
        return [frame('execution', { title: `${role}: R execution ${event.evidence_id}`, status: event.success ? 'completed' : 'error', message: event.success ? 'R exited successfully. Numerical acceptance and scientific review are recorded separately.' : 'Execution failed; partial stdout is diagnostic and cannot ground accepted numerical claims.', role, evidence_id: event.evidence_id, output: event.output, warnings: [event.error || event.stderr, ...preview.warnings].filter(Boolean), images: preview.images, exitCode: event.exitCode, timedOut: event.timedOut }, `evidence:${event.evidence_id}`)];
      }
      if (event.type === 'search' || event.type === 'source_read') {
        const sources = (event.results?.results || []).map(source => ({ id: source.id, title: source.title, url: source.url,
          content_scope: source.content_scope ?? null, content_truncated: source.content_truncated ?? null, truncation_scope: source.truncation_scope ?? null,
          scope: 'Retrieved source material; the recorded content and truncation scope applies. Retrieval does not establish numerical ground truth.' }));
        return [frame(event.type, { title: event.type === 'search' ? 'Source search receipt' : 'Source reading receipt', status: 'completed', message: event.query || event.url, output: json({ sources, provider: event.results?.provider, cache_hit: event.results?.cache_hit, source_ids: event.source_ids }), role })];
      }
      if (event.type === 'review') return [frame('review', { title: 'Scientific reviewer verdict', status: event.review.verdict === 'pass' ? 'completed' : 'warning', message: event.review.summary, output: json(event.review), review: event.review, role })];
      if (event.type === 'reference_check') return [frame('reference_check', { title: 'Deterministic reference audit', status: event.referenceAudit.status === 'failed' ? 'error' : 'completed', message: `Recorded status: ${event.referenceAudit.status}. Scope is limited to supported reference methods.`, output: json(event.referenceAudit) })];
      if (event.type === 'input_prepared') return [frame('input_preparation', { title: `Input prepared: ${escaped(event.source.name)}`, status: event.execution?.success === false ? 'warning' : 'completed', message: 'Original source context retained; preliminary parsing is not an accepted scientific finding.', code: event.execution?.code, output: json({ name: event.source.name, sha256: event.source.sha256, parsed_metadata: event.source.parsed_metadata, observed_data_profile: event.source.observed_data_profile, worksheets: event.source.worksheets.map(({ local_path, read_path, ...sheet }) => sheet), scope: event.source.profile_scope }), warnings: event.execution?.stderr ? [event.execution.stderr] : [] })];
      if (event.type === 'routing') return [frame('routing', { title: 'Advisory request routing', status: event.status === 'completed' ? 'completed' : 'warning', message: event.scope, output: json(event.classification || { reason: event.reason }) })];
      if (event.type === 'tool_result') return [frame('tool_receipt', { title: `${role}: ${event.tool} receipt`, status: event.result?.error || event.result?.success === false || event.result?.accepted === false ? 'warning' : 'completed', message: event.result?.error || 'Tool/submission receipt recorded; a submission is not scientific acceptance.', output: json({ tool: event.tool, evidence_id: event.result?.evidence_id, success: event.result?.success, accepted: event.result?.accepted, issues: event.result?.issues, error: event.result?.error }) })];
      if (event.type === 'document_correction') {
        if (event.status === 'running') documentGroups.set(event.source_name, `document:${++serial}`);
        return [frame('document_correction', { ...event, title: 'Proposed source-anchored document revisions', message: event.message || event.scope }, documentGroups.get(event.source_name))];
      }
      const publicTypes = ['candidate_revealed', 'feedback_loop', 'budget_constraint', 'failure'];
      if (!publicTypes.includes(event.type)) return [];
      return [frame(event.type === 'failure' ? 'error' : event.type, { title: event.type.replace(/_/g, ' '), status: event.type === 'failure' ? 'error' : 'completed', message: event.message || (event.type === 'candidate_revealed' ? 'Candidate revealed after a successful blind precheck; comparison remains required.' : 'Public workflow receipt recorded.'), output: event.constraint ? json(event.constraint) : undefined })];
    },
    finish(result) {
      const publicRecord = { ...result, trace: (result.trace || []).filter(event => event.type !== 'model_content') };
      const events = [...pendingCalls].map(([call, event]) => frame('model_call', { title: `${event.role}: model call ${call}`, status: 'error', message: 'No successful response receipt was recorded before the workflow ended.', model_call_number: call }, `call:${call}`));
      const accepted = (result.scientificSuccess ?? result.success) && result.scientificStatus === 'completed';
      const files = accepted ? legacyScientificFiles([...(result.outputFiles || []), ...(result.reportFiles || []), ...(result.documentRevisionFiles || [])]) : [];
      const answer = accepted ? formatLegacyScientificAnswer(result) : null;
      if (accepted) events.push(frame('insights', { title: 'Accepted scientific result', status: 'completed', content: answer, fullCode: result.fullCode, executionOutput: result.executionOutput }));
      else if (result.scientificStatus === 'needs_clarification') events.push(frame('needs_info', { title: 'Additional study information needed', status: 'needs_info', content: text(result.answer?.summary || result.error || 'Provide the missing study information before calculation.') }));
      else events.push(frame('error', { title: 'No scientific answer accepted', status: 'error', message: result.error || `The workflow ended with status ${result.scientificStatus}.`, output: result.executionOutput || undefined }));
      const conclusion = accepted ? answer : result.scientificStatus === 'needs_clarification' ? text(result.answer?.summary || result.error) : 'No scientific answer was accepted. ' + text(result.error || result.scientificStatus);
      events.push({ step: 'chatbot_conclusion_start', title: 'Scientific result', status: 'running' }, { step: 'chatbot_conclusion_stream', text: conclusion, fullText: conclusion }, { step: 'chatbot_conclusion_complete', message: conclusion, fullText: conclusion, scientificStatus: result.scientificStatus, files });
      if (files.length) events.push(frame('outputs', { title: 'Actual downloadable files', status: 'completed', message: 'Captured outputs, derived reports and proposed document revisions retain their individual provenance and scope.', files }));
      events.push({ ...publicRecord, step: 'scientific_result', legacyDisplayGroups: groups, display_scope: 'Numbered display groups organize public events; iterations remains the actual model-call count.' });
      if (accepted && result.productSuccess !== false) events.push({ ...publicRecord, step: 'complete', conversationLength: publicRecord.trace.filter(event => event.type === 'model_call').length });
      return events;
    }
  };
}
