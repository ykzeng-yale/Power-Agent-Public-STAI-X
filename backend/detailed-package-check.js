import { Sandbox } from '@e2b/code-interpreter';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Detailed E2B Template Package Check...\n');

  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    template: 'biostat-r-v2',
  });

  const code = `
# Check R library paths
cat("=== R LIBRARY PATHS ===\\n")
print(.libPaths())
cat("\\n")

# Check all installed packages
cat("=== INSTALLED PACKAGES ===\\n")
installed <- installed.packages()
cat("Total packages:", nrow(installed), "\\n\\n")

# Check specific locations
cat("=== CHECKING /usr/local/lib/R/site-library ===\\n")
if (dir.exists("/usr/local/lib/R/site-library")) {
  site_pkgs <- list.files("/usr/local/lib/R/site-library")
  cat("Packages in site-library:", length(site_pkgs), "\\n")
  cat("Sample:", paste(head(site_pkgs, 10), collapse=", "), "\\n\\n")
} else {
  cat("Directory does not exist\\n\\n")
}

# Try to load each biostat package
cat("=== BIOSTAT PACKAGE CHECK ===\\n")
biostat <- c("Rcpp", "RcppEigen", "lme4", "swdpwr", "CRTSize", "survey", "survival", "pwr")
for(pkg in biostat) {
  found <- pkg %in% rownames(installed)
  if (found) {
    location <- installed[pkg, "LibPath"]
    cat(sprintf("✅ %s - Location: %s\\n", pkg, location))
  } else {
    cat(sprintf("❌ %s - NOT FOUND\\n", pkg))
  }
}
`;

  const result = await sandbox.runCode(code, { language: 'r' });
  console.log(result.logs.stdout.join('\n'));
  
  if (result.logs.stderr && result.logs.stderr.length > 0) {
    console.log('\n=== STDERR ===');
    console.log(result.logs.stderr.join('\n'));
  }

  await sandbox.kill();
}

main();
