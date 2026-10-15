# AI-only inspection of the opaque main64 figure packet

All 23 original PNGs across 22 opaque cases were inspected from actual pixels against the supplied comparison CSVs. All64 cases are retained. No PDF was present, so zero PDF pages were rendered and no page-hash/content claim is made.

This is an AI-only assessment by Codex session `/root/paper`, not a human rating or validated visual judge. The eight-item human rubric and blank form are unchanged. Conditions, primary outcomes and model-review verdicts were not opened. Artifact contents can reveal clues, so complete blinding is not guaranteed.

AI-only case assessments: {'not_delivered': 42, 'pass': 15, 'fail': 6, 'unverifiable': 1}. Figure assessments: {'pass': 16, 'fail': 6, 'unverifiable': 1}. Of the42 cases without a figure,16 are incomplete-input requests that do not ask for one;26 calculation cases lack a delivered figure. These counts do not modify task scoring.

Defects include a Cox plot that clips four required scenarios, clipped annotations/missing glyphs in paired figures, two MDE figures lacking t-quantile-approximation disclosure, and one MDE curve whose values strongly disagree with the independent comparison. A separate Cox plot leaves the participant unit implicit and is marked unverifiable under the axis-unit item. Companion CSV agreement alone is not figure validation.

## Per opaque case

### case_0066a73f8fbf4dba8ad48422906fbad6

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_039e81d1dbe043ffbcd71411964b1f3b

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_114794d8a5fc44c4b67b465c83f49239

Case AI-only assessment: `pass`.

Original `case_114794d8a5fc44c4b67b465c83f49239/figure_650207ee10e6456fb001b392be3c737e.png`; SHA256 `7729c5fa75505669940bcfbe3638d691eb7531c3a47e48f0a1e8a6c8108107ab`; 3000×2100 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_18cb2165ab99465cb2622553d7816c46

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_296d490d3dc743719d8c4756ab078a00

Case AI-only assessment: `fail`.

Original `case_296d490d3dc743719d8c4756ab078a00/figure_a4c3c1f99b8b48588f8e84656021c575.png`; SHA256 `8970f42d8de4d5e94be2333dcff3aa9168f922f412fda2036f1c3ef4da953823`; 800×600 pixels. Comparison CSV SHA256 `2262da11d2be33732d797d6bd8453082d7ca4c5398ee568394e45e0346047adf`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots minimum detectable standardized mean difference against total clusters, not achieved power.
- Item 2: **pass** — Five requested grid points are shown at18,24,30,36,42 total clusters, with no silently added nuisance scenario.
- Item 3: **pass** — The axes name total clusters and MDE in standardized/outcome-SD units.
- Item 4: **pass** — Visible MDE positions agree within rendering resolution with approximately0.3630,0.3053,0.2691,0.2436,0.2243 at the five total-cluster counts.
- Item 5: **pass** — The title identifies the open-cohort stepped-wedge design; one MDE curve needs no multi-curve legend.
- Item 6: **pass** — No target-power line is requested in this MDE-versus-clusters plot; displayed total-cluster designs are integers.
- Item 7: **fail** — The title/legend identifies open-cohort MDE and target power 0.80 but nowhere labels the required t-quantile approximation. It does not explicitly claim exact achieved power; approximation disclosure is still absent.
- Item 8: **pass** — Axis labels, title, five marks and annotations are readable and not clipped.

### case_2a913ef4e2a749a19444b43ed688b150

Case AI-only assessment: `pass`.

Original `case_2a913ef4e2a749a19444b43ed688b150/figure_9818fbedb86545c39ac7bc032297eebe.png`; SHA256 `84fd71fb9cada2d3944f0fc4124e1aa1ecdd63202d600d9f6c014c578d3de0b1`; 800×600 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_2fc03f36b0574e11bf85f82b6417ca67

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_304a64e9279046ecb77116e49131dcd0

Case AI-only assessment: `pass`.

