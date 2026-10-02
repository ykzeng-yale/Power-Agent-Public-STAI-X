#!/usr/bin/env Rscript
# Candidate-blind paired-t precheck. Inputs are supplied planning/source files only.
# The primary calculation conditions on chi-square V in the official TDist
# representation (Z + lambda)/sqrt(V/nu). It never uses pt or power.t.test to
# construct the integral or find its integer crossing.
options(warn = 1, digits = 17)
library(jsonlite)

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1L) stop("Supply the study root path")
root <- normalizePath(args[[1]], mustWork = TRUE)
out <- file.path(root, "checker-precheck")
spec <- fromJSON(file.path(root, "planner-specification.json"), simplifyVector = TRUE)
request <- paste(readLines(file.path(root, "request.txt"), warn = FALSE), collapse = "\n")
source_receipt <- fromJSON(file.path(root, "source-receipt.json"))
t_receipt <- fromJSON(file.path(root, "source-t-distribution-receipt.json"))
reuse <- fromJSON(file.path(root, "source-reuse-provenance.json"))

alpha <- spec$study$alpha
target <- spec$study$target_power
delta <- spec$study$effect$delta
sigma1 <- spec$nuisance_and_dependence$marginal_sd_first_measurement
sigma2 <- spec$nuisance_and_dependence$marginal_sd_second_measurement
rhos <- spec$nuisance_and_dependence$rho_scenarios
grid_spec <- spec$requested_sensitivity_artifacts$participant_grid
grid <- seq.int(grid_spec$from, grid_spec$through, by = grid_spec$step)
stopifnot(alpha > 0, alpha < 1, target > alpha, target < 1,
          sigma1 > 0, sigma2 > 0, all(rhos > -1), all(rhos < 1),
          identical(spec$study$sidedness, "two-sided"),
          isTRUE(spec$study$noattrition),
          identical(spec$scientific_status, "planning_complete"))

tol <- list(integration_absolute = 1e-11, integration_relative = 1e-10,
            chi_square_upper_truncation = 1e-13, critical_root = 1e-12,
            distribution_comparison_absolute = 1e-8,
            critical_comparison_absolute = 1e-9,
            null_calibration_absolute = 1e-8)
warnings_seen <- list()

# For c > 0 the documented central-t upper tail is
# (1/2) I_{nu/(nu+c^2)}(nu/2, 1/2). Invert it without central qt.
source_critical <- function(nu) {
  upper_tail <- function(c) 0.5 * pbeta(nu/(nu+c*c), nu/2, 0.5)
  bracket_upper <- 1
  while (upper_tail(bracket_upper) > alpha/2) bracket_upper <- 2*bracket_upper
  uniroot(function(c) upper_tail(c)-alpha/2,
          interval = c(0, bracket_upper), tol = tol$critical_root)$root
}

# Let r = sqrt(V/nu), V ~ chi-square(nu). A change of variables gives
# f_R(r) = 2*(nu/2)^(nu/2)/Gamma(nu/2) * r^(nu-1)*exp(-nu*r^2/2).
# The conditional rejection probabilities are
# Phi(-c*r-lambda) and Phi(lambda-c*r), respectively.
# No noncentral-t CDF occurs in this integration function.
conditional_power <- function(n, sd_difference, mean_change = delta) {
  nu <- n-1
  lambda <- sqrt(n)*mean_change/sd_difference
  critical <- source_critical(nu)
  vmax <- qchisq(tol$chi_square_upper_truncation, df = nu, lower.tail = FALSE)
  rmax <- sqrt(vmax/nu)
  omitted_mass <- pchisq(vmax, df = nu, lower.tail = FALSE)
  chi_scale_density <- function(r) {
    value <- numeric(length(r))
    positive <- r > 0
    value[positive] <- exp(log(2) + (nu/2)*log(nu/2) - lgamma(nu/2) +
                           (nu-1)*log(r[positive]) - nu*r[positive]^2/2)
    if (nu == 1) value[!positive] <- exp(log(2) +
                                  (nu/2)*log(nu/2)-lgamma(nu/2))
    value
  }
  lower <- integrate(function(r) pnorm(-critical*r-lambda)*chi_scale_density(r),
                     lower = 0, upper = rmax, subdivisions = 2000L,
                     abs.tol = tol$integration_absolute,
                     rel.tol = tol$integration_relative, stop.on.error = FALSE)
  upper <- integrate(function(r) pnorm(lambda-critical*r)*chi_scale_density(r),
                     lower = 0, upper = rmax, subdivisions = 2000L,
                     abs.tol = tol$integration_absolute,
                     rel.tol = tol$integration_relative, stop.on.error = FALSE)
  error_estimate <- lower$abs.error + upper$abs.error
  power <- lower$value + upper$value
  list(power = power, lower = lower$value, upper = upper$value,
       integration_error_estimate = error_estimate,
       omitted_mass_upper_bound = omitted_mass,
       uncertainty_estimate = error_estimate + omitted_mass,
       critical = critical, df = nu, ncp = lambda,
       lower_message = lower$message, upper_message = upper$message,
       lower_subdivisions = lower$subdivisions,
       upper_subdivisions = upper$subdivisions)
}

