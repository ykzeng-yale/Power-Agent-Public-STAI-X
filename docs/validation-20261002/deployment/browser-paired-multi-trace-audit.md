# Browser paired follow-up: retained failure audit

This 2.2.0 multi-agent follow-up stopped before a candidate or reviewer was accepted. It used 12 model calls and five actual R executions in 170.290 seconds. The solver reached its configured nine-call/five-execution phase ceiling while global capacity and the 540-second deadline remained. Its three captured files and printed numerical calculations remain failed-run evidence, not a completed scientific answer.

The downloaded record SHA-256 is `0f3604cbb746fd73a14bec20077aa8a0ed83ea8a6b2b8051af895b3ea09cf481`; the unchanged frozen harness SHA-256 is `7fcde84beda8d5dcd5058a370ade3cb639f6b761ae3557b608dbfa8564876fd3`. The audit made no provider, model or R calls and changed no runtime, frozen protocol or scorer.

## Concrete failure chain

- **e1, successful coder:** calculated minima and powers but printed them without results-row JSON. `computed` is null. A saved RData object did not become a captured artifact.
- **e2, successful coder:** generated a 45-row CSV and PNG/PDF. Its structured rows describe counts/file status, not the requested minima or attained/preceding powers.
- **e3, failed coder:** a missing closing parenthesis caused an R parse error. The model called this a blind reviewer check, but it was an ordinary coder execution and its partial stdout cannot ground results.
- **e4, successful coder:** serialized minima as `Minimum_n_rho_*` with unit `participants`; later submission renamed them `Minimum_n_correlation_*` and `paired_participants`. Its bare-filename checks in the fresh cwd returned absent CSV/PNG/PDF even though e2 captured real immutable files. It emitted no attained/preceding-power JSON rows.
- **e5, failed coder:** undefined `%+%` stopped the script before the main calculations.
- A sixth execution request was blocked by the phase ceiling; it was not an actual execution. The last answer cited e1/e2/e4, but all nine submitted scientific rows lacked matching successful structured evidence. The harness correctly rejected the submission; the already captured artifact producer e2 was cited correctly.

No reviewer started. Actual verification flags correctly remain false. The rejected summary's assertions that e4 was an independent reviewer and that a blind check had completed are unsupported by the role/phase ledger.

## Sources, files and scientific qualifications

Both roles retrieved sources: two successful searches and two successful document reads, including the official `stats::power.t.test` page. The second read was cached. All ten stored content hashes match. The source callbacks report two additional credits in total; that is provider-reported request usage, not a billing invoice. Retrieval succeeded in this run and did not cause the failure. Receipts qualify provider excerpt versus extracted text scope.

All three e2 artifact byte counts and hashes match their retained base64 bytes. The CSV has 45 finite numeric rows, three rho values and 15 sample sizes from 20 through 300; SD-difference/effect-size columns agree with the declared elementary formulas. These checks do not independently validate the power values. No new power calculation was run. The PNG uses the full 0–1 power range, but its second title line is clipped on both sides. The PDF was not rendered in this audit; stderr retains glyph-conversion warnings. No actual reviewer inspected the artifacts. Accepted final outputFiles is empty because no answer was accepted.

Planner prose also states SD_difference=.600 at rho=.75, contrary to its own formula, which gives .848528. The code uses the formula rather than that mistaken prose value. This arithmetic inconsistency is real, but it is not established as the cause of phase exhaustion or rejected grounding.

## Context and fairness

This was a follow-up in a restored pooled-t chat, not a fresh-chat trial; conversationLength is 12. The downloaded record does not include a separate complete user-request/history payload. Its plan and numerical scripts switched to the paired design and current parameters. The evidence therefore does not demonstrate that earlier context caused the failure. There is no matched fresh-chat or single-mode control, and this one browser demonstration is outside the frozen main cohort. It supplies engineering failure evidence, not a comparative accuracy estimate.

The screenshot shows a green failure panel and “Reference check: not recorded for this historical analysis” on this newly incomplete 2.2.0 run. Reference audit is absent because there is no accepted candidate. Historical wording is incorrect; the parent is fixing frontend-only wording/color without changing the frozen runtime.

## Generalizable post-study proposals, not changes to evaluated 2.2.0

1. Serialize requested scientific quantities from their actual computed variables immediately, separately from file-status rows; preserve exact metric/unit strings and full computed values when submitting. Do not manufacture rows from rounded console text.
2. Inspect captured artifacts through their actual read_path, and distinguish a fresh cwd's missing bare filename from missing immutable evidence. Avoid regeneration caused by that confusion.
3. Tie prose claims about independent review to actual role/phase evidence. A coder's self-labeled blind check is not a separate reviewer.
4. Prospectively assess bounded solver recovery/checkpoints with the same tools and capacity profiles in both modes. Reserved capacity alone cannot ensure review if there is no valid candidate; increasing a ceiling is not evidence of improved accuracy.
5. Reuse source receipts, separate current specifications from quoted prior context, and test history-bearing follow-ups against fresh controls in a later fixed protocol.
6. Check formula/prose agreement and plot readability. Neither file hashes nor ordinary role separation certify mathematical or visual correctness.

The JSON audit records 19/19 passing structural/integrity checks and explicitly makes no scientific accuracy certification.