Original `case_304a64e9279046ecb77116e49131dcd0/figure_57f5a56b57fb4923971a74f637c58859.png`; SHA256 `bfbcbc55acb0cbf8b8ae82dcdd379f78aea4575606682bd0cd48addc480975cc`; 3000×2100 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_30ae593790f94447a61368510b9604c1

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_30de09d74baf4044bccbf7dccc12a1f4

Case AI-only assessment: `pass`.

Original `case_30de09d74baf4044bccbf7dccc12a1f4/figure_0718ebda056c4904a44c5d42a5612b54.png`; SHA256 `62e5805f0ba5bcc43e0e0e540b5ea029708a372b6d5bd7f4c801cf2ad55c9ef2`; 900×600 pixels. Comparison CSV SHA256 `b9d1255ecf19420a880ad6b94c1997d7d30bad484dc4a7d3ece6b573a079d748`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots omnibus ANOVA power against participants per group rather than total participants or a directional t-test statistic.
- Item 2: **pass** — All21 requested n=5 through25 grid values are covered by the curve; visible markers, where present, include endpoints and the n16 design.
- Item 3: **pass** — The x axis names participants per group; the y axis gives power on the0–1 scale.
- Item 4: **pass** — The curve agrees within rendering resolution with approximately0.35356 at n5,0.70969 at n10,0.89572 at n15,0.91672 at n16 and0.99119 at n25.
- Item 5: **pass** — The title names balanced four-group one-way ANOVA. A single scientific curve needs no multi-scenario legend; target/design marks are distinguishable.
- Item 6: **pass** — The target line is at0.90 and the selected n16 is an integer, not the continuous inversion.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, marks and legend/caption are legible. Some base-R legends have grid lines behind them, but the required text remains readable.

### case_323f5b78d65b413b845f39644a93d225

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_33e065ff6ac94c9fa4bee34be0271d87

Case AI-only assessment: `fail`.

Original `case_33e065ff6ac94c9fa4bee34be0271d87/figure_5102f733a8da4968a9d2fd325af7e099.png`; SHA256 `9c10eae1d1bd759e0da6bf453ec0ee0f3c658dbcf7c72554c9e6030bb22c262e`; 1000×700 pixels. Comparison CSV SHA256 `5613c357e13a0d7d8a6791e13e57b4c24323f43078263647a6fe61be074792c3`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots total sample size against R-squared, with a curve for each event probability, as requested.
- Item 2: **fail** — The upper plotting limit is approximately 115 participants. Four requested points are outside it: event probability 0.60 at R-squared 0.10, 0.1837, 0.30 (N=118,130,151), and probability 0.738 at R-squared 0.30 (N=123). Only eight of the twelve grid points are visible.
- Item 3: **fail** — The y axis explicitly names total participants. The x axis names R-squared but its parenthetical says Correlation with other covariates rather than squared multiple correlation/variance explained; those quantities differ.
- Item 4: **unverifiable** — Visible red points at approximately 71,79,87,101 and visible blue/green points agree with the reference counts, but the clipped four positions cannot be assessed from pixels.
- Item 5: **pass** — The title identifies Cox regression/continuous-covariate adjustment; legend labels all three event probabilities.
- Item 6: **pass** — No target-power line is requested for this recruitment-count plot; the marked recommendations are integers.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **fail** — The blue and green curves leave the top plotting region before their final requested scenarios. This obscures scientifically required curve content despite readable text.

### case_35c2f20f229c4b52aca4c5caf4bd254d

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_38c847acf5e6431cbc9ee20b4311c763

Case AI-only assessment: `pass`.

Original `case_38c847acf5e6431cbc9ee20b4311c763/figure_d68a057402ba4fa99a3d90df7bc87476.png`; SHA256 `941e99afddcca82990efa1724b0896d696c64c36b37e2a0286bae285350f1b0d`; 800×600 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

