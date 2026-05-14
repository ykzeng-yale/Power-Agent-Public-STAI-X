# [Award C] Power Agent — Autonomous Power & Sample-Size Analysis Agent

> **Team info**
> | Legal name | Affiliation | Institutional email | Kaggle username |
> |---|---|---|---|
> | Yukang Zeng | Yale University (Biostatistics) | yukang.zeng@yale.edu | [kaggle_username] |
> | [Name 2 — optional] | [Affiliation] | [email] | [kaggle_username] |
>
> **Registered team name:** PowerBot

**GitHub repository:** https://github.com/ykzeng-yale/Power-Agent-Public-STAI-X

---

## What it does

Power Agent is a reusable statistical agent that turns a plain-English study-design question into a verified power or sample-size calculation — it plans the analysis, writes and runs the R code in a sandbox, self-corrects on errors, and returns the result with the reproducible script, a report, and plots. It is built for biostatisticians, clinical researchers, and trial designers who need defensible power analyses without hand-coding `pwr`, `gsDesign`, `swdpwr`, and dozens of other packages. The same agent loop generalizes to any R-based statistical task that needs plan → execute → verify.

## Demo link

- **Live product:** https://power-agent.io/
- **Walkthrough video:** [add video link]

## Why it's reusable

- **Drop-in agent loop.** The plan → generate-R → execute-in-sandbox → observe → self-correct loop is task-agnostic. Point it at a different statistical question and it works without retuning.
- **Sandboxed R execution as a service.** On-demand R execution on Cloud Run with automatic package installation — other agents can call it as a worker.
- **Benchmark-verified.** Evaluated on a 989-task internal power-analysis benchmark plus **117 tasks from 4 independent published benchmarks** (N-Power AI, Sebo & Wang 2025, PowerGPT, Verma textbook), where it reaches **72.6% exact-match** with R/G*Power ground truth — so adopters get a known accuracy floor, not a black box.
- **Reproducibility built in.** Every answer ships the exact R script and a report, so results are auditable and rerunnable.

## Agent Design and Architecture

| Component | What it does |
|---|---|
| Brain / LLM | Claude, multi-model routing — Haiku 4.5 for fast file/intent classification, Sonnet 4.6 for R code generation and the self-correction loop, Opus 4.6 for planning and result interpretation |
| Memory | Conversation state, uploaded data/template context, a persistent R process pool for session continuity, and a cached benchmark ground-truth store for evaluation |
| Planning | A Planning/Inference (PI) agent decides direct-answer vs. code-execution; an orchestrator-worker pattern decomposes the request and routes data tasks to the R coding agent |
| Action | Generates and runs R code; web search (Tavily / Firecrawl) for statistical methods and references; file parsing (PDF / DOCX / CSV); report and plot generation |
| Execution | Sandboxed R execution in isolated Google Cloud Run containers with on-demand CRAN/Bioconductor package installation |
| Observation | Parses R stdout/stderr, detects errors, and iterates with a self-correction loop; validates outputs against expected result templates |
| Response | Chat answer + the reproducible R script + a formatted report (PDF/Markdown) + generated plots and CSVs |

---

*Built with Claude Code. Open-source under MIT. Feedback and contributions welcome.*
