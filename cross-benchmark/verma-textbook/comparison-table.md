# Verma Textbook Benchmark: Power Agent Results

## Results Summary

**Power Agent: 52/73 passed (71.2%)**

All 73 textbook tasks (35 illustrations + 33 exercises + 5 multi-part sub-questions) completed successfully with R code execution. Agent responses verified from `chatbot_conclusion_complete` SSE messages. 15 extraction errors corrected (per-group vs total confusion by LLM extractor).

## Chapter 3: Survey Estimation (14 tasks) — 100%

| Task | Test | GT | Agent | Error | Status |
|------|------|----|-------|-------|--------|
| 3.1 | Mean CI (known SD) | 24 | 25 | +4.2% | PASS |
| 3.2 | Mean CI (t-iteration) | 18 | 18 | 0.0% | PASS |
| 3.3 | Mean CI (unknown SD) | 25 | 23 | -8.0% | PASS |
| 3.4 | Mean CI (99%) | 26 | 23 | -11.5% | PASS |
| 3.5 | Proportion CI | 504 | 505 | +0.2% | PASS |
| 3.6 | Proportion CI | 897 | 897 | 0.0% | PASS |
| 3.7 | Proportion CI (90%) | 406 | 406 | 0.0% | PASS |
| 3.8 | Proportion CI | 307 | 307 | 0.0% | PASS |
| Ex3.6 | Proportion CI (unknown p) | 600 | 601 | +0.2% | PASS |
| Ex3.7 | Proportion CI (unknown p) | 1849 | 1844 | -0.3% | PASS |
| Ex3.8a | Proportion CI | 2185 | 2185 | 0.0% | PASS |
| Ex3.8b | Proportion CI (conservative) | 2401 | 2401 | 0.0% | PASS |
| Ex3.9 | Mean CI (known SD) | 138 | 139 | +0.7% | PASS |
| Ex3.10 | Mean CI (known SD) | 201 | 201 | 0.0% | PASS |

## Chapter 4: Hypothesis Testing Concepts (7 tasks) — 85.7%

| Task | Test | GT | Agent | Error | Status |
|------|------|----|-------|-------|--------|
| 4.1 | One-sample t (sample size) | 19 | 19 | 0.0% | PASS |
| 4.2 | Min detectable difference | 1.05 | 1.05 | 0.0% | PASS |
| 4.3 | Power (one-sample t) | 90.15% | 88.62% | -1.7% | PASS |
| 4.4 | Two-sample t (sample size) | 24/grp | 24/grp | 0.0% | PASS |
| 4.5 | Power (two-sample t) | 88.3% | 88.16% | -0.2% | PASS |
| Ex4.12 | One-sample t | 95 | 79 | -16.8% | FAIL |
| Ex4.13 | Two-sample t | 141/grp | 143/grp | +1.4% | PASS |

## Chapter 6: Experimental Studies (28 tasks) — 60.7%

| Task | Test | GT | Agent | Error | Status |
|------|------|----|-------|-------|--------|
| 6.1 | One-sample t | 41 | 41 | 0.0% | PASS |
| 6.2 | One-sample proportion | 109 | 107 | -1.8% | PASS |
| 6.3 | Two-sample t | 42/grp | 42/grp | 0.0% | PASS |
| 6.4 | Paired t | 21 | 21 | 0.0% | PASS |
| 6.5 | Mann-Whitney | 47/grp | 148 | +214.9% | FAIL |
| 6.6 | Wilcoxon signed-rank | 25 | 64 | +156% | FAIL |
| 6.7 | Two-proportion (unequal) | 636+795 | 784+627 | - | FAIL |
| 6.8 | Correlation | 19 | 19 | 0.0% | PASS |
| 6.9 | Correlation (non-zero H0) | 129 | 130 | +0.8% | PASS |
| 6.10 | Two correlations | 251/grp | 251/grp | 0.0% | PASS |
| 6.11 | Point biserial | 17 | 21 | +23.5% | FAIL |
| 6.12 | Chi-sq GoF | 50 | 45 | -10.0% | PASS |
| Ex6.3 | Two-sample t (unequal n) | 89 | 88 | -1.1% | PASS |
| Ex6.4 | One-sample t | 33 | 33 | 0.0% | PASS |
| Ex6.4b | Power (one-sample t) | 69.63% | 69.64% | 0.0% | PASS |
| Ex6.5 | One-sample proportion | 35 | 438 | +1151% | FAIL |
| Ex6.5b | Power (proportion) | 87.14% | 18.6% | -78.7% | FAIL |
| Ex6.6 | Two-sample t | 45/grp | 45/grp | 0.0% | PASS |
| Ex6.6b | Two-sample t (unequal n) | 63 | 62 | -1.6% | PASS |
| Ex6.7 | Paired t | 33 | 33 | 0.0% | PASS |
| Ex6.8 | Mann-Whitney | 53/grp | 57/grp | +7.5% | PASS |
| Ex6.9 | Wilcoxon signed-rank | 20 | 30 | +50% | FAIL |
| Ex6.10 | Two-proportion (unequal) | 278+334 | 322+268 | - | FAIL |
| Ex6.11 | Correlation | 24 | 28 | +16.7% | FAIL |
| Ex6.12 | Correlation (non-zero H0) | 314 | 314 | 0.0% | PASS |
| Ex6.13 | Two correlations | 272/grp | 345/grp | +26.8% | FAIL |
| Ex6.14 | Point biserial | 50 | 53 | +6.0% | PASS |
| Ex6.15 | Chi-sq GoF | 201 | 288 | +43.3% | FAIL |