Original `case_38c847acf5e6431cbc9ee20b4311c763/figure_fed2a8a43cc5433286e8600ac3ddd302.png`; SHA256 `d036197ed4b96da12bc6b456d9e9003a42ddf53bd993265f80d75a4aa0df5759`; 800×600 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_3a78771df4724782aa33cd914ab23f35

Case AI-only assessment: `fail`.

Original `case_3a78771df4724782aa33cd914ab23f35/figure_d50d5fd934374cb9999f7bc3d6c3502e.png`; SHA256 `7d1dee4fca1dfb50ce675ac965c0948418942fd903a7735c24f3c7667c05258f`; 800×600 pixels. Comparison CSV SHA256 `7a2196c831d8c7f3457ea315405b220aece7b5439326412d09193a33f1a41109`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots required participant/pair count against within-person correlation, as requested, rather than power or individual measurement count.
- Item 2: **pass** — All four rho scenarios0.20,0.40,0.60,0.80 are marked, with counts165,125,84,44. Lines connect the visibly marked scenarios rather than presenting intermediate rho values as measured points.
- Item 3: **pass** — The x axis names within-person correlation/rho; the y axis explicitly names participants or pairs. One participant supplies one complete pair in the stated question.
- Item 4: **pass** — The four plotted positions agree within rendering resolution with the reference integer counts165,125,84,44.
- Item 5: **pass** — The title or in-figure method annotation identifies the paired design; there is a single count curve, so no multi-curve legend is necessary.
- Item 6: **pass** — This task asks for count versus rho, not a power curve requiring a horizontal target line. Target0.90 appears in the title/annotation and all four displayed recommendations are integer counts.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **fail** — The second title line is clipped at the right image boundary. The n=165 annotation is cut at the plot top, and the upper-right annotation box obscures the end of the n=125 annotation. The four data markers themselves remain visible.

### case_3adff14bc70e42b5a0d1753b00e2c713

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_3cee011f5b0649de88a28336918bdd18

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_3d79d352af424d0285bc4e8873f3e709

Case AI-only assessment: `pass`.

Original `case_3d79d352af424d0285bc4e8873f3e709/figure_4460a64cdfac4479aa1a59be4aa0d5f1.png`; SHA256 `fb230a773e9cf919cda97740f480a2a45a24ede3db0d1591724f7bd65f1b2104`; 1500×1050 pixels. Comparison CSV SHA256 `9983e6a5fd05bb76be17dcfedbcf6b0edadb3367226c34ba7a93e3c6ae8ea29b`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots required total participants against hazard ratio for the supplied event approximation.
- Item 2: **pass** — All twelve markers are present: four hazard ratios0.50,0.60,0.70,0.80 for each of three event probabilities1,0.70,0.50.
- Item 3: **pass** — The x axis names hazard ratio; the y axis explicitly names total sample size in participants.
- Item 4: **pass** — Visible counts agree within rendering resolution: at HR0.50 the curves are approximately66,94,132; at HR0.80 approximately632,902,1262, with intermediate scenario ordering/positions matching the reference.
- Item 5: **pass** — The title names the Schoenfeld/Hsieh-Lavori method; the three curves have event-probability labels and distinct styles.
- Item 6: **pass** — No target-power line is requested for this recruitment-count plot; counts are integer recommendations and the target0.80 is stated in the title.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, legend and all twelve marks remain within the plotting region and are legible.

### case_4205a8c83bb64e84941a4e5d8a967607

Case AI-only assessment: `pass`.

Original `case_4205a8c83bb64e84941a4e5d8a967607/figure_76c57b9a60e34e17a13fc6716799fc8d.png`; SHA256 `6910c7c5510338e52eb4c1228196b51b271c249e0b93032d4c3174e36c98def3`; 800×600 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_42601646fb87429a9912c5fbe30a8224

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_46064c9783774f35b787d2b19e390e69

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_4624b38e97814189bec613e84f8aaf4a

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_48a25b9ea0d24204ac5f7b8df01ca1f6

Case AI-only assessment: `pass`.

