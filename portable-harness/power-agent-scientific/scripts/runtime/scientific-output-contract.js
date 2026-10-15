import { createHash } from 'node:crypto';

// Representation only: this helper supplies no statistical method, answer,
// parameter, count-unit conversion, or interpretation of printed output.
export const RESULT_SERIALIZER_VERSION = '1.0.0';
export const RESULT_SERIALIZER_R = String.raw`power_agent_row <- function(metric, value, unit) {
  if (!is.character(metric) || length(metric) != 1L || is.na(metric) || !nzchar(trimws(metric))) stop("result metric must be one nonempty string")
  if (!is.numeric(value) || length(value) != 1L || is.na(value) || !is.finite(value)) stop("result value must be one finite numeric scalar")
  if (!is.character(unit) || length(unit) != 1L || is.na(unit) || !nzchar(trimws(unit))) stop("result unit must be one nonempty string")
  list(metric = metric, value = as.numeric(value), unit = unit)
}
power_agent_emit <- function(rows, simulation = NULL) {
  if (!is.list(rows) || !length(rows)) stop("results must be a nonempty list of result rows")
  checked <- lapply(rows, function(row) {
    if (!is.list(row) || length(row) != 3L || is.null(names(row)) || !setequal(names(row), c("metric", "value", "unit")) || anyDuplicated(names(row))) stop("each result row needs exactly metric, value and unit")
    power_agent_row(row$metric, row$value, row$unit)
  })
  identities <- vapply(checked, function(row) jsonlite::toJSON(list(row$metric, row$unit), auto_unbox = TRUE), character(1))
  if (anyDuplicated(identities)) stop("duplicate metric/unit result rows")
  payload <- list(results = checked)
  if (!is.null(simulation)) {
    fields <- c("seed", "trials", "failures", "mcse", "confidence_interval")
    if (!is.list(simulation) || length(simulation) != length(fields) || is.null(names(simulation)) || !setequal(names(simulation), fields) || anyDuplicated(names(simulation))) stop("simulation metadata needs exactly seed, trials, failures, mcse and confidence_interval")
    for (field in c("seed", "trials", "failures")) {
      value <- simulation[[field]]
      if (!is.numeric(value) || length(value) != 1L || is.na(value) || !is.finite(value) || value != trunc(value)) stop("simulation seed/trials/failures must be finite integers")
    }
    if (simulation$trials < 1 || simulation$failures < 0) stop("simulation trials/failures outside allowed range")
    if (!is.numeric(simulation$mcse) || length(simulation$mcse) != 1L || is.na(simulation$mcse) || !is.finite(simulation$mcse) || simulation$mcse < 0) stop("simulation mcse must be finite and nonnegative")
    if (!is.numeric(simulation$confidence_interval) || length(simulation$confidence_interval) != 2L || any(!is.finite(simulation$confidence_interval))) stop("simulation confidence_interval needs two finite numbers")
    payload$simulation <- simulation
  }
  cat("POWER_AGENT_RESULT=", jsonlite::toJSON(payload, auto_unbox = TRUE, digits = 15), "\n", sep = "")
}
`;
export const RESULT_SERIALIZER_SHA256 = createHash('sha256').update(RESULT_SERIALIZER_R).digest('hex');

