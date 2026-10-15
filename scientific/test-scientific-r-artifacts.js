import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ScientificRExecutor } from './scientific-r-executor.js';

test('original JPEG figure formats retain actual captured bytes, hashes and MIME types', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pa-jpeg-test-'));await fs.chmod(root,0o711);
  const executor=new ScientificRExecutor({root});const workspace=await executor.createWorkspace();
  try {
    const result=await executor.executeRCode('jpeg("figure.jpg",width=500,height=400);plot(1:3,2:4);dev.off();jpeg("figure.jpeg",width=500,height=400);plot(1:3,2:4);dev.off()', {workspace});
    assert.equal(result.success,true,result.stderr);assert.equal(result.output_files.length,2);
    for(const file of result.output_files){const bytes=await fs.readFile(file.path);assert.equal(file.mime_type,'image/jpeg');assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(file.sha256,createHash('sha256').update(bytes).digest('hex'));assert.deepEqual(bytes,Buffer.from(file.content_base64,'base64'));}
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('actual R artifacts are execution-specific, hashed and readable by a subsequent checker', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-artifact-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const workspace = await executor.createWorkspace();
  try {
    const first = await executor.executeRCode('write.csv(data.frame(n=40:42,power=c(.7,.71,.72)),"sensitivity.csv",row.names=FALSE)\npng("power.png",width=480,height=360);plot(40:42,c(.7,.71,.72),type="b");dev.off()', { workspace });
    assert.equal(first.success, true, first.stderr);
    assert.equal(first.output_files.length, 2);
    const csv = first.output_files.find(file => file.type === 'csv');
    for (const file of first.output_files) {
      const bytes = await fs.readFile(file.path);
      assert.equal(file.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.deepEqual(Buffer.from(file.content_base64, 'base64'), bytes);
      assert.equal(file.size, bytes.length);
    }
    const second = await executor.executeRCode(`d<-read.csv(${JSON.stringify(csv.read_path)});stopifnot(nrow(d)==3)\nwrite.csv(data.frame(n=99,power=.9),"sensitivity.csv",row.names=FALSE)`, { workspace });
    assert.equal(second.success, true, second.stderr);
    assert.equal(second.output_files.length, 1);
    assert.notEqual(first.executionDirectory, second.executionDirectory);
    assert.notEqual(csv.sha256, second.output_files[0].sha256);
    assert.equal(createHash('sha256').update(await fs.readFile(csv.path)).digest('hex'), csv.sha256);
    const failed = await executor.executeRCode('writeLines("partial","failed.txt");stop("deliberate failure")', { workspace });
    assert.equal(failed.success, false);
    assert.equal(failed.output_files.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('Linux blind checker reads original inputs but cannot open candidate artifacts', { skip: process.platform !== 'linux' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-blind-artifact-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const workspace = await executor.createWorkspace();
  try {
    const sourcePath = path.join(workspace.directory, 'source-input.csv');
    await fs.writeFile(sourcePath, 'x\n1\n2\n');
    const first = await executor.executeRCode('writeLines("candidate-private-output", "candidate.txt")', { workspace });
    assert.equal(first.success, true, first.stderr);
    const file = first.output_files[0];
    const blind = await executor.executeRCode(`stopifnot(nrow(read.csv(${JSON.stringify(sourcePath)}))==2)\nx<-tryCatch(readLines(${JSON.stringify(file.read_path)}),error=function(e)e);stopifnot(inherits(x,"error"))\ny<-tryCatch(readLines(${JSON.stringify(path.join(first.executionDirectory, 'candidate.txt'))}),error=function(e)e);stopifnot(inherits(y,"error"))`, { workspace, phase: 'blind_verification' });
    assert.equal(blind.success, true, blind.stderr);
    assert.equal(blind.blind_artifact_isolation, true);
    const revealed = await executor.executeRCode(`stopifnot(readLines(${JSON.stringify(file.read_path)})=="candidate-private-output")`, { workspace, phase: 'candidate_comparison' });
    assert.equal(revealed.success, true, revealed.stderr);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('artifact limits and linked files are rejected without borrowing earlier outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-artifact-limit-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root, maxArtifactBytes: 100 });
  const workspace = await executor.createWorkspace();
  try {
    const result = await executor.executeRCode('writeLines(paste(rep("x",200),collapse=""),"large.txt");file.symlink("large.txt","linked.txt")', { workspace });
    assert.equal(result.success, true, result.stderr);
    assert.equal(result.output_files.length, 0);
    assert.equal(result.artifact_issues.length, 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('an actual captured RDS checkpoint can be explicitly adopted by a new fresh workspace', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-rds-source-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const firstWorkspace = await executor.createWorkspace();
  const nextWorkspace = await executor.createWorkspace();
  try {
    const first = await executor.executeRCode('values <- seq_len(7); saveRDS(list(values=values,mean=mean(values)), "checkpoint.rds"); save(values,file="values.RData")', { workspace: firstWorkspace });
    assert.equal(first.success, true, first.stderr);
    assert.equal(first.output_files.length, 2);
    const checkpoint = first.output_files.find(file => file.type === 'rds');
    assert.equal(checkpoint.mime_type, 'application/octet-stream');
    const bytes = await fs.readFile(checkpoint.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), checkpoint.sha256);
    assert.deepEqual(bytes, Buffer.from(checkpoint.content_base64, 'base64'));
    const adopted = path.join(nextWorkspace.directory, 'source-1-checkpoint.rds');
    await fs.writeFile(adopted, bytes);
    const next = await executor.executeRCode(`stopifnot(!exists("values")); state <- readRDS(${JSON.stringify(adopted)}); stopifnot(length(state$values)==7, mean(state$values)==state$mean); write.csv(data.frame(value=state$values), "continued.csv",row.names=FALSE)`, { workspace: nextWorkspace, phase: 'blind_verification' });
    assert.equal(next.success, true, next.stderr);
    assert.equal(next.output_files.length, 1);
    assert.equal(next.output_files[0].name, 'continued.csv');
    assert.notEqual(first.executionDirectory, next.executionDirectory);
    assert.equal(createHash('sha256').update(await fs.readFile(checkpoint.path)).digest('hex'), checkpoint.sha256);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('redirected background descendants are stopped before another phase can observe late files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pa-descendant-test-'));
  await fs.chmod(root, 0o711);
  const executor = new ScientificRExecutor({ root });
  const workspace = await executor.createWorkspace();
  try {
    const result = await executor.executeRCode('system("sh -c \'sleep 0.5; echo late > late.txt\' >/dev/null 2>&1 &");cat("parent completed\\n")', { workspace });
    assert.equal(result.success, true, result.stderr);
    await new Promise(resolve => setTimeout(resolve, 800));
    await assert.rejects(fs.access(path.join(result.executionDirectory, 'late.txt')));
    assert.equal(result.output_files.length, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
