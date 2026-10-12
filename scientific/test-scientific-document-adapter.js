import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Document, Packer, Paragraph } from 'docx';
import { createScientificDocumentRevisions, hostedDocumentRevisionCapability, documentDeliveryRecord } from './scientific-document-adapter.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const accepted = { success: true, scientificStatus: 'completed', runId: 'controlled-document-adapter', answer: { summary: 'An accepted fixture finding.' } };
async function workspaceFor(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'document-adapter-test-'));
  try { return await callback({ directory }); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
async function source(workspace, name, text = 'Protocol text. Sample size requires a correction.') {
  const bytes = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));
  const filename = path.join(workspace.directory, name), fullTextPath = filename + '.extracted.txt';
  await fs.writeFile(filename, bytes); await fs.writeFile(fullTextPath, text);
  return { name, local_path: filename, full_text_path: fullTextPath, sha256: hash(bytes) };
}
test('source-anchored revision adapter preserves original bytes, full text and separate actual artifact lineage', async () => workspaceFor(async workspace => {
  const text = 'A'.repeat(100100) + 'END_OF_FULL_DOCUMENT', input = await source(workspace, 'protocol.docx', text);
  const revised = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Proposed revised protocol.')] }] }));
  const events = [], original = await fs.readFile(input.local_path);
  const output = await createScientificDocumentRevisions(accepted, 'Review the protocol.', { source_files: [input] }, { workspace, onEvent: event => events.push(event), correctDocument: async options => {
    assert.equal(options.extractedText, text); assert.deepEqual(options.originalBuffer, original); assert.match(options.analysisReport, /accepted fixture finding/); assert.ok(options.timeoutMs <= 90000);
    return { success: true, correctedBuffer: revised, corrections: [{ find: 'Protocol', replace: 'Revised protocol', reason: 'Controlled proposal fixture' }], format: 'docx', correctedFileName: 'protocol_corrected.docx', model_receipt: { actual_model: 'test-stub-not-a-provider-call' }, application_receipt: { verified: true } };
  } });
  assert.equal(output.records[0].status, 'proposal_generated'); assert.equal(output.records[0].model_receipt.actual_model, 'test-stub-not-a-provider-call');
  const file = output.files[0]; assert.equal(file.source_kind, 'document_revision'); assert.equal(file.original_source_sha256, hash(original)); assert.equal(file.sha256, hash(revised));
  assert.deepEqual(Buffer.from(file.content_base64, 'base64'), revised); assert.deepEqual(await fs.readFile(input.local_path), original); assert.match(file.scope, /not independently accepted/);
  assert.deepEqual(events.map(event => event.status), ['running', 'completed']);
}));
test('document processing is bounded to two inputs and no-proposal results do not claim a correct document', async () => workspaceFor(async workspace => {
  const inputs = await Promise.all(['a.docx', 'b.docx', 'c.docx'].map(name => source(workspace, name))); let calls = 0;
  const output = await createScientificDocumentRevisions(accepted, 'Check sources.', { source_files: inputs }, { workspace, correctDocument: async () => { calls++; return { success: false, reason: 'no_corrections', corrections: [], model_receipt: { actual_model: 'test-stub' } }; } });
  assert.equal(calls, 2); assert.equal(output.omitted_documents, 1); assert.equal(output.files.length, 0);
  assert.ok(output.records.every(record => record.status === 'no_revision_generated' && /not.*claim.*entire document is correct/.test(record.scope)));
}));
test('timeout aborts the document callback and preserves the accepted scientific record', async () => workspaceFor(async workspace => {
  const input = await source(workspace, 'protocol.docx'), record = structuredClone(accepted); let aborted = false;
  const output = await createScientificDocumentRevisions(record, 'Review.', { source_files: [input] }, { workspace, maxDurationMs: 25, correctDocument: options => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('Callback aborted')); }, { once: true })) });
  assert.equal(aborted, true); assert.equal(output.records[0].status, 'timed_out'); assert.equal(output.files.length, 0); assert.deepEqual(record, accepted);
}));
test('failed scientific results and changed original source bytes never invoke document correction', async () => workspaceFor(async workspace => {
  const input = await source(workspace, 'protocol.docx'); let calls = 0; const correctDocument = async () => { calls++; return {}; };
  assert.equal((await createScientificDocumentRevisions({ ...accepted, success: false }, 'Review.', { source_files: [input] }, { workspace, correctDocument })).files.length, 0);
  await fs.appendFile(input.local_path, 'changed'); const output = await createScientificDocumentRevisions(accepted, 'Review.', { source_files: [input] }, { workspace, correctDocument });
  assert.equal(calls, 0); assert.equal(output.records[0].status, 'failed'); assert.match(output.records[0].reason, /changed before revision/);
}));


