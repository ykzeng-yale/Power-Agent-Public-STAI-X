# Internal Benchmark — 106 tasks, four tiers

The internal evaluation suite for Power Agent. Each task is a plain-English
power / sample-size question paired with an R-package-verified ground truth and
a numeric tolerance, organized into four tiers of increasing methodological
complexity.

| Tier | Name | Tasks | Scope |
|---|---|---|---|
| 1 | Basic Comparisons | 30 | t-tests, proportions, chi-square, ANOVA, correlation |
| 2 | Regression & Models | 35 | linear / logistic / Poisson regression, mixed effects, survival |
| 3 | Advanced Designs | 20 | cluster RCTs, stepped-wedge, crossover, factorial, non-inferiority, group-sequential |
| 4 | Prediction Models | 21 | Riley-criteria sample size for developing & validating clinical prediction models |
| | **Total** | **106** | |

## Task schema

```json
{
  "id": "t1-ttest-001",
  "template": "two_sample_ttest",
  "difficulty": "basic",
  "question": "<plain-English study-design question>",
  "expected_template": "two_sample_ttest",
  "ground_truth": { "sample_size_per_group": 64, "power": 0.8, "alpha": 0.05 },
  "tolerance": { "sample_size": 1, "power": 0.03 },
  "source": "<R package / vignette / paper the ground truth comes from>"
}
```

## Layout

```
benchmark/
├── tasks/tier{1,2,3,4}/tasks.json   # task definitions + ground truth
├── evaluator/                        # scoring.js, llm-judge.js
├── run-benchmark.js, runner.js       # runner
├── report.js, config.js
└── *-examples.json                   # source example collections used to build tasks
```

## Run

```bash
node benchmark/run-benchmark.js
```

Ground truth is verified against established R packages (`pwr`, `pwrss`,
`WebPower`, `gsDesign`, `swdpwr`, `longpower`, `powerSurvEpi`, `pmsampsize`, ...).
