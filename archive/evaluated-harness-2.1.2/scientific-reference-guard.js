/** Narrow deterministic check of declared pooled-t sample-size specifications.
 * This is not a general scientific certifier and does not infer missing inputs.
 */
const normalized = value => String(value || '').toLowerCase().replace(/[_’']/g, ' ').replace(/\s+/g, ' ').trim();
const finite = value => typeof value === 'number' && Number.isFinite(value);
export const POOLED_T_SCOPE = 'Two-sided, equal-allocation, fixed two-independent-normal-group pooled-t sample-size inversion with a common SD and no attrition inflation. Checks the declared plan, not source-input validity or other methods.';

export function pooledTReferenceSpecification(plan) {
  const notes = normalized([plan?.estimand, plan?.hypothesis, ...(plan?.assumptions || []), ...(plan?.scientific_notes || [])].join(' '));
  const method = normalized(plan?.method);
  const tMethod = /two[ -]?sample[ -]?t|noncentral[ -]?t|pooled.*t[ -]?test|power[ .]?t[ .]?test/.test(method);
  const common = /common.*(?:sd|variance|standard deviation)|equal variance|pooled variance/.test(notes);
  const independent = /independent.*(?:groups|samples|normal)|two[ -]?sample/.test(notes);
  const twoGroups = /\btwo[ -]?sample\b/.test(method + ' ' + notes) || /\b(?:two|2)\s+(?:(?:independent|normal|normally|distributed)\s+)*(?:groups|samples)\b/.test(notes);
  const normal = /\bnormal(?:ly)?(?: distributed)?\b/.test(notes);
  const noAttrition = /no attrition|no .*loss to follow|attrition.*not included|no .*dropout/.test(notes);
  if (!tMethod || !common || !independent || !twoGroups || !normal || !noAttrition || plan?.request_kind !== 'calculation' || plan?.calculation_type !== 'sample_size' || plan?.sidedness !== 'two-sided' || plan?.allocation_ratio !== 1) {
    return { status: 'skipped', scope: POOLED_T_SCOPE, reason: 'The declared design is outside this narrowly supported reference profile; no independent certification is implied.' };
  }
  const forbidden = (plan?.parameters || []).some(parameter => /icc|cluster|interim/.test(normalized(parameter.name)) || (/attrition|dropout/.test(normalized(parameter.name)) && parameter.value !== 0));
  if (forbidden || /one[ -]?(?:sample|group)|single[ -]?(?:sample|group)|\bnon[ -]?normal(?:ly)?\b|\blog[ -]?normal(?:ly)?\b|\bnot normal(?:ly)?\b|welch|unequal(?:[ -]+(?:population|group|within[ -]group))?[ -]+(?:variances?|sds?|standard deviations?)|heteroscedastic|\bpaired(?: |$)|cluster|crossover|repeated measure|normal approximation|z[ -]?test/.test(method + ' ' + notes)) return { status: 'skipped', scope: POOLED_T_SCOPE, reason: 'A material design feature is outside the pooled-t reference profile.' };
  // Recognize the parameter's declared name, not an incidental Cohen-d mention
  // in a nuisance parameter's unit (for example, a common SD's implied scale).
  const effectName = /^(?:cohen(?: s|s)? (?:d|standardized (?:mean )?difference)|standardized (?:mean )?difference|standardized effect(?: size)?|effect size d|d)(?: \((?:effect size|standardized (?:mean )?difference|standardized effect(?: size)?)\))?$/;
  const effectLike = /cohen|standardized|^effect size\b|^d(?:\b|\d)/;
  const effects = (plan?.parameters || []).filter(parameter => effectName.test(normalized(parameter.name)));
  const malformedEffect = (plan?.parameters || []).some(parameter => effectLike.test(normalized(parameter.name)) && !effectName.test(normalized(parameter.name)));
  const values = effects.map(parameter => parameter.value);
  if (malformedEffect || values.length !== 1 || !finite(values[0]) || values[0] === 0 || !finite(plan.alpha) || !(plan.alpha > 0 && plan.alpha < 1) || !finite(plan.target_power) || !(plan.target_power > 0 && plan.target_power < 1)) {
    return { status: 'failed', scope: POOLED_T_SCOPE, reason: 'The supported profile lacks an unambiguous numeric standardized effect, alpha or target power; no values were inferred.' };
  }
  return { status: 'applicable', scope: POOLED_T_SCOPE, specification: { standardized_effect: values[0], alpha: plan.alpha, target_power: plan.target_power, allocation_ratio: 1, sidedness: 'two-sided' } };
}

function candidateQuantities(plan, answer) {
  const counts = [], totals = [], powers = [], previous = [], invalidUnits = [], powerRows = [], invalidMappings = [];
  for (const row of answer?.results || []) {
    const metric = normalized(row.metric), unit = normalized(row.unit), combined = metric + ' ' + unit;
    if (/power/.test(metric)) {
      if (!/target|nominal|requested/.test(metric) && unit !== 'probability') invalidUnits.push({ metric: row.metric, unit: row.unit });
      if (!/target|nominal|requested/.test(metric)) powerRows.push({ ...row, metric });
      continue;
    }
    if (/preceding|previous|smaller|unrounded|continuous|prior|initial/.test(metric)) continue;
    const countRow = /total.*(?:participant|subject|sample|\bn\b)|(?:participant|subject).*total|per (?:arm|group)|perarm|pergroup|sample size|^n$/.test(combined);
    const explicitParticipantUnit = /^(?:participants?|subjects?|patients?)(?: per (?:arm|group)| total)?$/.test(unit);
    const labeledIntegerCount = /^(?:integer|count)$/.test(unit) && /participant|subject|patient/.test(metric);
    if (countRow && (/cluster|event|failure/.test(combined) || !(explicitParticipantUnit || labeledIntegerCount))) invalidUnits.push({ metric: row.metric, unit: row.unit });
    if (/total.*(?:participant|subject|sample|\bn\b)|(?:participant|subject).*total/.test(combined)) totals.push(row.value);
    else if (/per (?:arm|group)|perarm|pergroup/.test(combined) || (/sample size|^n$/.test(metric) && /per (?:arm|group)/.test(normalized(plan.sample_size_unit)))) counts.push(row.value);
  }
  const unique = values => [...new Set(values)];
  const selected = unique(counts);
  for (const row of powerRows) {
    const metric = row.metric.replace(/[−–—]/g, '-');
    const precedingLabel = /preceding|previous|smaller/.test(metric);
    // Consume a whole token rather than a numeric prefix. For example, n=86e2
    // means 8600, while n-10 is not the immediately preceding design.
    const numericLabel = (operator, rawToken) => {
      const token = rawToken.replace(/[),;\]]+$/, '');
      const valid = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token);
      return { operator, value: valid ? Number(token) : NaN };
    };
    const labels = [...metric.matchAll(/\bn\s*([=:+-])\s*(\S*)/g)].map(match => numericLabel(match[1], match[2]));
    const wordLabels = [...metric.matchAll(/\bn\s+(minus|plus)\s+(\S*)/g)].map(match => {
      const token = match[2].replace(/[),;\]]+$/, '');
      const trailing = metric.slice(match.index + match[0].length);
      const compoundOffset = /^\s*(?:(?:and\s+)?(?:plus|minus|times|divided|multiplied)\b|[+*/=:-])/.test(trailing);
      // The verbal/underscore alias is deliberately bounded to literal n minus 1.
      return { operator: match[1] === 'minus' ? '-' : '+', value: token === '1' && !compoundOffset ? 1 : NaN };
    });
    labels.push(...wordLabels);
    if (labels.length || /\bn\s*(?:plus|minus)/.test(metric)) {
      const label = labels[0];
      const offset = label && ['+', '-'].includes(label.operator);
      const n = offset ? selected[0] + (label.operator === '-' ? -label.value : label.value) : label?.value;
      const valid = labels.length === 1 && selected.length === 1 && Number.isInteger(label.value) &&
        (!offset || (label.operator === '-' && label.value === 1)) &&
        [selected[0], selected[0]-1].includes(n) && (!precedingLabel || n === selected[0]-1);
      if (!valid) invalidMappings.push({ metric: row.metric, value: row.value });
      else (n === selected[0] ? powers : previous).push(row.value);
    } else (precedingLabel ? previous : powers).push(row.value);
  }
  return { counts: selected, totals: unique(totals), powers: unique(powers), previous: unique(previous), invalidUnits, invalidMappings };
}

