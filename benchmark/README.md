# Historical internal benchmark source

This106-task directory is retained source history from the earlier prototype. Its ground-truth assertions, tolerances, expected templates and language-model judge were not independently re-certified as part of the revised release. It must not support a new rigor/accuracy claim merely because it is included in the repository. Its original README is preserved in `../archive/source-history/benchmark/README.md`.

The revised source-audited benchmark project is [power-agent-benchmark](https://github.com/ykzeng-yale/power-agent-benchmark). Keep benchmark answers separate from agent-visible questions; retain attempted failures and instrumentation losses, pin source/model/scorer/environment versions, and use deterministic unit/design/numeric scoring plus independent reference calculations. Root software regression tests exercise harness invariants and are not substitutes for a scientific benchmark.
