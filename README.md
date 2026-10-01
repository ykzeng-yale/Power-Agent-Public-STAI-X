# Power Agent scientific workflow

Power Agent assists with statistical power and sample-size planning through a structured design specification and executed R code. This release provides a standalone API-backed CLI and an installable scientific skill for Codex and Claude Code. The hosted application is [power-agent.io](https://power-agent.io/).

The runtime defaults to `claude-haiku-4-5-20251001`, verified against Anthropic's model catalogue on 1 October 2026. Runtime version is `2.1.2`; native skill version is `2.2.5`. Actual model, execution, code hashes, units, assumptions, role calls, resource usage and terminal status are recorded. A model critique or a successful program execution does not establish scientific correctness.

## Implemented workflow

- **Single:** design planning and implementation share a conversation. Numerical results require actual successful R execution.
- **Multi:** the design planner, implementation agent and reviewer have separate conversations/calls. The reviewer must execute a separate quantitative check before an accepted numerical pass. One repair is allowed by default. Roles using the same model can share errors.
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

Native development checks retained failures: an initial Claude missing-input run invented defaults; another run used a factor-of-two variance error while its unit arithmetic was consistent. After the correction, a fresh missing-input variant stopped and a supplied cluster variant passed actual R execution, reference/unit checks and an independent Python calculation. Prompt instructions alone cannot enforce arbitrary native-agent compliance. The mathematical protocol was tested with native2.2.1;2.2.2 added final-record reporting/digest binding. Bundle2.2.5 contains shared runtime2.1.2 with actual-stdout JSON parsing and explicit effect/preceding-design name mapping; it adds no native model trial and leaves the native mathematical/report helpers unchanged. Model-authored prose is not automatically certified.

## Validation and environment

```bash
npm ci
npm test
```

The thirty-two scientific/API/reference tests cover real R failure and environment filtering, fresh-process state, numeric grounding, actual reviewer execution, failed/budgeted review outcomes, clarification, source paths, session ownership, atomic allowance reservation and workspace cleanup/export/cancellation. API tests use local mocks and need the pinned development dependencies; no API key or live database is used. Portable tests cover input recognition, units, limited mathematical reference checks and stale/tampered-record reporting.

[Docker instructions](docs/PORTABLE-CONTAINER.md) provide a public R 4.4.1/Node 20 recipe with pinned `jsonlite`, `pwr` and `pmsampsize`, independent of the private production image. It contains no credentials. Provision additional pinned packages at build time when a study requires them. The hosted deployment used its existing private production base; that base is not needed for the portable recipe.

The original Mac experiment used a frozen2.0.0 core. After that study finished,2.0.1-cloud changed only the Linux file-descriptor limit128→512 and version metadata; workflow/executor/CLI hashes remained identical. Fifteen of 120 original primary attempts were lost to a scorer capture defect and must be reported as instrumentation failures. The Mac installed-package library was mutable. These limitations preclude presenting that development cohort as complete, immutable-environment evidence. After the Linux study, a live follow-up used an incorrect factor-of-two pooled-t noncentrality and returned 44 per arm for 90% power at d=.5. Runtime 2.1.0 adds a narrow, independently executed reference gate for the declared two-sided equal-allocation normal/common-SD pooled-t/no-attrition profile. It rejects that candidate and confirms 86 per arm. Unsupported profiles explicitly skip this check; declared-plan checks do not establish source-input validity or general correctness. Focused saved-candidate replays provide component regression checks. A separately frozen runtime 2.1.2 Linux release regression uses the same 20 exposed tasks once per mode, with its own immutable image, protocol and complete planned denominator; results are reported separately in the benchmark repository. These reused cases are not an external holdout. Current source-audited benchmark work is maintained in [power-agent-benchmark](https://github.com/ykzeng-yale/power-agent-benchmark); this repository's old 106-task suite is historical and has not become a newly validated benchmark by inclusion here.

## Source history

`scientific/`, `scripts/` and `portable-harness/` implement this release. `backend/`, `frontend/`, `public/`, the old `examples/*.js`, `benchmark/`, assets and the award submission are retained prototype/source history; the default CLI does not route through them. Exact evaluated runtime source and hashes are available in `archive/evaluated-harness-2.0.0/` (Mac study) and `archive/evaluated-harness-2.0.1-cloud/` (Linux study). These original snapshots predate the current reference gate. `archive/evaluated-harness-2.1.1/` preserves the exact later stopped-dispatch release: six actual responses and 34 undispatched stubs, with no 40-response behavior claim. Original replaced documentation/configuration is preserved in `archive/source-history/`. Old diagrams, expected templates, simulated roles and numerical performance claims are not evidence for the revised release. No new benchmark answers or private credentials are included in the scientific runtime/skill.

MIT: see [LICENSE](LICENSE). R packages retain their own licenses.
