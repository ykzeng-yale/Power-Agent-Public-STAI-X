# [Award C] Power Agent — Autonomous Power & Sample-Size Analysis Agent

**Team info**

- **Legal name:** Yukang Zeng
- **Affiliation:** Yale University (Biostatistics)
- **Institutional email:** yukang.zeng@yale.edu
- **Kaggle username:** yukangzengyale

**Registered team name:** PowerBot

**GitHub repository:** https://github.com/ykzeng-yale/Power-Agent-Public-STAI-X
**Demo:** https://power-agent.io/
**Submission commit tag:** `award-c-submission`

---

## What it does (plain language)

Power Agent is an autonomous statistical agent for power and sample-size analysis. A user types a study-design question in plain English (*"What sample size do I need for a stepped-wedge cluster trial with 12 clusters, ICC 0.05, to detect a 10 percent reduction in overdose ED visits with 80 percent power?"*), and the agent plans the analysis, selects the appropriate statistical method, writes and executes R code in a sandbox, verifies the result, and returns a reproducible script, a formatted report, and diagnostic plots. When the R code errors or produces an implausible answer, the agent reads the trace and corrects itself.

It is designed for **biostatisticians, clinical trialists, and public-health researchers** who need defensible, auditable power calculations without hand-coding the right package for each design.

---

## Statistical methods covered (four tiers of complexity)

Power Agent organizes its 30+ analysis templates into four tiers, escalating from basic hypothesis tests to modern prediction-model sample-size methodology.

**Tier 1 — Basic hypothesis tests.** Two-sample and paired t-tests, one-sample t-test, two-proportion and one-proportion tests, chi-square tests, one-way and two-way ANOVA, repeated-measures ANOVA, McNemar's test, Mann-Whitney U, correlation analysis.

**Tier 2 — Regression models.** Multiple linear regression, logistic regression, Poisson regression, ANCOVA, with covariate-adjusted effect sizes and correlation structures among predictors.

**Tier 3 — Advanced and clustered designs.** Mixed-effects models, GEE for longitudinal/correlated data, survival analysis (log-rank, Cox proportional hazards) with competing risks, cluster-randomized trials, stepped-wedge cluster-randomized trials, crossover designs, factorial designs, non-inferiority and equivalence trials, group-sequential and adaptive designs with sample-size re-estimation, meta-analysis power, and simulation-based power for arbitrary designs (via `simr`).

**Tier 4 — Prediction-model sample size (Riley et al. methodology).** Minimum sample size for developing clinical prediction models accounting for overfitting, optimism, and precise estimation of overall risk, for binary outcomes, survival outcomes, and continuous outcomes; external validation study sizing; high-dimensional and penalized models (LASSO, ridge, random forest, XGBoost).

Tool selection (which R package and which formula) is part of the planning step, so the agent reasons about the design before it writes code.

---

## Why this is a statistical agent, not just a code agent

The defining feature is **verification against analytical ground truth**. Every calculation is checked against closed-form formulas where available, against established R packages (`pwr`, `gsDesign`, `swdpwr`, `longpower`, `powerSurvEpi`, `pmsampsize`, etc.), and against published textbook values. Discrepancies trigger the self-correction loop. This is what makes the answers trustworthy enough to put in a grant or protocol.

Importantly, Tier 4 (prediction-model sample size via Riley's methodology) is a methodological gap in existing automated tools and a known failure mode for general-purpose AI assistants. Closing this gap is one of Power Agent's main contributions.

---

## Demo

**https://power-agent.io/** is the live product. Ask any power or sample-size question in natural language and watch the agent plan, write R, execute, verify, and return the script and report.

A representative end-to-end run, sized for a two-arm survival trial (HR 0.70, 12-month control median, 24-month accrual, 12-month follow-up), produces results from Schoenfeld, Freedman, and Lachin-Foulkes formulas, cross-validates against `powerSurvEpi`, runs sensitivity analyses over hazard ratio and control median, generates power curves and expected survival curves, and writes a full Markdown/PDF report with all underlying CSVs.

---

## Reproducibility

- **Full source** in the GitHub repository above (MIT-licensed).
- **Quick start** in `README`: clone, `npm install`, set `.env`, `npm start`.
- **Minimal usage examples:** `/examples` folder.
- **Internal benchmark:** `/benchmark` folder contains a **106-task four-tier suite** (Tier 1 basic comparisons: 30, Tier 2 regression & models: 35, Tier 3 advanced designs: 20, Tier 4 prediction models: 21). Each task pairs a plain-English question with R-package-verified ground truth and a numeric tolerance; the folder also includes the evaluator and runner (`node benchmark/run-benchmark.js`).
- **Submission snapshot:** commit tagged `award-c-submission` is the frozen state for review.

---

## Agent design and architecture

**Backbone:** LLM with multi-model routing (Anthropic Claude family), routing lightweight tasks (intent classification, file parsing) to faster models and code generation and planning to stronger models.

**Planning:** A Planning/Inference module classifies the query (direct answer vs. code execution), selects the statistical design and the tier, and chooses the appropriate R package and function. An orchestrator-worker pattern decomposes multi-part requests and routes data tasks to the R coding agent.

**Action:** R code generation, web search for methods references, and parsing of uploaded protocols (PDF, DOCX, CSV) to extract design parameters.

**Execution:** Sandboxed R execution in isolated Google Cloud Run containers, with on-demand CRAN and Bioconductor package installation and a persistent R process pool for session continuity.

**Observation and self-correction:** Parses R `stdout` and `stderr`, detects errors and implausible outputs, and iterates. Outputs are validated against expected result templates and, where available, analytical ground truth.

**Response:** Chat answer, the exact R script, a formatted report (PDF or Markdown), and generated plots and CSVs, all downloadable for audit.

---

## Why it's reusable

- **Task-agnostic agent loop.** The plan, generate, execute, verify, self-correct loop is not specific to power analysis. Point it at another R-based statistical task and the loop still applies.
- **Sandboxed R as a service.** Other agents can call the R execution layer as a worker.
- **Benchmark-verified.** Adopters get a verified accuracy reference across all four tiers, not a black box.
- **Auditable by construction.** Every answer ships the script that produced it.

---

## Relevance to STAI-X 2026

Power Agent embodies the STAI-X goal of **trustworthy statistics-plus-AI**: an LLM that does not just write plausible-looking code, but verifies its output against the statistical literature and the underlying mathematics. The same agent can size studies for the kind of public-health questions this competition targets, e.g., powering a difference-in-differences evaluation of a policy intervention on state-level overdose ED visit rates, or sizing a prediction model for nonfatal-overdose ED-visit risk using Riley's criteria.

---

*Feedback and contributions welcome. Open-source under MIT.*
