# PowerGPT 8-Scenario: Power Agent Results

| Task | Test | GT | Power Agent | % Error | Pass |
|------|------|-----|-------------|---------|------|
| pgpt-1 | One-sample t | 34 | 34 | 0% | PASS |
| pgpt-2 | Two-sample t | 64 | 64 | 0% | PASS |
| pgpt-3 | Paired t | 52 | 52 | 0% | PASS |
| pgpt-4 | ANOVA | 30 | 45 | 50% | FAIL |
| pgpt-5 | 1-prop z | 160 | 160 | 0% | PASS |
| pgpt-6 | 2-prop z | 162 | 163 | 0.6% | PASS |
| pgpt-7 | Cox PH | 259 | 259 | 0% | PASS |
| pgpt-8 | Log-rank | 111 | 111 | 0% | PASS |

**Power Agent: 7/8 passed (88%)**
**PowerGPT study: 94.1% accuracy (tool-assisted), Reference group: 55.4%**