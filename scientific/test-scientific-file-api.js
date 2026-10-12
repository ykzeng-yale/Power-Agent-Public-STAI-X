import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import { registerScientificFileRoutes } from './scientific-file-api.js';
import { parseFile } from './file-parser-improved.js';

async function serverFor(callback){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'file-api-test-'));const prior=process.env.SCIENTIFIC_WORKSPACE;process.env.SCIENTIFIC_WORKSPACE=root;
  const app=express();let classifications=0,summaries=0;
  registerScientificFileRoutes(app,{authenticateUser:(req,res,next)=>next(),parseFile,classifyFile:async()=>{classifications++;return{contentType:'document',confidence:.9,model_receipt:{actual_model:'fixture-router',status:'responded'}};},summarizeDocument:async(name,text)=>{summaries++;return{text:'Document context: '+text,model_receipt:{actual_model:'fixture-document-model',status:'responded'}};}});
  app.use(express.json());const server=app.listen(0);await new Promise(resolve=>server.once('listening',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  try{return await callback({url,root,counts:()=>({classifications,summaries}),post:async(name,bytes,type)=>fetch(url+'/api/analyze-file?fileName='+encodeURIComponent(name),{method:'POST',headers:{'content-type':type},body:bytes})});}
  finally{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});if(prior)process.env.SCIENTIFIC_WORKSPACE=prior;else delete process.env.SCIENTIFIC_WORKSPACE;}
}
test('HTTP JSON file uploads preserve exact original bytes before the general JSON parser',async()=>serverFor(async server=>{
  const bytes=Buffer.from('{ "alpha" : 0.05, "design" : "trial" }\n');const response=await server.post('protocol.json',bytes,'application/json');const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.rawFileSha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.rawFileSize,bytes.length);
  assert.equal(result.method,'document_text_analysis');assert.equal(result.modelCalls.classification.actual_model,'fixture-router');assert.equal(result.modelCalls.interpretation.actual_model,'fixture-document-model');
  for(let i=0;i<100&&(await fs.readdir(server.root)).length;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(await fs.readdir(server.root),[]);
}));
test('observed workbook parsing drives tabular preview despite advisory document classification',async()=>serverFor(async server=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['group','value'],['A',3],['B',5]]),'Trial');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const response=await server.post('trial.xlsx',bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');const result=await response.json();
  assert.equal(response.status,200);assert.equal(result.method,'restricted_code_execution');assert.equal(result.structuredData.rows,2);assert.equal(result.worksheets[0].sheet_name,'Trial');
  assert.equal(result.extractedText,null);assert.equal(server.counts().summaries,0);assert.equal(result.execution.success,true);
}));
test('empty bodies and invalid document extraction fail explicitly rather than reporting binary garbage as text',async()=>serverFor(async server=>{
  assert.equal((await server.post('empty.txt',Buffer.alloc(0),'text/plain')).status,400);
  const failed=await server.post('invalid.pdf',Buffer.from('not a PDF'),'application/pdf');assert.equal(failed.status,422);
  const result=await failed.json();assert.equal(result.error,'file_text_extraction_unavailable');assert.equal(server.counts().summaries,0);
}));
