import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { parseFile } from './file-parser-improved.js';
import { applyDocxCorrections, replaceUniqueDocxText, generateCorrectedDocument } from './document-corrector.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const correction={find:'planned sample size is 40 participants per group.',replace:'planned sample size is 64 participants per group.',reason:'The executed accepted calculation requires 64 per group.',severity:'major'};
const text='For our two-sided test, the '+correction.find+' Preserve the planned intervention and all other wording.';
async function document(){return Packer.toBuffer(new Document({sections:[{children:[new Paragraph({children:[new TextRun({text:'For our two-sided test, the planned sam',bold:true}),new TextRun({text:'ple size is 40 participants per group.'})]}),new Paragraph('Preserve the planned intervention and all other wording.')]}]}));}
function provider(proposals){return async params=>{assert.equal(params.model,'claude-sonnet-5-5');assert.equal(params.supports_forced_tools,undefined);return {id:'controlled-editorial-response',model:params.model,usage:{input_tokens:20,output_tokens:10},content:[{type:'text',text:JSON.stringify(proposals)}]};};}

test('unique DOCX edits span text runs and preserve formatting, XML entities and unrelated member bytes',async()=>{
 const original=await document(),originalSha=hash(original);const before=await JSZip.loadAsync(original);const revised=await applyDocxCorrections(original,[correction]);assert.equal(revised.applied.length,1);assert.equal(revised.rejected.length,0);const after=await JSZip.loadAsync(revised.buffer);
 for(const name of Object.keys(before.files)){if(name==='word/document.xml'||before.files[name].dir)continue;assert.deepEqual(await after.file(name).async('nodebuffer'),await before.file(name).async('nodebuffer'));}
 const xml=await after.file('word/document.xml').async('string');assert.match(xml,/<w:b\/>/);const parsed=await parseFile(revised.buffer,'revised.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.ok(parsed.text.includes(correction.replace));assert.ok(parsed.text.includes('Preserve the planned intervention'));
 const entity='<w:p><w:r><w:t>A &amp; B: planned sam</w:t></w:r><w:r><w:t>ple size is 40 participants per group.</w:t></w:r></w:p>';
 const changed=replaceUniqueDocxText(entity,'A & B: '+correction.find,'A & B: '+correction.replace);assert.equal(changed.applied,true);assert.ok(changed.xml.includes('A &amp; B:'));
 assert.equal(hash(original),originalSha,'Original bytes are never overwritten');
});
test('ambiguous anchors produce no corrected file and never claim unapplied corrections',async()=>{
 const xml='<w:p><w:r><w:t>Repeated anchor passage</w:t></w:r></w:p><w:p><w:r><w:t>Repeated anchor passage</w:t></w:r></w:p>';
 const changed=replaceUniqueDocxText(xml,'Repeated anchor passage','Replacement passage');assert.equal(changed.applied,false);assert.equal(changed.xml,xml);
 const original=await document();const revised=await applyDocxCorrections(original,[{...correction,find:'Passage that does not exist'}]);assert.equal(revised.buffer,null);assert.equal(revised.applied.length,0);assert.equal(revised.rejected.length,1);
 const overlapping='<w:p><w:r><w:t>AAAAAAAAA</w:t></w:r></w:p>';
 assert.equal(replaceUniqueDocxText(overlapping,'AAAAAAAA','Changed anchor').applied,false);
 const tabbed='<w:p><w:r><w:t>First anchor</w:t><w:tab/><w:t>second segment</w:t></w:r></w:p>';
 assert.equal(replaceUniqueDocxText(tabbed,'First anchorsecond segment','Changed anchor').applied,false);
 const repeatedUnsupported='<w:p><w:r><w:t>Repeated anchor passage</w:t></w:r></w:p><w:p><w:r><w:t>Repeated anchor passage</w:t><w:tab/></w:r></w:p>';
 assert.equal(replaceUniqueDocxText(repeatedUnsupported,'Repeated anchor passage','Changed passage').applied,false);
});
test('actual document proposals are distinguished from accepted numerical evidence and carry model/source receipts',async()=>{
 const original=await document();const result=await generateCorrectedDocument({originalBuffer:original,fileName:'protocol.docx',fileExt:'docx',extractedText:text,analysisReport:'Executed result: 64 participants per group.',query:'Review the study protocol.',callModel:provider([correction])});
 assert.equal(result.success,true);assert.equal(result.corrections.length,1);assert.equal(result.correctedFileName,'protocol_proposed-revision.docx');assert.equal(result.model_receipt.actual_model,'claude-sonnet-5-5');assert.equal(result.model_receipt.document_sha256,hash(original));assert.equal(result.application_receipt.applied,1);assert.match(result.application_receipt.scope,/author review/);
});
test('empty or invalid proposals stay qualified instead of certifying the whole document',async()=>{
 const original=await document();for(const proposals of [[],[{...correction,find:'A nonexistent source passage'}]]){const result=await generateCorrectedDocument({originalBuffer:original,fileName:'protocol.docx',fileExt:'docx',extractedText:text,callModel:provider(proposals)});assert.equal(result.success,false);assert.equal(result.correctedBuffer,undefined);assert.equal(result.application_receipt.applied,0);assert.equal(result.model_receipt.actual_model,'claude-sonnet-5-5');}
});
test('PDF-origin revisions preserve complete extracted text while declaring rebuilt DOCX layout',async()=>{
 const full=text+'\nUnchanged final protocol section.';const result=await generateCorrectedDocument({originalBuffer:Buffer.from('%PDF-supplied-fixture'),fileName:'protocol.pdf',fileExt:'pdf',extractedText:full,callModel:provider([correction])});assert.equal(result.success,true);assert.match(result.application_receipt.formatting_scope,/not preserved/);const parsed=await parseFile(result.correctedBuffer,'revision.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.ok(parsed.text.includes(correction.replace));assert.ok(parsed.text.includes('Unchanged final protocol section.'));
});
test('preview scope and cancellation are explicit',async()=>{
 const original=await document();const full=text+'X'.repeat(41000);const result=await generateCorrectedDocument({originalBuffer:original,fileName:'protocol.docx',fileExt:'docx',extractedText:full,callModel:provider([])});assert.equal(result.model_receipt.document_preview_truncated,true);assert.equal(result.model_receipt.document_full_text_characters,full.length);
 const controller=new AbortController();controller.abort(new Error('controlled cancellation'));await assert.rejects(generateCorrectedDocument({originalBuffer:original,fileName:'protocol.docx',fileExt:'docx',extractedText:text,signal:controller.signal,callModel:()=>{throw new Error('must not call');}}),/controlled cancellation/);
});
test('literal replacement tokens survive DOCX and PDF conversion, and provider-race cancellation cannot produce a revision',async()=>{
 const literal={...correction,replace:"Literal $& $` $' proposal text."};
 const xml='<w:p><w:r><w:t>'+correction.find+'</w:t></w:r></w:p>';
 const replaced=replaceUniqueDocxText(xml,literal.find,literal.replace);assert.equal(replaced.applied,true);assert.ok(replaced.xml.includes('Literal $&amp;'));
 const original=await document();const pdf=await generateCorrectedDocument({originalBuffer:Buffer.from('%PDF-test'),fileName:'protocol.pdf',fileExt:'pdf',extractedText:text,callModel:provider([literal])});
 const parsed=await parseFile(pdf.correctedBuffer,'revision.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document');assert.ok(parsed.text.includes(literal.replace));
 const controller=new AbortController();await assert.rejects(generateCorrectedDocument({originalBuffer:original,fileName:'protocol.docx',fileExt:'docx',extractedText:text,signal:controller.signal,callModel:async params=>{controller.abort(new Error('cancelled during provider response'));return provider([correction])(params);}}),/cancelled during provider response/);
});
