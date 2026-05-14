import { Sandbox } from '@e2b/code-interpreter';
import dotenv from 'dotenv';

dotenv.config();

console.log('\n🔍 Verifying Template: biostat-r\n');
console.log('═'.repeat(70) + '\n');

async function verify() {
  const sandbox = await Sandbox.create({
    apiKey: process.env.E2B_API_KEY,
    template: 'biostat-r', // Use template NAME
  });

  console.log('✅ Sandbox created from template\n');

  const check = await sandbox.runCode(`
cat('Installed R Packages Check:\\n')
cat('═══════════════════════════════════════\\n\\n')

packages <- c('swdpwr', 'CRTSize', 'lme4', 'survey', 'survival', 'pak')
for (pkg in packages) {
  if (require(pkg, quietly = TRUE, character.only = TRUE)) {
    cat('  ✅', pkg, '\\n')
  } else {
    cat('  ❌', pkg, 'NOT FOUND\\n')
  }
}

cat('\\n')
cat('Library paths:\\n')
print(.libPaths())

cat('\\nTotal installed packages:', length(installed.packages()[,1]), '\\n')
`, { language: 'r' });

  console.log(check.logs.stdout.join('\n'));

  await sandbox.kill();
  
  console.log('\n' + '═'.repeat(70));
  console.log('Template verification complete');
  console.log('═'.repeat(70) + '\n');
}

verify().catch(console.error);
