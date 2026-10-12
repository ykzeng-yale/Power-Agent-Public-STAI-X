import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPooledTReference, pooledTReferenceSpecification } from './scientific-reference-guard.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { runScientificAnalysis, extractComputedResult } from './scientific-harness.js';
import { HARNESS_VERSION } from './model-config.js';

const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: "Cohen's d in two independent normal groups with common variance", hypothesis: 'Two-sided difference in means', method: 'noncentral_t_distribution', alpha: .05, sidedness: 'two-sided', target_power: .9, allocation_ratio: 1, sample_size_unit: 'participants per arm', parameters: [{ name: "Cohen's d (effect size)", value: .5, unit: 'standardized difference', source: 'user' }], assumptions: ['Independent normal groups', 'Common population variance', 'Pooled variance t-test', 'No attrition or loss to follow-up', 'No interim analyses'], missing_information: [], clarification_questions: [], scientific_notes: [] };
const answer = (n, power, previous) => ({ summary: 'Candidate calculation', method: 'noncentral_t_distribution', results: [{ metric: 'Minimum participants per arm', value: n, unit: 'integer' }, { metric: 'Total participants (both arms)', value: 2*n, unit: 'integer' }, ...(power == null ? [] : [{ metric: 'Achieved power at n', value: power, unit: 'probability' }]), ...(previous == null ? [] : [{ metric: 'Power at n-1', value: previous, unit: 'probability' }])], assumptions: [], limitations: [], evidence_ids: ['e1'], simulation: null, citations: [] });
async function withExecutor(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'power-reference-test-')); await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root }); const workspace = await executor.createWorkspace();
  const execute = async (input, role) => { assert.equal(role, 'reference_check'); const value = await executor.executeRCode(input.code, { workspace }); return { success: value.success, evidence_id: 'reference-evidence', stdout: value.output }; };
  try { return await callback(executor, execute); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
const tool = (name,input) => ({ content: [{ type:'tool_use', id: name, name,input }], usage: {}, stop_reason:'tool_use' });

test('actual R rejects factor-two n=44 and accepts exact minimum n=86 with preceding check', async () => withExecutor(async (_executor,execute) => {
  const bad = await checkPooledTReference(plan, answer(44,.9065,.8999), execute);
  assert.equal(bad.status,'failed'); assert.equal(bad.reference.minimum_per_arm,86); assert.equal(bad.reference.participants_total,172);
  assert.ok(bad.reference.power_at_candidate < .65); assert.equal(bad.checks.find(c=>c.name==='candidate_minimum_per_arm').passed,false);
  const good = await checkPooledTReference(plan, answer(86,.9032,.8999), execute);
  assert.equal(good.status,'passed'); assert.equal(good.reference.minimum_per_arm,86);
  assert.ok(Math.abs(good.reference.power_at_minimum-.90322998)<1e-7); assert.ok(good.reference.power_preceding<.9);
}));
test('80 to 90 percent target revisions use current plan; 64 is not accepted for .90', async () => withExecutor(async (_executor,execute) => {
  assert.equal((await checkPooledTReference({...plan,target_power:.8},answer(64,.8015,.7952),execute)).status,'passed');
  const revised = await checkPooledTReference(plan,answer(64),execute); assert.equal(revised.status,'failed'); assert.equal(revised.specification.target_power,.9);
}));
test('explicit Cohen d names exclude incidental nuisance-unit mentions and ambiguous aliases fail closed', async () => withExecutor(async (_executor,execute) => {
  // Scientific fields and numerical rows replay the saved 2.1.1 browser case.
  const observedPlan={...plan,target_power:.8,method:'two_sample_t (pooled variance, equal allocation)',parameters:[
    {name:'Cohen d (effect size)',value:.5,unit:'standardized difference in means',source:'user'},
    {name:'Common standard deviation',value:1,unit:'implied by Cohen d definition',source:'explicit_assumption'}
  ]};
  const observed=answer(64,.801459,.795167);
  observed.results[0].unit='participants_per_arm';observed.results[1].unit='participants_total';
  const audit=await checkPooledTReference(observedPlan,observed,execute);
  assert.equal(audit.status,'passed');assert.equal(audit.specification.standardized_effect,.5);
  assert.equal(audit.reference.minimum_per_arm,64);assert.equal(audit.reference.participants_total,128);
  for (const name of ['Cohen d','Cohen\'s d (effect size)','Cohen standardized mean difference','standardized mean difference','effect size d','d']) {
    assert.equal(pooledTReferenceSpecification({...plan,parameters:[{name,value:.5,unit:'standardized difference',source:'user'}]}).status,'applicable');
  }
  for (const name of ['Cohen d11','Cohen d (effect size) junk','Cohen d (effect size11)','effect size','d11']) {
    const malformed={name,value:.5,unit:'d',source:'user'};
    for (const parameters of [[malformed],[...observedPlan.parameters,malformed]]) {
      assert.equal((await checkPooledTReference({...observedPlan,parameters},observed,async()=>{throw Error('must not execute malformed effect alias');})).status,'failed');
    }
  }
  for (const value of [.5,.6]) {
    assert.equal((await checkPooledTReference({...observedPlan,parameters:[...observedPlan.parameters,{name:'standardized mean difference',value,unit:'d',source:'user'}]},observed,async()=>{throw Error('must not execute duplicate or conflicting effect aliases');})).status,'failed');
  }
  assert.equal(pooledTReferenceSpecification({...observedPlan,parameters:[observedPlan.parameters[1]]}).status,'failed');
}));
test('literal verbal and underscore n-minus-one aliases reach actual reference math and reject the saved n50 error', async () => withExecutor(async (_executor,execute) => {
  for (const metric of ['Power at n minus 1','power_at_n_minus_1','Previous power at n minus 1)']) {
    const candidate=answer(86,.90322998,.89989408);candidate.results[3].metric=metric;
    assert.equal((await checkPooledTReference(plan,candidate,execute)).status,'passed');
  }
  const observed=answer(50,.938306879414802,.93381381488291);
  observed.results[0]={metric:'minimum_sample_size_per_arm',value:50,unit:'participants_per_arm'};
  observed.results[1]={metric:'total_sample_size',value:100,unit:'participants_total'};
  observed.results[2].metric='achieved_power_at_minimum_n';observed.results[3].metric='power_at_n_minus_1';
  const observedPlan={...plan,parameters:[{name:'Cohen standardized mean difference',value:.5,unit:'d',source:'user'}]};
  const audit=await checkPooledTReference(observedPlan,observed,execute);
  assert.equal(audit.status,'failed');assert.equal(audit.evidence_id,'reference-evidence');
  assert.equal(audit.reference.minimum_per_arm,86);assert.ok(Math.abs(audit.reference.power_at_candidate-.6968934)<1e-7);
  assert.equal(audit.checks.find(check=>check.name==='candidate_minimum_per_arm').passed,false);
  assert.equal(audit.checks.find(check=>check.name==='reported_achieved_power').passed,false);
  for (const metric of ['Power at n minus 11','Power at n minus 1e2','Power at n minus 1junk','Power at n minus 1 plus 1','Power at n minus 1 and plus 1','Power at n minus 1 - 1','Power at n minus 1 / 2','Power at n minus 1 and n+1','Power at n minus 1 and n minus 1','Power at n plus 1','Power at n minus −1','Power at nminus1','Power at nminus11','Power at n minus 1.0']) {
    const bad=answer(86,.90322998,.89989408);bad.results[3].metric=metric;
    assert.equal((await checkPooledTReference(plan,bad,async()=>{throw Error('must not execute malformed verbal offset');})).status,'failed');
  }
}));
test('supported unpaired design is checked; unsupported sidedness/allocation/power requests/clusters are explicit skips', () => {
  assert.equal(pooledTReferenceSpecification({...plan, assumptions:[...plan.assumptions,'Unpaired observations']}).status,'applicable');
  for (const changes of [{sidedness:'one-sided'},{allocation_ratio:2},{calculation_type:'power'},{parameters:[...plan.parameters,{name:'ICC',value:0,unit:'correlation',source:'user'}]},{assumptions:[...plan.assumptions,'Paired observations']},{assumptions:[]},{method:'Welch two-sample t-test'},{method:'two_sample_t normal approximation'}]) assert.equal(pooledTReferenceSpecification({...plan,...changes}).status,'skipped');
  assert.equal(pooledTReferenceSpecification({...plan,parameters:[]}).status,'failed');
  assert.equal(pooledTReferenceSpecification({...plan,method:'one_sample_t via noncentral t',estimand:'Independent normal observations',assumptions:['Independent normal observations','Common SD','No attrition']}).status,'skipped');
  const ambiguous={...plan,method:'noncentral t',estimand:'Independent normal observations',assumptions:['Independent normal observations','Common SD','No attrition'],scientific_notes:[]};
  assert.equal(pooledTReferenceSpecification(ambiguous).status,'skipped');
  assert.equal(pooledTReferenceSpecification({...ambiguous,method:'two_sample_t'}).status,'applicable');
  assert.equal(pooledTReferenceSpecification({...ambiguous,assumptions:[...ambiguous.assumptions,'Two independent groups']}).status,'applicable');
  for (const declaration of ['Non-normal independent groups','Non-normally distributed independent groups','Not normally distributed independent groups','Lognormal independent groups','Log-normally distributed independent groups','Unequal variances','Unequal population variances','Unequal group SDs','Heteroscedastic normal groups']) {
    assert.equal(pooledTReferenceSpecification({...plan,assumptions:[...plan.assumptions,declaration]}).status,'skipped');
  }
});
test('all reported achieved powers and total units are checked, including unfamiliar power labels', async () => withExecutor(async (_executor,execute) => {
  const wrongPower = answer(86); wrongPower.results.push({metric:'Observed statistical power',value:.999,unit:'probability'});
  assert.equal((await checkPooledTReference(plan,wrongPower,execute)).status,'failed');
  const wrongTotal = answer(86); wrongTotal.results[1].value=86;
  assert.equal((await checkPooledTReference(plan,wrongTotal,execute)).status,'failed');
  const onlyN = {...answer(86),results:[{metric:'sample_size',value:86,unit:'participants_per_group'}]};
  assert.equal((await checkPooledTReference(plan,onlyN,execute)).status,'passed');
}));
test('independent selected and preceding power rows tolerate floating-point differences while checking every value', async () => withExecutor(async (_executor,execute) => {
  const reference = await checkPooledTReference({...plan,target_power:.8}, answer(64), execute);
  assert.equal(reference.status,'passed');
  const {power_at_candidate:p,power_preceding:previous}=reference.reference;
  const candidate=answer(64,p,previous);
  candidate.results.push({metric:'Achieved power at n (independent pt)',value:p-6e-16,unit:'probability'},
    {metric:'Power at n-1 (independent pt)',value:previous-1e-16,unit:'probability'});
  const before=JSON.stringify(candidate);
  const audit=await checkPooledTReference({...plan,target_power:.8},candidate,execute);
  assert.equal(audit.status,'passed'); assert.equal(JSON.stringify(candidate),before);
  assert.equal(audit.checks.find(c=>c.name==='reported_achieved_power').observed.length,2);
  assert.equal(audit.checks.find(c=>c.name==='reported_preceding_power').observed.length,2);
  for(const [index,name] of [[4,'reported_achieved_power'],[5,'reported_preceding_power']]){
    const wrong=structuredClone(candidate); wrong.results[index].value+=.001;
    const rejected=await checkPooledTReference({...plan,target_power:.8},wrong,execute);
    assert.equal(rejected.status,'failed'); assert.equal(rejected.checks.find(c=>c.name===name).passed,false);
    assert.equal(rejected.checks.find(c=>c.name===name).observed.length,2);
  }
}));
test('all repeated power values obey the unchanged inclusive 1e-4 boundary and finite probability range', async () => {
  const p=.90323, previous=.89989;
  const reference={checks:[{name:'candidate_minimum_per_arm',passed:true},{name:'target_achieved',passed:true},{name:'independent_noncentral_t_implementation',passed:true}],minimum_per_arm:86,participants_total:172,power_at_candidate:p,power_at_minimum:p,power_preceding:previous,stats_version:'fixture'};
  const execute=async()=>({success:true,evidence_id:'boundary-fixture',stdout:'POWER_AGENT_REFERENCE_AUDIT='+JSON.stringify(reference)});
  for(const [metric,expected,check]of [['Achieved power at n (second implementation)',p,'reported_achieved_power'],['Power at n-1 (second implementation)',previous,'reported_preceding_power']]){
    const atBoundary=expected+.0001;
    assert.ok(Math.abs(atBoundary-expected)<=.0001);
    const candidate=answer(86,p,previous); candidate.results.push({metric,value:atBoundary,unit:'probability'});
    assert.equal((await checkPooledTReference(plan,candidate,execute)).status,'passed');
    candidate.results.at(-1).value=atBoundary+1e-12;
    const outside=await checkPooledTReference(plan,candidate,execute);
    assert.equal(outside.status,'failed'); assert.equal(outside.checks.find(c=>c.name===check).passed,false);
    for(const value of [NaN,Infinity,-Infinity,null,'0.90323',-Number.MIN_VALUE,1+Number.EPSILON]){
      const wrong=answer(86,p,previous); wrong.results.push({metric,value,unit:'probability'});
      const rejected=await checkPooledTReference(plan,wrong,execute);
      assert.equal(rejected.status,'failed'); assert.equal(rejected.checks.find(c=>c.name===check).passed,false);
    }
  }
});
test('repeated power rows retain unambiguous design labels and exactly unique participant counts', async () => {
  const stop=async()=>{throw Error('ambiguous declarations must fail before reference execution');};
  for(const metric of ['Power at n=86 and n=85','Power at n-1 and n-1','Previous power at n=86']){
    const wrong=answer(86,.90323,.89989); wrong.results.push({metric,value:.90323,unit:'probability'});
    const audit=await checkPooledTReference(plan,wrong,stop);
    assert.equal(audit.status,'failed'); assert.equal(audit.checks[0].name,'declared_power_design_mapping');
  }
  const wrongCount=answer(86,.90323,.89989); wrongCount.results.push({metric:'Selected participants per arm',value:85,unit:'participants per arm'});
  assert.equal((await checkPooledTReference(plan,wrongCount,stop)).status,'failed');
});
test('power.t.test annotations keep continuous diagnostics and selected integer n as participant quantities', async () => withExecutor(async (_executor,execute) => {
  const candidate=answer(64,.8014595579223276,.7951683381233856);
  candidate.results.unshift({metric:'continuous n per group (power.t.test)',value:63.7656101707814,unit:'participants per group'});
  candidate.results[1].metric='required n per group (rounded up; stats::power.t.test)';candidate.results[1].unit='participants per group';
  candidate.results.push({metric:'power at n (manual noncentral t)',value:.801459557922327,unit:'probability'},
    {metric:'power at n-1 (manual noncentral t)',value:.7951683381233854,unit:'probability'},
    {metric:'normal-approx n per group (continuous; power.t.test diagnostic)',value:62.791037874792686,unit:'participants per group'});
  candidate.results[3].metric='power at n (power.t.test)';candidate.results[4].metric='power at n-1 (stats::power.t.test)';
  const before=JSON.stringify(candidate);
  const audit=await checkPooledTReference({...plan,target_power:.8},candidate,execute);
  assert.equal(audit.status,'passed');assert.equal(audit.reference.minimum_per_arm,64);
  assert.equal(audit.checks.find(c=>c.name==='reported_achieved_power').observed.length,2);
  assert.equal(JSON.stringify(candidate),before);
  const countVariant=structuredClone(candidate);countVariant.results[1].metric='selected count (power.t.test)';
  assert.equal((await checkPooledTReference({...plan,target_power:.8},countVariant,execute)).status,'passed');
  // Optional continuous/approximation diagnostics are retained without becoming
  // the chosen integer design or receiving a reference certification.
  assert.equal(candidate.results[0].value,63.7656101707814);assert.equal(candidate.results.at(-1).value,62.791037874792686);
}));
test('R method annotations cannot hide wrong participant counts, power values, probability units or ambiguous labels', async () => withExecutor(async (_executor,execute) => {
  const supported={...plan,target_power:.8};
  for(const method of ['power.t.test','stats::power.t.test','stats :: power.t.test']){
    const wrongCount=answer(63);wrongCount.results[0].metric=`required n per group (${method})`;
    assert.equal((await checkPooledTReference(supported,wrongCount,execute)).status,'failed');
    const wrongUnits=answer(64);wrongUnits.results[0]={metric:`required n per group (${method})`,value:64,unit:'clusters per group'};
    assert.equal((await checkPooledTReference(supported,wrongUnits,async()=>{throw Error('invalid count units must fail before R');})).status,'failed');
    const wrongPower=answer(64,.95,.7951683381233856);wrongPower.results[2].metric=`power at n (${method})`;
    assert.equal((await checkPooledTReference(supported,wrongPower,execute)).status,'failed');
    const wrongPowerUnit=answer(64,.8014595579223276,.7951683381233856);wrongPowerUnit.results[2].metric=`continuous achieved power at n (${method})`;wrongPowerUnit.results[2].unit='percent';
    assert.equal((await checkPooledTReference(supported,wrongPowerUnit,async()=>{throw Error('actual power units must fail before R');})).status,'failed');
    const ambiguous=answer(64,.8014595579223276,.7951683381233856);ambiguous.results[3].metric=`power at n=64 and n=63 (${method})`;
    assert.equal((await checkPooledTReference(supported,ambiguous,async()=>{throw Error('ambiguous designs must fail before R');})).status,'failed');
  }
  // A method-only label is not an explicit participant quantity; retain its
  // previous power checking path, including contradictory values and units.
  const methodOnly=answer(64);methodOnly.results.push({metric:'power.t.test estimate',value:.95,unit:'probability'});
  assert.equal((await checkPooledTReference(supported,methodOnly,execute)).status,'failed');
  methodOnly.results.at(-1).unit='percent';
  assert.equal((await checkPooledTReference(supported,methodOnly,async()=>{throw Error('method-only invalid power unit must still fail before R');})).status,'failed');
}));
test('failed, null, incomplete, forged-check-name, and ambiguous-unit audits fail closed', async () => {
  for (const response of [{success:false}, {success:'true'}, {success:true,stdout:'POWER_AGENT_REFERENCE_AUDIT=null'}, {success:true,stdout:'POWER_AGENT_REFERENCE_AUDIT='+JSON.stringify({checks:[{name:'fake1',passed:true},{name:'fake2',passed:true},{name:'fake3',passed:true}]})}]) {
    assert.equal((await checkPooledTReference(plan,answer(86),async()=>response)).status,'failed');
  }
  const conflict=answer(86); conflict.results.push({metric:'n per arm',value:85,unit:'participants_per_group'});
  const audit=await checkPooledTReference(plan,conflict,async()=>{throw Error('must not execute ambiguous count');}); assert.equal(audit.status,'failed');
  for (const row of [{metric:'sample_size',value:86,unit:'clusters_per_arm'},{metric:'sample_size',value:86,unit:'events_per_group'},{metric:'sample_size',value:86,unit:'kg'},{metric:'sample_size',value:86,unit:'days'},{metric:'sample_size',value:86,unit:'probability'},{metric:'Observed power',value:.90322998,unit:'percent'}]) {
    const bad=answer(86); bad.results.push(row);
    assert.equal((await checkPooledTReference(plan,bad,async()=>{throw Error('must not execute invalid units');})).status,'failed');
  }
});
test('a very large effect with minimum two participants avoids inverse-solver bracketing failure', async () => withExecutor(async (_executor,execute) => {
  const largeEffectPlan={...plan,target_power:.8,parameters:[{name:'Cohen d',value:10,unit:'standardized difference',source:'user'}]};
  const audit=await checkPooledTReference(largeEffectPlan,answer(2),execute);
  assert.equal(audit.status,'passed'); assert.equal(audit.reference.minimum_per_arm,2);
  assert.equal((await checkPooledTReference(largeEffectPlan,answer(2,null,.5),async()=>{throw Error('must not execute inadmissible preceding design');})).status,'failed');
}));
test('contradictory passed booleans do not certify an inconsistent reference record', async () => {
  const reference={checks:[{name:'candidate_minimum_per_arm',passed:true},{name:'target_achieved',passed:true},{name:'independent_noncentral_t_implementation',passed:true}],minimum_per_arm:86,participants_total:172,power_at_candidate:.90323,power_at_minimum:.90323,power_preceding:.89989,stats_version:'4.4.2'};
  assert.equal((await checkPooledTReference(plan,answer(44),async()=>({success:true,evidence_id:'e2',stdout:'POWER_AGENT_REFERENCE_AUDIT='+JSON.stringify(reference)}))).status,'failed');
  assert.equal((await checkPooledTReference(plan,answer(86),async()=>({success:true,stdout:'POWER_AGENT_REFERENCE_AUDIT='+JSON.stringify(reference)}))).status,'failed');
});
test('explicit numeric n labels map to selected and preceding designs, and contradictions fail', async () => withExecutor(async (_executor,execute) => {
  const n=86, candidate=answer(n,.90322998,.89989408);
  candidate.results[2].metric=`Achieved power at n=${n}`;
  candidate.results[3].metric=`Achieved power at n=${n-1}`;
  assert.equal((await checkPooledTReference(plan,candidate,execute)).status,'passed');
  const wrongValues=structuredClone(candidate); wrongValues.results[3].value=.90322998;
  assert.equal((await checkPooledTReference(plan,wrongValues,execute)).status,'failed');
  for (const metric of [`Achieved power at n=${n-2}`,`Power preceding at n=${n}`,`Achieved power at n=${n}.5`,`Power at n=${n} and n=${n-1}`,`Power at n=−${n}`,`Power at n=${n}e2`,`Power at n=${n}junk`,`Power at n+1`,`Power at n−10`,`Power at n−2`,`Power at n=`]) {
    const bad=structuredClone(candidate);bad.results[3].metric=metric;
    assert.equal((await checkPooledTReference(plan,bad,async()=>{throw Error('must not execute ambiguous mapping');})).status,'failed');
  }
  const validOffset=structuredClone(candidate);validOffset.results[3].metric='Power at n−1';
  assert.equal((await checkPooledTReference(plan,validOffset,execute)).status,'passed');
  const validToken=structuredClone(candidate);validToken.results[2].metric=`Power at n=${n}e0,`;validToken.results[3].metric=`Power at n=${n-1};`;
  assert.equal((await checkPooledTReference(plan,validToken,execute)).status,'passed');
}));
test('execution-grounded wrong candidate is retained with review_failed and actual reference evidence', async () => withExecutor(async (executor) => {
  const candidate=answer(44,.9065,.8999);
  const code='solve <- power.t.test(delta=.5,sd=1,power=.9,sig.level=.05,type="one.sample",alternative="two.sided",strict=TRUE); n<-ceiling(solve$n); p<-power.t.test(n=n,delta=.5,sd=1,sig.level=.05,type="one.sample",alternative="two.sided",strict=TRUE)$power; previous<-power.t.test(n=n-1,delta=.5,sd=1,sig.level=.05,type="one.sample",alternative="two.sided",strict=TRUE)$power; cat("POWER_AGENT_RESULT=",jsonlite::toJSON(list(results=list(list(metric="Minimum participants per arm",value=n,unit="integer"),list(metric="Total participants (both arms)",value=2*n,unit="integer"),list(metric="Achieved power at n",value=p,unit="probability"),list(metric="Power at n-1",value=previous,unit="probability"))),auto_unbox=TRUE,digits=15),"\\n",sep="")';
  const calculated=await executor.executeRCode(code);assert.equal(calculated.success,true);candidate.results=extractComputedResult(calculated.output).results;
  const queue=[tool('submit_design',plan),tool('execute_r',{code,purpose:'Regression fixture reproduces a preserved erroneous candidate, not a scientific solution'}),tool('submit_answer',candidate)];
  const result=await runScientificAnalysis('Independent normal groups, common SD, d=.5, two-sided alpha=.05, power=.90, 1:1, no attrition.',{model:'claude-haiku-4-5-20251001',executor,transport:async()=>queue.shift()});
  assert.equal(result.harnessVersion,HARNESS_VERSION); assert.equal(result.scientificStatus,'review_failed'); assert.equal(result.success,false);
  assert.equal(result.results[0].value,44); assert.equal(result.referenceAudit.status,'failed');
  assert.deepEqual(result.executions.map(e=>e.role),['coder','reference_check']); assert.equal(result.referenceAudit.evidence_id,'e2');
}));

const sevenRowFixture = JSON.parse(await fs.readFile(new URL('./test-fixtures/reference-seven-row-2.1.2.json', import.meta.url), 'utf8'));
test('saved seven-row result separates selected and preceding participant counts without rounding the continuous diagnostic', async () => withExecutor(async (_executor, execute) => {
  assert.equal(sevenRowFixture.source_sha256, 'c18d1e58f4576fbc1aece337f835ab17b98d6ccff30bc6ccccba3721bd2b75e9');
  const candidate = structuredClone(sevenRowFixture.answer), before = JSON.stringify(candidate);
  const audit = await checkPooledTReference(sevenRowFixture.plan, candidate, execute);
  assert.equal(audit.status, 'passed'); assert.equal(audit.reference.minimum_per_arm, 64);
  assert.equal(audit.reference.participants_total, 128); assert.equal(candidate.results[0].value, 63.76561017078221);
  assert.ok(audit.checks.find(c => c.name === 'reported_preceding_per_arm_count').passed);
  assert.ok(audit.checks.find(c => c.name === 'reported_preceding_total_count').passed);
  assert.equal(JSON.stringify(candidate), before);
  for (const [index, value, check] of [[4, 62, 'reported_preceding_per_arm_count'], [5, 125, 'reported_preceding_total_count']]) {
    const wrong = structuredClone(candidate); wrong.results[index].value = value;
    const rejected = await checkPooledTReference(sevenRowFixture.plan, wrong, execute);
    assert.equal(rejected.status, 'failed'); assert.equal(rejected.checks.find(c => c.name === check).passed, false);
    assert.equal(wrong.results[index].value, value);
  }
  for (const alias of ['Participants per arm (n minus 1)', 'participants_per_arm_at_n_minus_1', 'Participants per arm (previous design)']) {
    const variant = structuredClone(candidate); variant.results[4].metric = alias;
    assert.equal((await checkPooledTReference(sevenRowFixture.plan, variant, execute)).status, 'passed');
  }
  for (const change of [
    {metric: 'Participants per arm (n-10)'}, {metric: 'Participants per arm (n-1 + 1)'},
    {metric: 'Participants per arm (n minus 1 plus 1)'}, {metric: 'Participants per arm (n minus 11)'},
    {metric: 'Selected participants per arm (n-1)'}, {metric: 'Required previous participants per group'},
    {metric: 'Accepted preceding participants per group'}, {metric: 'Participants per arm'},
    {unit: 'clusters_per_arm'}, {unit: 'events_per_group'}, {unit: 'kg'}
  ]) {
    const wrong = structuredClone(candidate); Object.assign(wrong.results[4], change);
    assert.equal((await checkPooledTReference(sevenRowFixture.plan, wrong, async () => { throw Error('must reject ambiguous count mapping or units before R'); })).status, 'failed');
  }
}));
test('execution-grounded candidate with a wrong preceding count is retained after reference failure', async () => withExecutor(async (executor) => {
  const candidate = structuredClone(sevenRowFixture.answer); candidate.results[4].value = 62; candidate.evidence_ids = ['e1']; candidate.citations = []; // This fixture tests the numerical guard; historical citations are not retrieved here.
  const expressions=['solve$n','n','2*n','p','n-2','2*(n-1)','previous'];
  const code='solve <- power.t.test(delta=.5,sd=1,power=.8,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE);n<-ceiling(solve$n);p<-power.t.test(n=n,delta=.5,sd=1,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE)$power;previous<-power.t.test(n=n-1,delta=.5,sd=1,sig.level=.05,type="two.sample",alternative="two.sided",strict=TRUE)$power;cat("POWER_AGENT_RESULT=",jsonlite::toJSON(list(results=list('+candidate.results.map((row,i)=>'list(metric='+JSON.stringify(row.metric)+',value='+expressions[i]+',unit='+JSON.stringify(row.unit)+')').join(',')+')),auto_unbox=TRUE,digits=15),"\\n",sep="")';
  const calculated=await executor.executeRCode(code);assert.equal(calculated.success,true);candidate.results=extractComputedResult(calculated.output).results;
  const queue = [tool('submit_design', sevenRowFixture.plan), tool('execute_r', {code, purpose: 'Regression fixture reproduces a wrong preceding count'}), tool('submit_answer', candidate)];
  const result = await runScientificAnalysis('Use the explicitly declared pooled-t specification in the fixture.', {model:'claude-haiku-4-5-20251001',executor, transport: async () => queue.shift()});
  assert.equal(result.harnessVersion, HARNESS_VERSION); assert.equal(result.scientificStatus, 'review_failed'); assert.equal(result.success, false);
  assert.equal(result.results[1].value, 64); assert.equal(result.results[4].value, 62);
  assert.equal(result.referenceAudit.status, 'failed'); assert.equal(result.referenceAudit.evidence_id, 'e2');
  assert.equal(result.referenceAudit.checks.find(c => c.name === 'reported_preceding_per_arm_count').passed, false);
  assert.deepEqual(result.executions.map(e => e.role), ['coder', 'reference_check']);
}));

test('explicit protocol/observed diagnostics do not replace the primary planned design and remain uncertified', async () => withExecutor(async (_executor,execute) => {
  const candidate=answer(64,.8014595579223276,.7951683381233855);
  candidate.results.push(
    {metric:'DOCX claim check only: claimed enrollment per group',value:20,unit:'participants per group'},
    {metric:'DOCX claim check only (not a design candidate): strict power at the claimed enrollment',value:.3379390289250903,unit:'probability'},
    {metric:'Observed control participants per group',value:12,unit:'participants per group'},
    {metric:'Comparison power at n=20',value:.3379390289250903,unit:'probability'});
  const before=JSON.stringify(candidate);
  const audit=await checkPooledTReference({...plan,target_power:.8},candidate,execute);
  assert.equal(audit.status,'passed');assert.equal(audit.reference.minimum_per_arm,64);
  assert.equal(audit.diagnostic_quantities.length,4);
  assert.ok(audit.diagnostic_quantities.every(row=>row.reference_scope.includes('not certified')));
  assert.equal(audit.checks.find(check=>check.name==='reported_achieved_power').observed.length,1);
  assert.equal(JSON.stringify(candidate),before);
}));
test('diagnostics cannot establish or disguise conflicting primary participant and achieved-power claims', async () => withExecutor(async (_executor,execute) => {
  const stop=async()=>{throw Error('no unambiguous primary design was declared');};
  for(const metric of ['Protocol planned participants per group','Observed participants per group','Sensitivity participants per group']){
    const diagnosticOnly={...answer(64),results:[{metric,value:64,unit:'participants per group'}]};
    assert.equal((await checkPooledTReference({...plan,target_power:.8},diagnosticOnly,stop)).status,'failed');
  }
  for(const metric of ['Selected protocol participants per group','Required observed participants per group','Minimum comparison participants per group']){
    const wrong=answer(64);wrong.results.push({metric,value:20,unit:'participants per group'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,stop)).status,'failed');
  }
  for(const metric of ['Claimed achieved power at n','Diagnostic selected power at n','Requested achieved power at n']){
    const wrong=answer(64);wrong.results.push({metric,value:.95,unit:'probability'});
    const audit=await checkPooledTReference({...plan,target_power:.8},wrong,execute);
    assert.equal(audit.status,'failed');assert.equal(audit.checks.find(check=>check.name==='reported_achieved_power').passed,false);
  }
}));
test('compact absolute n labels share the conservative primary/preceding mapping and explicit comparison scope', async () => withExecutor(async (_executor,execute) => {
  const candidate=answer(64,.8014595579223276,.7951683381233855);
  candidate.results[2].metric='power_n64';candidate.results[3].metric='power_n63';
  candidate.results.push({metric:'protocol_claim_power_n20',value:.3379390289250903,unit:'probability'});
  assert.equal((await checkPooledTReference({...plan,target_power:.8},candidate,execute)).status,'passed');
  for(const metric of ['selected_power_n20','preceding_power_n20','power_n20','power_n64junk','power_n64_and_n63']){
    const wrong=answer(64,.8014595579223276,.7951683381233855);wrong.results.push({metric,value:.3379390289250903,unit:'probability'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,async()=>{throw Error('unqualified/malformed primary labels must fail before R');})).status,'failed');
  }
}));
test('explicit diagnostic probability rows retain domain/unit and unambiguous absolute-count checks', async () => {
  const stop=async()=>{throw Error('invalid diagnostic quantity must fail before R');};
  for(const metric of ['Comparison power at n=1','Comparison power at n=-20','Comparison power at n-10','Comparison power at n=20 and n=21','Protocol claim power at n=20junk']){
    const wrong=answer(64);wrong.results.push({metric,value:.338,unit:'probability'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,stop)).status,'failed');
  }
  for(const value of [NaN,Infinity,null,'0.338',-.1,1.1]){
    const wrong=answer(64);wrong.results.push({metric:'Protocol claim power',value,unit:'probability'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,stop)).status,'failed');
  }
  const wrongUnit=answer(64);wrongUnit.results.push({metric:'Protocol claim power',value:.338,unit:'percent'});
  assert.equal((await checkPooledTReference({...plan,target_power:.8},wrongUnit,stop)).status,'failed');
});

