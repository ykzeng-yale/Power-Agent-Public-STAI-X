# Verma Textbook Benchmark (73 Tasks)

## Source

**Verma, J. P. and Verma, Priyam (2020).** *Determining Sample Size and Power in Research Studies: A Manual for Researchers.* Springer Nature Singapore. ISBN: 978-981-15-5204-5. DOI: [10.1007/978-981-15-5204-5](https://doi.org/10.1007/978-981-15-5204-5)

## Overview

All **73 computation tasks** from the Verma textbook — every illustration and exercise with a numerical answer across all chapters. Includes sample size calculations, power estimations, and minimum detectable difference problems.

| Chapter | Topics | Illustrations | Exercises | Total |
|---------|--------|:---:|:---:|:---:|
| Ch. 3 | Mean CI, Proportion CI | 8 | 6 | 14 |
| Ch. 4 | One-sample t, Two-sample t, Power, MDD | 5 | 2 | 7 |
| Ch. 6 | t-tests, paired t, Mann-Whitney, Wilcoxon, proportions, correlations, point biserial, chi-sq GoF, power sub-tasks | 12 | 16 | 28 |
| Ch. 7 | Regression, logistic regression, ANOVA, two-way ANOVA, RM ANOVA, MANOVA, power sub-tasks | 10 | 14 | 24 |
| **Total** | | **35** | **38** | **73** |

## Task Sources

All 73 tasks are **verbatim from the textbook** — 35 worked illustrations with step-by-step solutions (Chapters 3, 4, 6, 7), plus 38 exercises with numerical answers from the textbook's answer keys (including multi-part sub-questions). No tasks are fabricated or reconstructed.

## Results

**Power Agent: 52/73 (71.2%)**

| Category | Tasks | Passed | Rate |
|----------|-------|--------|------|
| Survey estimation (CI) | 14 | 14/14 | **100%** |
| Basic hypothesis tests | 12 | 11/12 | **92%** |
| Power & MDD estimation | 7 | 6/7 | **86%** |
| ANOVA (one-way + two-way) | 7 | 7/7 | **100%** |
| Correlations | 8 | 6/8 | 75% |
| Regression | 6 | 4/6 | 67% |
| RM ANOVA | 6 | 3/6 | 50% |
| Non-parametric tests | 4 | 1/4 | 25% |
| MANOVA | 4 | 0/4 | 0% |

See [comparison-table.md](comparison-table.md) for full per-task results and failure analysis.

## Ground Truths

Ground truths are the G\*Power answers explicitly stated in each illustration's solution or exercise answer key. These are the answers the textbook reports after clicking "Calculate" in G\*Power.

## Evaluation

```bash
# Run all 73 tasks
node cross-benchmark/run-cross-benchmark.js --benchmark=verma-textbook

# Run only exercises
node cross-benchmark/run-cross-benchmark.js --benchmark=verma-textbook --task=verma-Ex

# Evaluate only (skip running)
node cross-benchmark/run-cross-benchmark.js --benchmark=verma-textbook --evaluate-only
```

## Citation

If using this benchmark, please cite the original textbook:

> Verma, J. P. & Verma, P. (2020). *Determining Sample Size and Power in Research Studies: A Manual for Researchers.* Springer Nature Singapore. https://doi.org/10.1007/978-981-15-5204-5