Original `case_48a25b9ea0d24204ac5f7b8df01ca1f6/figure_9fc339cb0c514e9a83afe65ceb701c15.png`; SHA256 `f024d1221f44ce04fbd8b50c63bc13da197c903550909c17f4224ed825541c63`; 800×600 pixels. Comparison CSV SHA256 `b9d1255ecf19420a880ad6b94c1997d7d30bad484dc4a7d3ece6b573a079d748`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots omnibus ANOVA power against participants per group rather than total participants or a directional t-test statistic.
- Item 2: **pass** — All21 requested n=5 through25 grid values are covered by the curve; visible markers, where present, include endpoints and the n16 design.
- Item 3: **pass** — The x axis names participants per group; the y axis gives power on the0–1 scale.
- Item 4: **pass** — The curve agrees within rendering resolution with approximately0.35356 at n5,0.70969 at n10,0.89572 at n15,0.91672 at n16 and0.99119 at n25.
- Item 5: **pass** — The title names balanced four-group one-way ANOVA. A single scientific curve needs no multi-scenario legend; target/design marks are distinguishable.
- Item 6: **pass** — The target line is at0.90 and the selected n16 is an integer, not the continuous inversion.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, marks and legend/caption are legible. Some base-R legends have grid lines behind them, but the required text remains readable.

### case_502fc52b0a504dc799863df772f6d021

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_51e23d06ff314317ad8569aecd6f07f7

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_5eb98fbadaf446e68fbbc0284f5ef06b

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_6669aa707c204c83b2070427a063bde6

Case AI-only assessment: `pass`.

Original `case_6669aa707c204c83b2070427a063bde6/figure_b5204219c9734f2d9e380c8a1adcabf5.png`; SHA256 `1091ef75941d050372cc97cf978a43d35c4171ac7a24e40c6ff5f950b529440d`; 800×600 pixels. Comparison CSV SHA256 `7a2196c831d8c7f3457ea315405b220aece7b5439326412d09193a33f1a41109`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots required participant/pair count against within-person correlation, as requested, rather than power or individual measurement count.
- Item 2: **pass** — All four rho scenarios0.20,0.40,0.60,0.80 are marked, with counts165,125,84,44. Lines connect the visibly marked scenarios rather than presenting intermediate rho values as measured points.
- Item 3: **pass** — The x axis names within-person correlation/rho; the y axis explicitly names participants or pairs. One participant supplies one complete pair in the stated question.
- Item 4: **pass** — The four plotted positions agree within rendering resolution with the reference integer counts165,125,84,44.
- Item 5: **pass** — The title or in-figure method annotation identifies the paired design; there is a single count curve, so no multi-curve legend is necessary.
- Item 6: **pass** — This task asks for count versus rho, not a power curve requiring a horizontal target line. Target0.90 appears in the title/annotation and all four displayed recommendations are integer counts.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — All required text, symbols, count labels and markers are legible at the viewed scale.

### case_6831254714c34a5690ff2c06a95bbd49

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_6a08af81951d49c0a50354e06d09f1fb

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_767f46a78c1846e9ad8e3c68f6364bcc

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_7846a9ac491c48ab8c88a53703085ff2

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_796993ae2c574776aa3662768c268151

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_7c241c1f0b574a51b8b4650e340ccd7e

Case AI-only assessment: `pass`.

Original `case_7c241c1f0b574a51b8b4650e340ccd7e/figure_3aca6f94ac0a41abbc98ac7bb6660205.png`; SHA256 `716ae888288d85e8bd22f73c0b31cf8e766b9a6032d33ee5af21a15d2b821044`; 800×600 pixels. Comparison CSV SHA256 `b9d1255ecf19420a880ad6b94c1997d7d30bad484dc4a7d3ece6b573a079d748`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots omnibus ANOVA power against participants per group rather than total participants or a directional t-test statistic.
- Item 2: **pass** — All21 requested n=5 through25 grid values are covered by the curve; visible markers, where present, include endpoints and the n16 design.
- Item 3: **pass** — The x axis names participants per group; the y axis gives power on the0–1 scale.
- Item 4: **pass** — The curve agrees within rendering resolution with approximately0.35356 at n5,0.70969 at n10,0.89572 at n15,0.91672 at n16 and0.99119 at n25.
- Item 5: **pass** — The title names balanced four-group one-way ANOVA. A single scientific curve needs no multi-scenario legend; target/design marks are distinguishable.
- Item 6: **pass** — The target line is at0.90 and the selected n16 is an integer, not the continuous inversion.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, marks and legend/caption are legible. Some base-R legends have grid lines behind them, but the required text remains readable.

