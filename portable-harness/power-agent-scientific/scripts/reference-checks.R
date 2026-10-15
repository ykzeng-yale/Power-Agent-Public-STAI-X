#!/usr/bin/env Rscript
# Limited reference checks for explicitly specified independent continuous means.
# No task answers, package installations, source retrieval or inferred defaults.
args <- commandArgs(trailingOnly=TRUE)
value_after <- function(flag) {i <- match(flag,args); if(is.na(i) || i==length(args)) stop(paste('Missing',flag)); args[i+1L]}
input_path <- value_after('--record')
output_path <- value_after('--output')
if(!requireNamespace('jsonlite',quietly=TRUE)) stop('Preinstalled jsonlite is required; do not install it from this checker')
hash_command <- 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())'
record_sha256 <- system2('python3',c('-c',shQuote(hash_command),shQuote(input_path)),stdout=TRUE,stderr=TRUE)
if(length(record_sha256)!=1L || !grepl('^[0-9a-f]{64}$',record_sha256)) stop('Preinstalled Python3 is required to bind the audit to the final record')
record <- jsonlite::fromJSON(input_path,simplifyVector=FALSE)
design <- record$design
issues <- character()
check <- function(condition,description) {if(!isTRUE(condition)) issues <<- c(issues,description)}
number <- function(x) is.numeric(x) && length(x)==1L && is.finite(x)
profile <- design$reference_profile
supported <- c('normal_independent_means','normal_equal_cluster_design_effect','two_sample_t_equal_allocation')
check(is.character(profile) && length(profile)==1L && profile %in% supported,'Specify a supported reference_profile; other methods require independent source-based review')
check(number(design$arms) && design$arms==2,'Exactly two arms must be explicitly supplied')
check(number(design$allocation_ratio) && design$allocation_ratio==1,'Explicit equal allocation is required')
check(number(design$standardized_effect) && design$standardized_effect!=0,'A nonzero signed standardized_effect is required')
check(number(design$alpha) && design$alpha>0 && design$alpha<1,'Explicit alpha must lie between0and1')
check(number(design$target_power) && design$target_power>0 && design$target_power<1,'Explicit target_power must lie between0and1')
check(is.character(design$sidedness) && design$sidedness %in% c('two-sided','one-sided-greater','one-sided-less'),'Specify two-sided, one-sided-greater or one-sided-less')
clustered <- identical(profile,'normal_equal_cluster_design_effect')
if(clustered) {
  check(number(design$icc) && design$icc>=0 && design$icc<1,'Explicit ICC must lie between0and1')
  check(number(design$cluster_size) && design$cluster_size>=1 && design$cluster_size%%1==0,'Explicit positive integer cluster_size is required')
}
emit <- function(extra=list()) {
  result <- c(list(checker_version='1.0.1',record_sha256=record_sha256,status=if(length(issues)) 'failed' else 'passed',passed=!length(issues),issues=as.list(issues),
    limitation='Limited mathematical check under declared normal/common-variance/equal-allocation assumptions. Does not certify source inputs, appropriateness, finite-cluster inference, or unfamiliar designs.'),extra)
  jsonlite::write_json(result,output_path,auto_unbox=TRUE,pretty=TRUE,digits=16)
  cat(jsonlite::toJSON(result,auto_unbox=TRUE,digits=16),'\n')
  quit(status=if(length(issues)) 2L else 0L)
}
if(length(issues)) emit()
d <- design$standardized_effect
alpha <- design$alpha
target <- design$target_power
two <- design$sidedness=='two-sided'
direction <- if(design$sidedness=='one-sided-less') -1 else 1
if(!two) check(direction*d>0,'The declared one-sided direction and effect must agree for this inversion checker')
if(length(issues)) emit()
effect <- if(two) abs(d) else direction*d
m <- if(clustered) design$cluster_size else 1
DE <- if(clustered) 1+(m-1)*design$icc else 1
critical <- qnorm(1-alpha/if(two) 2 else 1)
student <- identical(profile,'two_sample_t_equal_allocation')
power_standardized <- function(count) {
  n_arm <- count*m
  ncp <- effect*sqrt(n_arm/(2*DE))
  if(student) {
    df <- 2*n_arm-2
    cutoff <- qt(1-alpha/if(two) 2 else 1,df)
    pt(cutoff,df,ncp=ncp,lower.tail=FALSE)+if(two) pt(-cutoff,df,ncp=ncp) else 0
  } else pnorm(ncp-critical)+if(two) pnorm(-ncp-critical) else 0
}
power_independent <- function(count) {
  n_arm <- count*m
  if(student) return(stats::power.t.test(n=n_arm,delta=effect,sd=1,sig.level=alpha,type='two.sample',alternative=if(two) 'two.sided' else 'one.sided',strict=TRUE)$power)
  # Two independently sampled group means: Var(mean1-mean0)=Var(mean1)+Var(mean0).
  sd_group_mean <- sqrt(DE/n_arm)  # individual common SD standardized to1
  sd_difference <- sqrt(sd_group_mean^2+sd_group_mean^2)
  threshold <- critical*sd_difference
  pnorm(threshold,mean=effect,sd=sd_difference,lower.tail=FALSE)+if(two) pnorm(-threshold,mean=effect,sd=sd_difference) else 0
}
smallest <- if(student) 2L else 1L
upper <- smallest
while(power_standardized(upper)<target && upper<1000000L) upper <- upper*2L
check(upper<=1000000L && power_standardized(upper)>=target,'Required design exceeds bounded reference search')
if(length(issues)) emit()
lower <- smallest
while(lower<upper) {middle <- floor((lower+upper)/2); if(power_standardized(middle)>=target) upper<-middle else lower<-middle+1L}
minimum <- lower
previous <- minimum-1L
achieved <- power_standardized(minimum)
previous_power <- if(previous>=smallest) power_standardized(previous) else NA_real_
independent_achieved <- power_independent(minimum)
check(abs(achieved-independent_achieved)<1e-10,'The two implementations disagree at the minimum')
if(previous>=smallest) check(abs(previous_power-power_independent(previous))<1e-10,'The two implementations disagree at preceding design')
result_rows <- record$results
find_value <- function(metric,unit) {
  matching <- Filter(function(row) identical(row$metric,metric) && identical(row$unit,unit),result_rows)
  if(length(matching)!=1L || !number(matching[[1]]$value)) {issues <<- c(issues,paste('Require exactly one computed',metric,unit)); return(NA_real_)}
  matching[[1]]$value
}
expected <- list(list(metric='sample_size',value=minimum*m,unit='participants_per_arm'),list(metric='sample_size',value=2*minimum*m,unit='participants_total'),
  list(metric='achieved_power',value=achieved,unit='probability'))
if(previous>=smallest) expected <- c(expected,list(list(metric='power_preceding',value=previous_power,unit='probability')))
if(clustered) expected <- c(expected,list(list(metric='sample_size',value=minimum,unit='clusters_per_arm'),list(metric='sample_size',value=2*minimum,unit='clusters_total')))
for(row in expected) {
  actual <- find_value(row$metric,row$unit)
  if(is.finite(actual)) check(abs(actual-row$value)<1e-7,paste('Computed result disagrees with reference:',row$metric,row$unit))
}
emit(list(profile=profile,design_effect=DE,reference_results=expected,independent_method=if(student) 'Noncentral-t two tails compared with stats::power.t.test(strict=TRUE)' else 'Standardized noncentrality compared with independently constructed group-mean difference distribution',
  variance_identity='Var(mean1-mean0)=2*sigma^2*DE/n_per_arm=4*sigma^2*DE/N_total',minimum_verified=achieved>=target && (is.na(previous_power) || previous_power<target)))
