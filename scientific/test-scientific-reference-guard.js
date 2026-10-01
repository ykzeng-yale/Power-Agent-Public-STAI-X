import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPooledTReference, pooledTReferenceSpecification } from './scientific-reference-guard.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { runScientificAnalysis } from './scientific-harness.js';

const plan = { ready: true, request_kind: 'calculation', calculation_type: 'sample_size', estimand: "Cohen's d in independent normal groups with common variance", hypothesis: 'Two-sided difference in means', method: 'noncentral_t_distribution', alpha: .05, sidedness: 'two-sided', target_power: .9, allocation_ratio: 1, sample_size_unit: 'participants per arm', parameters: [{ name: "Cohen's d (effect size)", value: .5, unit: 'standardized difference', source: 'user' }], assumptions: ['Independent normal groups', 'Common population variance', 'Pooled variance t-test', 'No attrition or loss to follow-up', 'No interim analyses'], missing_information: [], clarification_questions: [], scientific_notes: [] };
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
test('supported unpaired design is checked; unsupported sidedness/allocation/power requests/clusters are explicit skips', () => {
  assert.equal(pooledTReferenceSpecification({...plan, assumptions:[...plan.assumptions,'Unpaired observations']}).status,'applicable');
  for (const changes of [{sidedness:'one-sided'},{allocation_ratio:2},{calculation_type:'power'},{parameters:[...plan.parameters,{name:'ICC',value:0,unit:'correlation',source:'user'}]},{assumptions:[...plan.assumptions,'Paired observations']},{assumptions:[]},{method:'Welch two-sample t-test'},{method:'two_sample_t normal approximation'}]) assert.equal(pooledTReferenceSpecification({...plan,...changes}).status,'skipped');
  assert.equal(pooledTReferenceSpecification({...plan,parameters:[]}).status,'failed');
});
test('all reported achieved powers and total units are checked, including unfamiliar power labels', async () => withExecutor(async (_executor,execute) => {
  const wrongPower = answer(86); wrongPower.results.push({metric:'Observed statistical power',value:.999,unit:'probability'});
  assert.equal((await checkPooledTReference(plan,wrongPower,execute)).status,'failed');
  const wrongTotal = answer(86); wrongTotal.results[1].value=86;
  assert.equal((await checkPooledTReference(plan,wrongTotal,execute)).status,'failed');
  const onlyN = {...answer(86),results:[{metric:'sample_size',value:86,unit:'participants_per_group'}]};
  assert.equal((await checkPooledTReference(plan,onlyN,execute)).status,'passed');
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
  for (const metric of [`Achieved power at n=${n-2}`,`Power preceding at n=${n}`,`Achieved power at n=${n}.5`,`Power at n=${n} and n=${n-1}`,`Power at n=−${n}`,`Power at n=${n}e2`,`Power at n=${n}junk`,`Power at n+1`,`Power at n−10`,`Power at n−2`,`Power at n minus 1`,`Power at n=`]) {
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
  const code='cat('+JSON.stringify('POWER_AGENT_RESULT='+JSON.stringify({results:candidate.results})+'\n')+')';
  const queue=[tool('submit_design',plan),tool('execute_r',{code,purpose:'Regression fixture reproduces a preserved erroneous candidate, not a scientific solution'}),tool('submit_answer',candidate)];
  const result=await runScientificAnalysis('Independent normal groups, common SD, d=.5, two-sided alpha=.05, power=.90, 1:1, no attrition.',{executor,transport:async()=>queue.shift()});
  assert.equal(result.harnessVersion,'2.1.0'); assert.equal(result.scientificStatus,'review_failed'); assert.equal(result.success,false);
  assert.equal(result.results[0].value,44); assert.equal(result.referenceAudit.status,'failed');
  assert.deepEqual(result.executions.map(e=>e.role),['coder','reference_check']); assert.equal(result.referenceAudit.evidence_id,'e2');
}));
