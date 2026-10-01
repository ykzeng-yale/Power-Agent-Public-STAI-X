# Install exact dependencies at image build time; generated R workers cannot install.
versions <- c(jsonlite="2.0.0",pwr="1.3-0",pmsampsize="1.1.3")
for (name in names(versions)) {
  version <- versions[[name]]
  artifact <- paste0(name,"_",version,".tar.gz")
  urls <- c(paste0("https://cran.r-project.org/src/contrib/Archive/",name,"/",artifact),paste0("https://cran.r-project.org/src/contrib/",artifact))
  local <- tempfile(fileext=".tar.gz")
  downloaded <- FALSE
  for (url in urls) {
    outcome <- tryCatch(suppressWarnings(download.file(url,local,mode="wb",quiet=TRUE)),error=function(e) 1L)
    if (identical(outcome,0L)) { downloaded <- TRUE; break }
  }
  if (!downloaded) stop(paste("Cannot retrieve pinned source",artifact))
  install.packages(local,repos=NULL,type="source")
  unlink(local)
  if (!identical(as.character(packageVersion(name)),as.character(package_version(version)))) stop(paste("Pinned package verification failed",name))
}
cat("Pinned R packages verified:",paste(names(versions),versions,collapse="; "),"\n")
