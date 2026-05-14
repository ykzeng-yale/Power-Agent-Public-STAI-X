/**
 * COMPREHENSIVE R PACKAGE TEST
 * Tests:
 * 1. C++ compilation support in E2B
 * 2. Multiple CRT R packages
 * 3. Determines if we need different environment
 */

import { Sandbox } from '@e2b/code-interpreter';
import { readFileSync } from 'fs';

const envContent = readFileSync('../backend/.env', 'utf-8');
const E2B_API_KEY = envContent.match(/E2B_API_KEY=(.*)/)?.[1]?.trim();

console.log('\n' + '='.repeat(70));
console.log('🔬 COMPREHENSIVE E2B + R CAPABILITY TEST');
console.log('='.repeat(70) + '\n');

// Packages to test
const CRT_PACKAGES = [
  { name: 'CRTSize', category: 'Pure R' },
  { name: 'clusterPower', category: 'CRT Power' },
  { name: 'swdpwr', category: 'Stepped Wedge' },
  { name: 'swCRTdesign', category: 'SW Design' },
];

const BASIC_PACKAGES = [
  { name: 'lme4', category: 'Mixed Models' },
  { name: 'survey', category: 'Survey Stats' },
  { name: 'pwrss', category: 'Power Analysis' },
];

async function comprehensiveTest() {
  let sandbox = null;

  try {
    console.log('1️⃣  Creating E2B Code-Interpreter sandbox...\n');
    sandbox = await Sandbox.create({ apiKey: E2B_API_KEY });
    console.log('✅ Sandbox created\n');

    // TEST 1: Check C++ compilation tools
    console.log('2️⃣  Testing C++ Compilation Support...\n');
    
    const compilerTest = `
# Check for compilers
cat("Checking for C++ compiler...\\n")
system("which gcc", intern=FALSE)
system("which g++", intern=FALSE)
system("gcc --version 2>&1 | head -1", intern=FALSE)

cat("\\nChecking R compilation capability...\\n")
# Try to see if R can compile
cat(R.version.string, "\\n")
cat("Platform:", R.version$platform, "\\n")
`;

    console.log('   Running compiler check...\n');
    const compExec = await sandbox.runCode(compilerTest, { language: 'r' });
    
    console.log('   Compiler Test Output:');
    console.log('   ' + (compExec.logs.stdout?.join('   ') || '(no output)'));
    
    const hasGCC = compExec.logs.stdout?.some(line => line.includes('gcc'));
    console.log(`\n   GCC Compiler: ${hasGCC ? '✅ AVAILABLE' : '❌ NOT FOUND'}\n`);

    // TEST 2: Try installing build tools
    console.log('3️⃣  Attempting to Install Build Tools...\n');
    
    const installBuildTools = `
# Try to install build-essential (if we have sudo/apt)
result <- tryCatch({
  system("apt-get update && apt-get install -y build-essential r-base-dev", 
         intern=TRUE, ignore.stderr=FALSE)
}, error = function(e) {
  cat("Cannot install system packages (no sudo access)\\n")
  return(NULL)
})

if (!is.null(result)) {
  cat("Build tools installation attempted\\n")
} else {
  cat("No system package installation access\\n")
}
`;

    const buildExec = await sandbox.runCode(installBuildTools, { language: 'r' });
    console.log('   Build Tools Output:');
    console.log('   ' + (buildExec.logs.stdout?.join('   ') || '(no output)'));

    // TEST 3: Test CRT packages
    console.log('\n4️⃣  Testing CRT R Packages...\n');
    console.log('   Testing packages one by one...\n');

    const results = {};

    for (const pkg of [...CRT_PACKAGES, ...BASIC_PACKAGES]) {
      console.log(`   📦 Testing: ${pkg.name} (${pkg.category})`);
      
      const testCode = `
cat("\\n=== Testing ${pkg.name} ===\\n")

# Try installation with dependencies
result <- tryCatch({
  install.packages("${pkg.name}", 
                   dependencies=TRUE,
                   repos="https://cloud.r-project.org",
                   quiet=TRUE)
  
  # Try to load
  library(${pkg.name})
  
  cat("✅ ${pkg.name} installed and loaded successfully!\\n")
  TRUE
}, error = function(e) {
  cat("❌ ${pkg.name} failed:", e$message, "\\n")
  FALSE
}, warning = function(w) {
  cat("⚠️  ${pkg.name} warning:", w$message, "\\n")
  FALSE
})

cat("Result:", ifelse(result, "SUCCESS", "FAILED"), "\\n")
`;

      try {
        const exec = await sandbox.runCode(testCode, { language: 'r' });
        
        const success = exec.logs.stdout?.some(line => line.includes('SUCCESS'));
        const failed = exec.logs.stderr?.some(line => line.includes('non-zero exit'));
        
        results[pkg.name] = {
          status: success ? '✅ WORKS' : (failed ? '❌ FAILS' : '⚠️ UNCLEAR'),
          category: pkg.category,
          output: exec.logs.stdout?.join(' ').substring(0, 100),
        };
        
        console.log(`      ${results[pkg.name].status}\n`);
      } catch (e) {
        results[pkg.name] = {
          status: '❌ ERROR',
          category: pkg.category,
          error: e.message,
        };
        console.log(`      ❌ ERROR: ${e.message}\n`);
      }
      
      // Small delay between packages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // FINAL SUMMARY
    console.log('\n' + '='.repeat(70));
    console.log('📊 COMPREHENSIVE TEST RESULTS');
    console.log('='.repeat(70) + '\n');

    console.log('C++ Compilation:');
    console.log(`  GCC Compiler: ${hasGCC ? '✅ Available' : '❌ Not available'}`);
    console.log(`  System packages: ❌ Cannot install (no sudo)\n`);

    console.log('CRT Packages:');
    CRT_PACKAGES.forEach(pkg => {
      console.log(`  ${pkg.name.padEnd(15)} ${results[pkg.name]?.status || '❓ Not tested'}`);
    });

    console.log('\nBasic Packages:');
    BASIC_PACKAGES.forEach(pkg => {
      console.log(`  ${pkg.name.padEnd(15)} ${results[pkg.name]?.status || '❓ Not tested'}`);
    });

    // Determine recommendation
    console.log('\n' + '='.repeat(70));
    console.log('🎯 RECOMMENDATION');
    console.log('='.repeat(70) + '\n');

    const workingCRT = CRT_PACKAGES.filter(p => results[p.name]?.status === '✅ WORKS');
    const failingCRT = CRT_PACKAGES.filter(p => results[p.name]?.status === '❌ FAILS');

    if (workingCRT.length > 0) {
      console.log('✅ Working CRT packages in E2B:');
      workingCRT.forEach(p => console.log(`   • ${p.name}`));
      console.log('\n   → Use these packages for CRT analysis!');
    }

    if (failingCRT.length > 0) {
      console.log('\n❌ Failing CRT packages in E2B:');
      failingCRT.forEach(p => console.log(`   • ${p.name}`));
      console.log('\n   → Use Python implementation or working alternatives');
    }

    const workingBasic = BASIC_PACKAGES.filter(p => results[p.name]?.status === '✅ WORKS');
    if (workingBasic.length >= 2) {
      console.log('\n✅ E2B is VIABLE for biostatistics with working packages!');
    } else {
      console.log('\n⚠️  Consider alternative execution environment');
    }

    console.log('\n');

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
  } finally {
    if (sandbox) {
      await sandbox.kill();
    }
  }
}

comprehensiveTest();