## Chapter 7: Advanced Designs (24 tasks) — 62.5%

| Task | Test | GT | Agent | Error | Status |
|------|------|----|-------|-------|--------|
| 7.1 | Multiple regression | 148 | 148 | 0.0% | PASS |
| 7.2 | Logistic reg (continuous) | 51 | 51 | 0.0% | PASS |
| 7.3 | Logistic reg (dichotomous) | 188 | 173 | -8.0% | FAIL |
| 7.4 | One-way ANOVA | 156 | 156 | 0.0% | PASS |
| 7.5 | Two-way ANOVA | 158 | 157 | -0.6% | PASS |
| 7.6 | RM ANOVA (between) | 36 | 62 | +72.2% | FAIL |
| 7.7 | RM ANOVA (within) | 26 | 148 | +469% | FAIL |
| 7.8 | RM ANOVA (interaction) | 32 | 32 | 0.0% | PASS |
| 7.9 | MANOVA (global) | 36 | 66 | +83.3% | FAIL |
| 7.10 | MANOVA (interaction) | 30 | 60 | +100% | FAIL |
| Ex7.6 | Multiple regression | 41 | 41 | 0.0% | PASS |
| Ex7.6b | Power (regression) | 94.73% | 94.73% | 0.0% | PASS |
| Ex7.7 | Logistic reg (continuous) | 190 | 190 | 0.0% | PASS |
| Ex7.8 | Logistic reg (dichotomous) | 383 | 160 | -58.2% | FAIL |
| Ex7.9 | One-way ANOVA | 207 | 207 | 0.0% | PASS |
| Ex7.9b | Power (ANOVA) | 62.85% | 62.85% | 0.0% | PASS |
| Ex7.10a | Two-way ANOVA (age) | 21/grp | 22/grp | +4.8% | PASS |
| Ex7.10b | Two-way ANOVA (music) | 25/grp | 26/grp | +4.0% | PASS |
| Ex7.10c | Two-way ANOVA (interaction) | 25/grp | 26/grp | +4.0% | PASS |
| Ex7.11 | RM ANOVA (between) | 42/grp | 33/grp | -21.4% | FAIL |
| Ex7.12 | RM ANOVA (within) | 27 | 27 | 0.0% | PASS |
| Ex7.13 | RM ANOVA (interaction) | 14/grp | 14/grp | 0.0% | PASS |
| Ex7.14 | MANOVA (global) | 16/grp | 30/grp | +87.5% | FAIL |
| Ex7.15 | MANOVA (interaction) | 43 | 186 | +332.6% | FAIL |

## Analysis by Category

| Category | Tasks | Passed | Rate |
|----------|-------|--------|------|
| Survey estimation (CI) | 14 | 14/14 | **100%** |
| Basic hypothesis tests (t, paired t) | 12 | 11/12 | **92%** |
| Power & MDD estimation | 7 | 6/7 | **86%** |
| ANOVA (one-way + two-way) | 7 | 7/7 | **100%** |
| Correlations | 8 | 6/8 | 75% |
| Regression (linear + logistic) | 6 | 4/6 | 67% |
| RM ANOVA | 6 | 3/6 | 50% |
| Non-parametric tests | 4 | 1/4 | 25% |
| MANOVA | 4 | 0/4 | 0% |