### case_854b23c1fb58476597ab36fefcb379a2

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_876478850b0a4cc3aff12e2b18f4d9bc

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_87ecdda452024184a0ff9eecfa7756ea

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_8c93fab83d4d49749c07cf12cf4f5d51

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_909cba32f2ab4f5aae2e64619ef7186c

Case AI-only assessment: `fail`.

Original `case_909cba32f2ab4f5aae2e64619ef7186c/figure_73c706375c8f4219a021feeb657c483e.png`; SHA256 `67a05c1ae114abeb9175f1c771af0146e78d9689923ac69a2f76c94380a29d35`; 900×600 pixels. Comparison CSV SHA256 `7a2196c831d8c7f3457ea315405b220aece7b5439326412d09193a33f1a41109`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots required participant/pair count against within-person correlation, as requested, rather than power or individual measurement count.
- Item 2: **pass** — All four rho scenarios0.20,0.40,0.60,0.80 are marked, with counts165,125,84,44. Lines connect the visibly marked scenarios rather than presenting intermediate rho values as measured points.
- Item 3: **pass** — The x axis names within-person correlation/rho; the y axis explicitly names participants or pairs. One participant supplies one complete pair in the stated question.
- Item 4: **pass** — The four plotted positions agree within rendering resolution with the reference integer counts165,125,84,44.
- Item 5: **pass** — The title or in-figure method annotation identifies the paired design; there is a single count curve, so no multi-curve legend is necessary.
- Item 6: **pass** — This task asks for count versus rho, not a power curve requiring a horizontal target line. Target0.90 appears in the title/annotation and all four displayed recommendations are integer counts.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **fail** — SD subscripts in the subtitle and annotation box render as missing-glyph/hex boxes; the long first title reaches the right boundary. Count markers and axes remain interpretable, but symbols/text are not fully legible.

### case_932d773bd5064f60b3a0f3b50a8ec8b8

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_95ceadd1f0364b25b15fc2d3ef1b813c

Case AI-only assessment: `pass`.

Original `case_95ceadd1f0364b25b15fc2d3ef1b813c/figure_9bc989712f294360aff59735b6fd4f67.png`; SHA256 `f167f3d44ce20f90175fc77258aa9f4acadc11f5ed5ee60532d9beb6ed50484b`; 800×600 pixels. Comparison CSV SHA256 `7a2196c831d8c7f3457ea315405b220aece7b5439326412d09193a33f1a41109`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots required participant/pair count against within-person correlation, as requested, rather than power or individual measurement count.
- Item 2: **pass** — All four rho scenarios0.20,0.40,0.60,0.80 are marked, with counts165,125,84,44. Lines connect the visibly marked scenarios rather than presenting intermediate rho values as measured points.
- Item 3: **pass** — The x axis names within-person correlation/rho; the y axis explicitly names participants or pairs. One participant supplies one complete pair in the stated question.
- Item 4: **pass** — The four plotted positions agree within rendering resolution with the reference integer counts165,125,84,44.
- Item 5: **pass** — The title or in-figure method annotation identifies the paired design; there is a single count curve, so no multi-curve legend is necessary.
- Item 6: **pass** — This task asks for count versus rho, not a power curve requiring a horizontal target line. Target0.90 appears in the title/annotation and all four displayed recommendations are integer counts.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — All required text, symbols, count labels and markers are legible at the viewed scale.

