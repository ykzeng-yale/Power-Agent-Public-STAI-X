# Sebo & Wang 24-Scenario Benchmark (2025)

## Paper

**Title:** ChatGPT's performance in sample size estimation: a preliminary study on the capabilities of artificial intelligence

**Authors:** Paul Sebo (University of Geneva), Ting Wang (Emporia State University)

**Journal:** Family Practice, 42(5), 2025

**DOI:** [10.1093/fampra/cmaf069](https://doi.org/10.1093/fampra/cmaf069)

**PMID:** 40910515 | **PMCID:** PMC12411907

## Benchmark Details

- **24 sample-size tasks** (V1-V14 from Verma textbook, A1-A10 from Arifin website)
- Ground truths from **G*Power** (Verma examples) and **Arifin Sample Size Calculator**
- All tasks are estimation-type (sample size calculation only, no power estimation tasks)
- Prompts are constructed from the paper's scenario descriptions (exact reworded prompts are in supplementary PDF)

### Task Types

| Type | Count | Examples |
|------|-------|---------|
| Mean CI estimation | 3 | V1, V2, A1 |
| Proportion CI estimation | 3 | V3, V4, A2 |
| One-sample t-test | 2 | V5, V7 |
| Two-sample t-test | 3 | V6, V8, A3 |
| Paired t-test | 2 | V9, A5 |
| Mann-Whitney (non-parametric) | 1 | V10 |
| Chi-squared (two proportions) | 2 | V11, A4 |
| McNemar's test (paired proportions) | 1 | A6 |
| Pearson correlation | 3 | V12, V13, A7 |
| Two correlations comparison | 1 | V14 |
| Multiple linear regression (rule of thumb) | 1 | A8 |
| Multiple logistic regression (EPP rule) | 1 | A9 |
| Exploratory factor analysis (rule of thumb) | 1 | A10 |

### Notable Features

- Several tasks include **dropout rate adjustments** (A1-A10), testing whether the model correctly inflates sample size
- V2 uses **99% CI with t-distribution** (not z), a common pitfall
- V10 requires **ARE correction** for non-parametric test
- V11 has **unequal group allocation** (ratio 1:1.25)
- A8, A9, A10 use **rule-of-thumb** formulas (not statistical power formulas)

## Published ChatGPT Results

| Metric | GPT-4.0 R1 | GPT-4.0 R2 | GPT-4o R1 | GPT-4o R2 |
|--------|-----------|-----------|----------|----------|
| **MAPE (SD)** | 4.1% (4.4) | 5.1% (6.8) | 3.1% (4.2) | **2.8% (3.9)** |
| **MdAPE (IQR)** | 2.2% (0.3-6.3) | 2.1% (0.3-8.0) | 1.0% (0-5.1) | 0.7% (0-4.6) |

ChatGPT-4o was significantly more accurate than ChatGPT-4.0 (P=0.01).

### Per-Task Published Results (Best GPT-4o Round)

| Task | True N | GPT-4o Best | % Error |
|------|--------|-------------|---------|
| V1 | 24 | 25 | 4.2% |
| V2 | 26 | 23 | -11.5% |
| V3 | 504 | 505 | 0.2% |
| V4 | 897 | 897 | 0% |
| V5 | 19 | 18 | -5.3% |
| V6 | 24/grp | 23/grp | -4.2% |
| V7 | 41 | 39 | -4.9% |
| V8 | 42/grp | 42/grp | 0% |
| V9 | 21 | 24 | 14.3% |
| V10 | 47/grp | 49/grp | 4.3% |
| V11 | 636 & 795 | 622 & 778 | -2.2% |
| V12 | 19 | 19 | 0% |
| V13 | 129 | 129 | 0% |
| V14 | 251/grp | 248/grp | -1.2% |
| A1 | 272 | 272 | 0% |
| A2 | 322 | 322 | 0% |
| A3 | 52/grp | 52/grp | 0% |
| A4 | 189/grp | 189/grp | 0% |
| A5 | 23 | 23 | 0% |
| A6 | 47 | 44 | -6.4% |
| A7 | 33 | 35 | 6.1% |
| A8 | 88 | 88 | 0% |
| A9 | 382 | 382 | 0% |
| A10 | 288 | 286 | -0.7% |

## Evaluation Methodology

- **Primary metric:** Mean Absolute Percentage Error (MAPE)
- **Tolerance:** We use 5% of ground truth as absolute tolerance (matching paper's methodology)
- Tasks with dropout adjustments: tolerance includes the dropout-adjusted final value

## Files

- `tasks.json` - 24 tasks with constructed prompts and verified ground truths
- `raw-responses/power-agent.json` - Power Agent raw responses (after running)
- `evaluation.json` - Per-task pass/fail results (after evaluation)
- `comparison-table.md` - Power Agent vs. ChatGPT-4.0/4o results (after evaluation)