evaluate_n <- function(n, rho, sd_difference) {
  independent <- conditional_power(n, sd_difference)
  critical_r <- qt(1-alpha/2, df = n-1)
  # Reflection uses two lower-tail evaluations, reducing upper-tail cancellation.
  pt_reflected <- pt(-critical_r, df = n-1, ncp = independent$ncp) +
                  pt(-critical_r, df = n-1, ncp = -independent$ncp)
  pt_direct <- pt(-critical_r, df = n-1, ncp = independent$ncp) +
               pt(critical_r, df = n-1, ncp = independent$ncp, lower.tail = FALSE)
  package_power <- power.t.test(n = n, delta = delta, sd = sd_difference,
                 sig.level = alpha, power = NULL, type = "paired",
                 alternative = "two.sided", strict = TRUE)$power
  data.frame(rho_assumed = rho, sd_difference = sd_difference,
       participants = as.integer(n), complete_pairs = as.integer(n),
       independent_differences = as.integer(n), measurements = as.integer(2*n),
       df = n-1, ncp = independent$ncp,
       critical_source_beta = independent$critical, critical_R_qt = critical_r,
       power_conditional_integral = independent$power,
       lower_tail_integral = independent$lower, upper_tail_integral = independent$upper,
       integration_error_estimate = independent$integration_error_estimate,
       omitted_chi_square_mass_bound = independent$omitted_mass_upper_bound,
       numerical_uncertainty_estimate = independent$uncertainty_estimate,
       power_lower_estimate = max(0, independent$power-independent$uncertainty_estimate),
       power_upper_estimate = min(1, independent$power+independent$uncertainty_estimate),
       power_R_pt_reflected = pt_reflected, power_R_pt_direct = pt_direct,
       power_R_power_t_test_strict = package_power,
       abs_integral_minus_pt_reflected = abs(independent$power-pt_reflected),
       abs_integral_minus_pt_direct = abs(independent$power-pt_direct),
       abs_integral_minus_power_t_test = abs(independent$power-package_power),
       abs_critical_difference = abs(independent$critical-critical_r),
       target_power = target,
       lower_integration_message = independent$lower_message,
       upper_integration_message = independent$upper_message,
       lower_subdivisions = independent$lower_subdivisions,
       upper_subdivisions = independent$upper_subdivisions,
       stringsAsFactors = FALSE)
}

