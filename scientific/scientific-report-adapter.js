import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { documentRevisionReceiptLines } from './scientific-document-adapter.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hash = value => createHash('sha256').update(value).digest('hex');

export async function createScientificReportFiles(result, query, { workspace, executor, signal } = {}) {
  if (!result.success || result.scientificStatus !== 'completed' || !result.answer) return { files: [], rendering: null };
  const answer = result.answer;
  const rows = (answer.results || []).map(row => `${row.metric}: ${row.value} ${row.unit}`);
  const citations = (answer.citations || []).map(source => `${source.title}: ${source.url}`);
  const scope = 'Derived presentation of the accepted workflow record. Formatting does not add scientific verification and is not numerical execution evidence.';
  const delivery = documentRevisionReceiptLines(result);
  const analystScope = 'Analyst narrative submitted before final review and document post-processing. Actual postprocessor delivery receipts below govern file availability; earlier narrative is retained unchanged.';
  const narrative = ['Power Agent analysis report', `Run: ${result.runId}`, `Harness: ${result.harnessVersion}`, `Scientific status: ${result.scientificStatus}; product delivery: ${result.productStatus || 'not assessed'}`,
    'Research question', query, 'Accepted answer', analystScope, answer.summary, 'Method', answer.method, 'Reported quantities', ...rows,
    'Assumptions', ...(answer.assumptions || []), 'Limitations', ...(answer.limitations || []),
    'Verification', `Workflow: ${result.workflowMode}; review verdict: ${result.review?.verdict || 'unavailable'}; reference: ${result.referenceAudit?.status || 'unavailable'}`,
    ...(delivery.length ? ['Actual document proposal receipts', ...delivery] : []), 'Sources', ...citations, 'Report scope', scope].filter(value => value !== undefined && value !== null).join('\n\n');
  const md = `${narrative}\n\n## Reproducible R code\n\n\`\`\`r\n${result.fullCode || ''}\n\`\`\`\n\n## Actual execution output\n\n\`\`\`text\n${result.executionOutput || ''}\n\`\`\`\n`;
  const pngFiles = (result.outputFiles || []).filter(file => file.type === 'png' && file.content_base64 && hash(Buffer.from(file.content_base64, 'base64')) === file.sha256);
  const figures = pngFiles.map(file => `<figure><img src="data:image/png;base64,${file.content_base64}" alt="${escape(file.name)}"><figcaption>${escape(file.name)} — SHA-256 ${escape(file.sha256)}</figcaption></figure>`).join('');
  const paragraphs = value => String(value || '').split(/\n\s*\n/).filter(Boolean).map(text => `<p>${escape(text).replace(/\n/g, '<br>')}</p>`).join('');
  const bullets = values => `<ul>${(values || []).map(value => `<li>${escape(value)}</li>`).join('')}</ul>`;
  const sourceLinks = (answer.citations || []).map(source => `<li>${/^https?:\/\//.test(source.url) ? `<a href="${escape(source.url)}" rel="noopener noreferrer">${escape(source.title)}</a>` : escape(source.title)}${source.supports ? `: ${escape(source.supports)}` : ''}</li>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Power Agent analysis report</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 24px;color:#172338}h1,h2{color:#164b6b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6f8;padding:18px;border-radius:8px}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ddd;padding:8px}img{max-width:100%;height:auto}figcaption,.scope{font-size:13px;color:#526174}.metadata{background:#eef5f8;padding:12px 18px;border-radius:8px}</style><h1>Power Agent analysis report</h1><p class="scope">${escape(scope)}</p><p class="metadata">Run ${escape(result.runId)} · Harness ${escape(result.harnessVersion)} · Scientific status ${escape(result.scientificStatus)} · Product delivery ${escape(result.productStatus || 'not assessed')}</p><h2>Research question</h2>${paragraphs(query)}<h2>Accepted answer</h2><p class="scope">${escape(analystScope)}</p>${paragraphs(answer.summary)}<h2>Method</h2>${paragraphs(answer.method)}<h2>Computed quantities</h2><table><thead><tr><th>Quantity</th><th>Value</th><th>Unit</th></tr></thead><tbody>${(answer.results || []).map(row => `<tr><td>${escape(row.metric)}</td><td>${escape(row.value)}</td><td>${escape(row.unit)}</td></tr>`).join('')}</tbody></table><h2>Assumptions</h2>${bullets(answer.assumptions)}<h2>Limitations</h2>${bullets(answer.limitations)}<h2>Verification</h2><p>Workflow ${escape(result.workflowMode)}; review verdict ${escape(result.review?.verdict || 'unavailable')}; deterministic reference ${escape(result.referenceAudit?.status || 'unavailable')}.</p>${result.review?.summary ? paragraphs(result.review.summary) : ''}${figures ? `<h2>Figures from the accepted execution</h2>${figures}` : ''}${delivery.length ? `<h2>Actual document proposal receipts</h2>${delivery.map(line => `<p>${escape(line)}</p>`).join('')}` : ''}<h2>Sources</h2><ul>${sourceLinks}</ul><details><summary>Executed R code</summary><pre>${escape(result.fullCode || '')}</pre></details><details><summary>Actual stdout and stderr</summary><pre>${escape(result.executionOutput || '')}</pre></details></html>`;
  const files = [];
  for (const [name, text, type, mime] of [['analysis-report.html', html, 'html', 'text/html'], ['analysis-report.md', md, 'md', 'text/markdown'],
    ['analysis-code.R', result.fullCode || '', 'r', 'text/plain'], ['execution-output.txt', result.executionOutput || '', 'txt', 'text/plain']]) {
    const bytes = Buffer.from(text);
    if (!bytes.length || bytes.length > 2000000) continue;
    const filename = path.join(workspace.directory, name);
    await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o400 });
    files.push({ artifact_id: `report-${result.runId}-${type}`, name, path: filename, type, mime_type: mime,
      sha256: hash(bytes), size: bytes.length, content_base64: bytes.toString('base64'), source_kind: 'derived_report',
      producer_kind: 'deterministic_report_adapter', source_run_id: result.runId, scope });
  }
  let rendering = null;
  if (executor && !signal?.aborted) {
    const figureInputs = [];
    for (const [index, file] of pngFiles.entries()) {
      const bytes = Buffer.from(file.content_base64, 'base64');
      const target = path.join(workspace.directory, `report-figure-${index + 1}.png`);
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o400 });
      figureInputs.push({ path: target, name: file.name, sha256: file.sha256 });
    }
    const code = `lines<-strsplit(${JSON.stringify(narrative)},"\\n",fixed=TRUE)[[1L]]
lines<-unlist(lapply(lines,function(x){if(!nzchar(x))"" else strwrap(x,width=88)}),use.names=FALSE)
lines<-unlist(lapply(lines,function(x){if(nchar(x)<=88)x else substring(x,seq(1,nchar(x),by=88),pmin(nchar(x),seq(1,nchar(x),by=88)+87))}),use.names=FALSE)
if(length(lines)>4800)stop("Report exceeds the 100-page rendering bound")
previous_device<-dev.cur();if(capabilities("cairo"))tryCatch(cairo_pdf("analysis-report.pdf",width=8.27,height=11.69,onefile=TRUE,family="sans"),error=function(e)NULL)
if(dev.cur()==previous_device)pdf("analysis-report.pdf",width=8.27,height=11.69,onefile=TRUE)
headings<-c("Power Agent analysis report","Research question","Accepted answer","Method","Reported quantities","Assumptions","Limitations","Verification","Actual document proposal receipts","Sources","Report scope")
for(start in seq(1,max(1,length(lines)),by=48)){par(mar=c(0,0,0,0));plot.new();plot.window(xlim=c(0,1),ylim=c(0,1));chunk<-lines[start:min(length(lines),start+47)];text(.04,seq(.96,by=-.019,length.out=length(chunk)),labels=chunk,adj=c(0,1),cex=ifelse(chunk%in%headings,1,.82),font=ifelse(chunk%in%headings,2,1),family="sans");text(.5,.02,labels=paste("Power Agent report - page",ceiling(start/48)),cex=.7)}
figures<-jsonlite::fromJSON(${JSON.stringify(JSON.stringify(figureInputs))},simplifyVector=FALSE);figure_receipts<-list()
for(figure in figures){ok<-FALSE;reason<-NULL;if(requireNamespace("png",quietly=TRUE)){tryCatch({image<-png::readPNG(figure$path);grid::grid.newpage();grid::grid.text(figure$name,x=.5,y=.96,gp=grid::gpar(fontsize=12,fontface="bold"));ratio<-dim(image)[2]/dim(image)[1];w<-7.27;h<-w/ratio;if(h>9.1){h<-9.1;w<-h*ratio};grid::grid.raster(image,x=.5,y=.5,width=grid::unit(w,"inches"),height=grid::unit(h,"inches"),interpolate=FALSE);grid::grid.text(paste("SHA-256",figure$sha256),x=.5,y=.04,gp=grid::gpar(fontsize=8));ok<-TRUE},error=function(e){reason<<-"PNG decoding/rendering failed"})}else reason<-"png package unavailable";figure_receipts[[length(figure_receipts)+1]]<-list(name=figure$name,sha256=figure$sha256,rendered=ok,reason=reason)}
dev.off();cat("DERIVED_REPORT_FIGURES=",jsonlite::toJSON(figure_receipts,auto_unbox=TRUE),"\\n",sep="");cat("DERIVED_REPORT_RENDERED\\n")`;
    const execution = await executor.executeRCode(code, { workspace, phase: 'report_rendering', timeout: 30000, signal });
    rendering = { success: execution.success === true, code_sha256: hash(code), output: execution.output || '', stderr: execution.stderr || '',
      elapsed_ms: execution.executionTime || 0, exitCode: execution.exitCode ?? null, scope: 'Document rendering only; separate from the scientific numerical execution budget and evidence.' };
    const receipt = String(execution.output || '').split(/\r?\n/).find(line => line.startsWith('DERIVED_REPORT_FIGURES='));
    try { rendering.figures = JSON.parse(receipt?.slice('DERIVED_REPORT_FIGURES='.length)); } catch { rendering.figures = []; }
    if (execution.success) for (const file of execution.output_files || []) if (file.type === 'pdf') files.push({ ...file,
      source_kind: 'derived_report', producer_kind: 'deterministic_report_renderer', source_run_id: result.runId, scope });
  }
  return { files, rendering };
}
