#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateAnswerEvidence, extractComputedResult } from './runtime/scientific-harness.js';
const record = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const issues = [];
if (record.scientificStatus !== 'completed') issues.push('Record is not a completed calculation');
const executions = record.executions || [];
for (const evidence of executions) {
  if (evidence.code_sha256 !== createHash('sha256').update(evidence.code).digest('hex')) issues.push(`Code digest mismatch: ${evidence.id}`);
  if (evidence.success && evidence.exitCode !== 0) issues.push(`Missing zero exit code: ${evidence.id}`);
  if (evidence.success) evidence.computed = extractComputedResult(evidence.output);
}
if (record.answer && record.plan) issues.push(...validateAnswerEvidence(record.answer, executions, record.plan));
else issues.push('Answer or design is missing');
if (record.workflowMode === 'multi') {
  const review = record.review;
  if (review?.verdict !== 'pass') issues.push('Independent review did not pass');
  if (record.plan?.request_kind === 'calculation' && !review?.independent_check_evidence_ids?.some(id => executions.some(e => e.id === id && e.role === 'reviewer' && e.success))) issues.push('Independent executed check is missing');
}
process.stdout.write(JSON.stringify({ valid: issues.length === 0, issues, limitation: 'Evidence consistency is checked; statistical correctness still requires scientific review.' }, null, 2) + '\n');
if (issues.length) process.exitCode = 1;
