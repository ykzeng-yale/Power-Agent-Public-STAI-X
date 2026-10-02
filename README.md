# Power Agent scientific workflow

Power Agent assists with statistical power and sample-size planning through a structured design specification and executed R code. This release provides a standalone API-backed CLI and an installable scientific skill for Codex and Claude Code. The hosted application is [power-agent.io](https://power-agent.io/).

The runtime defaults to `claude-haiku-4-5-20251001`, verified against the authenticated Anthropic model catalogue on 2 October 2026. Runtime version is `2.2.0`; native skill version is `2.3.1`. Actual model, execution, code hashes, units, assumptions, role calls, resource usage and terminal status are recorded. A model critique or a successful program execution does not establish scientific correctness.

## Implemented workflow

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

`scientific/`, `scripts/` and `portable-harness/` implement this release. `backend/`, `frontend/`, `public/`, the old `examples/*.js`, `benchmark/`, assets and the award submission are retained prototype/source history; the default CLI does not route through them. Exact evaluated runtime source and hashes are available in `archive/evaluated-harness-2.0.0/` (Mac study) and `archive/evaluated-harness-2.0.1-cloud/` (Linux study). These original snapshots predate the current reference gate. `archive/evaluated-harness-2.1.1/` preserves the exact later stopped-dispatch release: six actual responses and 34 undispatched stubs, with no 40-response behavior claim. `archive/evaluated-harness-2.1.2/` preserves the exact complete 40-response release regression; the2.1.3 count-role correction is preserved separately in archive/release-harness-2.1.3. Current2.2.0 is assessed in a separately frozen prospective capability cohort. Original replaced documentation/configuration is preserved in `archive/source-history/`. Old diagrams, expected templates, simulated roles and numerical performance claims are not evidence for the revised release. No new benchmark answers or private credentials are included in the scientific runtime/skill.

MIT: see [LICENSE](LICENSE). R packages retain their own licenses.

Runtime2.2.0 shares bounded search_sources and read_source capabilities between CLI/hosted workflows and all roles. Set TAVILY_API_KEY to enable retrieval; without it the record reports unavailable tools. Source text includes scope, SHA256 and truncation metadata; extraction does not guarantee complete PDF coverage. Actual CSV/PNG/PDF artifacts include execution IDs, size, immutable snapshots, SHA256 and retained bytes. Code executes in a fresh directory each time; restricted Linux blind prechecks additionally use a distinct worker identity before candidate artifacts are revealed. Native skill2.3.1 updates this delegation/retrieval guidance; native host behavior requires separate validation.

For fair topology comparisons, set verificationPolicy=required in both modes and identical maxModelCalls, maxExecutions, deadlineMs and budgetProfile. The capability cohort uses18/8/300s and26/12/540s profiles in both modes, with6searches and4document reads. These are operation ceilings, not matched dollar spend or guaranteed reserved phase operations. Hosted product defaults give multi26/12 and single18/8; report that capacity difference when comparing hosted results.


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
