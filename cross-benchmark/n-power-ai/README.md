# N-Power AI Benchmark (Ruan et al., 2025)

## Paper

**Title:** N-Power AI: A Specialized Agent Framework for Automated Sample Size and Power Analysis in Clinical Trial Design

**Authors:** Peifeng Ruan, Ismael Villanueva-Miranda, Jialiang Liu, Donghan M. Yang, Qinbo Zhou, Guanghua Xiao, Yang Xie (UT Southwestern Medical Center)

**Source:** bioRxiv 2025.02.06.636776 (February 8, 2025)

**DOI:** [10.1101/2025.02.06.636776](https://doi.org/10.1101/2025.02.06.636776)

## Benchmark Details

- **12 tasks** (6 scenarios x 2 task types: sample size + power estimation)
- Ground truths computed with **R pwrss v0.3.1** on R 4.2.2
- Prompts are **verbatim** from the paper's Table S1

### Scenarios

| # | Statistical Test | Sample Size GT | Power GT | Source |
|---|-----------------|---------------|----------|--------|
| 1 | One-sample t-test | 37 (total) | 0.90 | Biostatistics 11th Ed, Ex 7.2.4 |
| 2 | Two-sample t-test | 42 (per group) | 0.81 | UCLA Stats |
| 3 | Paired t-test | 42 (total/pairs) | 0.81 | UCLA Stats / G*Power |
| 4 | One-way ANOVA | 13 (per group) | 0.81 | UCLA Stats |
| 5 | Chi-square (2x5) | 13,069 (total) | 0.80 | Gao et al. 2020 |
| 6 | Cox PH model | 294 (per group) | 0.80 | Rosner Biostatistics 7th Ed |

## Published LLM Results (from paper)

### Sample Size Calculations

| Model | S1 (37) | S2 (42/grp) | S3 (42) | S4 (13/grp) | S5 (13069) | S6 (294/grp) |
|-------|---------|-------------|---------|-------------|------------|--------------|
| **N-Power AI** | 37 (0%) | 42 (0%) | 42 (0%) | 13 (0%) | 13069 (0%) | 294 (0%) |
| GPT o1 | 35 (-5%) | 41 (-2%) | 51 (+21%) | 22 (+69%) | 13000 (-1%) | 144 (-51%) |
| GPT 4o | 35 (-5%) | 41 (-2%) | 51 (+21%) | 33 (+154%) | 2596 (-80%) | 14 (-95%) |
| Claude 3.5 | 35 (-5%) | 37 (-12%) | 40 (-5%) | 20 (+54%) | 3738 (-71%) | 596 (+103%) |
| Gemini 1.5 | 36 (-3%) | 41 (-2%) | 40 (-5%) | 49 (+277%) | 6340 (-51%) | 141 (-52%) |

### Power Estimates

| Model | S1 (0.90) | S2 (0.81) | S3 (0.81) | S4 (0.81) | S5 (0.80) | S6 (0.80) |
|-------|-----------|-----------|-----------|-----------|-----------|-----------|
| **N-Power AI** | 0.90 (0%) | 0.81 (0%) | 0.81 (0%) | 0.81 (0%) | 0.80 (0%) | 0.80 (0%) |
| GPT o1 | 0.91 (+1%) | 0.65 (-20%) | 0.71 (-12%) | 0.70 (-14%) | 0.96 (+20%) | 0.86 (+7%) |
| GPT 4o | 0.085 (-91%) | 0.88 (+9%) | 0.70 (-14%) | 0.69 (-15%) | 1.00 (+25%) | 0.43 (-46%) |
| Claude 3.5 | 0.93 (+3%) | 0.85 (+5%) | 0.82 (+1%) | 0.83 (+2%) | 0.95 (+19%) | 0.89 (+11%) |

## Evaluation Methodology

- **Metric:** Percentage error = (estimated - reference) / reference x 100
- **Tolerance:** We use 5% relative error or absolute tolerance matching the paper's R ground truth
- N-Power AI achieved 0% error on all 12 tasks by routing calculations through R/pwrss

## Files

- `tasks.json` - 12 tasks with verbatim prompts and R-verified ground truths
- `raw-responses/power-agent.json` - Power Agent raw responses (after running)
- `evaluation.json` - Per-task pass/fail results (after evaluation)
- `comparison-table.md` - Power Agent vs. published LLM results (after evaluation)
