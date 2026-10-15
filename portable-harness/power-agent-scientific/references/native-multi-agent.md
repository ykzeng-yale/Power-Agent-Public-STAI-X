# Native separate-session workflow

Use the host's real delegation/session tools. This protocol does not launch a host, grant permissions or promise that a particular Codex/Claude Code installation supports delegation. Inspect the available tool and its context-inheritance behavior first. A separate reviewer must return actual work; naming three roles inside one conversation is single-agent execution.

1. **Planner and implementation context.** Preserve the exact current request and adopted earlier user inputs, staged source/data bytes and complete study specification. Record the host model/tool versions when available. Define the planned test, reporting units, source questions, output files and review scope. Keep private expected answers outside every agent context. The implementation agent executes code and preserves actual output and artifacts.
2. **Launch the checker.** Start a fresh separate context using the host's documented tool. Supply the original request, user/source data, specification and source receipts, with comparable search/execution tools. Do not include current candidate code, numerical answer or artifacts in its initial context; disable inherited candidate history where supported. A shared preliminary model interpretation can already contain answer clues: preserve and disclose that limitation rather than claiming full answer blindness.
3. **Freeze the executed precheck.** Ask the checker to select and execute a source-grounded calculation or diagnostic before disclosure. Retain its actual launch/session ID, code, stdout/stderr, exit status and tool receipt. Save hashes of these bytes before revealing the candidate. Its source and method can share dependencies with the implementation; separate sessions do not guarantee independent errors.
4. **Disclose and compare.** Give that checker the exact candidate code/output/artifacts and their hashes. Ask it to compare against its preserved precheck and the requested specification, inspect numerical units/search criteria and requested media, and return anchored issues or a qualified pass. Preserve the comparison receipt and candidate digest. Code or media it did not inspect must remain unverified.
5. **Repair with evidence.** Return the actual failed check and the minimal issue to the implementation agent. Preserve the rejected candidate. Obtain an actual check of the repaired candidate; a previous verdict does not cover changed code. Stop when the requested review is complete, the authorized budget ends, launch fails, or a repair yields no new progress. A stopping condition is not a scientific pass.

Use private per-task files rather than an accumulating cross-project memory of numerical answers. Save requested and executed modes, session topology, actual provider/tool failures and review scope. If the checker cannot launch or execute, retain `requested_workflow_mode: "multi"`, `executed_workflow_mode: "single"`, `independent_review_status: "unavailable"`. Deterministic reference tools remain useful self-check evidence and must not be labelled a separate agent.

## Optional receipt-consistency check

`python3 scripts/check-native-review.py review-manifest.json --output review-audit.json` checks a small explicit record after actual host execution. Paths are relative to the manifest directory; use private saved copies of actual receipts. The JSON shape is:

```json
{
  "schema_version": "1.0.0",
  "requested_mode": "multi",
  "implementation_session_id": "actual-host-session-id",
  "reviewer_session_id": "different-actual-host-session-id",
  "input_files": ["request.txt", "specification.json"],
  "reviewer_initial_files": ["request.txt", "specification.json"],
  "launch_receipt": "reviewer-launch.json",
  "precheck": {"code": "precheck.R", "output": "precheck.stdout", "receipt": "precheck-tool.json", "exit_code": 0, "completed_at": "2026-10-14T12:00:00Z"},
  "disclosure": {"candidate_code": "candidate.R", "candidate_output": "candidate.stdout", "at": "2026-10-14T12:01:00Z"},
  "comparison": {"receipt": "comparison-tool.json", "candidate_code_sha256": "actual-code-sha256", "candidate_output_sha256": "actual-output-sha256", "completed_at": "2026-10-14T12:02:00Z", "verdict": "pass"},
  "files_sha256": {"request.txt": "actual-sha256"}
}
```

`files_sha256` must cover every referenced file. Input files must be represented in the reviewer's initial file set, and that set must exclude the candidate code/output bytes. This is a declared-file check: it cannot see undisclosed chat history or prove the timestamps, role claims or receipt authenticity. A passing audit means **receipt consistency**, not observed delegation, guaranteed blindness, mathematical independence, general scientific validation or benchmark success. Keep the actual host-tool logs for review. Use this helper when a reusable multi-agent record is requested; it is not a prerequisite for asking a clarification question.
