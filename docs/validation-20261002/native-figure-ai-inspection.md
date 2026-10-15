# Native figure AI inspection and package identity verification

Inspection recorded on 2026-10-02 at 07:06:49 UTC by the native orchestrator session /root/native_skill_forward.

This is a post hoc AI inspection of the actual PNG pixels and a read-only file/package consistency check. The candidate results were already known to this inspecting session. No human reviewer, human rating, blinded visual review, accessibility certification, or mathematical certification is claimed. No new provider call or numerical study execution was made. The native scientific artifacts, project-installed skill, candidate, checker and blind-precheck files were not edited.

## Frozen native evidence

The [native file manifest](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/file-hashes.json) contains exactly 126 files. All 126 existing bytes and file sizes matched the manifest; no file was missing and no additional file was found within that frozen directory, excluding the manifest itself as specified by its contract.

Manifest SHA256: 7402417aeba9b4a4c316ebbcb86fa2643d909f5e9494ae53b10a8a5c11294474.

The [final computed record](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/record.json) remains SHA256 3820474ba451266f2dc5464ef1149d102384e60242aa43d3992aaa68bf9b1699, with completed scientific status, requested/executed multi mode, and passed independent numerical review. The primary values below are copies of the existing [native generated summary](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/verified-summary.md), not newly computed results.

| Assumed rho | SD of differences | Participants / complete pairs | Measurements | Achieved power | Power at one fewer participant |
| --- | --- | --- | --- | --- | --- |
| 0.25 | 1.469694 | 178 | 356 | 0.901523 | 0.899910 |
| 0.50 | 1.200000 | 119 | 238 | 0.900761 | 0.898315 |
| 0.75 | 0.848528 | 61 | 122 | 0.903226 | 0.898389 |

These are correlation sensitivity scenarios for iid normally distributed participant differences, with two complete measurements per person and no attrition. The frozen numerical record and existing independent-check evidence supply full precision, integer minimality and the executed CSV comparisons. Pixel inspection does not supply that numerical validation.

## Direct PNG inspection

The native tools.view_image tool returned all four actual PNGs, which were directly inspected in this follow-up. The return did not expose an opaque image-tool result identifier; none is invented. Each image is 1600 by 1000 pixels.

| Actual PNG | AI content and layout observation | Result |
| --- | --- | --- |
| [rho 0.25](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.25.png) | Title and legend identify assumed rho 0.25. Blue grid markers and connecting curve are visible. The participant/pair axis, both-tail power axis, model caption and red dashed target line are readable. | No content/label/layout defect observed |
| [rho 0.50](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.50.png) | Title and legend identify assumed rho 0.50. Brown grid markers and connecting curve are visible. Axis units, caption and target line are readable. | No content/label/layout defect observed |
| [rho 0.75](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-rho_0.75.png) | Title and legend identify assumed rho 0.75. Green grid markers and connecting curve are visible. Axis units, caption and target line are readable. | No content/label/layout defect observed |
| [combined sensitivity](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/native-forward-2.3.1/power-sensitivity-combined.png) | All three assumed correlations and the target are identified in the legend. Color and marker shape distinguish the curves. Their ordering is consistent with the scenario values in the frozen record. Title, axes, caption and legend remain readable. | No content/label/layout defect observed |

In every image, the horizontal axis explicitly states participants with two measurements and one complete pair each, with all requested grid ticks from 20 through 300 in steps of 20. The vertical axis says both-tail power. The red dashed horizontal line and legend identify target power 0.90. The caption identifies mean change 0.36, marginal SD 1.2 and alpha 0.05. No clipping or overlap impairs those labels or the curves at this viewed resolution.

The plots join only the requested grid values. They do not display every admissible integer and must not be used to infer the exact minimum by interpolation. In particular, the rho 0.75 point at 60 participants lies very near the target visually; its recorded power is below the target and the verified integer minimum is 61. High-power values also approach the plot ceiling, so full-precision CSV/record values remain authoritative. Smaller document placement and other rendering sizes were not inspected.

