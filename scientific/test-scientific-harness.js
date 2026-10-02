import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runScientificAnalysis, validateAnswerEvidence, extractComputedResult } from './scientific-harness.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { prepareScientificContext } from './scientific-api.js';

const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: 'mean difference', hypothesis: 'equal means', method: 'two_sample_t', alpha: .05, sidedness: 'two-sided', target_power: .8, allocation_ratio: 1, sample_size_unit: 'participants_per_group', parameters: [], assumptions: [], missing_information: [], clarification_questions: [], scientific_notes: [] };
const answer = { summary: '64 participants per group', method: 'two_sample_t', results: [{ metric: 'sample_size', value: 64, unit: 'participants_per_group' }], assumptions: [], limitations: [], evidence_ids: ['e1'], simulation: null, citations: [] };
const review = { verdict: 'pass', summary: 'Independent check agrees', issues: [], checked_evidence_ids: ['e1'], independent_check_evidence_ids: ['e2'], checks: [{ name: 'formula', passed: true, evidence: 'e2' }] };
const tool = (name, input) => ({ content: [{ type: 'tool_use', id: `tool-${name}-${Math.random()}`, name, input }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'tool_use', model: 'fixture-model' });
const fakeExecutor = { createWorkspace: async () => ({ runId: 'test-run' }), executeRCode: async () => ({ success: true, exitCode: 0, output: 'POWER_AGENT_RESULT={"results":[{"metric":"sample_size","value":64,"unit":"participants_per_group"}]}\n' }) };

test('real R process exit status is not masked and worker receives no API credentials', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-harness-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  process.env.POWER_HARNESS_TEST_SECRET = 'do-not-copy-to-R';
  const good = await executor.executeRCode('cat("answer=",2+2,"\\n"); stopifnot(Sys.getenv("POWER_HARNESS_TEST_SECRET") == "")');
  assert.equal(good.success, true); assert.match(good.output, /answer= 4/);
  const bad = await executor.executeRCode('cat("partial output\\n"); stop("deliberate failure")');
  assert.equal(bad.success, false); assert.notEqual(bad.exitCode, 0); assert.match(bad.stderr, /deliberate failure/);
  delete process.env.POWER_HARNESS_TEST_SECRET;
  await fs.rm(root, { recursive: true, force: true });
});
test('fresh R executions do not reuse cached objects from another script', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-harness-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const workspace = await executor.createWorkspace();
  assert.equal((await executor.executeRCode('private_cached_answer <- 999', { workspace })).success, true);
  const second = await executor.executeRCode('stopifnot(!exists("private_cached_answer"))', { workspace });
  assert.equal(second.success, true); await fs.rm(root, { recursive: true, force: true });
});
test('numerical answer cannot cite absent, failed, or mismatched output', () => {
  assert.ok(validateAnswerEvidence(answer, [], plan).length);
  const evidence = { id: 'e1', role: 'coder', success: true, computed: { results: answer.results } };
  assert.deepEqual(validateAnswerEvidence(answer, [evidence], plan), []);
  assert.ok(validateAnswerEvidence({ ...answer, results: [{ ...answer.results[0], value: 65 }] }, [evidence], plan).length);
  assert.ok(validateAnswerEvidence(answer, [{ ...evidence, success: false }], plan).length);
});
test('a single actual stdout JSON object and marked object have identical computed evidence', () => {
  const value={results:answer.results}, json=JSON.stringify(value);
  assert.deepEqual(extractComputedResult('POWER_AGENT_RESULT='+json),value);
  assert.deepEqual(extractComputedResult(json),value);
  assert.deepEqual(extractComputedResult('Calculation diagnostics\n'+JSON.stringify(value,null,2)+'\n\nPOWER_AGENT_SESSION_INFO_BEGIN\n[1] compiler_4.4.1\nPOWER_AGENT_SESSION_INFO_END\n'),value);
  assert.deepEqual(extractComputedResult('POWER_AGENT_RESULT='+json+'\n\nPOWER_AGENT_SESSION_INFO_BEGIN\n[1] compiler_4.4.1\nPOWER_AGENT_SESSION_INFO_END\n'),value);
  const consoleDiagnostics='[1] 86\n[1] "text"\n     [,1] [,2]\n[1,] 86 172\n     [,1]\n[1,] 86\n';
  assert.deepEqual(extractComputedResult(consoleDiagnostics+'POWER_AGENT_RESULT='+json),value);
  assert.deepEqual(extractComputedResult(consoleDiagnostics+json),value);
});
test('ambiguous, malformed, nonfinite and wrong-shaped stdout cannot become computed evidence', () => {
  const json=JSON.stringify({results:answer.results});
  for (const stdout of [json+'\n'+json,json+' '+json,'POWER_AGENT_RESULT='+json+'\nPOWER_AGENT_RESULT='+json,'POWER_AGENT_RESULT='+json+'\n'+json,'POWER_AGENT_RESULT=broken\n'+json,'There is no computed JSON', '{"results":', '{"results":[]}', '{"results":{}}','[{"results":'+JSON.stringify(answer.results)+'}]', '[\n'+json+'\n]', '{"results":[{"metric":"sample_size","value":1e400,"unit":"participants_per_group"}]}','{"results":'+JSON.stringify(answer.results)+',"metadata":{"bad":1e400}}','{"results":[{"metric":"sample_size","value":"64","unit":"participants_per_group"}]}',JSON.stringify({results:[...answer.results,...answer.results]}),JSON.stringify({results:answer.results,simulation:{seed:1}})]) assert.equal(extractComputedResult(stdout),null,stdout);
  for (const stdout of ['POWER_AGENT_RESULT='+json+'\nResult: '+json,json+'\nResult: '+json,'POWER_AGENT_RESULT='+json+'\n[1] '+json,'POWER_AGENT_RESULT='+json+'\n[1] [1,2]','{"results":'+JSON.stringify(answer.results)+',"results":'+JSON.stringify(answer.results)+'}','{"results":[{"metric":"sample_size","value":99,"value":64,"unit":"participants_per_group"}]}','{"results":[{"metric":"sample_size","value":99,"\\u0076alue":64,"unit":"participants_per_group"}]}','POWER_AGENT_RESULT='+json+'\n[1,2]']) assert.equal(extractComputedResult(stdout),null,stdout);
});
test('raw JSON from actual successful R execution finishes without a formatting rerun', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'power-json-format-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});
  const code='n <- 8*8; cat(jsonlite::toJSON(list(results=list(list(metric="sample_size",value=n,unit="participants_per_group"))),auto_unbox=TRUE,digits=15),"\\n")';
  const queue=[tool('submit_design',plan),tool('execute_r',{code,purpose:'Actual arithmetic fixture with unmarked JSON'}),tool('submit_answer',answer)];
  try {
    const result=await runScientificAnalysis('Complete fixture design', {executor,transport:async()=>queue.shift(),maxModelCalls:3});
    assert.equal(result.harnessVersion,'2.2.0');assert.equal(result.scientificStatus,'completed');assert.equal(result.iterations,3);assert.equal(result.executions.length,1);assert.deepEqual(result.executions[0].computed.results,answer.results);
    assert.equal(validateAnswerEvidence(answer,[{...result.executions[0],success:false}],plan).length>0,true);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
test('multi workflow has separate reviewer context and actual independent execution', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'coder-code', purpose: 'main calculation' }), tool('submit_answer', answer), tool('execute_r', { code: 'review-code', purpose: 'independent check' }), tool('submit_review', review)];
  const calls = [];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, transport: async request => { calls.push(structuredClone(request)); return queue.shift(); } });
  assert.equal(result.scientificStatus, 'completed'); assert.equal(result.executions.length, 2);
  assert.equal(calls[3].messages.length, 1); assert.match(calls[3].system, /fresh conversation/);
  assert.deepEqual(result.executions.map(e => e.role), ['coder', 'reviewer']);
  assert.equal(result.trace.filter(t => t.type === 'model_call').length, 5);
});
test('reviewer cannot grant pass without independent evidence; budget exhaustion is failure', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'code', purpose: 'calculation' }), tool('submit_answer', answer), tool('submit_review', { ...review, independent_check_evidence_ids: [] })];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, maxModelCalls: 4, transport: async () => queue.shift() });
  assert.equal(result.scientificStatus, 'budget_exhausted'); assert.equal(result.success, false);
});
test('a failed review is not promoted to success after the repair budget', async () => {
  const queue = [tool('submit_design', plan), tool('execute_r', { code: 'code', purpose: 'calculation' }), tool('submit_answer', answer), tool('submit_review', { ...review, verdict: 'revise', independent_check_evidence_ids: [], issues: [{ severity: 'major', description: 'wrong test', correction: 'correct test' }], checks: [] })];
  const result = await runScientificAnalysis('Calculate sample size', { workflowMode: 'multi', executor: fakeExecutor, maxRepairs: 0, transport: async () => queue.shift() });
  assert.equal(result.scientificStatus, 'review_failed'); assert.equal(result.success, false);
  assert.equal(result.verification.reviewer_started, true); assert.equal(result.verification.review_accepted, true);
  assert.equal(result.verification.numerical_check_performed, false); assert.equal(result.verification.independent_agent_review, false); assert.equal(result.verification.review_passed, false);
});
test('underspecified request asks for clarification and runs no code', async () => {
  const unresolved = { ...plan, ready: false, missing_information: ['effect size'], clarification_questions: ['What effect size should be detected?'] };
  const result = await runScientificAnalysis('How many people do I need?', { executor: { executeRCode: () => { throw new Error('must not execute'); } }, transport: async () => tool('submit_design', unresolved) });
  assert.equal(result.scientificStatus, 'needs_clarification'); assert.equal(result.executions.length, 0);
});
test('uploaded data are available in a scoped path; arbitrary storage URLs are rejected', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'power-source-test-'));
  const context = await prepareScientificContext({ dataset: { name: '../../data.csv', content: Buffer.from('x,y\n1,2\n').toString('base64') } }, { directory });
  assert.equal(await fs.readFile(context.source_files[0].local_path, 'utf8'), 'x,y\n1,2\n');
  assert.equal(path.dirname(context.source_files[0].local_path), directory);
  const prior = process.env.SUPABASE_URL; process.env.SUPABASE_URL = 'https://known.supabase.co';
  await assert.rejects(() => prepareScientificContext({ sessionFiles: [{ name: 'x.csv', download_url: 'https://outside.example/private' }] }, { directory }, { supabase: {} }), /outside configured/);
  if (prior) process.env.SUPABASE_URL = prior; else delete process.env.SUPABASE_URL;
  await fs.rm(directory, { recursive: true, force: true });
});