// This bounded AST inspection rejects obvious transcription; it does not
// certify scientific formulas, dynamic dataflow, read-file authenticity or
// a model's interpretation of a request.
export const COMPUTATION_CONTRACT_VERSION = '1.0.1';
export const COMPUTATION_CONTRACT_R = String.raw`power_agent_check_source <- function(source, constraints_json) {
  program <- parse(text = source, keep.source = FALSE)
  constraints <- jsonlite::fromJSON(constraints_json, simplifyVector = FALSE)
  definitions <- new.env(parent = emptyenv())
  functions <- new.env(parent = emptyenv())
  rows <- list(); nodes <- 0L; method_calls <- 0L
  head_name <- function(x) {
    if (is.symbol(x)) return(as.character(x))
    if (is.call(x) && as.character(x[[1L]]) %in% c("::", ":::")) return(as.character(x[[3L]]))
    ""
  }
  collect <- function(x, depth = 0L) {
    nodes <<- nodes + 1L
    if (nodes > 30000L || depth > 100L) stop("computation contract: source AST exceeds inspection bounds; simplify the self-contained script")
    if (is.expression(x) || is.pairlist(x)) { for (i in seq_along(x)) if (!identical(x[[i]], quote(expr = ))) collect(x[[i]], depth + 1L); return(invisible(NULL)) }
    if (!is.call(x)) return(invisible(NULL))
    name <- head_name(x[[1L]]); args <- as.list(x)[-1L]; labels <- names(args)
    if (is.null(labels)) labels <- rep("", length(args))
    if (name %in% c("<-", "=", "<<-") && length(args) == 2L && is.symbol(args[[1L]])) {
      variable <- as.character(args[[1L]])
      if (grepl("^power_agent_(check_source|row|emit)$", variable)) stop("computation contract: supplied code cannot replace reserved evidence helpers")
      assign(variable, args[[2L]], envir = definitions)
      if (is.call(args[[2L]]) && head_name(args[[2L]][[1L]]) == "function") assign(variable, args[[2L]], envir = functions)
    }
    if (name == "for" && length(args) == 3L && is.symbol(args[[1L]])) assign(as.character(args[[1L]]), args[[2L]], envir = definitions)
    if (name == "power_agent_row") {
      idx <- which(labels == "value")
      if (!length(idx) && length(args) >= 2L) idx <- 2L
      if (length(idx) == 1L) rows[[length(rows) + 1L]] <<- args[[idx]]
    }
    if (name == "list" && all(c("metric", "value", "unit") %in% labels)) rows[[length(rows) + 1L]] <<- args[[which(labels == "value")[[1L]]]]
    stats_call <- name == "power.t.test" && (is.symbol(x[[1L]]) || (is.call(x[[1L]]) && head_name(x[[1L]][[1L]]) %in% c("::", ":::") && as.character(x[[1L]][[2L]]) == "stats"))
    if (stats_call && !is.null(constraints$power_t_test_strict)) {
      method_calls <<- method_calls + 1L
      resolve <- function(value, seen = character()) {
        if (is.symbol(value) && !as.character(value) %in% seen && exists(as.character(value), definitions, inherits = FALSE)) return(resolve(get(as.character(value), definitions), c(seen, as.character(value))))
        value
      }
      strict_idx <- which(labels == "strict"); alternative_idx <- which(labels == "alternative")
      strict_value <- if (length(strict_idx) == 1L) resolve(args[[strict_idx]]) else NULL
      alternative <- if (length(alternative_idx) == 1L) resolve(args[[alternative_idx]]) else NULL
      if (!is.logical(strict_value) || length(strict_value) != 1L || !identical(strict_value, constraints$power_t_test_strict)) stop("request contract: power.t.test must explicitly use the user's requested strict option; recompute this same self-contained calculation with strict = TRUE/FALSE as requested, rather than serializing earlier output")
      if (isTRUE(constraints$strict_two_sided) && (!is.character(alternative) || length(alternative) != 1L || alternative != "two.sided")) stop("request contract: the explicit strict two-sided request requires alternative = 'two.sided' when using power.t.test; recompute instead of accepting a function default")
    }
    for (i in seq_along(args)) if (!identical(args[[i]], quote(expr = ))) collect(args[[i]], depth + 1L)
    invisible(NULL)
  }
  for (expression in program) collect(expression)
  combine <- function(states) {
    if ("computed_or_read" %in% states) "computed_or_read" else if ("unresolved" %in% states) "unresolved" else "literal_only"
  }
  transparent <- c("list", "c", "data.frame", "structure", "setNames", "unname", "identity", "I", "as.numeric", "as.integer", "as.double", "as.logical", "as.character", "round", "signif", "ceiling", "floor", "trunc", "format", "formatC", "paste", "paste0", "sprintf", "(", "{", "return", "if", "$", "[[", "[")
  local_function <- function(name, visited = character(), depth = 0L) {
    if (depth > 100L || name %in% visited) return(NULL)
    if (exists(name, functions, inherits = FALSE)) return(get(name, functions))
    if (!exists(name, definitions, inherits = FALSE)) return(NULL)
    value <- get(name, definitions)
    if (is.symbol(value)) return(local_function(as.character(value), c(visited, name), depth + 1L))
    if (is.call(value) && head_name(value[[1L]]) == "function") return(value)
    NULL
  }
  contains_return <- function(x) {
    if (!is.call(x)) return(FALSE)
    name <- head_name(x[[1L]])
    if (name == "function") return(FALSE)
    if (name == "return") return(TRUE)
    args <- as.list(x)[-1L]
    any(vapply(seq_along(args), function(i) if (identical(args[[i]], quote(expr = ))) FALSE else contains_return(args[[i]]), logical(1)))
  }
  origin <- function(x, seen = character(), depth = 0L) {
    if (depth > 100L) return("unresolved")
    if (is.null(x) || is.atomic(x)) return("literal_only")
    if (is.symbol(x)) {
      name <- as.character(x)
      if (name %in% c("TRUE", "FALSE", "NULL", "NA", "NA_real_", "Inf", "NaN", "T", "F")) return("literal_only")
      if (name %in% seen || !exists(name, definitions, inherits = FALSE)) return("unresolved")
      return(origin(get(name, definitions), c(seen, name), depth + 1L))
    }
    if (!is.call(x)) return("unresolved")
    name <- head_name(x[[1L]]); args <- as.list(x)[-1L]
    # R function arguments are formals, body, and optional NULL source reference.
    # Inspect its return/tail expression; unrelated preceding arithmetic cannot
    # turn a literal tail into calculation lineage. Early control-flow returns
    # remain unresolved: this is not a dynamic execution/dataflow proof.
    if (name == "function") {
      if (length(args) < 2L) return("unresolved")
      body <- args[[2L]]
      if (is.call(body) && head_name(body[[1L]]) == "{") {
        expressions <- as.list(body)[-1L]
        if (!length(expressions)) return("literal_only")
        preceding <- head(expressions, -1L)
        if (length(preceding) && any(vapply(preceding, contains_return, logical(1)))) return("unresolved")
        body <- expressions[[length(expressions)]]
      }
      if (is.call(body) && head_name(body[[1L]]) %in% c("if", "for", "while", "repeat")) return("unresolved")
      return(origin(body, seen, depth + 1L))
    }
    fn <- local_function(name)
    if (!is.null(fn)) return(origin(fn, c(seen, name), depth + 1L))
    if (name == "$") return(origin(args[[1L]], seen, depth + 1L))
    if (name %in% c("[[", "[")) return(combine(vapply(seq_along(args), function(i) if (identical(args[[i]], quote(expr = ))) "literal_only" else origin(args[[i]], seen, depth + 1L), character(1))))
    if (name %in% transparent) return(combine(vapply(seq_along(args), function(i) if (identical(args[[i]], quote(expr = ))) "literal_only" else origin(args[[i]], seen, depth + 1L), character(1))))
    if (name %in% c("<-", "=", "<<-")) return(origin(args[[length(args)]], seen, depth + 1L))
    if (!nzchar(name)) return("unresolved")
    "computed_or_read"
  }
  states <- if (length(rows)) vapply(rows, origin, character(1)) else character()
  if (any(states == "literal_only")) stop("computation contract: numerical result rows contain literal-only values or aliases, not fresh calculation/read lineage; recompute the quantities in this execution or read an actually captured artifact by its issued read_path and serialize its variables. Printed numbers and unrelated calculations cannot supply provenance")
  # A literal complete JSON string bypasses row calls but is still transcription.
  inspect_string <- function(x) {
    if (is.character(x) && length(x) == 1L) {
      text <- sub("^POWER_AGENT_RESULT=", "", trimws(x))
      if (grepl("^\\{", text)) {
        payload <- tryCatch(jsonlite::fromJSON(text, simplifyVector = FALSE), error = function(e) NULL)
        if (is.list(payload) && is.list(payload$results) && length(payload$results)) stop("computation contract: a literal result JSON string is transcription; calculate/read and serialize actual variables in the same execution")
      }
    } else if (is.call(x) || is.expression(x) || is.pairlist(x)) for (i in seq_along(x)) if (!identical(x[[i]], quote(expr = ))) inspect_string(x[[i]])
  }
  for (expression in program) inspect_string(expression)
  audit <- list(version = "1.0.1", status = "no_obvious_literal_transcription", result_expressions = length(states), computed_or_read_expressions = sum(states == "computed_or_read"), unresolved_expressions = sum(states == "unresolved"), explicit_method_option_calls = method_calls, scope = "Conservative source AST filter; no dynamic-dataflow, file-authenticity, numerical or scientific certification")
  message("POWER_AGENT_COMPUTATION_AUDIT=", jsonlite::toJSON(audit, auto_unbox = TRUE))
  invisible(audit)
}
`;
export const COMPUTATION_CONTRACT_SHA256 = createHash('sha256').update(COMPUTATION_CONTRACT_R).digest('hex');

