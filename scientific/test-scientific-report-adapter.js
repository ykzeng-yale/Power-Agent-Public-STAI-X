import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createScientificReportFiles } from './scientific-report-adapter.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { parseFile } from './file-parser-improved.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function workspaceFor(callback){const root=await fs.mkdtemp(path.join(os.tmpdir(),'report-adapter-test-'));await fs.chmod(root,0o711);const executor=new ScientificRExecutor({root});const workspace=await executor.createWorkspace();try{return await callback(workspace,executor);}finally{await fs.rm(root,{recursive:true,force:true});}}
const result={success:true,scientificStatus:'completed',runId:'controlled-report',harnessVersion:'test',workflowMode:'multi',answer:{summary:'The observed mean is 3.5.',method:'Mean computed from the uploaded data.',results:[{metric:'observed mean',value:3.5,unit:'units'}],assumptions:['The supplied rows are the data of interest.'],limitations:['This descriptive summary is not a causal estimate.'],citations:[{title:'Supplied protocol',url:'https://example.invalid/protocol',supports:'Input context only'}]},review:{verdict:'pass'},referenceAudit:{status:'skipped'},outputFiles:[],fullCode:'x<-c(2,5);mean(x)',executionOutput:'[1] 3.5'};
test('derived reports have actual bytes and hashes, semantic HTML and separate rendering provenance',async()=>workspaceFor(async(workspace,executor)=>{
  const report=await createScientificReportFiles(structuredClone(result),'Summarize the uploaded outcome.',{workspace,executor});
  assert.equal(report.rendering.success,true,report.rendering.stderr);assert.deepEqual(report.files.map(f=>f.type).sort(),['html','md','pdf','r','txt']);
  for(const file of report.files){const bytes=await fs.readFile(file.path);assert.equal(hash(bytes),file.sha256);assert.deepEqual(Buffer.from(file.content_base64,'base64'),bytes);assert.equal(file.source_kind,'derived_report');}
  const html=Buffer.from(report.files.find(f=>f.type==='html').content_base64,'base64').toString();assert.match(html,/<h2>Accepted answer<\/h2><p/);assert.match(html,/<table>/);assert.match(html,/<ul>/);assert.match(html,/<a href="https:\/\/example.invalid\/protocol"/);assert.doesNotMatch(html,/<pre>Power Agent analysis report/);
  const pdf=report.files.find(f=>f.type==='pdf');assert.equal(pdf.name,'analysis-report.pdf');const parsed=await parseFile(await fs.readFile(pdf.path),'analysis-report.pdf','application/pdf');assert.match(parsed.text,/observed mean is 3\.5/);assert.match(parsed.text,/Derived presentation/);
}));
test('accepted PNG figures remain byte-bound in HTML and have explicit actual PDF rendering receipts',async()=>workspaceFor(async(workspace,executor)=>{
  const figure=await executor.executeRCode('png("mean.png",width=800,height=500);plot(c(1,2),c(2,5),xlab="Observation",ylab="Outcome");dev.off()',{workspace});assert.equal(figure.success,true,figure.stderr);
  const local=structuredClone(result);local.outputFiles=figure.output_files;
  const report=await createScientificReportFiles(local,'Summarize and show the supplied observations.',{workspace,executor});assert.equal(report.rendering.success,true,report.rendering.stderr);
  const receipt=report.rendering.figures[0];assert.equal(receipt.sha256,figure.output_files[0].sha256);
  const hasPng=spawnSync(process.env.RSCRIPT_PATH||'Rscript',['--vanilla','-e','cat(requireNamespace("png",quietly=TRUE))'],{encoding:'utf8'}).stdout.trim()==='TRUE';
  if(process.env.POWER_AGENT_REQUIRE_REPORT_PNG==='1')assert.equal(hasPng,true,'Production figure embedding requires the pinned png package');
  assert.equal(receipt.rendered,hasPng);if(!hasPng)assert.equal(receipt.reason,'png package unavailable');
  const html=Buffer.from(report.files.find(f=>f.type==='html').content_base64,'base64').toString();assert.match(html,/<figure><img src="data:image\/png;base64,/);assert.ok(html.includes(figure.output_files[0].sha256));
}));
test('report HTML escapes user/model text and failed analyses do not gain accepted reports',async()=>workspaceFor(async workspace=>{
  const unsafe=structuredClone(result);unsafe.answer.summary='<script>run()</script> A statement.';
  const report=await createScientificReportFiles(unsafe,'<img src=x onerror=run()>',{workspace});const html=Buffer.from(report.files[0].content_base64,'base64').toString();assert.ok(html.includes('&lt;script&gt;'));assert.doesNotMatch(html,/<script>/);assert.doesNotMatch(html,/<img src=x/);
  assert.deepEqual((await createScientificReportFiles({...result,success:false,scientificStatus:'review_failed'},'Unaccepted output',{workspace})).files,[]);
}));


test('derived report retains earlier analyst prose beside authoritative actual postprocessor receipts',async()=>workspaceFor(async workspace=>{
  const local=structuredClone(result);local.answer.summary='No DOCX was captured by R.';local.documentDelivery={status:'proposal_delivered',required_by_request:true,scope:'Editorial proposal only.'};local.documentCorrections=[{source_name:'protocol.docx',status:'proposal_generated',original_source_sha256:'source-sha'}];local.documentRevisionFiles=[{name:'protocol_proposed.docx',sha256:'proposal-sha',original_source_sha256:'source-sha'}];
  const report=await createScientificReportFiles(local,'Propose document revision.',{workspace});for(const type of ['html','md']){const text=Buffer.from(report.files.find(f=>f.type===type).content_base64,'base64').toString();assert.ok(text.includes('No DOCX was captured by R.'));assert.ok(text.includes('proposal_delivered'));assert.ok(text.includes('protocol_proposed.docx'));assert.ok(text.includes('source-sha'));assert.ok(text.includes('supersedes earlier analyst statements'));}assert.equal(local.answer.summary,'No DOCX was captured by R.');
}));