### case_990bea4674744f8391033eb8b46da820

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_a054793c3f5d4974b681136ed9ae22dd

Case AI-only assessment: `fail`.

Original `case_a054793c3f5d4974b681136ed9ae22dd/figure_2a3bf26c42784e669147555f5b63599a.png`; SHA256 `a37c28d2ae11392f116e891345ba5bbdc6dc442e487ac36a38db34bcacd4cc37`; 800×600 pixels. Comparison CSV SHA256 `7a2196c831d8c7f3457ea315405b220aece7b5439326412d09193a33f1a41109`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots required participant/pair count against within-person correlation, as requested, rather than power or individual measurement count.
- Item 2: **pass** — All four rho scenarios0.20,0.40,0.60,0.80 are marked, with counts165,125,84,44. Lines connect the visibly marked scenarios rather than presenting intermediate rho values as measured points.
- Item 3: **pass** — The x axis names within-person correlation/rho; the y axis explicitly names participants or pairs. One participant supplies one complete pair in the stated question.
- Item 4: **pass** — The four plotted positions agree within rendering resolution with the reference integer counts165,125,84,44.
- Item 5: **pass** — The title or in-figure method annotation identifies the paired design; there is a single count curve, so no multi-curve legend is necessary.
- Item 6: **pass** — This task asks for count versus rho, not a power curve requiring a horizontal target line. Target0.90 appears in the title/annotation and all four displayed recommendations are integer counts.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **fail** — The sigma subscripts in the subtitle render as missing-glyph/hex boxes. Dense rotated y-axis tick labels also reduce normal-scale readability; all four annotated count markers remain visible.

### case_a1f375ab1f0045009808a0f7d34c01ab

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_a3ad558b7ced4709808a01e861823084

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_a87866ddb1c345d580069e1427bc1790

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_aad0c4b07e454e5b89c88284ab959fe6

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_b9ecf6eb47b04612a31f62ac3e87f981

Case AI-only assessment: `pass`.

Original `case_b9ecf6eb47b04612a31f62ac3e87f981/figure_27c1c356480346aeae2a7af1bd1972da.png`; SHA256 `dd8c4d4c0fbabeab9d52957b42d16b57573829d85037a587c5aa1580a60de1d5`; 800×600 pixels. Comparison CSV SHA256 `b9d1255ecf19420a880ad6b94c1997d7d30bad484dc4a7d3ece6b573a079d748`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots omnibus ANOVA power against participants per group rather than total participants or a directional t-test statistic.
- Item 2: **pass** — All21 requested n=5 through25 grid values are covered by the curve; visible markers, where present, include endpoints and the n16 design.
- Item 3: **pass** — The x axis names participants per group; the y axis gives power on the0–1 scale.
- Item 4: **pass** — The curve agrees within rendering resolution with approximately0.35356 at n5,0.70969 at n10,0.89572 at n15,0.91672 at n16 and0.99119 at n25.
- Item 5: **pass** — The title names balanced four-group one-way ANOVA. A single scientific curve needs no multi-scenario legend; target/design marks are distinguishable.
- Item 6: **pass** — The target line is at0.90 and the selected n16 is an integer, not the continuous inversion.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, marks and legend/caption are legible. Some base-R legends have grid lines behind them, but the required text remains readable.

### case_ba990d119b2041b7abb6e4ff1c00b870

Case AI-only assessment: `pass`.

Original `case_ba990d119b2041b7abb6e4ff1c00b870/figure_4c03276c5249454c8f4fe03632466262.png`; SHA256 `58e367c691a9f514ddf2aef080320acb24abc76cf66099e19687f4dbedd41f10`; 1000×700 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_bd27cbd84a7c4496825fb122e968a397

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_becbff14ea424758925487be775f50ad

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_c40240d2b9814297859c486759e8e430

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_c9914e67fb2948fb94e382614876bac6

Case AI-only assessment: `unverifiable`.

