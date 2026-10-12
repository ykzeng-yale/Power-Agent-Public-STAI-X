import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createLegacyScientificEventAdapter, legacyScientificFiles, formatLegacyScientificAnswer } from './scientific-legacy-events.js';
import { ScientificRExecutor } from './scientific-r-executor.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const accepted = { success: true, scientificStatus: 'completed', workflowMode: 'multi', runId: 'legacy-adapter-fixture', iterations: 4, trace: [{ type: 'model_call' }],
  answer: { summary: 'The executed answer.', method: 'Actual fixture method.', results: [{ metric: 'sample size', value: 64, unit: 'participants_per_group' }], assumptions: ['Independent groups.'], limitations: ['Specified design only.'], evidence_ids: ['e1'], citations: [{ title: 'Primary documentation', url: 'https://example.invalid/source', supports: 'Method documentation only.' }] },
  review: { verdict: 'pass', summary: 'Executed check recorded.' }, referenceAudit: { status: 'passed' }, fullCode: 'actual_code()', executionOutput: 'actual_stdout', outputFiles: [], reportFiles: [], documentRevisionFiles: [] };

test('actual submitted plan, repeated R attempts and reviewer records remain visible without DOM identity collisions', async () => {
  const adapter = createLegacyScientificEventAdapter(), events = [];
  for (const event of [{type:'agent_start',role:'coder',call:2,model:'fixture-model'},{type:'model_call',role:'coder',call:2,model:'fixture-model',usage:{output_tokens:3}},
    {type:'design',role:'planner',plan:{ready:true,method:'Two-sample t test',assumptions:['Independent groups.']}},
    {type:'code',role:'coder',evidence_id:'e1',code:'first_actual_code()',message:'First submitted attempt'},
    {type:'execution',role:'coder',evidence_id:'e1',success:false,output:'partial_stdout',error:'actual_R_error',exitCode:1},
    {type:'code',role:'coder',evidence_id:'e2',code:'second_actual_code()',message:'Corrected attempt'},
    {type:'execution',role:'coder',evidence_id:'e2',success:true,output:'successful_stdout',exitCode:0},
    {type:'review',role:'reviewer',review:{verdict:'pass',summary:'Actual check',independent_check_evidence_ids:['e3']}}]) events.push(...await adapter.event(event));
  const code = events.filter(event=>event.step==='code'), execution=events.filter(event=>event.step==='execution');
  assert.notEqual(code[0].iteration,code[1].iteration);assert.equal(code[0].iteration,execution[0].iteration);assert.equal(code[1].iteration,execution[1].iteration);
  assert.equal(execution[0].status,'error');assert.equal(execution[0].warnings[0],'actual_R_error');assert.equal(execution[1].output,'successful_stdout');
  assert.match(events.find(event=>event.step==='planning').output,/Two-sample t test/);assert.match(events.find(event=>event.step==='review').output,/e3/);
  assert.equal(events[0].iteration,events[1].iteration);assert.equal(events[1].status,'completed');assert.equal(events.some(event=>event.reasoning),false);
});
test('private provider blocks and source body material are never turned into legacy public cards',async()=>{
  const adapter=createLegacyScientificEventAdapter();assert.deepEqual(await adapter.event({type:'model_content',content:[{type:'thinking',thinking:'private chain fixture'}]}),[]);
  const events=await adapter.event({type:'source_read',url:'https://example.invalid/source',source_ids:['s1'],results:{provider:'test',results:[{id:'s1',title:'Primary source',url:'https://example.invalid/source',content:'FULL_SOURCE_BODY_FIXTURE',scope:'Retrieved source text'}]}});
  assert.match(events[0].output,/Primary source/);assert.doesNotMatch(JSON.stringify(events),/FULL_SOURCE_BODY_FIXTURE|private chain fixture/);
  const raw=structuredClone(accepted);raw.trace.push({type:'model_content',content:[{type:'thinking',thinking:'PRIVATE_FINAL_CONTENT_FIXTURE'}]});assert.doesNotMatch(JSON.stringify(adapter.finish(raw)),/PRIVATE_FINAL_CONTENT_FIXTURE/);assert.equal(raw.trace.at(-1).type,'model_content');
});
test('actual harness source scope and truncation fields stay visible and original upload names cannot become title markup',async()=>{
  const adapter=createLegacyScientificEventAdapter(),actualSource={id:'s1',title:'Source preview',url:'https://example.invalid/source',content:'SOURCE_BODY_NOT_A_CARD',content_scope:'Provider content limited to this receipt',content_truncated:true,truncation_scope:'80000-character total retrieval limit applied'};
  const events=await adapter.event({type:'source_read',url:actualSource.url,results:{results:[actualSource]}}),visible=JSON.parse(events[0].output).sources[0];
  assert.equal(visible.content_scope,actualSource.content_scope);assert.equal(visible.content_truncated,true);assert.equal(visible.truncation_scope,actualSource.truncation_scope);assert.equal(visible.content,undefined);
  const source={name:'<img src=x onerror=run()>.csv',worksheets:[]};const prepared=await adapter.event({type:'input_prepared',source});assert.doesNotMatch(prepared[0].title,/<img/);assert.match(prepared[0].title,/&lt;img/);assert.equal(JSON.parse(prepared[0].output).name,source.name);
});
test('legacy downloadable transport is byte-backed and retains MIME/hash/decoded report cache content',()=>{
  const bytes=Buffer.from('# Real report\n\nActual recorded values.');const original={name:'analysis-report.md',type:'md',mime_type:'text/markdown',sha256:hash(bytes),content_base64:bytes.toString('base64'),source_kind:'derived_report'};
  const [file]=legacyScientificFiles([original]);assert.match(file.download_url,/^data:text\/markdown;base64,/);assert.deepEqual(Buffer.from(file.download_url.split(',')[1],'base64'),bytes);assert.equal(file.content,bytes.toString());assert.equal(file.source_kind,'derived_report');
  assert.deepEqual(legacyScientificFiles([{...original,sha256:'0'.repeat(64)},{name:'unavailable.pdf',download_url:'https://example.invalid/no-captured-bytes'}]),[]);assert.equal(original.download_url,undefined);
});
test('only accepted scientific results celebrate completion; clarification and failed review retain honest terminal records',()=>{
  const success=createLegacyScientificEventAdapter().finish(structuredClone(accepted));const insights=success.find(event=>event.step==='insights');assert.match(insights.content,/64/);assert.match(insights.content,/Assumptions/);assert.match(insights.content,/Verification record/);assert.equal(insights.fullCode,'actual_code()');assert.equal(insights.executionOutput,'actual_stdout');assert.equal(success.filter(event=>event.step==='complete').length,1);
  for(const status of ['review_failed','execution_failed','needs_clarification']){const record={...structuredClone(accepted),success:false,scientificStatus:status,error:'Recorded unresolved issue'};const events=createLegacyScientificEventAdapter().finish(record);assert.equal(events.some(event=>event.step==='complete'||event.step==='insights'),false);assert.equal(events.find(event=>event.step==='scientific_result').scientificStatus,status);assert.ok(events.some(event=>event.step===(status==='needs_clarification'?'needs_info':'error')));}
  const prose=structuredClone(accepted);prose.answer.summary="Cohen's d < 0.5 & p > 0.05.";prose.answer.method='Pr(|T|>c)';prose.answer.results[0].metric='Pr(|T|>c)';
  const markdown=formatLegacyScientificAnswer(prose);assert.ok(markdown.includes(prose.answer.summary));assert.match(markdown,/Pr\(&#124;T&#124;>c\)/);assert.doesNotMatch(markdown,/&#39;|&lt;|&gt;|&amp;/);assert.equal(prose.answer.results[0].metric,'Pr(|T|>c)');
});
test('accepted conclusion and original output cards share actual files, including proposed document revision scope',()=>{
  const bytes=Buffer.from('Actual revision bytes fixture');const result=structuredClone(accepted);result.documentRevisionFiles=[{name:'revision.docx',type:'docx',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',sha256:hash(bytes),content_base64:bytes.toString('base64'),source_kind:'document_revision',original_source_sha256:'source-fixture',scope:'Proposed editorial revision.'}];
  const events=createLegacyScientificEventAdapter().finish(result),conclusion=events.find(event=>event.step==='chatbot_conclusion_complete'),outputs=events.find(event=>event.step==='outputs');assert.deepEqual(conclusion.files,outputs.files);assert.equal(outputs.files[0].source_kind,'document_revision');assert.equal(outputs.files[0].original_source_sha256,'source-fixture');
});
test('original image cards receive only actual captured PNG/JPEG bytes from a fresh real R execution',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-image-test-'));await fs.chmod(root,0o711);const executor=new ScientificRExecutor({root});const workspace=await executor.createWorkspace();
  try{const result=await executor.executeRCode('png("plot.png",width=480,height=360);plot(1:3);dev.off();jpeg("plot.jpg",width=480,height=360);plot(3:1);dev.off()',{workspace});assert.equal(result.success,true,result.stderr);
    const events=await createLegacyScientificEventAdapter({workspace}).event({type:'execution',role:'coder',evidence_id:'e1',success:true,output:result.output,output_files:result.output_files});const images=events[0].images;assert.equal(images.length,2);assert.deepEqual(images.map(image=>image.format).sort(),['image/jpeg','image/png']);for(const image of images)assert.equal(hash(Buffer.from(image.data,'base64')),image.sha256);
    const blocked=await createLegacyScientificEventAdapter({workspace}).event({type:'execution',role:'coder',evidence_id:'e2',success:true,output_files:[{type:'png',name:'external.png',path:'/etc/passwd',sha256:'0'.repeat(64)}]});assert.equal(blocked[0].images.length,0);assert.equal(blocked[0].warnings.length,1);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});


test('accepted numerical insights survive partial document delivery without full-product celebration',()=>{
 const result={...structuredClone(accepted),success:false,scientificSuccess:true,productSuccess:false,productStatus:'partial_delivery',documentDelivery:{status:'required_proposal_not_delivered',required_by_request:true,scope:'Separate proposal scope.'},documentCorrections:[{source_name:'protocol.docx',status:'failed',original_source_sha256:'source-sha',reason:'Anchor unavailable'}]};
 const events=createLegacyScientificEventAdapter().finish(result);assert.ok(events.some(event=>event.step==='insights'));assert.ok(!events.some(event=>event.step==='complete'));const receipt=events.find(event=>event.step==='scientific_result');assert.equal(receipt.success,false);assert.equal(receipt.scientificSuccess,true);assert.equal(receipt.scientificStatus,'completed');assert.match(events.find(event=>event.step==='insights').content,/required_proposal_not_delivered/);assert.match(events.find(event=>event.step==='insights').content,/source-sha/);
});