test('source-count qualifiers cannot hide preceding-design contradictions or invalid count labels', async () => withExecutor(async (_executor,execute) => {
  for(const metric of ['Protocol participants per group at n-1','Protocol prior participants per group','Source participants per group at n minus 1']){
    const wrong=answer(64);wrong.results.push({metric,value:62,unit:'participants per group'});
    const audit=await checkPooledTReference({...plan,target_power:.8},wrong,execute);
    assert.equal(audit.status,'failed');
    assert.equal(audit.checks.find(check=>check.name==='reported_preceding_per_arm_count').passed,false);
    wrong.results.at(-1).value=63;
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,execute)).status,'passed');
  }
  const stop=async()=>{throw Error('invalid scoped count must fail before R');};
  for(const metric of ['Protocol participants per group at n=20junk','Protocol participants per group at n=20 and n=21','Protocol participants per group at n-10','Protocol participants per group at n minus 1 plus 1','Protocol participants per group at n=20']){
    const wrong=answer(64);wrong.results.push({metric,value:21,unit:'participants per group'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,stop)).status,'failed');
  }
  for(const value of [-20,20.5,NaN,Infinity,null,'20']){
    const wrong=answer(64);wrong.results.push({metric:'Protocol claimed participants per group',value,unit:'participants per group'});
    assert.equal((await checkPooledTReference({...plan,target_power:.8},wrong,stop)).status,'failed');
  }
  const valid=answer(64);valid.results.push({metric:'Observed pilot participants per group',value:0,unit:'participants per group'},
    {metric:'Protocol claimed participants per group at n=20',value:20,unit:'participants per group'});
  assert.equal((await checkPooledTReference({...plan,target_power:.8},valid,execute)).status,'passed');
}));

test('selected power markers cannot identify the preceding design, while achieved-at-n remains a numeric design label', async () => withExecutor(async (_executor,execute) => {
  for(const metric of ['Selected power at n=63','Protocol selected power at n63','Power at minimum n=63','Required power at n-1','Chosen previous power']){
    const wrong=answer(64);wrong.results.push({metric,value:.7951683381233855,unit:'probability'});
    const audit=await checkPooledTReference({...plan,target_power:.8},wrong,async()=>{throw Error('contradictory selected label must fail before R');});
    assert.equal(audit.status,'failed');assert.equal(audit.checks[0].name,'declared_power_design_mapping');
  }
  const valid=answer(64);valid.results.push({metric:'Selected power at n=64',value:.8014595579223276,unit:'probability'},
    {metric:'Achieved power at n=63',value:.7951683381233855,unit:'probability'});
  assert.equal((await checkPooledTReference({...plan,target_power:.8},valid,execute)).status,'passed');
}));