export async function checkPooledTReference(plan, answer, execute) {
  const scope = pooledTReferenceSpecification(plan);
  if (scope.status !== 'applicable') return { ...scope, checks: [], evidence_id: null };
  const quantities = candidateQuantities(plan, answer);
  if (quantities.invalidMappings.length) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [{ name: 'declared_power_design_mapping', passed: false, observed: quantities.invalidMappings }], evidence_id: null, reason: 'Reported power labels contradict or do not uniquely identify the selected or immediately preceding per-arm design.' };
  if (quantities.invalidUnits.length) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [{ name: 'declared_reference_units', passed: false, observed: quantities.invalidUnits }], evidence_id: null, reason: 'Reported quantities have units outside the supported participant-count and probability reference profile; no units were inferred or converted.' };
  if (quantities.counts.length !== 1 || !Number.isInteger(quantities.counts[0]) || quantities.counts[0] < 2) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [], reason: 'No unique admissible integer per-arm sample-size result was declared.', evidence_id: null };
  const n = quantities.counts[0], { standardized_effect: d, alpha, target_power: target } = scope.specification;
  if (n === 2 && quantities.previous.length) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [{ name: 'preceding_design_admissibility', passed: false, observed: quantities.previous }], evidence_id: null, reason: 'A numerical preceding-design power was reported at one participant per arm, where the pooled-t test is inadmissible.' };
  const code = `library(jsonlite)
d <- ${JSON.stringify(Math.abs(d))}; alpha <- ${JSON.stringify(alpha)}; target <- ${JSON.stringify(target)}; candidate_n <- ${JSON.stringify(n)}
package_power <- function(n) stats::power.t.test(n=n,delta=d,sd=1,sig.level=alpha,type="two.sample",alternative="two.sided",strict=TRUE)$power
independent_power <- function(n) { df <- 2*n-2; cutoff <- qt(1-alpha/2,df); noncentrality <- d*sqrt(n/2); pt(cutoff,df,ncp=noncentrality,lower.tail=FALSE)+pt(-cutoff,df,ncp=noncentrality) }
continuous_n <- if(package_power(2)>=target) 2 else stats::power.t.test(delta=d,sd=1,sig.level=alpha,power=target,type="two.sample",alternative="two.sided",strict=TRUE)$n
minimum_n <- max(2L,ceiling(continuous_n))
while(package_power(minimum_n)<target) minimum_n <- minimum_n+1L
while(minimum_n>2L && package_power(minimum_n-1L)>=target) minimum_n <- minimum_n-1L
at_candidate <- package_power(candidate_n); at_minimum <- package_power(minimum_n); preceding <- if(minimum_n>2L) package_power(minimum_n-1L) else NA_real_
checks <- list(list(name="candidate_minimum_per_arm",passed=candidate_n==minimum_n,observed=candidate_n,expected=minimum_n),
 list(name="target_achieved",passed=at_candidate>=target,observed=at_candidate,expected=target),
 list(name="independent_noncentral_t_implementation",passed=abs(at_candidate-independent_power(candidate_n))<1e-10 && abs(at_minimum-independent_power(minimum_n))<1e-10))
cat("POWER_AGENT_REFERENCE_AUDIT=",toJSON(list(checks=checks,minimum_per_arm=minimum_n,participants_total=2*minimum_n,power_at_candidate=at_candidate,power_at_minimum=at_minimum,power_preceding=preceding,stats_version=as.character(packageVersion("stats"))),auto_unbox=TRUE,digits=16),"\\n",sep="")`;
  const evidence = await execute({ code, purpose: 'Deterministic pooled-t check: stats::power.t.test(strict=TRUE) versus independent noncentral-t tails with d*sqrt(n/2).' }, 'reference_check');
  if (evidence.success !== true || typeof evidence.evidence_id !== 'string' || !evidence.evidence_id.trim()) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [], evidence_id: evidence.evidence_id || null, reason: 'The required reference execution did not succeed with an identified evidence record.' };
  const line = String(evidence.stdout).split(/\r?\n/).find(value => value.startsWith('POWER_AGENT_REFERENCE_AUDIT='));
  let result;
  try { result = JSON.parse(line?.slice('POWER_AGENT_REFERENCE_AUDIT='.length)); }
  catch { return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [], evidence_id: evidence.evidence_id, reason: 'Reference execution did not return a valid audit.' }; }
  const requiredChecks = ['candidate_minimum_per_arm', 'target_achieved', 'independent_noncentral_t_implementation'];
  const validResult = result && Array.isArray(result.checks) && result.checks.length === 3 &&
    requiredChecks.every(name => result.checks.filter(check => check?.name === name && typeof check.passed === 'boolean').length === 1) &&
    Number.isInteger(result.minimum_per_arm) && result.minimum_per_arm >= 2 && result.participants_total === 2 * result.minimum_per_arm &&
    ['power_at_candidate', 'power_at_minimum'].every(name => finite(result[name]) && result[name] >= 0 && result[name] <= 1) &&
    (result.minimum_per_arm === 2 || (finite(result.power_preceding) && result.power_preceding >= 0 && result.power_preceding <= 1)) &&
    typeof result.stats_version === 'string' &&
    result.checks.find(check => check.name === 'candidate_minimum_per_arm').passed === (n === result.minimum_per_arm) &&
    result.checks.find(check => check.name === 'target_achieved').passed === (result.power_at_candidate >= target) &&
    result.power_at_minimum >= target && (result.minimum_per_arm === 2 || result.power_preceding < target);
  if (!validResult) return { status: 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, checks: [], evidence_id: evidence.evidence_id, reason: 'Reference audit is missing required named checks or finite reference quantities.' };
  const checks = [...(result.checks || [])];
  if (quantities.totals.length) checks.push({ name: 'candidate_total_units', passed: quantities.totals.length === 1 && quantities.totals[0] === 2 * n, observed: quantities.totals });
  if (quantities.powers.length) checks.push({ name: 'reported_achieved_power', passed: quantities.powers.length === 1 && Math.abs(quantities.powers[0] - result.power_at_candidate) <= 0.0001, observed: quantities.powers, expected: result.power_at_candidate });
  if (quantities.previous.length && n > 2) {
    // A candidate preceding-design claim concerns its own n-1. Only an accepted
    // minimum can be compared with the reference minimum's preceding result.
    checks.push({ name: 'reported_preceding_power', passed: n === result.minimum_per_arm && quantities.previous.length === 1 && Math.abs(quantities.previous[0] - result.power_preceding) <= 0.0001, observed: quantities.previous, expected: result.power_preceding });
  }
  const passed = checks.length >= 3 && checks.every(check => check.passed === true);
  return { status: passed ? 'passed' : 'failed', scope: POOLED_T_SCOPE, specification: scope.specification, evidence_id: evidence.evidence_id, checks, reference: result,
    reason: passed ? 'Declared structured quantities agree under this limited pooled-t specification.' : 'Candidate disagrees with the independently executed pooled-t reference; candidate outputs are retained and are not accepted.' };
}
