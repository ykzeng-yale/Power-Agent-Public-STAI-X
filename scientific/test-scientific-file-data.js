import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph } from 'docx';
import { prepareScientificContext } from './scientific-api.js';
import { normalizeWorkbook, profileTabularFile } from './scientific-file-data.js';
import { ScientificRExecutor } from './scientific-r-executor.js';
import { parseFile } from './file-parser-improved.js';

const hash = value => createHash('sha256').update(value).digest('hex');
async function workspaceFor(callback) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scientific-input-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});const workspace=await executor.createWorkspace();
  try{return await callback(workspace,executor);}finally{await fs.rm(root,{recursive:true,force:true});}
}
test('Excel worksheets preserve complete cached raw values, binary SHA, sheets and normalization limitations',async()=>workspaceFor(async workspace=>{
  const wb=XLSX.utils.book_new();const first=XLSX.utils.aoa_to_sheet([['group','change'],['control',1.23456789012345],['treatment',3]]);
  first.B3.f='B2+1';first['!merges']=[{s:{r:3,c:0},e:{r:3,c:1}}];
  XLSX.utils.book_append_sheet(wb,first,'Trial');XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['site','n'],['A',8],['B',9]]),'Sites');
  for(const bookType of ['xlsx','xls']){
    const raw=XLSX.write(wb,{type:'buffer',bookType});const filename=path.join(workspace.directory,'data-'+bookType+'.'+bookType);await fs.writeFile(filename,raw);
    const normalized=await normalizeWorkbook(raw,filename,workspace);
    assert.deepEqual(normalized.worksheets.map(sheet=>sheet.sheet_name),['Trial','Sites']);
    assert.equal(normalized.raw_workbook_sha256,hash(raw));assert.equal(normalized.parser_version,'0.20.3');
    const csv=await fs.readFile(normalized.worksheets[0].local_path,'utf8');assert.ok(csv.includes('1.23456789012345'));
    assert.equal(normalized.worksheets[0].sha256,hash(csv));assert.equal(normalized.worksheets[0].column_count,2);
    // This writer retains the cached value in XLS but only serializes this
    // fixture's formula in XLSX. Check the actual serialized source, not the
    // in-memory worksheet, when asserting parser metadata.
    const serializedFormula=XLSX.read(raw,{type:'buffer',cellFormula:true}).Sheets.Trial.B3.f;
    assert.equal(normalized.worksheets[0].formula_cells,serializedFormula?1:0);
    assert.equal(Boolean(serializedFormula),bookType==='xlsx');assert.match(csv,/"treatment","3"/);
    assert.ok(normalized.worksheets[0].limitations.some(text=>/not recalculated/.test(text)));
  }
}));
test('CSV and normalized Excel sidecars can be read by fresh real R without readxl',async()=>workspaceFor(async(workspace,executor)=>{
  const raw='group,bp\ncontrol,120\ntreatment,115\n';const csv=path.join(workspace.directory,'raw.csv');await fs.writeFile(csv,raw);
  const profile=await profileTabularFile(csv,executor,workspace);assert.equal(profile.success,true,profile.execution.stderr);
  assert.equal(profile.profile.rows,2);assert.equal(profile.profile.columns,2);assert.equal(profile.profile.variables[1].numeric_summary.mean,117.5);
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['group','bp'],['control',120],['treatment',115]]),'Data');
  const normalized=await normalizeWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),path.join(workspace.directory,'raw.xlsx'),workspace);
  const second=await profileTabularFile(normalized.worksheets[0].local_path,executor,workspace);assert.equal(second.success,true,second.execution.stderr);
  assert.deepEqual(second.profile.preview,profile.profile.preview);
}));
test('full raw uploads, document extraction and preliminary/context data survive together',async()=>workspaceFor(async(workspace,executor)=>{
  const rawDoc=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Protocol: randomized trial. Outcome: blood pressure.')]}]}));
  const rawCsv=Buffer.from('group,bp\ncontrol,120\ntreatment,115\n');
  const context=await prepareScientificContext({data:{previous_setting:'retain'},preliminaryAnalysis:'Top-level prior context',sessionFiles:[{name:'protocol.docx',content:rawDoc.toString('base64'),full_content:'Stale client extraction'}],dataset:{name:'trial.csv',content:rawCsv.toString('base64'),preliminaryAnalysis:'Keep the preliminary summary'}},workspace,{parseFile,executor});
  assert.equal(context.source_files.length,2);assert.equal(context.source_files[0].sha256,hash(rawDoc));assert.deepEqual(await fs.readFile(context.source_files[0].local_path),rawDoc);
  assert.match(context.source_files[0].text,/Protocol: randomized trial/);assert.doesNotMatch(context.source_files[0].text,/Stale client extraction/);
  assert.equal(context.source_files[1].preliminary_analysis,'Keep the preliminary summary');assert.equal(context.source_files[1].observed_data_profile.rows,2);
  assert.equal(context.inline_data.previous_setting,'retain');assert.equal(context.preliminary_analysis,'Top-level prior context');
}));
test('long extracted text is complete on a read-only sidecar with an explicit prompt preview bound',async()=>workspaceFor(async workspace=>{
  const text='A'.repeat(100020)+'END_OF_PROTOCOL';
  const context=await prepareScientificContext({sessionFiles:[{name:'protocol.txt',content:Buffer.from(text).toString('base64')}]},workspace,{parseFile});
  const source=context.source_files[0];assert.equal(source.text.length,100000);assert.equal(source.text_truncated,true);
  assert.equal(await fs.readFile(source.full_text_path,'utf8'),text);assert.equal(source.full_text_sha256,hash(text));assert.equal(source.full_text_characters,text.length);
}));
test('adopted prior artifacts retain verified bytes and claimed lineage without becoming current scientific evidence',async()=>workspaceFor(async workspace=>{
  const bytes=Buffer.from('x\n1\n2\n');const context=await prepareScientificContext({sessionFiles:[{name:'cleaned.csv',content:bytes.toString('base64'),sha256:hash(bytes),source_kind:'prior_generated_artifact',producing_run_id:'prior-run',producing_evidence_id:'e4',artifact_id:'prior-artifact'}]},workspace,{});
  const source=context.source_files[0];assert.equal(source.input_role,'adopted_input');assert.equal(source.inherited_generated_input,true);assert.equal(source.sha256,hash(bytes));assert.equal(source.supplied_provenance.producing_run_id,'prior-run');assert.match(source.supplied_provenance.scope,/not.*current execution evidence/);
  await assert.rejects(prepareScientificContext({sessionFiles:[{name:'bad.csv',content:bytes.toString('base64'),sha256:'0'.repeat(64)}]},workspace,{}),/SHA-256/);
}));
test('opaque RDS inputs are retained without Node deserialization or binary UTF-8 fallback',async()=>workspaceFor(async workspace=>{
  const raw=Buffer.from([88,10,0,0,0,3,255,254,128]);
  const context=await prepareScientificContext({dataset:{name:'model.rds',content:raw.toString('base64'),source_kind:'prior_generated_artifact',sha256:hash(raw)}},workspace,{parseFile});
  const file=context.source_files[0];assert.equal(file.text,null);assert.equal(file.parsed_metadata.parsedAs,'opaque-r-data');assert.equal(file.full_text_path,null);assert.deepEqual(await fs.readFile(file.local_path),raw);
}));
test('owned stored document bytes remain first-class when a client extraction is also supplied',async()=>workspaceFor(async workspace=>{
  const raw=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Canonical stored protocol text, preserved as original DOCX bytes.')]}]}));let reads=0;
  const context=await prepareScientificContext({sessionFiles:[{name:'stored.docx',full_content:'Stale client extraction',gcsPath:'user-uploads/owned-session/stored.docx'}]},workspace,{parseFile,ownedSessionId:'owned-session',datasetBucket:{file:()=>({download:async()=>{reads++;return[raw];}})}});
  assert.equal(reads,1);assert.equal(context.source_files[0].sha256,hash(raw));assert.match(context.source_files[0].text,/Canonical stored protocol/);assert.deepEqual(await fs.readFile(context.source_files[0].local_path),raw);
}));
test('unsupported advertised binary formats stay opaque and name the required genuine reader',async()=>workspaceFor(async workspace=>{
  const raw=Buffer.from([0,255,82,192,0,1]);
  for(const extension of ['sav','zsav','dta','sas7bdat','xpt','zip','doc']){
    const name='unsupported-'+extension+'.'+extension,parsed=await parseFile(raw,name,'application/octet-stream');assert.equal(parsed.text,null);assert.equal(parsed.metadata.parsedAs,'opaque-unsupported-format');assert.equal(parsed.metadata.supported_reader,false);
    const context=await prepareScientificContext({dataset:{name,content:raw.toString('base64'),full_content:'Do not treat this client placeholder as parsed data.'}},workspace,{parseFile});const file=context.source_files[0];
    assert.equal(file.text,null);assert.match(file.parsed_metadata.required_reader,/reader|read_|extraction/);assert.deepEqual(await fs.readFile(file.local_path),raw);assert.equal(file.full_text_path,null);
  }
}));
