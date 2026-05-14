import { Sandbox } from '@e2b/code-interpreter';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('🔍 Checking E2B Template Packages...\n');

  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    template: 'biostat-r-v4', // Clean rebuild with verified packages
  });

  const code = `
installed <- installed.packages()
cat("TOTAL PACKAGES:", nrow(installed), "\\n\\n")

biostat <- c("lme4","swdpwr","CRTSize","survey","survival","pwr","MatchIt","lmerTest","emmeans","effectsize")
for(pkg in biostat) {
  found <- pkg %in% rownames(installed)
  cat(sprintf("%s: %s\\n", pkg, if(found) "✅" else "❌"))
}
`;

  const result = await sandbox.runCode(code, { language: 'r' });
  console.log(result.logs.stdout.join('\n'));

  await sandbox.kill();
}

main();