Original `case_c9914e67fb2948fb94e382614876bac6/figure_2fbabdd1f13c4dbe9ac138b362d0ee6b.png`; SHA256 `08bf5d8d77b8b79d09f0b0ec21c811f08c386000c24c19ff119dc3f1a6347a2e`; 1800×1200 pixels. Comparison CSV SHA256 `5613c357e13a0d7d8a6791e13e57b4c24323f43078263647a6fe61be074792c3`. AI-only figure assessment: `unverifiable`.

- Item 1: **pass** — The figure plots total sample size against R-squared, with a curve for each event probability, as requested.
- Item 2: **pass** — All twelve requested R-squared/event-probability combinations are represented by visible markers.
- Item 3: **unverifiable** — The x axis explicitly identifies R-squared as a squared multiple correlation coefficient. The y axis says Total Sample Size (N) but does not explicitly identify the participant unit, leaving recruitment-versus-event count terminology implicit. The plotted counts agree with the participant reference; unit clarity requires human assessment.
- Item 4: **pass** — Visible curves agree within rendering resolution with total counts71,79,87,101 at probability0.90;86,96,106,123 at0.738;106,118,130,151 at0.60.
- Item 5: **pass** — The title identifies Cox regression/continuous-covariate adjustment; legend labels all three event probabilities.
- Item 6: **pass** — No target-power line is requested for this recruitment-count plot; the marked recommendations are integers.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — All required curve points and labels are legible and within the plotting region.

### case_cfad3bb439ee449ea37ed22466bb19b3

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_d267c6c847704b8ba2c34a86a3642854

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_d5c2091c37424af3a38417f7153f1c14

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_d9e3a3d3f9c4488b82f4521e86651148

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_dbe24b9ac8a048e5bfaf95376168fa6a

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_e8cb1fa71cca4a8cb2d380929d382ae3

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed. The request supplies incomplete inputs and asks for clarification; no sensitivity figure is requested. This no-delivery status is not itself a failed clarification task.

### case_eade452dda9d4d5cb0455dab56aa9b07

Case AI-only assessment: `pass`.

Original `case_eade452dda9d4d5cb0455dab56aa9b07/figure_bb54dea85dff4b62b1d9f5ce98b9d9b1.png`; SHA256 `c0f92461474ab9cc6eee4c45f29da7c709e5f0d5a85ff236b7429418ad8a5557`; 1200×700 pixels. Comparison CSV SHA256 `1c544e9999e2e4d89f1560dc874b0a74403ac3060ee482fa0b41e88572024e82`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots power against participants per arm for the requested two-sample t design, with no fractional integer recommendation.
- Item 2: **pass** — The visible curve spans the requested n=5 to160 range. The companion CSV has all32 requested five-participant grid rows; no separate nuisance scenario is omitted. Dense connecting lines are interpreted only within image resolution.
- Item 3: **pass** — The x axis names participants per arm; power is displayed on a0–1 probability scale.
- Item 4: **pass** — Curve positions agree within rendering resolution with power approximately0.07465 at n5,0.50945 at n50,0.81601 at n100 and0.95452 at n160. The n110 marker, where present, is approximately0.85221.
- Item 5: **pass** — The title identifies a two-sample t test and the supplied d/alpha. There is one scientific power curve; any legend clearly distinguishes target/design annotations.
- Item 6: **pass** — The target line is at0.85 and any selected count is integer110, consistent with the stated task.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Text, axes, curve and target/design annotations are legible; no required part is visibly clipped.

### case_ed3d1bf2806a451bb862079016f7ca76

Case AI-only assessment: `fail`.

Original `case_ed3d1bf2806a451bb862079016f7ca76/figure_753efe54e8f94b74b35790d313ab7919.png`; SHA256 `8b13bc02cbeb3472474122d4c780b785580b89b175faece46771c2e74fb155bf`; 900×600 pixels. Comparison CSV SHA256 `2262da11d2be33732d797d6bd8453082d7ca4c5398ee568394e45e0346047adf`. AI-only figure assessment: `fail`.

