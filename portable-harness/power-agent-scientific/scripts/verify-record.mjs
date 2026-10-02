#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateAnswerEvidence, extractComputedResult } from './runtime/scientific-harness.js';
const record = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const issues = [];
if (record.scientificStatus !== 'completed') issues.push('Record is not a completed calculation');
const executions = record.executions || [];
const referenceStatus = record.referenceAudit?.status;
if (referenceStatus === 'failed') issues.push('Reference audit failed; the candidate is not accepted');
const version = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(record.harnessVersion || ''))?.slice(1).map(Number);
const requiresReferenceAudit = version && (version[0] > 2 || (version[0] === 2 && (version[1] > 1 || (version[1] === 1 && version[2] >= 2))));
if (requiresReferenceAudit && !['passed', 'skipped'].includes(referenceStatus)) issues.push('Current runtime requires a passed or explicitly skipped reference audit');
if (referenceStatus != null && !['passed', 'skipped', 'failed'].includes(referenceStatus)) issues.push('Reference audit has an unrecognized status');
if (referenceStatus === 'passed') {
  if (!record.referenceAudit.checks?.length || record.referenceAudit.checks.some(check => check.passed !== true)) issues.push('Passed reference audit contains absent or failed checks');
  if (!executions.some(e => e.id === record.referenceAudit.evidence_id && e.role === 'reference_check' && e.success === true && e.exitCode === 0)) issues.push('Passed reference audit lacks its successful reference execution');
}
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
process.stdout.write(JSON.stringify({ valid: issues.length === 0, issues, reference_audit_status: referenceStatus || 'not_recorded_historical', limitation: 'Evidence consistency is checked; an absent historical audit is not certification. Statistical correctness still requires scientific review.' }, null, 2) + '\n');
if (issues.length) process.exitCode = 1;
