# Native paired-study forward report

The corrected native skill 2.3.1 completed this exploratory study workflow. The initial 2.3.0 attempt failed at its input classifier and remains preserved in the adjacent failure directory. This result is one native demonstration, with separate planning, implementation and checking sessions.

The supplied marginal measurement SDs are 1.2 and 1.2; mean change is 0.36. The paired Student-t test is two-sided at alpha 0.05, with target power 0.9 and no attrition. The correlations below are sensitivity assumptions, not a known population correlation.

For D = Y2 - Y1, the difference SD is sqrt(sigma1^2 + sigma2^2 - 2*rho*sigma1*sigma2). The calculation uses both noncentral-t rejection tails, df = n - 1, and noncentrality sqrt(n)*delta/sd(D). The official function call explicitly uses paired type, two-sided alternative and strict=TRUE. Each n is n participants, n complete pairs and 2n individual measurements. The integer minimum comes from an ascending search over every admissible n, with its preceding design checked.

| Assumed rho | SD of differences | Participants / complete pairs | Measurements | Achieved power | Power at one fewer participant |
| --- | --- | --- | --- | --- | --- |
| 0.25 | 1.469694 | 178 | 356 | 0.901523 | 0.899910 |
| 0.50 | 1.200000 | 119 | 238 | 0.900761 | 0.898315 |
| 0.75 | 0.848528 | 61 | 122 | 0.903226 | 0.898389 |

These displayed values are formatted copies of the accepted computed record. Full-precision fields are in [record.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/record.json) and the installed renderer output [verified-summary.md](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/verified-summary.md).

The candidate R calculation and source-based checker were executed in fresh sessions. The checker first saved its own numerical precheck without candidate code, values or artifacts, then received the frozen candidate and compared them. Its computational method and tolerances, actual shared dependencies, file bindings, warnings and limitations are recorded in [independent-check.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/independent-check.json). The paired participant/pair/measurement arithmetic audit passed on the exact final record. The skill’s independent/equal-cluster reference profiles were not applied to this paired design. Separate sessions and agreement do not constitute mathematical certification.

The per-scenario executed sensitivity files cover the supplied participant grid; the target and assumed correlations are labeled in each figure. Lines connect grid values. They do not determine the integer minimum.

| Assumed rho | CSV | PNG |
| --- | --- | --- |
| 0.25 | [CSV](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.25.csv) | [PNG](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.25.png) |
| 0.50 | [CSV](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.50.csv) | [PNG](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.50.png) |
| 0.75 | [CSV](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.75.csv) | [PNG](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.75.png) |

[Combined CSV](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-combined.csv) · [Combined PNG](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-combined.png) · [Summary CSV](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/scenario-summary.csv)

Executable calculation: [native-calculation.R](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/native-calculation.R). Actual command, stdout/stderr, execution identifier, timing and code digest: [calculation-execution.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/calculation-execution.json). Runtime/session information and all source/artifact hashes are retained with the record and [file-hashes.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/file-hashes.json).

The official [stats::power.t.test page](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/power.t.test.html) documents paired testing and the strict both-tail option. The [Student-t distribution page](https://stat.ethz.ch/R-manual/R-devel/library/stats/html/TDist.html) gives the normal/chi-square representation and one-sample t noncentrality applied to participant differences. Receipts cover complete HTTP bodies of those single HTML pages without local truncation; no broader manual or PDF coverage is claimed. Retrieved R-devel documentation and installed runtime versions are recorded separately.

The exact-power interpretation is conditional on independent normally distributed participant differences and complete pairs. The true correlation remains unknown. This forward session made no paid API call, benchmark oracle/results access, deployment, credential access, global settings change or skill/runtime edit. Root supplied the corrected 2.3.1 revision after the preserved 2.3.0 failure.

Final record SHA256: 3820474ba451266f2dc5464ef1149d102384e60242aa43d3992aaa68bf9b1699.