- Item 1: **pass** — The figure plots minimum detectable standardized mean difference against total clusters, not achieved power.
- Item 2: **pass** — Five requested grid points are shown at18,24,30,36,42 total clusters, with no silently added nuisance scenario.
- Item 3: **pass** — The axes name total clusters and MDE in standardized/outcome-SD units.
- Item 4: **fail** — The plotted MDEs are approximately 0.889,0.863,0.851,0.844,0.839 for 18,24,30,36,42 total clusters. The comparison values are 0.362995,0.305250,0.269134,0.243606,0.224272. This disagreement is much larger than pixel resolution, and the accompanying candidate CSV contains the same wrong values.
- Item 5: **pass** — The title identifies the open-cohort stepped-wedge design; one MDE curve needs no multi-curve legend.
- Item 6: **pass** — No target-power line is requested in this MDE-versus-clusters plot; displayed total-cluster designs are integers.
- Item 7: **fail** — The title/annotation does not identify the required t-quantile approximation. Power=0.80 is stated as a parameter rather than verified achieved power, but the approximation label is absent.
- Item 8: **pass** — Axis labels, title, five marks and annotations are readable and not clipped.

### case_ef4b69ceed7848ac8d22de78f7e6b933

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_f113060343ad426692ebf0259ab3b84b

Case AI-only assessment: `pass`.

Original `case_f113060343ad426692ebf0259ab3b84b/figure_4d6071c6532d4088bd522dab1ecf6339.png`; SHA256 `33f242e4a3ba1e521e2ea5e090c64e70b21705f2052c7ba0e4de3c278855dac2`; 3000×1800 pixels. Comparison CSV SHA256 `b9d1255ecf19420a880ad6b94c1997d7d30bad484dc4a7d3ece6b573a079d748`. AI-only figure assessment: `pass`.

- Item 1: **pass** — The figure plots omnibus ANOVA power against participants per group rather than total participants or a directional t-test statistic.
- Item 2: **pass** — All21 requested n=5 through25 grid values are covered by the curve; visible markers, where present, include endpoints and the n16 design.
- Item 3: **pass** — The x axis names participants per group; the y axis gives power on the0–1 scale.
- Item 4: **pass** — The curve agrees within rendering resolution with approximately0.35356 at n5,0.70969 at n10,0.89572 at n15,0.91672 at n16 and0.99119 at n25.
- Item 5: **pass** — The title names balanced four-group one-way ANOVA. A single scientific curve needs no multi-scenario legend; target/design marks are distinguishable.
- Item 6: **pass** — The target line is at0.90 and the selected n16 is an integer, not the continuous inversion.
- Item 7: **not_applicable** — This is not the NIH MDE task.
- Item 8: **pass** — Axes, title, marks and legend/caption are legible. Some base-R legends have grid lines behind them, but the required text remains readable.

### case_f21cf02a857148dbaab09fb03a8c1fcc

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

### case_ff9066c01d4b43338f1f07fcc8b2640f

`not_delivered` — No figure is present in this opaque case; no pixel content was assessed.

## Provenance and limits

Packet manifest SHA256: `fb60620e2f0346a05d175eb8409af6547c1a86aa2b16a6ed1022e5c30974cf3a`. All162 manifest files matched recorded SHA and size. Blank human form SHA256 remained `000fc0651ffc2854d0c3e7b8d819fd292eef6653b85592d55606dc4368416c7b`; rubric SHA256 remained `208ef29df60f7d19b3d4466f4bcb6ad66d1e64e9d4f52bec433c15c8e25e0882`.

Exact original artifact/data digests, item-level observations, CSV arithmetic comparisons and all64 cases are in `ai-only-inspection.json`. PDF source/page digest fields are null/empty because no PDF was delivered. CSV arithmetic checks compare provided files; they do not recompute reference science or certify clinical assumptions. No source/helper/original figure, manuscript, frozen evaluator or human form was edited. No model/provider/R call, deployment or public export was performed.
