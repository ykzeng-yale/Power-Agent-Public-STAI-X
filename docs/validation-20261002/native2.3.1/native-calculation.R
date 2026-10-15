#!/usr/bin/env Rscript
# Candidate implementation only. Separate source-based checking follows.
# Reproduce from this directory with: Rscript --vanilla native-calculation.R
options(warn = 1, digits = 17)
if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Preinstalled jsonlite is required; no installation is attempted.")
}

run_calculation <- function() {
  spec <- jsonlite::fromJSON("planner-specification.json", simplifyVector = FALSE)
  stopifnot(isTRUE(spec$gate$ready_for_numerical_execution_under_named_model))
  delta <- spec$study$effect$delta
  alpha <- spec$study$alpha
  target <- spec$study$target_power
  sigma1 <- spec$nuisance_and_dependence$marginal_sd_first_measurement
  sigma2 <- spec$nuisance_and_dependence$marginal_sd_second_measurement
  rhos <- unlist(spec$nuisance_and_dependence$rho_scenarios, use.names = FALSE)
  grid_spec <- spec$requested_sensitivity_artifacts$participant_grid
  participants_grid <- seq.int(grid_spec$from, grid_spec$through, by = grid_spec$step)
  min_n <- spec$sample_size_units$minimum_admissible_integer_n
  stopifnot(delta > 0, alpha > 0, alpha < 1, target > alpha, target < 1,
            sigma1 > 0, sigma2 > 0, all(abs(rhos) <= 1), min_n >= 2,
            isTRUE(spec$study$noattrition), length(participants_grid) > 0)

  # D = Y2 - Y1; covariance is rho*sigma1*sigma2. This is a derivation
  # from the supplied measurement SDs and assumed sensitivity correlation.
  difference_sd <- function(rho) {
    sqrt(sigma1^2 + sigma2^2 - 2 * rho * sigma1 * sigma2)
  }
  paired_power <- function(n, sd_D) {
    stopifnot(all(n >= min_n), all(n == as.integer(n)), sd_D > 0)
    stats::power.t.test(n = n, delta = delta, sd = sd_D,
                       sig.level = alpha, power = NULL, type = "paired",
                       alternative = "two.sided", strict = TRUE)$power
  }
  # Equivalent lower-tail expression used only for a numerical self-check.
  # It shares stats::pt with power.t.test and is not an independent review.
  reflected_power <- function(n, sd_D) {
    df <- n - 1
    critical <- stats::qt(1 - alpha / 2, df = df)
    ncp <- sqrt(n) * delta / sd_D
    stats::pt(-critical, df = df, ncp = ncp, lower.tail = TRUE) +
      stats::pt(-critical, df = df, ncp = -ncp, lower.tail = TRUE)
  }

  result_rows <- list()
  add_result <- function(metric, value, unit) {
    stopifnot(length(value) == 1, is.numeric(value), is.finite(value))
    result_rows[[length(result_rows) + 1L]] <<-
      list(metric = metric, value = unname(value), unit = unit)
  }
  add_result("alpha", alpha, "probability")
  add_result("target_power", target, "probability")
  add_result("mean_change", delta, "outcome_units")
  add_result("marginal_sd_first_measurement", sigma1, "outcome_units")
  add_result("marginal_sd_second_measurement", sigma2, "outcome_units")

  scenario_summaries <- list()
  grid_tables <- list()
  search_tables <- list()
  summary_rows <- list()
  generated_artifacts <- character()
  tolerance <- 1e-12
  palette <- c("#1769AA", "#A34B00", "#14805E")

  for (i in seq_along(rhos)) {
    rho <- rhos[[i]]
    tag <- sprintf("rho_%.2f", rho)
    sd_D <- difference_sd(rho)
    stopifnot(sd_D > 0)
    # Retain every admissible integer through the first target crossing.
    # No restriction to the plotting grid is imposed on this search.
    n <- as.integer(min_n)
    search_n <- integer()
    search_p <- numeric()
    repeat {
      p <- paired_power(n, sd_D)
      stopifnot(is.finite(p), p >= 0, p <= 1)
      search_n <- c(search_n, n)
      search_p <- c(search_p, p)
      if (p >= target) break
      n <- n + 1L
    }
    achieved <- paired_power(n, sd_D)
    previous_n <- n - 1L
    previous_admissible <- previous_n >= min_n
    previous_power <- if (previous_admissible) paired_power(previous_n, sd_D) else NA_real_
    below <- search_p[search_n < n]
    stopifnot(achieved >= target, all(below < target))
    if (previous_admissible) stopifnot(previous_power < target)

    grid_power <- paired_power(participants_grid, sd_D)
    selfcheck_n <- unique(c(search_n, participants_grid))
    primary_check <- paired_power(selfcheck_n, sd_D)
    reflected_check <- reflected_power(selfcheck_n, sd_D)
    max_difference <- max(abs(primary_check - reflected_check))
    max_ncp <- max(abs(sqrt(selfcheck_n) * delta / sd_D))
    stopifnot(max_difference <= tolerance)

    search_table <- data.frame(
      assumed_rho = rho, participants = search_n, complete_pairs = search_n,
      independent_differences = search_n, measurements = 2L * search_n,
      difference_sd = sd_D, df = search_n - 1L,
      noncentrality = sqrt(search_n) * delta / sd_D,
      both_tail_power = search_p, target_power = target,
      reaches_target = search_p >= target)
    grid_table <- data.frame(
      assumed_rho = rho, participants = participants_grid,
      complete_pairs = participants_grid, independent_differences = participants_grid,
      measurements = 2L * participants_grid, difference_sd = sd_D,
      df = participants_grid - 1L,
      noncentrality = sqrt(participants_grid) * delta / sd_D,
      both_tail_power = grid_power, target_power = target)
    search_file <- paste0("integer-search-", tag, ".csv")
    grid_file <- paste0("power-sensitivity-", tag, ".csv")
    figure_file <- paste0("power-sensitivity-", tag, ".png")
    utils::write.csv(search_table, search_file, row.names = FALSE)
    utils::write.csv(grid_table, grid_file, row.names = FALSE)

    grDevices::png(figure_file, width = 1600, height = 1000, res = 160)
    graphics::par(mar = c(5.2, 5.0, 4.8, 2.0), las = 1)
    graphics::plot(participants_grid, grid_power, type = "n", ylim = c(0, 1),
      xlim = range(participants_grid), xaxt = "n", yaxt = "n",
      xlab = "Participants with two measurements (one complete pair each)",
      ylab = "Both-tail power",
      main = sprintf("Paired Student-t power: assumed rho = %.2f", rho))
    graphics::axis(1, at = participants_grid, cex.axis = 0.78)
    graphics::axis(2, at = seq(0, 1, by = 0.1))
    graphics::abline(h = seq(0, 1, by = 0.1), v = participants_grid, col = "#E3E7EB")
    graphics::lines(participants_grid, grid_power, type = "o", pch = 16,
                    lwd = 2.5, col = palette[[i]])
    graphics::abline(h = target, col = "#B9272F", lty = 2, lwd = 2)
    graphics::legend("bottomright",
      legend = c(sprintf("Assumed rho = %.2f", rho), sprintf("Target power = %.2f", target)),
      col = c(palette[[i]], "#B9272F"), lty = c(1, 2), pch = c(16, NA),
      lwd = c(2.5, 2), bty = "n", cex = 0.95)
    graphics::mtext(sprintf("Exact both-tail noncentral t | mean change %.2f | marginal SD %.1f | alpha %.2f",
                           delta, sigma1, alpha), side = 3, line = 0.5, cex = 0.83)
    grDevices::dev.off()

    add_result(paste0(tag, ".assumed_correlation"), rho, "correlation")
    add_result(paste0(tag, ".difference_sd"), sd_D, "outcome_units")
    add_result(paste0(tag, ".standardized_mean_change"), delta / sd_D, "standard_deviation_units")
    for (unit in c("participants_total", "complete_pairs", "independent_differences")) {
      add_result(paste0(tag, ".sample_size"), n, unit)
      if (previous_admissible) add_result(paste0(tag, ".previous_sample_size"), previous_n, unit)
    }
    add_result(paste0(tag, ".sample_size"), 2L * n, "measurements_total")
    if (previous_admissible) add_result(paste0(tag, ".previous_sample_size"), 2L * previous_n, "measurements_total")
    add_result(paste0(tag, ".achieved_power"), achieved, "probability")
    if (previous_admissible) add_result(paste0(tag, ".previous_power"), previous_power, "probability")
    add_result(paste0(tag, ".degrees_of_freedom"), n - 1L, "degrees_of_freedom")
    add_result(paste0(tag, ".max_abs_reflection_discrepancy"), max_difference, "probability")
    add_result(paste0(tag, ".maximum_evaluated_noncentrality"), max_ncp, "noncentrality")

    summary <- list(
      scenario_id = tag, assumed_correlation = rho, correlation_status = "sensitivity_assumption",
      difference_variance = sd_D^2, difference_sd = sd_D,
      standardized_mean_change = delta / sd_D,
      participants = n, complete_pairs = n, independent_differences = n,
      measurements = 2L * n, achieved_power = achieved,
      previous_participants = previous_n, previous_admissible = previous_admissible,
      previous_power = if (previous_admissible) previous_power else NULL,
      degrees_of_freedom = n - 1L, target_power = target,
      minimality = list(first_admissible_n = min_n, integers_examined = length(search_n),
        all_smaller_admissible_counts_below_target = all(below < target),
        previous_below_target = if (previous_admissible) previous_power < target else NULL,
        selected_reaches_target = achieved >= target, search_csv = search_file),
      numerical_selfcheck = list(method = "equivalent reflected lower-tail formula; shared stats::pt",
        status = "passed", independent_review = FALSE, tolerance = tolerance,
        maximum_absolute_difference = max_difference, maximum_evaluated_noncentrality = max_ncp),
      grid_csv = grid_file, grid_png = figure_file)
    scenario_summaries[[i]] <- summary
    summary_rows[[i]] <- data.frame(
      assumed_rho = rho, difference_sd = sd_D, standardized_mean_change = delta / sd_D,
      participants = n, complete_pairs = n, independent_differences = n,
      measurements = 2L * n, achieved_power = achieved,
      previous_participants = previous_n, previous_complete_pairs = previous_n,
      previous_measurements = 2L * previous_n, previous_power = previous_power,
      target_power = target)
    grid_tables[[i]] <- grid_table
    search_tables[[i]] <- search_table
    generated_artifacts <- c(generated_artifacts, search_file, grid_file, figure_file)
  }

  combined_grid <- do.call(rbind, grid_tables)
  combined_search <- do.call(rbind, search_tables)
  summary_table <- do.call(rbind, summary_rows)
  utils::write.csv(combined_grid, "power-sensitivity-combined.csv", row.names = FALSE)
  utils::write.csv(combined_search, "integer-search-combined.csv", row.names = FALSE)
  utils::write.csv(summary_table, "scenario-summary.csv", row.names = FALSE)

  grDevices::png("power-sensitivity-combined.png", width = 1600, height = 1000, res = 160)
  graphics::par(mar = c(5.2, 5.0, 4.8, 2.0), las = 1)
  graphics::plot(range(participants_grid), c(0, 1), type = "n", xaxt = "n", yaxt = "n",
    xlab = "Participants with two measurements (one complete pair each)",
    ylab = "Both-tail power", main = "Paired Student-t power: correlation sensitivity")
  graphics::axis(1, at = participants_grid, cex.axis = 0.78)
  graphics::axis(2, at = seq(0, 1, by = 0.1))
  graphics::abline(h = seq(0, 1, by = 0.1), v = participants_grid, col = "#E3E7EB")
  for (i in seq_along(rhos)) {
    graphics::lines(grid_tables[[i]]$participants, grid_tables[[i]]$both_tail_power,
                    type = "o", pch = 15L + i, lwd = 2.5, col = palette[[i]])
  }
  graphics::abline(h = target, col = "#B9272F", lty = 2, lwd = 2)
  graphics::legend("bottomright",
    legend = c(sprintf("Assumed rho = %.2f", rhos), sprintf("Target power = %.2f", target)),
    col = c(palette[seq_along(rhos)], "#B9272F"),
    lty = c(rep(1, length(rhos)), 2), pch = c(15L + seq_along(rhos), NA),
    lwd = c(rep(2.5, length(rhos)), 2), bty = "n", cex = 0.95)
  graphics::mtext(sprintf("Exact both-tail noncentral t | mean change %.2f | marginal SD %.1f | alpha %.2f",
                         delta, sigma1, alpha), side = 3, line = 0.5, cex = 0.83)
  grDevices::dev.off()
  generated_artifacts <- c(generated_artifacts, "power-sensitivity-combined.csv",
                           "integer-search-combined.csv", "scenario-summary.csv",
                           "power-sensitivity-combined.png")

  # Verify metric/unit uniqueness within the actual computed result object.
  result_keys <- vapply(result_rows, function(x) paste(x$metric, x$unit, sep = "|"), "")
  stopifnot(!anyDuplicated(result_keys))
  session <- capture.output(utils::sessionInfo())
  writeLines(session, "candidate-session-info.txt")
  generated_artifacts <- c(generated_artifacts, "candidate-session-info.txt")
  record <- list(
    schema = "power-agent-native-candidate-record", schema_version = "1.0",
    scientificStatus = "needs_review", success = FALSE,
    candidate_status = "executed; pending separate numerical check and final audits",
    candidateExecutionSuccess = TRUE, harnessVersion = "native skill 2.3.1; no bundled API runner used",
    requested_workflow_mode = "multi", executed_workflow_mode = "separate_native_sessions_in_progress",
    independent_review_status = "pending", session_identity = "/root/native_skill_forward/native_coder_231",
    workflow = list(requested_mode = "separate_native_sessions_for_planning_implementation_and_check",
      implementation_mode = "one_host_native_implementation_session",
      context_topology = "fork_turns=none; explicit task messages and supplied local files only",
      subchildren = 0L, prior_candidate_supplied = FALSE, intended_answer_supplied = FALSE,
      benchmark_or_oracle_access = FALSE, checker_outputs_accessed = FALSE,
      scope = "one exploratory native study workflow demonstration; no broad skill validation"),
    plan = spec,
    design = list(procedure = "paired Student-t test",
      estimand = "E[Y2-Y1] on the original outcome scale", null_value = 0,
      sidedness = "two-sided", alpha = alpha, delta = delta, target_power = target,
      marginal_sd_first_measurement = sigma1, marginal_sd_second_measurement = sigma2,
      correlation_scenarios = rhos, correlation_status = "sensitivity assumptions",
      difference_sd_formula = "sqrt(sigma1^2 + sigma2^2 - 2*rho*sigma1*sigma2)",
      distribution = "iid normally distributed participant differences under the named test model",
      noattrition = TRUE, allocation = "not applicable to paired observations",
      primary_sample_size_unit = "participants with two complete measurements",
      sample_size_units = list(participants_total = "n", complete_pairs = "n",
        independent_differences = "n", measurements_total = "2*n"),
      minimum_admissible_integer_participants = min_n,
      sample_size_rule = "first admissible integer reaching target, ascending exhaustive search from n=2",
      R_call = "stats::power.t.test(n=n,delta=delta,sd=sd_D,sig.level=alpha,power=NULL,type='paired',alternative='two.sided',strict=TRUE)",
      power_formula = "pt(-c,df=n-1,ncp=sqrt(n)*delta/sd_D) + pt(c,df=n-1,ncp=sqrt(n)*delta/sd_D,lower.tail=FALSE)",
      plot_participant_grid = participants_grid),
    assumptions = c(
      "Normally distributed paired differences are supplied by the request.",
      "Participant differences are iid under the named exact paired Student-t model; this is not empirically verified for a real study.",
      "The three rho values are separate sensitivity assumptions, not known or estimated correlations.",
      "Every participant supplies two complete measurements; no attrition inflation is applied."),
    results = result_rows, scenario_summaries = scenario_summaries,
    runtime = list(R_version = R.version.string, stats_version = as.character(utils::packageVersion("stats")),
      jsonlite_version = as.character(utils::packageVersion("jsonlite")),
      platform = R.version$platform, session_info_file = "candidate-session-info.txt"),
    review = list(status = "pending", final_independent_review_completed = FALSE,
      numerical_selfcheck = "reflected lower-tail identity uses shared stats::pt; not an independent reviewer",
      final_unit_audit = "pending analogous paired audit", final_reference_audit = "pending source-based paired check"),
    limitations = c(
      "Candidate execution and the reflected-tail self-check are not final independent validation.",
      "The exact distribution is conditional on the named iid-normal participant-difference model.",
      "Outcome physical units were not named; effect and SD retain the original outcome scale.",
      "Official sources are complete single-page R-devel stats 4.6.0 HTML receipts; actual installed R/stats is recorded separately.",
      "power.t.test and the self-check share the installed R noncentral-t routine; numerical evaluation is not mathematical certification.",
      "The paired design is outside the skill's recognized equal-arm reference profiles; analogous final checking is pending.",
      "No simulation, paid API, installation, credential read, global setting change, skill edit, or runtime edit was performed."),
    source_provenance = spec$source_provenance,
    evidence_ids = Sys.getenv("POWER_AGENT_EXECUTION_ID", unset = "direct-R-execution-unassigned-id"),
    generated_artifacts = generated_artifacts)
  jsonlite::write_json(record, "candidate-record.json", auto_unbox = TRUE,
                       pretty = TRUE, digits = 15, null = "null")
  cat("POWER_AGENT_RESULT=", jsonlite::toJSON(
    list(results = result_rows, scenario_summaries = scenario_summaries),
    auto_unbox = TRUE, digits = 15, null = "null"), "\n", sep = "")
  cat("\nSCENARIO_SUMMARY\n")
  print(summary_table, row.names = FALSE)
  cat("\nSESSION_INFO\n")
  cat(paste(session, collapse = "\n"), "\n")
  invisible(record)
}

calculation_warnings <- character()
tryCatch(
  withCallingHandlers(run_calculation(), warning = function(w) {
    calculation_warnings <<- c(calculation_warnings, conditionMessage(w))
  }),
  error = function(e) {
    jsonlite::write_json(list(status = "failed", error = conditionMessage(e),
      warnings = as.list(calculation_warnings)), "candidate-failure.json",
      auto_unbox = TRUE, pretty = TRUE, null = "null")
    stop(e)
  })
jsonlite::write_json(list(status = "completed", warning_count = length(calculation_warnings),
  warnings = as.list(calculation_warnings)), "candidate-warnings.json",
  auto_unbox = TRUE, pretty = TRUE, null = "null")