PNG identity was checked against the unchanged native manifest:

| File | Bytes | SHA256 |
| --- | ---: | --- |
| power-sensitivity-rho_0.25.png | 122986 | fd3859158bed9e661ba5f9775c1fa019725436d7edb2b6363629f3fef7101c6d |
| power-sensitivity-rho_0.50.png | 121635 | ce8411e7f11e07b84fd3eb8ebfadb3a2198fd7c3b22758c8b86eb8024ca8cf22 |
| power-sensitivity-rho_0.75.png | 116640 | 0a85a5ba503267f04401243b3d26f19a163774449c1f749c4437d084c5d1f0d5 |
| power-sensitivity-combined.png | 159661 | a8605f0305d8273650bfa474da537beb098ec4738de0249ccb956de457e2f600 |

## Exact distributable and package proof

The verified versioned distributable is [power-agent-portable-harness-2.3.1.zip](</Users/yukangzengcmac/Power-Agent/Power Agent Claude Code 1016/output/jsm2026/power-agent-portable-harness-2.3.1.zip>).

The [public-repository copy](/Users/yukangzengcmac/Power-Agent/Power-Agent-Public-STAI-X/output/jsm2026/power-agent-portable-harness-2.3.1.zip) is byte-identical. Each archive is 66256 bytes, with SHA256 b53b04d9c5ef52c3c89c2ffff74deffa7c2cb3ca31c643c0d00b9d18d7d735f1.

The ZIP has 23 file members. Its CRC check found no corrupt member. Every member matched the current canonical portable-harness source bytes, and all enclosed skill-file SHA256 declarations matched the ZIP bytes. Both the top-level and nested manifests identify native skill 2.3.1 and bundled API runtime 2.2.0.

The read-only checks also matched the actual archives to both saved bundle receipts and matched all seven runtime core members to [runtime-release-manifest.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/runtime-release-manifest.json). No provider workflow or test-final-proof script was re-executed in this inspection.

| Package receipt / proof | SHA256 | Read-only check |
| --- | --- | --- |
| [portable-app-bundle.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/portable-app-bundle.json) | 1777fd5b95589962dd38b19a6d5e766dd808432795110bc69eb8ec1490cdabd2 | Actual ZIP size and SHA match |
| [portable-public-bundle.json](/Users/yukangzengcmac/Power-Agent/jsm-2026/multi-agent-20261002/portable-public-bundle.json) | 17592bd9bf1229062a21685a62b1d1de5437b2d60aab93e2e943e8b30c4d38ee | Actual ZIP size and SHA match |
| runtime-release-manifest.json | f559d41d4aa63c8db20d766710e8c8b337b49ccb7e2fbb95dcdac6e2730dab7b | All seven declared core hashes match archive bytes |

## Provenance caveat

The frozen native project install retains optional bundled scientific-harness.js SHA256 fecbcae37d2b6df6a27aae4962fa4c282dfca1505defca682c84083fec1def37. The final distributable contains the later bundled core SHA256 7fcde84beda8d5dcd5058a370ade3cb639f6b761ae3557b608dbfa8564876fd3. Among the 19 manifest-listed skill files, this is the only current source file that differs from the frozen native installation; its enclosing manifest also necessarily records a different runtime identity.

The native SKILL.md, preflight, native report renderer, unit helper, reference helper and scientific reference documents retain the same hashes as the frozen native installation. The native study used host sessions and native R execution rather than the optional bundled API runner. Accordingly, the successful native study demonstrates this one native workflow under its recorded files and model conditions; it does not establish prospective validation of the later 7fcde bundled core or equivalence to its pinned Haiku API benchmark.

The preceding 2.3.0 gate failure, native setup/tool failures and the checker's first comparator-predicate failure/corrected retry remain preserved. Separate AI sessions share a configured host model and some computational/source dependencies; no statistical independence claim follows from their separation. The exact host model identifier was unavailable. This follow-up adds only the present inspection note outside the frozen native directory.
