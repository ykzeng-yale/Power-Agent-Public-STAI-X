# PowerGPT 8-Scenario Benchmark (Lu et al., 2025)

## Paper

**Title:** Empowering Clinical Trial Design through AI: A Randomized Evaluation of PowerGPT

**Authors:** Yiwen Lu, Lu Li, Dazheng Zhang, et al. (University of Pennsylvania, UTHealth Houston)

**Source:** arXiv:2509.12471 (September 15, 2025)

**URL:** [arxiv.org/abs/2509.12471](https://arxiv.org/abs/2509.12471)

## Important Notes

The exact clinical vignette texts for all 8 scenarios are in **Supplementary Materials A**, which is **not included** in the arXiv PDF. Only Task 1 (hip surgery, one-sample t-test) is visible from Figure 5 of the paper. Tasks 2-8 are **reconstructed** from:
- The paper's described test types (Table in Methods section)
- Standard clinical parameters appropriate for each test type
- R package functions used (`pwr`, `powerSurvEpi`)

The GitHub repository (github.com/x1jiang/pwgpt) returns 404 as of February 2026.

## Benchmark Details

- **8 sample-size tasks** covering the statistical tests evaluated in the paper
- Ground truths computed with **R `pwr`** and **`powerSurvEpi`** packages
- Task 1 uses the verbatim vignette from Figure 5; tasks 2-8 use reconstructed scenarios

### Scenarios

| # | Statistical Test | Sample Size GT | Unit | R Package |
|---|-----------------|---------------|------|-----------|
| 1 | One-sample t-test | 34 | total | pwr |
| 2 | Two-sample t-test | 64 | per group | pwr |
| 3 | Paired t-test | 52 | total (pairs) | pwr |
| 4 | One-way ANOVA | 30 | per group | pwr |
| 5 | One-proportion z-test | 160 | total | pwr |
| 6 | Two-proportions z-test | 162 | per group | pwr |
| 7 | Cox PH model | 259 | per group | powerSurvEpi |
| 8 | Log-rank test | 111 | per group | powerSurvEpi |

## Published Results

This paper reports a **randomized controlled trial** comparing:
- **PowerGPT group** (N=17 users): Used the PowerGPT tool
- **Reference group** (N=18 users): Used traditional methods (textbooks, software, Google; no AI)

| Metric | PowerGPT Group | Reference Group |
|--------|---------------|-----------------|
| Test selection accuracy | **95.6%** | 83.6% |
| Sample size calc accuracy | **94.1%** | 55.4% |
| Average time per question | **4.0 min** | 9.3 min |
| Completion rate | **99.3%** | 77.8% |

PowerGPT equalized performance between statisticians and non-statisticians.

Note: This paper does NOT directly benchmark individual LLMs (GPT-4, Claude, etc.) on these tasks. The comparison is between human users with/without the PowerGPT tool.

## Evaluation Methodology

- **Metric:** Pass/fail based on integer rounding tolerance (ceiling)
- **Tolerance:** We use max(2, ceil(5% * GT)) absolute tolerance
- Survival analysis tasks (Cox PH, log-rank) get larger tolerance due to method-dependent variation

## Files

- `tasks.json` - 8 tasks with clinical vignettes and R-verified ground truths
- `raw-responses/power-agent.json` - Power Agent raw responses (after running)
- `evaluation.json` - Per-task pass/fail results (after evaluation)
- `comparison-table.md` - Power Agent results summary (after evaluation)
