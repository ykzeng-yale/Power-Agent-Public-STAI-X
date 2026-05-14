import { Sandbox } from '@e2b/code-interpreter';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Debugging R Library Paths in E2B Sandbox...\n');

  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    template: 'biostat-r-v4',
  });

  const code = `
# Show R library paths
cat("=== R LIBRARY PATHS ===\\n")
.libPaths()

cat("\\n\\n=== CONTENTS OF EACH LIBRARY ===\\n")
for (lib in .libPaths()) {
  cat(sprintf("\\n%s:\\n", lib))
  if (dir.exists(lib)) {
    pkgs <- list.files(lib)
    cat(sprintf("  %d packages: %s\\n", length(pkgs), paste(head(pkgs, 10), collapse=", ")))
  } else {
    cat("  (does not exist)\\n")
  }
}

cat("\\n\\n=== CHECK SPECIFIC PATHS ===\\n")
paths_to_check <- c(
  "/usr/local/lib/R/site-library",
  "/usr/lib/R/site-library",
  "/usr/lib/R/library",
  "/home/user/R"
)

for (p in paths_to_check) {
  cat(sprintf("\\n%s:\\n", p))
  if (dir.exists(p)) {
    pkgs <- list.files(p)
    cat(sprintf("  EXISTS - %d items\\n", length(pkgs)))
    if (length(pkgs) > 0) {
      cat(sprintf("  First 20: %s\\n", paste(head(pkgs, 20), collapse=", ")))
    }
  } else {
    cat("  DOES NOT EXIST\\n")
  }
}

cat("\\n\\n=== SEARCH FOR lme4 ===\\n")
system("find /usr -name 'lme4' -type d 2>/dev/null || echo 'Not found'")
`;

  const result = await sandbox.runCode(code, { language: 'r' });
  console.log(result.logs.stdout.join('\n'));
  if (result.logs.stderr.length > 0) {
    console.log('\nSTDERR:');
    console.log(result.logs.stderr.join('\n'));
  }

  await sandbox.kill();
}

main();
