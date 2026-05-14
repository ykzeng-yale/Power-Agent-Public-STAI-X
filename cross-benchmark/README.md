# Cross-Benchmark Evaluation

Evaluation of Power Agent on published benchmark tasks from four independent sources on AI-powered sample size and power analysis.

## Benchmarks

| Benchmark | Tasks | Types | Ground Truth | Paper |
|-----------|-------|-------|-------------|-------|
| [N-Power AI](n-power-ai/) | 12 (6 SS + 6 power) | t-tests, ANOVA, chi-sq, Cox PH | R `pwrss` v0.3.1 | [Ruan et al., bioRxiv 2025](https://doi.org/10.1101/2025.02.06.636776) |
| [Sebo & Wang](sebo-wang-24/) | 24 (all SS) | CI estimation, t-tests, chi-sq, correlation, regression rules | G*Power + Arifin calculator | [Sebo & Wang, Family Practice 2025](https://doi.org/10.1093/fampra/cmaf069) |
| [PowerGPT](powergpt-8/) | 8 (all SS) | t-tests, ANOVA, proportions, Cox PH, log-rank | R `pwr` + `powerSurvEpi` | [Lu et al., arXiv 2025](https://arxiv.org/abs/2509.12471) |
| [Verma Textbook](verma-textbook/) | 73 (SS + power + MDD) | CI estimation, t-tests, paired t, Mann-Whitney, Wilcoxon, proportions, correlation, chi-sq GoF, regression, ANOVA, RM ANOVA, MANOVA, power estimation | G*Power software | [Verma & Verma, Springer 2020](https://doi.org/10.1007/978-981-15-5204-5) |

**Total: 117 tasks** across 4 independent benchmarks.

## Summary Results

| Benchmark | Tasks | Power Agent | MAPE | Best Published |
|-----------|-------|-------------|------|---------------|
| N-Power AI | 12 | **7/12 (58.3%)** | 8.2% | N-Power AI: 12/12 (100%) |
| Sebo & Wang | 24 | **19/24 (79.2%)** | 7.4% | ChatGPT-4o: MAPE 2.8% |
| PowerGPT | 8 | **7/8 (87.5%)** | 6.3% | PowerGPT (tool): 94.1% accuracy |
| Verma Textbook | 73 | **52/73 (71.2%)** | — | — |
| **Combined** | **117** | **85/117 (72.6%)** | — | — |

### Key Observations

- Power Agent achieves **exact matches (0% error)** on most tasks: one-sample t, two-sample t (SS), chi-square, Cox PH, correlation, CI estimation, regression rules
- **100% accuracy** on CI estimation (14/14), basic hypothesis tests (8/8), and standard ANOVA (7/7)
- The 5 N-Power AI failures stem from paired t-test and ANOVA scenarios where `pwr` and `pwrss` packages use different parameterizations
- Sebo & Wang failures include: V11 (unequal group allocation), V13/V14 (two-correlation comparison), A5 (extraction error), A6 (McNemar's test)
- The single PowerGPT failure (ANOVA) is a parameterization issue — agent computed n=45 using a different effect size interpretation vs. the expected n=30
- Verma Textbook failures concentrate in non-parametric tests (G*Power uses Laplace parent distribution), RM ANOVA (correlation correction), MANOVA (Pillai's V conversion), and exact binomial tests

## How to Run

```bash
# Run a specific benchmark
node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai

# Run all benchmarks
node cross-benchmark/run-cross-benchmark.js --benchmark=all

# Evaluate only (skip running, use existing responses)
node cross-benchmark/run-cross-benchmark.js --benchmark=all --evaluate-only

# Run a single task or task prefix
node cross-benchmark/run-cross-benchmark.js --benchmark=n-power-ai --task=npa-s1-ss
node cross-benchmark/run-cross-benchmark.js --benchmark=verma-textbook --task=verma-Ex
```

Requires:
- `ANTHROPIC_API_KEY` environment variable (for LLM-based value extraction)
- Power Agent API running (default: Cloud Run deployment)

## Evaluation Methodology

### Value Extraction
Agent responses are processed by Claude Sonnet to extract the final numerical answer (sample size or power value). This handles varied response formats consistently. Manual verification is applied for known per-group vs total extraction ambiguities.

### Tolerance Rules
Each benchmark uses tolerance rules appropriate to its methodology:

- **N-Power AI:** Absolute tolerance matching R `pwrss` ground truths (2-5% depending on task complexity)
- **Sebo & Wang:** 5% of ground truth as absolute tolerance (matching paper's MAPE methodology)
- **PowerGPT:** Integer rounding tolerance with method-dependent allowance for survival analysis
- **Verma Textbook:** Task-specific absolute tolerance (2-5% of ground truth)

### Comparison Metrics
- **Pass rate:** Percentage of tasks where extracted value is within tolerance
- **MAPE:** Mean Absolute Percentage Error across all tasks
- **Per-task comparison:** Side-by-side with published LLM results

## Directory Structure

```
cross-benchmark/
├── README.md                    # This file
├── run-cross-benchmark.js       # Runner script
├── n-power-ai/
│   ├── README.md                # Paper citation + methodology
│   ├── tasks.json               # 12 tasks (verbatim from paper)
│   ├── raw-responses/           # Power Agent raw API responses
│   ├── evaluation.json          # Per-task results
│   └── comparison-table.md      # vs. published LLM results
├── sebo-wang-24/
│   ├── README.md
│   ├── tasks.json               # 24 tasks (constructed from paper)
│   ├── raw-responses/
│   ├── evaluation.json
│   └── comparison-table.md      # vs. ChatGPT-4.0/4o
├── powergpt-8/
│   ├── README.md
│   ├── tasks.json               # 8 tasks (1 verbatim + 7 reconstructed)
│   ├── raw-responses/
│   ├── evaluation.json
│   └── comparison-table.md
└── verma-textbook/
    ├── README.md
    ├── tasks.json               # 73 tasks (35 illustrations + 38 exercises)
    ├── raw-responses/
    ├── evaluation.json
    └── comparison-table.md
```

## Citations

1. Ruan P, Villanueva-Miranda I, Liu J, et al. "N-Power AI: A Specialized Agent Framework for Automated Sample Size and Power Analysis in Clinical Trial Design." bioRxiv 2025.02.06.636776.

2. Sebo P, Wang T. "ChatGPT's performance in sample size estimation: a preliminary study on the capabilities of artificial intelligence." Family Practice 2025;42(5):cmaf069.

3. Lu Y, Li L, Zhang D, et al. "Empowering Clinical Trial Design through AI: A Randomized Evaluation of PowerGPT." arXiv:2509.12471, 2025.

4. Verma JP, Verma P. "Determining Sample Size and Power in Research Studies: A Manual for Researchers." Springer Nature Singapore, 2020. ISBN: 978-981-15-5204-5.