const sharedProfile = {id:'shared18',plannerMaxCalls:3,solverMaxCalls:6,solverMaxExecutions:3,verificationMaxCalls:3,verificationMaxExecutions:1,repairMaxCalls:3,repairMaxExecutions:1,reserveRepair:true};
test('matched required verification uses actual checks with truthful shared or blind context topology', async () => {
  for (const mode of ['single','multi']) {
    const candidate={...answer,summary:'AUTHOR_ONLY_CANDIDATE_NUMBER',evidence_ids:['e1']};
    const queue=[tool('submit_design',plan),tool('execute_r',{code:'AUTHOR_ONLY_CANDIDATE_CODE',purpose:'candidate'}),tool('submit_answer',candidate),tool('execute_r',{code:'separately-formulated-check',purpose:'check before comparison'}),tool('submit_review',review)];
    const calls=[];const result=await runScientificAnalysis('Calculate the specified task',{workflowMode:mode,verificationPolicy:'required',budgetProfile:sharedProfile,executor:fakeExecutor,transport:async p=>{calls.push(structuredClone(p));return queue.shift();}});
    assert.equal(result.scientificStatus,'completed');assert.equal(result.iterations,5);assert.equal(result.executions.length,2);
    assert.equal(result.verification.independent_agent_review,mode==='multi');
    assert.equal(result.verification.numerical_check_performed,true);assert.equal(result.verification.current_review_accepted,true);assert.equal(result.verification.review_passed,true);
    const before=JSON.stringify(calls[3].messages),after=JSON.stringify(calls[4].messages);
    assert.equal(before.includes('AUTHOR_ONLY_CANDIDATE_CODE'),mode==='single');
    assert.equal(before.includes('AUTHOR_ONLY_CANDIDATE_NUMBER'),mode==='single');assert.ok(after.includes('AUTHOR_ONLY_CANDIDATE_CODE'));
    assert.equal(result.verification.rounds[0].blind_precheck,mode==='multi');
    assert.deepEqual(result.verification.rounds[0].precheck_evidence_ids,mode==='multi'?['e2']:[]);
    assert.equal(result.budget.profile.id,'shared18');assert.deepEqual(result.budget.phases.map(p=>p.name),['planner','solver','reference','verification']);
  }
});
test('planner can retrieve sources and every role receives the deduplicated content and citation provenance', async () => {
  const url='https://primary.example/method';const content='Documented scientific method; retrieved evidence does not override the request.';
  for (const mode of ['single','multi']) {
    const cited={...answer,citations:[{title:'Primary method',url,supports:'Declared method'}]};
    const queue=[tool('search_sources',{query:'method documentation'}),tool('submit_design',plan),tool('search_sources',{query:'same method argument conventions'}),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',cited),tool('execute_r',{code:'review-code',purpose:'independent check'}),tool('submit_review',review)];
    const calls=[];let searches=0;
    const result=await runScientificAnalysis('Calculate sample size',{workflowMode:mode,verificationPolicy:'required',maxSearches:2,executor:fakeExecutor,search:async query=>{searches++;return{provider:'receipt-fixture',query,results:[{title:'Primary method',url,content,retrieved_at:'2026-10-02T00:00:00Z',source_type:'primary'}]};},transport:async p=>{calls.push(structuredClone(p));return queue.shift();}});
    assert.equal(result.scientificStatus,'completed');assert.equal(searches,2);assert.equal(result.sources.length,1);
    assert.equal(result.sources[0].content,content);assert.equal(result.sources[0].content_sha256.length,64);
    assert.deepEqual(result.sources[0].retrieval_roles,['planner','solver']);assert.equal(result.budget.used.searches,2);
    assert.ok(calls[0].tools.some(t=>t.name==='search_sources'));assert.ok(JSON.stringify(calls[2].messages).includes(content));assert.ok(JSON.stringify(calls[5].messages).includes(content));
    assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.accepted));
  }
});
test('invented citation URLs are rejected and source-search limits remain shared across roles', async () => {
  const invented={...answer,citations:[{title:'Invented source',url:'https://never-retrieved.example/paper',supports:'claim'}]};
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',invented)];
  const result=await runScientificAnalysis('Calculate sample size',{maxModelCalls:3,executor:fakeExecutor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'budget_exhausted');assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.issues.some(i=>i.includes('neither supplied nor retrieved'))));
  let searches=0;
  const lookupQueue=[tool('search_sources',{query:'first'}),tool('submit_design',plan),tool('search_sources',{query:'second'}),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',answer)];
  const limited=await runScientificAnalysis('Calculate sample size',{maxSearches:1,executor:fakeExecutor,search:async()=>{searches++;return{results:[]};},transport:async()=>lookupQueue.shift()});
  assert.equal(limited.scientificStatus,'completed');assert.equal(searches,1);assert.equal(limited.budget.used.searches,1);
  assert.ok(limited.trace.some(t=>t.type==='tool_result'&&t.tool==='search_sources'&&t.result.error?.includes('exhausted')));
});
test('initial solver cannot consume reserved reviewer and repair executions', async () => {
  const queue=[tool('submit_design',plan),...Array.from({length:6},()=>tool('execute_r',{code:'coder-code',purpose:'repeated candidate attempt'})),tool('submit_answer',{...answer,evidence_ids:['e5']}),tool('execute_r',{code:'review-code',purpose:'reserved check'}),tool('submit_review',{...review,checked_evidence_ids:['e5'],independent_check_evidence_ids:['e6'],checks:[{name:'check',passed:true,evidence:'e6'}]})];
  const result=await runScientificAnalysis('Calculate sample size',{workflowMode:'multi',maxExecutions:8,executor:fakeExecutor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'completed');assert.equal(result.executions.filter(e=>e.role==='coder').length,5);
  assert.equal(result.executions.filter(e=>e.role==='reviewer').length,1);assert.equal(result.budget.planned_repair_allowance,1);
  assert.equal(result.budget.phases.find(p=>p.name==='solver').max_executions,5);
  assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='execute_r'&&t.result.error?.includes('allowance')));
});
test('repair receives actual reviewer execution and stale earlier-round review evidence cannot grant pass', async () => {
  const revise={...review,verdict:'revise',summary:'Correct implementation and execute again',issues:[{severity:'major',description:'Implementation issue',correction:'Use checked method'}],checks:[{name:'implementation',passed:false,evidence:'e2'}]};
  const stale={...review,checked_evidence_ids:['e3'],independent_check_evidence_ids:['e2']};
  const final={...review,checked_evidence_ids:['e3'],independent_check_evidence_ids:['e4'],checks:[{name:'corrected calculation',passed:true,evidence:'e4'}]};
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',answer),tool('execute_r',{code:'REVIEWER_CHECK_CODE',purpose:'independent check'}),tool('submit_review',revise),tool('execute_r',{code:'repaired-code',purpose:'repair'}),tool('submit_answer',{...answer,evidence_ids:['e3']}),tool('submit_review',stale),tool('execute_r',{code:'fresh-rereview-code',purpose:'rereview'}),tool('submit_review',final)];
  const calls=[];const result=await runScientificAnalysis('Calculate sample size',{workflowMode:'multi',executor:fakeExecutor,transport:async p=>{calls.push(structuredClone(p));return queue.shift();}});
  assert.equal(result.scientificStatus,'completed');assert.equal(result.candidates.length,2);
  assert.ok(JSON.stringify(calls[5].messages).includes('REVIEWER_CHECK_CODE'));assert.ok(JSON.stringify(calls[5].messages).includes('verification_execution_evidence'));
  assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='submit_review'&&t.result.issues?.some(i=>i.includes('earlier-round'))));
  const staleFeedback=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_review'&&t.result.issues?.some(i=>i.includes('earlier-round'))).result;
  assert.deepEqual(staleFeedback.allowed_evidence_ids,{checked_evidence_ids:['e3'],independent_check_evidence_ids:[]});
  assert.deepEqual(result.verification.rounds.map(r=>r.precheck_evidence_ids),[['e2'],['e4']]);
  assert.deepEqual(result.budget.phases.filter(p=>p.name==='repair'||p.name==='rereview').map(p=>p.name),['repair','rereview']);
});
test('artifact bytes remain in records while model tool and role handoff receive only actual metadata', async () => {
  const bytes='ZmFrZS1iaW5hcnktYXJ0aWZhY3Q=';
  const executor={...fakeExecutor,executeRCode:async code=>({...await fakeExecutor.executeRCode(code),output_files:[{artifact_id:code==='coder-code'?'a1':'check-a2',name:'sensitivity.csv',size:20,type:'csv',mime_type:'text/csv',sha256:'0'.repeat(64),read_path:'/readonly/sensitivity.csv',path:'/exports/immutable.csv',content_base64:bytes}]})};
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation plus table'}),tool('submit_answer',answer),tool('execute_r',{code:'review-code',purpose:'check'}),tool('submit_review',review)];
  const calls=[];const result=await runScientificAnalysis('Calculate and provide a sensitivity table',{workflowMode:'multi',executor,transport:async p=>{calls.push(structuredClone(p));return queue.shift();}});
  assert.equal(result.scientificStatus,'completed');assert.equal(result.outputFiles.length,1);assert.equal(result.outputFiles[0].content_base64,bytes);assert.equal(result.outputFiles[0].execution_id,'e1');
  assert.equal(JSON.stringify(calls).includes(bytes),false);assert.equal(JSON.stringify(result.trace).includes(bytes),false);
  assert.equal(JSON.stringify(calls[3].messages).includes('/readonly/sensitivity.csv'),false);assert.ok(JSON.stringify(calls[4].messages).includes('/readonly/sensitivity.csv'));
});
test('the final permitted model call may execute a real tool even when no submission call remains', async () => {
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'last permitted tool call'})];
  const result=await runScientificAnalysis('Calculate sample size',{maxModelCalls:2,executor:fakeExecutor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'budget_exhausted');assert.equal(result.executions.length,1);assert.equal(result.executions[0].success,true);
});
test('a planner cannot claim missing inputs without identifying them and focused questions', async () => {
  const queue=[tool('submit_design',{...plan,ready:false}),tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',answer)];
  const result=await runScientificAnalysis('Calculate the supplied design',{executor:fakeExecutor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'completed');assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='submit_design'&&t.result.accepted===false));
});
test('actual R blind verification and bounded repair retain the failed candidate and execute new checks', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'power-orchestration-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});
  const fixturePlan={...plan,calculation_type:'other',method:'executable_arithmetic_fixture',estimand:'2+2; orchestration fixture only'};
  const candidate=(value,id)=>({...answer,summary:'Actual arithmetic fixture',method:'executable_arithmetic_fixture',results:[{metric:'arithmetic_check',value,unit:'unitless'}],evidence_ids:[id]});
  const code=expression=>`value <- ${expression};cat(jsonlite::toJSON(list(results=list(list(metric="arithmetic_check",value=value,unit="unitless"))),auto_unbox=TRUE,digits=15),"\\n")`;
  const revise={...review,verdict:'revise',summary:'The executed candidate used the wrong operand',issues:[{severity:'major',description:'Candidate uses 2+3',correction:'Implement the supplied 2+2'}],checks:[{name:'direct arithmetic',passed:false,evidence:'e2'}]};
  const final={...review,checked_evidence_ids:['e3'],independent_check_evidence_ids:['e4'],checks:[{name:'recomputed arithmetic',passed:true,evidence:'e4'}]};
  const queue=[tool('submit_design',fixturePlan),tool('execute_r',{code:code('2+3'),purpose:'erroneous fixture'}),tool('submit_answer',candidate(5,'e1')),tool('execute_r',{code:code('sum(c(2,2))'),purpose:'blind separately specified check'}),tool('submit_review',revise),tool('execute_r',{code:code('2+2'),purpose:'actual repair'}),tool('submit_answer',candidate(4,'e3')),tool('execute_r',{code:code('sum(rep(2,2))'),purpose:'fresh blind rereview'}),tool('submit_review',final)];
  try {
    const result=await runScientificAnalysis('Evaluate 2+2 for an orchestration test; no scientific-accuracy claim.',{workflowMode:'multi',executor,transport:async()=>queue.shift()});
    assert.equal(result.scientificStatus,'completed');assert.equal(result.candidates[0].answer.results[0].value,5);assert.equal(result.results[0].value,4);
    assert.deepEqual(result.executions.map(e=>e.role),['coder','reviewer','coder','reviewer']);assert.ok(result.executions.every(e=>e.success&&e.computed));
    assert.deepEqual(result.verification.rounds.map(r=>r.precheck_evidence_ids),[['e2'],['e4']]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('bounded direct-source reads share receipt evidence and cannot exceed their own global allowance', async () => {
  const url='https://official.example/method.pdf',content='A provider-extracted PDF excerpt; completeness is not asserted.';
  const cited={...answer,citations:[{title:'Official method',url,supports:'Method argument conventions'}]};
  const queue=[tool('read_source',{url}),tool('submit_design',plan),tool('read_source',{url}),tool('execute_r',{code:'coder-code',purpose:'documented calculation'}),tool('submit_answer',cited)];
  let reads=0;const calls=[];
  const result=await runScientificAnalysis('Use the supplied scientific inputs',{maxSourceReads:1,executor:fakeExecutor,readSource:async u=>{reads++;return{provider:'extract-fixture',results:[{title:'Official method',url:u,content,source_type:'allowed_primary_domain',content_scope:'provider_excerpt',truncation_scope:'Local excerpt cap only; provider completeness unknown.'}]};},transport:async p=>{calls.push(structuredClone(p));return queue.shift();}});
  assert.equal(result.scientificStatus,'completed');assert.equal(reads,1);assert.equal(result.budget.used.source_reads,1);
  assert.equal(result.sources[0].content_scope,'provider_excerpt');assert.ok(result.sources[0].truncation_scope.includes('completeness unknown'));
  assert.ok(calls[0].tools.some(t=>t.name==='read_source'));assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='read_source'&&t.result.error?.includes('exhausted')));
});
test('a model cannot claim an invented or earlier-candidate artifact as an accepted output', async () => {
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',{...answer,artifact_claims:[{artifact_id:'invented-plot',purpose:'Power curve'}]})];
  const result=await runScientificAnalysis('Calculate sample size',{executor:fakeExecutor,maxModelCalls:3,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'budget_exhausted');assert.equal(result.outputFiles.length,0);
  assert.ok(result.trace.some(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.issues?.some(i=>i.includes('Artifact claim'))));
});
test('multi precheck requests the blind worker scope and exposes artifacts only after it completes', async () => {
  const workerPhases=[];const executor={...fakeExecutor,executeRCode:async(code,opts)=>{workerPhases.push(opts.phase);return fakeExecutor.executeRCode(code);}};
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',answer),tool('execute_r',{code:'precheck-code',purpose:'blind check'}),tool('execute_r',{code:'comparison-code',purpose:'post-reveal comparison'}),tool('submit_review',{...review,independent_check_evidence_ids:['e2','e3']})];
  const result=await runScientificAnalysis('Calculate sample size',{workflowMode:'multi',maxRepairs:0,executor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'completed');assert.deepEqual(workerPhases,['solver','blind_verification','verification']);
  assert.equal(result.executions[1].worker_phase,'blind_verification');assert.equal(result.executions[2].worker_phase,'verification');
});
test('a failed deterministic reference enters required verification and repair rather than being accepted or discarded', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'power-reference-repair-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});
  const specified={...plan,estimand:'Standardized difference in two independent normal groups',parameters:[{name:'Cohen d',value:.5,unit:'standardized mean difference',source:'user'}],assumptions:['Two independent normal groups','Common SD','No attrition']};
  const code=halve=>`n <- ceiling(stats::power.t.test(delta=.5,sd=1,sig.level=.05,power=.8,type="two.sample",alternative="two.sided",strict=TRUE)$n${halve?'/2':''});cat(jsonlite::toJSON(list(results=list(list(metric="sample_size",value=n,unit="participants_per_group"))),auto_unbox=TRUE,digits=15),"\\n")`;
  const wrong={...answer,results:[{metric:'sample_size',value:32,unit:'participants_per_group'}]};
  const revise={...review,verdict:'revise',independent_check_evidence_ids:['e3'],issues:[{severity:'major',description:'Candidate incorrectly halves the group requirement',correction:'Implement the declared two-group inversion'}],checks:[{name:'inversion',passed:false,evidence:'e3'}]};
  const final={...review,checked_evidence_ids:['e4'],independent_check_evidence_ids:['e6'],checks:[{name:'inversion',passed:true,evidence:'e6'}]};
  const queue=[tool('submit_design',specified),tool('execute_r',{code:code(true),purpose:'erroneous halving regression fixture'}),tool('submit_answer',wrong),tool('execute_r',{code:code(false),purpose:'blind declared-spec check'}),tool('submit_review',revise),tool('execute_r',{code:code(false),purpose:'executed repair'}),tool('submit_answer',{...answer,evidence_ids:['e4']}),tool('execute_r',{code:code(false),purpose:'fresh declared-spec rereview'}),tool('submit_review',final)];
  try{
    const result=await runScientificAnalysis('Two-sided independent normal groups,commonSD,d=.5,alpha=.05,target.8,equalallocation,noattrition.',{workflowMode:'multi',executor,transport:async()=>queue.shift()});
    assert.equal(result.scientificStatus,'completed');assert.equal(result.candidates[0].referenceAudit.status,'failed');assert.equal(result.candidates[0].answer.results[0].value,32);
    assert.equal(result.referenceAudit.status,'passed');assert.equal(result.results[0].value,64);assert.equal(result.executions.length,6);
    assert.deepEqual(result.verification.rounds.map(r=>r.precheck_evidence_ids),[['e3'],['e6']]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('provider document text is retained to the explicit global cap and credit/cache receipts survive', async () => {
  const url1='https://official.example/long-method.pdf',url2='https://official.example/another-method.pdf';
  const first='A'.repeat(49000)+'METHOD_AT_END'+'B'.repeat(987),second='C'.repeat(50000);
  const queue=[tool('read_source',{url:url1}),tool('read_source',{url:url2}),tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',answer)];
  const result=await runScientificAnalysis('Use the declared design',{maxSourceChars:75000,executor:fakeExecutor,readSource:async url=>({provider:'extract-fixture',provider_usage:{credits:1},cache_hit:url===url2,results:[{title:'Document',url,content:url===url1?first:second,content_scope:'provider_extracted_document_text',content_truncated:false}]}),transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'completed');assert.equal(result.sources[0].content.length,50000);assert.ok(result.sources[0].content.includes('METHOD_AT_END'));
  assert.equal(result.sources[1].content.length,25000);assert.equal(result.sources[1].content_truncated,true);assert.equal(result.budget.used.source_chars,75000);
  assert.deepEqual(result.source_requests.map(r=>r.provider_usage),[{credits:1},{credits:1}]);assert.deepEqual(result.source_requests.map(r=>r.cache_hit),[false,true]);
  assert.equal(result.trace.find(t=>t.type==='source_read').results.provider_usage.credits,1);
});
test('a final model submission returned after the wall deadline cannot be accepted', async () => {
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',answer)];let index=0;
  const result=await runScientificAnalysis('Calculate sample size',{deadlineMs:1000,executor:fakeExecutor,transport:async(_p,{signal})=>{assert.ok(signal);if(index++===2)await new Promise(r=>setTimeout(r,1050));return queue.shift();}});
  assert.equal(result.scientificStatus,'budget_exhausted');assert.equal(result.success,false);assert.equal(result.executions.length,1);assert.equal(result.usage.input_tokens,3);
});

test('requested independent review is distinguished from an actually reached review and cache credits are not counted twice', async () => {
  const unresolved={...plan,ready:false,missing_information:['effect'],clarification_questions:['What effect is specified?']};
  const result=await runScientificAnalysis('Incomplete design',{workflowMode:'multi',executor:fakeExecutor,transport:async()=>tool('submit_design',unresolved)});
  assert.equal(result.verification.requested_independent_agent_review,true);assert.equal(result.verification.independent_agent_review,false);
  assert.equal(result.verification.reviewer_started,false);assert.equal(result.verification.successful_precheck_executed,false);assert.equal(result.verification.review_accepted,false);
  const queue=[tool('read_source',{url:'https://official.example/docs'}),tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'calculation'}),tool('submit_answer',answer)];
  const cached=await runScientificAnalysis('Calculate the design',{executor:fakeExecutor,readSource:async url=>({provider:'cache-fixture',cache_hit:true,provider_usage:{credits:1},results:[{url,content:'Previously retrieved primary-source excerpt'}]}),transport:async()=>queue.shift()});
  assert.equal(cached.scientificStatus,'completed');assert.deepEqual(cached.source_requests[0].provider_usage,{credits:1});assert.deepEqual(cached.source_requests[0].additional_provider_usage,{credits:0});
  assert.ok(cached.source_requests[0].billing_scope.includes('no additional'));
});

test('custom stdout keys require actual fresh recomputation and results-row feedback in both modes', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'power-result-feedback-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});
  const task={...plan,calculation_type:'other',method:'arithmetic_sum',estimand:'sum of supplied values',sidedness:'not-applicable',alpha:null,target_power:null,sample_size_unit:'items'};
  const rows=[{metric:'computed_sum',value:41,unit:'items'}];
  const proposed={...answer,summary:'Sum of the supplied values',method:task.method,results:rows,evidence_ids:['e1']};
  const calculate='input_values <- c(11,13,17); computed_value <- sum(input_values)';
  const custom=calculate+'; cat(jsonlite::toJSON(list(computed_sum=computed_value),auto_unbox=TRUE,digits=15),"\\n")';
  const corrected='stopifnot(!exists("computed_value")); '+calculate+'; quantity_name <- "computed_sum"; quantity_unit <- "items"; result_rows <- list(list(metric=quantity_name,value=as.numeric(computed_value),unit=quantity_unit)); cat("POWER_AGENT_RESULT=",jsonlite::toJSON(list(results=result_rows),auto_unbox=TRUE,digits=15),"\\n",sep="")';
  const check='input_values <- c(11,13,17); computed_value <- Reduce(`+`,input_values); result_rows <- list(list(metric="computed_sum",value=as.numeric(computed_value),unit="items")); cat(jsonlite::toJSON(list(results=result_rows),auto_unbox=TRUE,digits=15),"\\n")';
  try {
    const descriptions=[];
    for(const mode of ['single','multi']) {
      const queue=[tool('submit_design',task),tool('execute_r',{code:custom,purpose:'Compute sum; incompatible custom JSON'}),tool('submit_answer',proposed),tool('execute_r',{code:corrected,purpose:'Fresh recomputation with proper serialization'}),tool('submit_answer',{...proposed,evidence_ids:['e2']}),tool('execute_r',{code:check,purpose:'Separately computed sum check'}),tool('submit_review',{...review,checked_evidence_ids:['e2'],independent_check_evidence_ids:['e3']})];
      const requests=[];
      const result=await runScientificAnalysis('Sum the values 11,13,17',{workflowMode:mode,verificationPolicy:'required',executor,transport:async request=>{requests.push(structuredClone(request));return queue.shift();}});
      assert.equal(result.scientificStatus,'completed');assert.equal(result.iterations,7);assert.equal(result.executions.length,3);
      assert.equal(result.executions[0].success,true);assert.equal(result.executions[0].computed,null);assert.deepEqual(result.executions[1].computed.results,rows);assert.deepEqual(result.answer.evidence_ids,['e2']);
      const feedback=result.trace.find(t=>t.type==='tool_result'&&t.tool==='execute_r').result;
      assert.equal(feedback.success,true);assert.equal(feedback.computed_result_diagnostic.status,'invalid_numerical_output');assert.ok(feedback.computed_result_diagnostic.expected_results_schema);
      assert.match(feedback.computed_result_diagnostic.recovery,/Recompute the actual variables/);assert.match(feedback.computed_result_diagnostic.recovery,/Do not manually insert printed numbers/);
      const rejected=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.accepted===false);
      assert.ok(rejected.result.issues.some(issue=>issue.startsWith('Unverified result:')));
      assert.equal(result.trace.filter(t=>t.type==='tool_result'&&t.tool==='execute_r').at(-1).result.computed_result_diagnostic.status,'accepted');
      assert.equal(result.capabilities.search_sources,false);assert.equal(result.capabilities.read_source,false);assert.match(result.capabilities.fresh_execution,/read_path/);
      assert.equal(result.capabilities.r_network.enforcement,executor.restrictedLinux?'restricted_linux_worker':'not_certified_by_harness');
      for(const request of [requests[1],requests[5]]) {
        const description=request.tools.find(t=>t.name==='execute_r').description;
        assert.match(description,/jsonlite::toJSON\(list\(results = result_rows\)/);assert.match(description,/value = as.numeric\(computed_value\)/);
        assert.match(description,/disable network access/);assert.match(description,/search_sources or read_source/);assert.match(description,/immutable read_path/);descriptions.push(description);
      }
    }
    assert.ok(descriptions.every(description=>description===descriptions[0]));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('solver failure cannot claim independent numerical review that never started', async () => {
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'custom-output',purpose:'Missing results schema'}),tool('submit_answer',answer)];
  const result=await runScientificAnalysis('Calculate the supplied task',{workflowMode:'multi',maxModelCalls:5,maxRepairs:0,executor:{...fakeExecutor,executeRCode:async()=>({success:true,exitCode:0,output:'{"custom_number":64}'})},transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'budget_exhausted');assert.equal(result.verification.requested_independent_agent_review,true);
  for(const field of ['reviewer_started','numerical_check_performed','independent_agent_review','review_accepted','current_review_accepted','review_passed']) assert.equal(result.verification[field],false,field);
  assert.equal(result.executions.length,1);assert.equal(result.executions[0].computed,null);
});

test('mode defaults disclose expanded multi capacity and explicit matched caps retain reservations', async () => {
  for(const mode of ['single','multi']) {
    const run=async explicit=>{
      const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',answer),tool('execute_r',{code:'review-code',purpose:'numerical check'}),tool('submit_review',review)];
      return runScientificAnalysis('Calculate the supplied design',{workflowMode:mode,verificationPolicy:'required',executor:fakeExecutor,transport:async()=>queue.shift(),...explicit});
    };
    const standard=await run({});assert.equal(standard.scientificStatus,'completed');
    assert.equal(standard.budget.global.maxModelCalls,mode==='multi'?26:18);assert.equal(standard.budget.global.maxExecutions,mode==='multi'?12:8);
    assert.equal(standard.budget.profile.verificationMaxCalls,5);assert.equal(standard.budget.profile.verificationMaxExecutions,3);
    assert.equal(standard.budget.profile.repairMaxCalls,4);assert.equal(standard.budget.profile.repairMaxExecutions,1);
    const solver=standard.budget.phases.find(p=>p.name==='solver');assert.ok(solver.reservation.calls>=2);assert.ok(solver.reservation.executions>=1);
    assert.ok(solver.max_model_calls<standard.budget.global.maxModelCalls);assert.ok(solver.max_executions<standard.budget.global.maxExecutions);
    const explicit={maxModelCalls:18,maxExecutions:8,budgetProfile:{...sharedProfile,verificationMaxCalls:4,verificationMaxExecutions:2}};
    const matched=await run(explicit);assert.equal(matched.scientificStatus,'completed');
    assert.equal(matched.budget.global.maxModelCalls,18);assert.equal(matched.budget.global.maxExecutions,8);
    assert.equal(matched.budget.profile.verificationMaxCalls,4);assert.equal(matched.budget.profile.verificationMaxExecutions,2);
    assert.equal(matched.budget.profile.repairMaxCalls,3);assert.equal(matched.budget.profile.repairMaxExecutions,1);
    for(const phase of matched.budget.phases) assert.ok(phase.max_executions>=0&&phase.max_model_calls>=0);
  }
});

test('strict review interface rejects JSON-string checks and returns its typed schema in both modes', async () => {
  for(const mode of ['single','multi']) {
    const malformed={...review,checks:JSON.stringify({checks:review.checks,checked_evidence_ids:review.checked_evidence_ids,independent_check_evidence_ids:review.independent_check_evidence_ids})};
    const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',answer),tool('execute_r',{code:'review-code',purpose:'verification'}),tool('submit_review',malformed),tool('submit_review',review)];
    const requests=[];const result=await runScientificAnalysis('Calculate the supplied design',{workflowMode:mode,verificationPolicy:'required',executor:fakeExecutor,transport:async request=>{requests.push(structuredClone(request));return queue.shift();}});
    assert.equal(result.scientificStatus,'completed');assert.equal(result.iterations,6);
    const definition=requests[3].tools.find(t=>t.name==='submit_review');assert.equal(definition.strict,true);assert.equal(definition.input_schema.properties.checks.type,'array');
    assert.match(definition.description,/never a JSON string/);assert.match(requests[3].system,/separate top-level string arrays/);
    const rejected=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_review'&&t.result.accepted===false);
    assert.equal(typeof rejected.submitted_input.checks,'string');assert.equal(rejected.result.tool,'submit_review');
    assert.deepEqual(rejected.result.expected_input_schema,definition.input_schema);assert.ok(JSON.stringify(rejected.result.expected_input_schema).length<5000);
    assert.ok(rejected.result.issues.includes('value.checks must be array'));
    assert.deepEqual(rejected.result.allowed_evidence_ids,{checked_evidence_ids:['e1'],independent_check_evidence_ids:['e2']});
    assert.ok(Array.isArray(result.review.checks));assert.equal(result.verification.review_passed,true);
  }
});

test('review role-mixed evidence remains rejected while feedback lists current eligible IDs', async () => {
  for(const mode of ['single','multi']) {
    const mixed={...review,checked_evidence_ids:['e2'],independent_check_evidence_ids:['e1']};
    const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',answer),tool('execute_r',{code:'review-code',purpose:'verification'}),tool('submit_review',mixed),tool('submit_review',review)];
    const result=await runScientificAnalysis('Calculate the supplied design',{workflowMode:mode,verificationPolicy:'required',executor:fakeExecutor,transport:async()=>queue.shift()});
    assert.equal(result.scientificStatus,'completed');
    const rejected=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_review'&&t.result.accepted===false);
    assert.ok(rejected.result.issues.some(issue=>issue.includes('coder evidence outside')));assert.ok(rejected.result.issues.some(issue=>issue.includes('missing, failed, or earlier-round')));
    assert.deepEqual(rejected.result.allowed_evidence_ids,{checked_evidence_ids:['e1'],independent_check_evidence_ids:['e2']});
    assert.deepEqual(rejected.submitted_input.checked_evidence_ids,['e2']);assert.deepEqual(rejected.submitted_input.independent_check_evidence_ids,['e1']);
    assert.deepEqual(result.review.checked_evidence_ids,['e1']);assert.deepEqual(result.review.independent_check_evidence_ids,['e2']);
  }
});

test('renaming a computed metric fails and exact execution triples are returned without row repair', async () => {
  for(const mode of ['single','multi']) {
    const renamed={...answer,results:[{...answer.results[0],metric:'renamed sample-size label'}]};
    const queue=[tool('submit_design',plan),tool('execute_r',{code:'coder-code',purpose:'candidate'}),tool('submit_answer',renamed),tool('submit_answer',answer),tool('execute_r',{code:'review-code',purpose:'verification'}),tool('submit_review',review)];
    const requests=[];const result=await runScientificAnalysis('Calculate the supplied design',{workflowMode:mode,verificationPolicy:'required',executor:fakeExecutor,transport:async request=>{requests.push(structuredClone(request));return queue.shift();}});
    assert.equal(result.scientificStatus,'completed');assert.equal(result.executions.length,2);
    const rejected=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.accepted===false);
    assert.ok(rejected.result.issues.some(issue=>issue.startsWith('Unverified result: renamed')));
    assert.deepEqual(rejected.result.cited_execution_evidence,[{evidence_id:'e1',computed_results:answer.results,omitted_result_rows:0}]);
    assert.equal(rejected.submitted_input.results[0].metric,'renamed sample-size label');assert.deepEqual(result.results,answer.results);
    assert.match(requests[1].tools.find(t=>t.name==='submit_answer').description,/metric and unit strings must match byte for byte/);
  }
});

test('actual file-only CSV and plot evidence require their producing ID alongside numeric evidence', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'power-artifact-citation-test-'));await fs.chmod(root,0o711);
  const actual=new ScientificRExecutor({root});
  const task={...plan,calculation_type:'other',method:'arithmetic_sum',sidedness:'not-applicable',alpha:null,target_power:null,estimand:'sum of supplied values',sample_size_unit:'items'};
  const rows=[{metric:'computed_sum',value:10,unit:'items'}];
  const numeric='computed_value <- sum(c(2,3,5)); cat(jsonlite::toJSON(list(results=list(list(metric="computed_sum",value=computed_value,unit="items"))),auto_unbox=TRUE,digits=15),"\\n")';
  const files='x <- c(2,3,5); write.csv(data.frame(x=x),"values.csv",row.names=FALSE); png("values.png",width=480,height=360); plot(seq_along(x),x); dev.off(); cat("Files produced\\n")';
  try {
    for(const mode of ['single','multi']) {
      const captured=[];const executor={restrictedLinux:actual.restrictedLinux,createWorkspace:()=>actual.createWorkspace(),executeRCode:async(code,options)=>{const result=await actual.executeRCode(code,options);captured.push(result);return result;}};
      let step=0;
      const candidate=ids=>({...answer,method:task.method,summary:'Computed sum with CSV and plot',results:rows,evidence_ids:ids,artifact_claims:(captured[2]?.output_files||[]).map(file=>({artifact_id:file.artifact_id,purpose:'Requested output'}))});
      const result=await runScientificAnalysis('Sum 2,3,5 and produce a CSV and plot',{workflowMode:mode,verificationPolicy:'required',executor,transport:async()=>{
        switch(++step) {
          case 1:return tool('submit_design',task);
          case 2:return tool('execute_r',{code:'write.csv(data.frame(x=1),"failed.csv",row.names=FALSE); stop("deliberate failure")',purpose:'Failed file generation'});
          case 3:return tool('execute_r',{code:numeric,purpose:'Numerical calculation'});
          case 4:return tool('execute_r',{code:files,purpose:'Generate CSV and plot without numeric JSON'});
          case 5:return tool('submit_answer',candidate(['e2']));
          case 6:return tool('submit_answer',{...candidate(['e2','e3']),artifact_claims:[{artifact_id:'invented-output',purpose:'Nonexistent output'}]});
          case 7:return tool('submit_answer',candidate(['e1','e2','e3']));
          case 8:return tool('submit_answer',candidate(['e2','e3']));
          case 9:return tool('execute_r',{code:numeric,purpose:'Current-round numerical verification'});
          case 10:return tool('submit_review',{...review,checked_evidence_ids:['e2','e3'],independent_check_evidence_ids:['e4']});
          default:throw new Error('Unexpected model call');
        }
      }});
      assert.equal(result.scientificStatus,'completed');assert.equal(result.executions.length,4);assert.equal(result.executions[0].success,false);assert.equal(result.executions[0].output_files.length,0);
      assert.equal(result.executions[2].success,true);assert.equal(result.executions[2].computed,null);assert.equal(result.executions[2].output_files.length,2);
      const fileFeedback=result.trace.find(t=>t.type==='tool_result'&&t.tool==='execute_r'&&t.result.evidence_id==='e3').result;
      assert.equal(fileFeedback.computed_result_diagnostic.status,'artifacts_only');assert.equal(fileFeedback.computed_result,null);assert.match(fileFeedback.computed_result_diagnostic.recovery,/no numerical formatting rerun/);
      const rejected=result.trace.filter(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.accepted===false);assert.equal(rejected.length,3);
      assert.ok(rejected[0].result.issues.some(issue=>issue.includes('Artifact claim')));assert.deepEqual(rejected[0].submitted_input.evidence_ids,['e2']);
      const expected=result.executions[2].output_files.map(file=>({artifact_id:file.artifact_id,producing_evidence_id:'e3',name:file.name,sha256:file.sha256}));
      for(const feedback of rejected) assert.deepEqual(feedback.result.available_artifact_evidence,expected);
      assert.ok(rejected[1].result.issues.some(issue=>issue.includes('invented-output')));assert.ok(rejected[2].result.issues.some(issue=>issue.includes('missing, failed')));
      assert.deepEqual(result.answer.evidence_ids,['e2','e3']);assert.equal(result.outputFiles.length,2);
      for(const file of result.outputFiles) {const bytes=await fs.readFile(file.path);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);assert.equal(bytes.toString('base64'),file.content_base64);assert.equal(file.execution_id,'e3');}
      assert.match((await fs.readFile(result.outputFiles.find(file=>file.type==='csv').path)).toString(),/2\n3\n5/);
      assert.equal((await fs.readFile(result.outputFiles.find(file=>file.type==='png').path)).subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('repaired candidates cannot claim stale artifacts and feedback lists only current captures', async () => {
  const revise={...review,verdict:'revise',issues:[{severity:'major',description:'Recompute candidate',correction:'Execute the revised implementation'}],checks:[{name:'implementation',passed:false,evidence:'e2'}]};
  const old={artifact_id:'old-artifact',name:'old.csv',sha256:'1'.repeat(64)},fresh={artifact_id:'fresh-artifact',name:'fresh.csv',sha256:'2'.repeat(64)};
  const executor={...fakeExecutor,executeRCode:async code=>({...await fakeExecutor.executeRCode(code),output_files:code==='initial-code'?[old]:code==='repair-code'?[fresh]:[]})};
  const initial={...answer,artifact_claims:[{artifact_id:old.artifact_id,purpose:'Initial output'}]};
  const repaired={...answer,evidence_ids:['e3'],artifact_claims:[{artifact_id:fresh.artifact_id,purpose:'Repaired output'}]};
  const queue=[tool('submit_design',plan),tool('execute_r',{code:'initial-code',purpose:'Candidate'}),tool('submit_answer',initial),tool('execute_r',{code:'review-code',purpose:'Review'}),tool('submit_review',revise),tool('execute_r',{code:'repair-code',purpose:'Repair'}),tool('submit_answer',{...repaired,artifact_claims:initial.artifact_claims}),tool('submit_answer',repaired),tool('execute_r',{code:'fresh-review-code',purpose:'Review revised candidate'}),tool('submit_review',{...review,checked_evidence_ids:['e3'],independent_check_evidence_ids:['e4']})];
  const result=await runScientificAnalysis('Calculate and retain revised output',{workflowMode:'multi',executor,transport:async()=>queue.shift()});
  assert.equal(result.scientificStatus,'completed');assert.equal(result.candidates.length,2);
  const rejection=result.trace.find(t=>t.type==='tool_result'&&t.tool==='submit_answer'&&t.result.issues?.some(issue=>issue.includes(old.artifact_id)));
  assert.deepEqual(rejection.result.available_artifact_evidence,[{artifact_id:fresh.artifact_id,producing_evidence_id:'e3',name:fresh.name,sha256:fresh.sha256}]);
  assert.equal(result.outputFiles.length,1);assert.equal(result.outputFiles[0].artifact_id,fresh.artifact_id);assert.equal(result.executions[0].output_files[0].artifact_id,old.artifact_id);
});