main <- function() {
  scenario_summaries <- list()
  searches <- list()
  grids <- list()
  # A resource safety cap, separate from the supplied plotting endpoint.
  search_cap <- 100000L
  for (j in seq_along(rhos)) {
    rho <- rhos[[j]]
    sd_difference <- sqrt(sigma1*sigma1 + sigma2*sigma2 - 2*rho*sigma1*sigma2)
    rows <- list()
    selected <- NULL
    for (n in seq.int(2L, search_cap)) {
      row <- evaluate_n(n, rho, sd_difference)
      rows[[length(rows)+1L]] <- row
      if (row$power_lower_estimate >= target) {
        selected <- row
        break
      }
      if (row$power_upper_estimate >= target) {
        stop("Integral uncertainty estimate leaves the integer crossing unresolved")
      }
    }
    if (is.null(selected)) stop("No crossing found before the recorded resource cap")
    search <- do.call(rbind, rows)
    selected_n <- selected$participants
    previous <- if (selected_n > 2) search[search$participants == selected_n-1L, ] else NULL
    all_smaller_below <- all(search$power_upper_estimate[search$participants < selected_n] < target)
    stopifnot(all_smaller_below, selected$power_lower_estimate >= target)
    grid_rows <- lapply(grid, function(n) evaluate_n(n, rho, sd_difference))
    grid_table <- do.call(rbind, grid_rows)
    tag <- sprintf("rho-%03d", as.integer(round(100*rho)))
    search_file <- paste0("integer-search-", tag, ".csv")
    grid_file <- paste0("grid-", tag, ".csv")
    write.csv(search, file.path(out, search_file), row.names = FALSE)
    write.csv(grid_table, file.path(out, grid_file), row.names = FALSE)
    scenario_summaries[[j]] <- list(
      rho_assumed = rho, rho_status = "supplied sensitivity assumption",
      sd_difference = sd_difference, standardized_mean_change = delta/sd_difference,
      smallest_integer_participants = selected_n,
      complete_pairs = selected$complete_pairs,
      independent_differences = selected$independent_differences,
      measurements = selected$measurements,
      achieved_power = selected$power_conditional_integral,
      achieved_lower_tail = selected$lower_tail_integral,
      achieved_upper_tail = selected$upper_tail_integral,
      achieved_power_R_pt = selected$power_R_pt_reflected,
      achieved_power_R_power_t_test = selected$power_R_power_t_test_strict,
      achieved_numerical_uncertainty_estimate = selected$numerical_uncertainty_estimate,
      one_fewer_participants = if (is.null(previous)) NULL else previous$participants,
      one_fewer_power = if (is.null(previous)) NULL else previous$power_conditional_integral,
      one_fewer_power_R_pt = if (is.null(previous)) NULL else previous$power_R_pt_reflected,
      one_fewer_power_R_power_t_test = if (is.null(previous)) NULL else previous$power_R_power_t_test_strict,
      one_fewer_numerical_uncertainty_estimate = if (is.null(previous)) NULL else previous$numerical_uncertainty_estimate,
      one_fewer_status = if (is.null(previous)) "not_admissible" else "admissible",
      integer_search_from = min(search$participants),
      integer_search_through = max(search$participants),
      integer_search_evaluated_count = nrow(search),
      all_smaller_admissible_counts_below_target = all_smaller_below,
      search_not_limited_to_plot_grid = TRUE,
      integer_search_file = search_file, grid_file = grid_file)
    searches[[j]] <- search
    grids[[j]] <- grid_table
  }
  all_searches <- do.call(rbind, searches)
  all_grids <- do.call(rbind, grids)
  all_rows <- rbind(all_searches, all_grids)
  write.csv(all_searches, file.path(out, "integer-search-all.csv"), row.names = FALSE)
  write.csv(all_grids, file.path(out, "grid-all.csv"), row.names = FALSE)
  calibration_n <- unique(c(2L, grid[[1]], grid[[length(grid)]]))
  calibrations <- lapply(calibration_n, function(n) {
    p <- conditional_power(n, sd_difference = 1, mean_change = 0)
    list(participants = n, null_both_tail_power = p$power, alpha = alpha,
         absolute_difference = abs(p$power-alpha),
         numerical_uncertainty_estimate = p$uncertainty_estimate,
         integration_messages = c(p$lower_message, p$upper_message))
  })
  max_calibration_error <- max(vapply(calibrations, function(x) x$absolute_difference, numeric(1)))
  numerical_checks <- list(
    total_integer_search_rows = nrow(all_searches),
    total_supplied_grid_rows = nrow(all_grids),
    max_abs_integral_minus_pt_reflected = max(all_rows$abs_integral_minus_pt_reflected),
    max_abs_integral_minus_pt_direct = max(all_rows$abs_integral_minus_pt_direct),
    max_abs_integral_minus_power_t_test = max(all_rows$abs_integral_minus_power_t_test),
    max_abs_source_critical_minus_qt = max(all_rows$abs_critical_difference),
    max_integration_error_estimate = max(all_rows$integration_error_estimate),
    max_omitted_chi_square_mass_bound = max(all_rows$omitted_chi_square_mass_bound),
    max_abs_null_calibration_error = max_calibration_error,
    max_absolute_ncp = max(abs(all_rows$ncp)),
    integration_messages_all_OK = all(all_rows$lower_integration_message == "OK") &&
                                  all(all_rows$upper_integration_message == "OK"),
    units_all_consistent = all(all_rows$participants == all_rows$complete_pairs) &&
      all(all_rows$participants == all_rows$independent_differences) &&
      all(all_rows$measurements == 2*all_rows$participants),
    all_powers_in_unit_interval = all(all_rows$power_conditional_integral >= 0) &&
                                 all(all_rows$power_conditional_integral <= 1))
  passed <- numerical_checks$max_abs_integral_minus_pt_reflected <= tol$distribution_comparison_absolute &&
      numerical_checks$max_abs_integral_minus_pt_direct <= tol$distribution_comparison_absolute &&
      numerical_checks$max_abs_integral_minus_power_t_test <= tol$distribution_comparison_absolute &&
      numerical_checks$max_abs_source_critical_minus_qt <= tol$critical_comparison_absolute &&
      max_calibration_error <= tol$null_calibration_absolute &&
      numerical_checks$integration_messages_all_OK && numerical_checks$units_all_consistent &&
      numerical_checks$all_powers_in_unit_interval
  record <- list(
    schema = "candidate-blind-paired-t-independent-precheck", schema_version = "1.0",
    scientific_status = if (passed) "precheck_completed" else "review_failed",
    phase = 1L, candidate_not_accessed = TRUE, candidate_comparison_performed = FALSE,
    session_topology = list(
      identity = "/root/native_skill_forward/native_checker_231",
      parent_identity = "/root/native_skill_forward",
      fork_turns = "none", inherited_parent_conversation = FALSE,
      candidate_supplied = FALSE, child_sessions_spawned = FALSE,
      role = "candidate-blind independent numerical checker; phase 1 only",
      context = "Explicit parent task, supplied request/planner specification and report/preflight, listed official HTML and receipts, and installed skill plus two named references only",
      model_identifier = "not exposed to this checker; no cross-model independence claim",
      tool_surface = "native functions.exec, exec_command and apply_patch; preinstalled R and Python",
      writes = "checker-precheck/ only", paid_API_used = FALSE,
      installation_performed = FALSE, global_settings_changed = FALSE),
    original_request = request,
    input_gate = list(status = spec$gate$observed_status,
      manual_specification_status = spec$manual_specification_status,
      material_numerical_inputs_missing = spec$gate$missing_material_numerical_inputs),
    design = list(estimand = "Mean within-participant change", null_value = spec$study$null_estimand_value,
      procedure = "two-sided paired Student-t on iid normally distributed participant differences",
      alpha = alpha, target_power = target, mean_change = delta,
      marginal_sd_first_measurement = sigma1, marginal_sd_second_measurement = sigma2,
      correlation_scenarios = rhos, correlation_status = "supplied sensitivity scenarios",
      noattrition = spec$study$noattrition, units = list(
        primary = "participants with two complete measurements",
        participants_to_pairs = 1L, participants_to_differences = 1L,
        measurements_per_participant = 2L),
      difference_sd_formula = "sqrt(sigma1^2 + sigma2^2 - 2*rho*sigma1*sigma2)",
      df_formula = "participants-1", noncentrality_formula = "sqrt(participants)*mean_change/sd_difference",
      requested_grid = grid, integer_search_cap = search_cap),
    method = list(
      primary = "Source-derived deterministic conditional-normal / chi-square quadrature",
      official_representation = "T=(Z+lambda)/sqrt(V/nu), independent Z~N(0,1), V~chi-square(nu)",
      integral_formula = "Integral_0^infinity [Phi(-c*sqrt(v/nu)-lambda)+Phi(lambda-c*sqrt(v/nu))] f_chisq(v;nu) dv",
      integration_variable = "r=sqrt(v/nu); smooth chi density evaluated from its log formula",
      critical_value = "Numerically invert documented central-t incomplete-beta upper tail, without qt",
      upper_truncation = "qchisq(chi_square_upper_truncation, nu, lower.tail=FALSE); omitted rejection probability bounded by omitted chi-square mass",
      comparator_pt = "R reflected lower tails, plus direct both-tail expression",
      comparator_package = "R stats::power.t.test(type='paired', alternative='two.sided', strict=TRUE), with all material arguments explicit",
      integer_search = "Enumerate every admissible n from 2 until the integral lower estimate reaches target; retain every evaluated row",
      mathematical_exactness = "Exact t-test model; distribution probabilities evaluated numerically",
      tolerance_semantics = "Quadrature error estimates are numerical estimates, not mathematically certified rigorous error bounds; chi-square omission bound is a probability bound subject to numerical p/qchisq evaluation",
      null_calibration = calibrations, tolerances = tol),
    scenarios = scenario_summaries, numerical_checks = numerical_checks,
    within_checker_numerical_agreement_passed = passed,
    warnings = warnings_seen,
    runtime = list(R_version = R.version.string, stats_version = as.character(packageVersion("stats")),
       jsonlite_version = as.character(packageVersion("jsonlite")),
       sessionInfo = capture.output(sessionInfo())),
    source_provenance = list(power_t_test = source_receipt,
       t_distribution = t_receipt, power_t_test_reuse = reuse,
       source_read_scope = "Local saved HTML bodies and receipts; no new network retrieval, PDF or wider manual coverage",
       source_doc_version = "R-devel stats 4.6.0; installed runtime separately recorded"),
    assumptions = c("Participant differences are iid normal under the named exact paired-t model; across-participant independence is a model requirement rather than an empirically verified fact",
      "Marginal population SDs and mean change are supplied on the original outcome scale",
      "Rho values are assumptions in sensitivity scenarios, with all participants supplying two measurements and no attrition"),
    limitations = c("This precheck is candidate-blind; candidate files and outputs have not been accessed or compared",
      "The checker shares supplied specification and official sources; separate native sessions do not establish statistical independence or mathematical certification",
      "Both numerical routes use R base floating-point routines, including pnorm, pbeta, pchisq and qchisq; the integral does not call the noncentral-t CDF or power.t.test",
      "R pt and power.t.test share R noncentral-t implementation; these two comparators are not mutually independent",
      "Official TDist documents noncentrality accuracy limits and possible tail cancellation; actual ncp range and warnings are preserved",
      "Quadrature errors are estimated rather than proven; integer crossing decisions have retained numerical margins",
      "The power curves and PNGs in the implementation are outside this phase and remain unreviewed",
      "This is one exploratory workflow demonstration, not broad skill validation"))
  write_json(record, file.path(out, "precheck.json"), auto_unbox = TRUE, pretty = TRUE,
             digits = 17, null = "null", dataframe = "rows")
  cat("POWER_AGENT_RESULT=", toJSON(list(results = scenario_summaries,
      numerical_checks = numerical_checks, status = record$scientific_status),
      auto_unbox = TRUE, digits = 17, null = "null"), "\n", sep = "")
  print(sessionInfo())
  if (!passed) stop("Precheck numerical agreement failed; preserved all evidence")
}

withCallingHandlers(main(), warning = function(w) {
  warnings_seen[[length(warnings_seen)+1L]] <<- list(message = conditionMessage(w),
        call = paste(deparse(conditionCall(w)), collapse = " "))
  cat("ACTUAL_R_WARNING: ", conditionMessage(w), "\n", file = stderr(), sep = "")
  invokeRestart("muffleWarning")
})
