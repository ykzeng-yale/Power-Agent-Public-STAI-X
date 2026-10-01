# CLAUDE.md — Power Agent

Persistent guidance for the agent working in this repository.

## What this project is

Power Agent: an autonomous biostatistics agent for power and sample-size analysis.
A natural-language request becomes a verified R-based calculation, returned with the
reproducible script, a report, and plots.

## Core loop

`plan → generate R → execute in sandbox → observe stdout/stderr → self-correct on
error → validate against expected template → report`

## Architecture (orchestrator-worker)

- **Data Manager Agent** (orchestrator) — classifies input (data vs. document) and routes.
- **PI (Planning/Inference) Agent** — decides direct-answer vs. code-execution.
- **Biostatistics Coding Agent** (worker) — generates and runs R, iterates on errors.

See `docs/ARCHITECTURE.md` for the full design.

## Conventions

- **R for biostatistics** (power analysis, mixed models, survival, CRT/SWD designs);
  Python only for general data wrangling.
- Always return the **reproducible R script** alongside any numeric result — answers
  must be auditable.
- Prefer established R packages (`pwr`, `pwrss`, `WebPower`, `gsDesign`, `swdpwr`,
  `longpower`, `presize`, `Superpower`, ...). Do not hand-roll formulas a package implements.
- When an R run errors, **read the actual error and fix the root cause** — do not
  silently fall back to a different method.
- Validate numeric output against the expected result template before reporting.

## R package gotchas (learned)

- `pwr`: use `result[["n"]]`, not `result$n` (partial-matches `result$note`).
- `gsDesign`: S3 object — use `upper$bound`, `lower$bound`, `n.I`, `n.fix`.
- `presize` `prec_rate`: `n` is a text note; use `x` for events.
- `Superpower` `main_results`: effect names are rownames, not a column.

## Verification

- Internal benchmark in `benchmark/` — run `node benchmark/run-benchmark.js`.
- Never report a calculation as complete without executing the R and checking the result.

## Don't

- Don't commit secrets (`.env`, credential JSON). They are gitignored — keep it that way.
- Don't add packages or abstractions beyond what the task needs.