test('document capability is server scoped and required proposal failures stay partial without changing numerical acceptance', () => {
  const context = { source_files: [{ name: 'protocol.docx', local_path: '/owned/input', full_text_path: '/owned/text', sha256: 'source-sha' }] };
  const capability = hostedDocumentRevisionCapability('Provide a revised DOCX protocol.', context, true);
  assert.equal(capability.stage, 'post_scientific_acceptance'); assert.equal(capability.required_by_request, true);
  assert.equal(hostedDocumentRevisionCapability('Inspect protocol.docx and calculate power.', context, true).required_by_request, false);
  assert.equal(hostedDocumentRevisionCapability('Revise the DOCX.', context, false).stage, 'unavailable');
  for (const status of ['failed', 'timed_out', 'no_revision_generated']) { const result = documentDeliveryRecord(capability, {records:[{status}],files:[]}); assert.equal(result.complete,false); assert.equal(result.status,'required_proposal_not_delivered'); }
  assert.equal(documentDeliveryRecord(capability,{records:[{source_name:'protocol.docx',original_source_sha256:'source-sha',status:'proposal_generated'}],files:[{name:'actual.docx',original_source_name:'protocol.docx',original_source_sha256:'wrong-sha'}]}).complete,false);
  assert.equal(documentDeliveryRecord(capability,{records:[{source_name:'protocol.docx',original_source_sha256:'source-sha',status:'proposal_generated'}],files:[{name:'actual.docx',original_source_name:'protocol.docx',original_source_sha256:'source-sha'}]}).complete,true);
});


test('an explicitly requested uploaded DOCX proposal is independent of optional contextual PDF outcomes',()=>{
 const context={source_files:[{name:'study.pdf',local_path:'/owned/pdf',full_text_path:'/owned/pdf.txt',sha256:'pdf-sha'},{name:'protocol.docx',local_path:'/owned/docx',full_text_path:'/owned/docx.txt',sha256:'docx-sha'}]};
 const capability=hostedDocumentRevisionCapability('If inconsistent, export a corrected proposal for the uploaded DOCX enrollment sentence.',context,true);
 assert.deepEqual(capability.required_source_names,['protocol.docx']);assert.equal(capability.conditional_request,true);
 const revisions={records:[{source_name:'study.pdf',original_source_sha256:'pdf-sha',status:'no_revision_generated'},{source_name:'protocol.docx',original_source_sha256:'docx-sha',status:'proposal_generated'}],files:[{name:'proposal.docx',original_source_name:'protocol.docx',original_source_sha256:'docx-sha'}]};
 const delivery=documentDeliveryRecord(capability,revisions);assert.equal(delivery.complete,true);assert.equal(delivery.status,'proposal_delivered');assert.equal(delivery.records[0].status,'no_revision_generated');
 const failed=documentDeliveryRecord(capability,{records:[{source_name:'protocol.docx',original_source_sha256:'docx-sha',status:'failed'}],files:[]});assert.equal(failed.complete,false);assert.equal(failed.status,'conditional_revision_unresolved');
});