export function explicitRequestConstraints(query) {
  const negated = prefix => /\b(?:not|never|without|avoid)\b/i.test(prefix);
  const matches = [...query.matchAll(/\bstrict\s*=\s*(TRUE|FALSE)\b/gi)].filter(match => {
    const prefix = query.slice(Math.max(0, match.index - 500), match.index);
    const methods = [...prefix.matchAll(/\b(?:stats::)?power\.t\.test(?=[\s(])/gi)];
    const method = methods.at(-1);
    if (!method) return false;
    const gap = prefix.slice(method.index + method[0].length);
    return !/[;\n]/.test(gap) && !/\b(?:json|schema)\b/i.test(gap) && !negated(prefix.slice(Math.max(0, method.index - 50), method.index));
  });
  const natural = [...query.matchAll(/\bstrict[ ._-]+two[ ._-]*sided\b/gi)].find(match => {
    const prefix = query.slice(Math.max(0, match.index - 60), match.index);
    const suffix = query.slice(match.index + match[0].length, match.index + match[0].length + 120);
    return !negated(prefix) && /^[^;\n.]{0,100}\bpower\b/i.test(suffix);
  });
  const values = new Set(matches.map(match => match[1].toUpperCase() === 'TRUE'));
  if (natural) values.add(true);
  const constraints = { exact_request: query, request_sha256: createHash('sha256').update(query).digest('hex'), power_t_test_strict: values.size === 1 ? [...values][0] : null, strict_two_sided: Boolean(natural), conflicting_strict_options: values.size > 1,
    source_quotes: [...matches.map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length })), ...(natural ? [{ text: natural[0], start: natural.index, end: natural.index + natural[0].length }] : [])], scope: 'Verbatim current user request plus bounded recognition of explicit strict options; no general semantic/input certification.' };
  return constraints;
}

export function computationAudit(stderr) {
  const entries = String(stderr || '').split('\n').filter(line => line.startsWith('POWER_AGENT_COMPUTATION_AUDIT='));
  if (entries.length !== 1) return null;
  try { const value = JSON.parse(entries[0].slice('POWER_AGENT_COMPUTATION_AUDIT='.length)); return value.version === COMPUTATION_CONTRACT_VERSION && value.status === 'no_obvious_literal_transcription' ? value : null; } catch { return null; }
}

export function codeWithResultSerializer(code, requestConstraints = {}) {
  return `# Power Agent numerical serialization helper ${RESULT_SERIALIZER_VERSION}; no statistical defaults\n${RESULT_SERIALIZER_R}\n${COMPUTATION_CONTRACT_R}\npower_agent_check_source(${JSON.stringify(code)}, ${JSON.stringify(JSON.stringify({ power_t_test_strict: requestConstraints.power_t_test_strict ?? null, strict_two_sided: requestConstraints.strict_two_sided === true }))})\n# Requested calculation\n${code}`;
}
