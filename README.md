# Power Agent scientific workflow

Power Agent assists with statistical power and sample-size planning through a structured design specification and executed R code. This release provides a standalone API-backed CLI and an installable scientific skill for Codex and Claude Code. The hosted application is [power-agent.io](https://power-agent.io/).

The standalone API runtime defaults to `claude-sonnet-5-5` for scientific roles and `claude-haiku-5-5` for advisory routing. Current source is version `2.4.3`; the native skill is `2.3.3` (native knowledge `1.0.2`). The hosted service separately restores the original Domain Expert, PI and iterative R-coding workflow with semantic report/conclusion review. See [current scientific checks](docs/SCIENTIFIC-CHECKS-20261014.md) for the implementation boundaries and the separate matched 16-attempt comparison. Earlier dated release sections retain their historical scope. Actual models, execution, code hashes, units, assumptions, role calls, resource usage and terminal status accompany run records. A model critique or successful program does not certify statistical validity.

## Standalone API workflow

- **Single:** design planning and implementation share a conversation. Numerical results require actual successful R execution. Required verification uses this author conversation and is labelled self-verification.
- **Multi:** planning, implementation and review have separate conversations. The checker first executes a quantitative check without candidate code, answers or artifacts, then receives the candidate for comparison. Repair receives actual check code/output and requires a fresh check. Complete repair/review cycles are reserved within the fixed global limits. Roles using the same model and design plan can share errors.
- Material missing inputs produce `needs_clarification`. Failed execution, unresolved review and exhausted budgets remain failures; no numeric fallback answer is inserted.
- The structured record distinguishes participants per arm, total participants, events and clusters. The workflow requires selected/preceding-design checks, but model compliance and mathematical correctness still require validation. Simulation requires a generating model, test, seed, trial count, failure handling and Monte Carlo uncertainty.

See [the current architecture](docs/ARCHITECTURE.md), [runtime source hashes](scientific/manifest.json) and [the scientific record contract](portable-harness/power-agent-scientific/references/record-contract.md).

## Run the CLI

The coauthor review release is on branch `jsm-2026/scientific-harness-release`. Obtain it with:

```bash
git clone --branch jsm-2026/scientific-harness-release https://github.com/ykzeng-yale/Power-Agent-Public-STAI-X.git
cd Power-Agent-Public-STAI-X
```


Use Node 20+, R and preinstalled `jsonlite`. The CLI uses Node built-ins; no npm runtime dependency or database/cloud account is required. Provision any other study-specific R packages before execution. Put an Anthropic API key in the process environment, or copy `.env.example` to a private `.env` file. The key is used by the model caller and filtered from R workers.

```bash
npm start -- --mode single --env-file .env --input examples/scientific-request.json --output record.json
npm start -- --mode multi --env-file .env --input examples/scientific-request.json --output record.json
node portable-harness/power-agent-scientific/scripts/verify-record.mjs record.json
```

The example supplies a complete statistical design and contains no expected answer. The JSON result includes real stdout/stderr, exit code, session information, code/evidence digests, structured metric/value/unit rows and call provenance. `completed`, `needs_clarification`, `review_failed`, `budget_exhausted` and `failed` are distinct terminal outcomes. The evidence checker verifies internal consistency rather than methodological correctness.

On macOS, workers provide fresh-process isolation with filtered environments and resource limits; the host filesystem and installed R library are shared. On Linux, the default worker requires a root launcher, Python3 and libseccomp; it drops to an unprivileged run identity, denies networking/metadata and selected sensitive syscalls, and applies resource limits. The launcher provisions the common workspace parent0711 and private run directories0700. Production fails closed if restrictions are unavailable. For explicitly accepted non-root local Linux process-only use, set `POWER_AGENT_LOCAL_R_UNRESTRICTED=1` in the process environment; that opt-out is unavailable with `NODE_ENV=production`. These controls have bounded smoke evidence and are not a comprehensive adversarial sandbox certification.

## Install the scientific skill

```bash
python3 portable-harness/install.py --target codex
python3 portable-harness/install.py --target claude
```

Add `--project /path/to/project` for a project installation. Existing skills are preserved; `--replace` creates a timestamped backup. Invoke `$power-agent-scientific` in Codex or `/power-agent-scientific` in Claude Code after discovery/reload. The skill uses host tools and the host model; its optional pinned API runner is separately versioned. Native runs do not automatically reproduce the API workflow.

The native skill has a conservative input-preflight gate, an arithmetic unit checker, a limited independent-means mathematical reference checker, and a deterministic final-record report renderer. The supported mathematical profiles are common-variance equal-allocation independent normal means, the explicitly requested equal-size cluster normal/design-effect approximation, and equal-allocation two-sample Student-t power. Unfamiliar designs require their own source-based checks and review. The renderer copies verified recorded values and distinguishes a deterministic reference check from a separate agent reviewer.

Native development checks retained failures: an initial Claude missing-input run invented defaults; another run used a factor-of-two variance error while its unit arithmetic was consistent. After the correction, a fresh missing-input variant stopped and a supplied cluster variant passed actual R execution, reference/unit checks and an independent Python calculation. Prompt instructions alone cannot enforce arbitrary native-agent compliance. The mathematical protocol was tested with native2.2.1;2.2.2 added final-record reporting/digest binding. Historical bundle2.2.6 contains shared runtime2.1.3 with actual-stdout JSON parsing and explicit effect/preceding-design name mapping; it adds no native model trial and leaves the native mathematical/report helpers unchanged. Runtime 2.1.3 also separates explicitly labeled n-1 count diagnostics from the selected integer design and checks their count/total arithmetic. Model-authored prose is not automatically certified.

## Validation and environment

```bash
npm ci
npm test
```

Scientific/API/reference/source/artifact tests cover real R failure and environment filtering, fresh-process state, numeric grounding, actual reviewer execution, failed/budgeted review outcomes, clarification, source paths, session ownership, atomic allowance reservation and workspace cleanup/export/cancellation. API tests use local mocks and need the pinned development dependencies; no API key or live database is used. Portable tests cover input recognition, units, limited mathematical reference checks and stale/tampered-record reporting.

[Docker instructions](docs/PORTABLE-CONTAINER.md) provide a public R 4.4.1/Node 20 recipe with pinned `jsonlite`, `pwr` and `pmsampsize`, independent of the private production image. It contains no credentials. Provision additional pinned packages at build time when a study requires them. The hosted deployment used its existing private production base; that base is not needed for the portable recipe.

The original Mac experiment used a frozen2.0.0 core. After that study finished,2.0.1-cloud changed only the Linux file-descriptor limit128→512 and version metadata; workflow/executor/CLI hashes remained identical. Fifteen of 120 original primary attempts were lost to a scorer capture defect and must be reported as instrumentation failures. The Mac installed-package library was mutable. These limitations preclude presenting that development cohort as complete, immutable-environment evidence. After the Linux study, a live follow-up used an incorrect factor-of-two pooled-t noncentrality and returned 44 per arm for 90% power at d=.5. Runtime 2.1.0 adds a narrow, independently executed reference gate for the declared two-sided equal-allocation normal/common-SD pooled-t/no-attrition profile. It rejects that candidate and confirms 86 per arm. Unsupported profiles explicitly skip this check; declared-plan checks do not establish source-input validity or general correctness. Focused saved-candidate replays provide component regression checks. A separately frozen runtime 2.1.2 Linux release regression uses the same 20 exposed tasks once per mode, with its own immutable image, protocol and complete planned denominator; results are reported separately in the benchmark repository. This complete cohort captured all 40 actual responses: strict success was 8/20 single versus 4/20 multi, with median runtimes 30.898 versus 100.3975 seconds. None of its questions activated the narrow inversion gate, so it does not measure that gate's effectiveness. These reused cases are not an external holdout. Current source-audited benchmark work is maintained in [power-agent-benchmark](https://github.com/ykzeng-yale/power-agent-benchmark); this repository's old 106-task suite is historical and has not become a newly validated benchmark by inclusion here.

## Source history

`scientific/`, `scripts/` and `portable-harness/` implement this release. `backend/`, `frontend/`, `public/`, the old `examples/*.js`, `benchmark/`, assets and the award submission are retained prototype/source history; the default CLI does not route through them. Exact evaluated runtime source and hashes are available in `archive/evaluated-harness-2.0.0/` (Mac study) and `archive/evaluated-harness-2.0.1-cloud/` (Linux study). These original snapshots predate the current reference gate. `archive/evaluated-harness-2.1.1/` preserves the exact later stopped-dispatch release: six actual responses and 34 undispatched stubs, with no 40-response behavior claim. `archive/evaluated-harness-2.1.2/` preserves the exact complete 40-response release regression; the2.1.3 count-role correction is preserved separately in archive/release-harness-2.1.3. Archived2.2.0 is assessed in a separately frozen prospective capability cohort; current2.4.1 is a subsequent engineering release whose smoke checks do not replace that cohort. Original replaced documentation/configuration is preserved in `archive/source-history/`. Old diagrams, expected templates, simulated roles and numerical performance claims are not evidence for the revised release. No new benchmark answers or private credentials are included in the scientific runtime/skill.

MIT: see [LICENSE](LICENSE). R packages retain their own licenses.

Runtime2.2.0 shares bounded search_sources and read_source capabilities between CLI/hosted workflows and all roles. Set TAVILY_API_KEY to enable retrieval; without it the record reports unavailable tools. Source text includes scope, SHA256 and truncation metadata; extraction does not guarantee complete PDF coverage. Actual CSV/PNG/PDF artifacts include execution IDs, size, immutable snapshots, SHA256 and retained bytes. Code executes in a fresh directory each time; restricted Linux blind prechecks additionally use a distinct worker identity before candidate artifacts are revealed. Native skill2.3.1 updates this delegation/retrieval guidance; native host behavior requires separate validation.

For fair topology comparisons, set verificationPolicy=required in both modes and identical maxModelCalls, maxExecutions, deadlineMs and budgetProfile. The capability cohort uses18/8/300s and26/12/540s profiles in both modes, with6searches and4document reads. These are operation ceilings, not matched dollar spend or guaranteed reserved phase operations. The evaluated2.2.0 hosted product defaults gave multi26/12 and single18/8. The runtime2.4.1 hosted configuration defaults are multi64/32 and single32/16 with20minutes. Report capacity differences when comparing hosted results; matched topology studies must pass identical explicit profiles. Explicit old profiles retain hard phase caps and minimum reservations unless the new policies are selected.


## Complete 2.2.0 capability study

The 64 planned Linux attempts were all captured before frozen offline scoring: eight exposed tasks, two repeats, required verification in both modes, and identical phase/global caps within each capacity profile. The raw originals remain restricted because they include retrieved document text. The benchmark review branch provides separately identified public redacted derivatives and original/derivative SHA links; those derivatives are not byte-identical raw data or fully re-scoreable without receipt content.

| Condition | Completed with all scalar targets correct | Appropriate clarification | Calculation median seconds |
|---|---:|---:|---:|
| Single / shared | 5/12 | 4/4 | 129.1 |
| Multi / shared | 2/12 | 4/4 | 121.9 |
| Single / expanded | 3/12 | 4/4 | 141.6 |
| Multi / expanded | 5/12 | 4/4 | 158.1 |

Frozen full-contract calculation success is 0/12 in every condition. That score also includes a restrictive exact-document-search chain and three measurement mismatches: an unstated required figure basename, requiring every reviewer check to emit numeric JSON, and exact float equality stricter than the runtime's existing tolerance. These failures are retained and separately audited; actual named-document reads occurred in all 48 calculations. Post hoc contract sensitivities are diagnostic, not preregistered validation or evidence of general accuracy. Scientific errors, incomplete submissions, budget exhaustion and figure defects remain failures rather than being automatically repaired by the evaluation. Component and native demonstrations do not establish that multi always outperforms single.

The selected `docs/validation-20261002/` evidence includes the native 2.3.1 paired-design demonstration, independent numerical checks and retained deployment failures. It used host-native sessions with an unavailable model identifier and unrestricted local tools; it did not run the final pinned API core. The downloadable 2.3.1 package includes the final 2.2.0 API core. Native routing and provenance failures remain recorded; there is no host/API equivalence claim. Linux release checks passed 65/65 and portable checks 11/11 in the final tested image. Captured images and an accepted model review do not certify scientific figure content; human assessment remains pending.

## Post-study 2.2.2 capacity and execution repair

The hosted `hosted-research-v1` configuration replaces the old nine-call/five-R solver bottleneck with elastic non-planner phases under64model calls/32R executions. Full configured review/repair/re-review capacity is protected, with a20minute workflow deadline. The generic executed R serializer supplies only JSON representation helpers; local numerical, unit, provenance and simulation-domain validation remain required. Provider strict-answer schemas retain local checks for bounds the provider cannot enforce. New records distinguish phase/global/deadline stops and include effective remaining capacity.

The hosted service exposes server-managed limits in `/health`; its five-minute signed guest transport ticket preserves the original cookie identity and atomic allowance reservation when streaming directly from Cloud Run. The static Vercel frontend retains same-origin short auth/session calls and never automatically retries a charged analysis. The dedicated30minute Cloud Run and25minute browser timeouts exceed the20minute task ceiling. The five-minute R-call timeout is future workload capacity; no failed2.2.0 case reached its old120second R timeout.

The original 64-attempt scores, retrieved receipts and coauthor source package remain immutable. New production smoke checks are selected engineering demonstrations, not a new representative accuracy comparison. The native skill remains2.3.1; current source/manifest bundles optional API2.3.1. The original `power-agent-portable-harness-2.3.1.zip` remains the historical API2.2.0 package.

Current optional scientific runtime2.2.2 retains the expanded hosted capacity and adds bounded preservation of explicitly requested function options, a conservative literal-result transcription filter, recorded alternate search attempts, and bounded direct public HTML/plain-text reading. These checks do not certify arbitrary mathematics, source interpretation, or visual layout. The retained first2.2.1 hosted demonstration failed scientific/source/figure acceptance; it is not replaced by later adaptive engineering demonstrations.

The subsequent public service restores direct scientific analysis without signup or credits, preserves owner-scoped private history, and applies per-instance/observed-connection admission. Current default reasoning/review is Sonnet5.5; Haiku5.5 supplies bounded advisory routing, whose actual calls are counted. Selected service-restoration checks do not establish unseen-task accuracy or single/multi superiority. The failed first Sonnet canary and prior failed2.2.1 acceptance/2.2.2 deployment remain retained.

Current optional API runtime2.3.1 repairs faithful structured user-effect binding before calculation and compares all repeated power estimates with the same reference tolerance. Native skill2.3.1 is a separate versioned product; no new native-host equivalence or benchmark accuracy claim. The2.3.0 complex success and single completion failure remain preserved.

## Original interface compatibility 2.4.1

[The2.4.1 source boundary](docs/ORIGINAL-UI-COMPATIBILITY-2.4.1.md) distinguishes unchanged core/native protocols from hosted legacy event adaptation. The user rejected the rewritten frontend attempted with2.4.0; its source/evidence and package are retained. The current product reference is the actual Aug5 interface, preserved with a thin transport/context/safe-rendering patch and a server adapter from real multi-agent events. No new result-card/IndexedDB layer is active.

The web requests real multi only; standalone CLI/API scientific routes retain both research modes. The eight-file CLI core still needs no npm runtime dependency or cloud/DB account. Optional file/API/document/report tests use pinned development dependencies. Native2.3.1 instructions/checkers and prior evidence remain exact. Existing file downloads/reupload provide UI continuation; a direct prior-artifact selection control is not exposed in the original interface.

Preliminary input preparation is shared context, not an independent scientific check. In the selected 2.4.1 PDF/DOCX engineering trial, preliminary model interpretations included approximate 63/64-participant suggestions and remained in the reviewer’s original source material. No offline oracle or current candidate answer/code/artifacts were exposed before the recorded numerical precheck. The workflow is therefore candidate-blind after shared preprocessing, not fully answer-blind. This qualification does not change the retained raw records, numerical tolerance, scored studies or native 2.3.1 evidence.

Source identity and engineering tests do not establish a deployment, actual browser/pixel acceptance or scientific accuracy. Root-owned preview/Linux/production/browser receipts record those states separately. Historical scored studies, original failures and all archived bundles remain unchanged. No universal multi superiority or native-host equivalence is claimed.

## Document delivery source release 2.4.2

[The 2.4.2 boundary](docs/DOCUMENT-DELIVERY-2.4.2.md) separates numerical acceptance from required document delivery. Hosted scientific roles receive the actual postprocessor capability; proposed revisions are created after scientific acceptance and before reports. Actual source/file/model/application receipts supersede earlier phase-specific file-delivery statements. A missing required DOCX keeps product delivery partial without rewriting accepted numerical findings or the failed prior trial.

The reference guard now distinguishes explicitly labelled diagnostic source/comparison quantities from the primary selected design, with unchanged formulas and tolerance. Prior 2.4.1 selected scientific, RDS/UI-byte and qualified DOCX checks remain separately scoped. The [October 12 release audit](docs/PRODUCT-RELEASE-20261012.md) records subsequent selected production checks separately from these source-package checks. All old packages and scientific evidence are preserved.

## Production restoration verified October 12, 2026

The original interface and selected complete hosted workflow passed native production validation. The dated [release audit](docs/PRODUCT-RELEASE-20261012.md) records deployment, exact file-byte checks and scientific limits. Earlier source-package status notes and frozen benchmark/native-skill evidence keep their historical scope.


## Prospective source correction after the matched comparison

API2.4.3 clarifies canonical planner unit tokens and rejects annotated strings before computation without converting their meanings. Native2.3.3 clarifies reviewer-session support; the optional kernel and mathematical helper scopes are separate. Prior16 API2.4.2 results and native2.3.2 failures are unchanged. The original hosted production UI/workflow is unchanged by this source-only release. See docs/SCIENTIFIC-CHECKS-20261014.md for separately scoped evidence.
