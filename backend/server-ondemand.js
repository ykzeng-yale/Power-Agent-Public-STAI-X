// On-Demand Package Installation Server
// Tests the /tmp/Rlibs pattern for Cloud Run

import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// R Process Pool with on-demand package installation
class RProcessPool {
  constructor(size = 3) {
    this.size = size;
    this.processes = [];
    this.available = [];
    this.stats = {
      totalExecutions: 0,
      packageInstalls: {},
      avgExecutionTime: 0,
    };
  }

  async init() {
    console.log('🚀 Initializing R Process Pool with on-demand installation support...');

    // Create R bootstrap script for on-demand installation
    // EXPERT RECOMMENDATION: Use PPM Linux binaries + pak for speed
    const bootstrapScript = `
# On-demand package installation bootstrap (IMPROVED)
cache_lib <- Sys.getenv("R_LIBS_USER", "/tmp/Rlibs")
if (!dir.exists(cache_lib)) {
  dir.create(cache_lib, recursive = TRUE, showWarnings = FALSE)
  cat("✅ Created", cache_lib, "for on-demand packages\\n")
}

# Use Posit Package Manager for Linux binaries (EXPERT FIX #1)
ppm_repo <- "https://packagemanager.posit.co/cran/__linux__/jammy/latest"
options(repos = c(PPM = ppm_repo, CRAN = "https://cloud.r-project.org"))

# Prepend to library paths
.old <- .libPaths()
.libPaths(c(cache_lib, .old))

cat("📚 Library paths:\\n")
print(.libPaths())
cat("📦 Using PPM binary repo:", ppm_repo, "\\n")
cat("\\n")

# Install pak if not available (EXPERT FIX #2)
if (!requireNamespace("pak", quietly = TRUE)) {
  cat("📦 Installing pak (modern package installer)...\\n")
  install.packages("pak", repos = "https://cloud.r-project.org", lib = cache_lib)
}

# Function to ensure packages are installed using pak
ensure_packages <- function(cran_pkgs = character(), github_pkgs = character()) {
  start_time <- Sys.time()

  # Use pak for unified CRAN + GitHub installation
  suppressPackageStartupMessages(library(pak))

  all_refs <- c(cran_pkgs, github_pkgs)

  if (length(all_refs) > 0) {
    cat("📦 Installing packages via pak:", paste(all_refs, collapse=", "), "\\n")
    cat("   (pak uses parallel downloads + binary packages when available)\\n")

    tryCatch({
      pak::pkg_install(all_refs, lib = cache_lib, upgrade = FALSE, ask = FALSE)
      cat("✅ All packages installed successfully\\n")
    }, error = function(e) {
      cat("❌ Installation error:", conditionMessage(e), "\\n")
      stop(e)
    })
  } else {
    cat("✓ No packages to install\\n")
  }

  elapsed <- difftime(Sys.time(), start_time, units="secs")
  cat("⏱️ Package installation took:", round(as.numeric(elapsed), 2), "seconds\\n\\n")

  return(as.numeric(elapsed))
}

# Make function available globally
.GlobalEnv$ensure_packages <- ensure_packages

cat("✅ On-demand installation bootstrap complete (using pak + PPM binaries)\\n\\n")
`;

    await fs.writeFile('/tmp/r_bootstrap_ondemand.R', bootstrapScript);

    for (let i = 0; i < this.size; i++) {
      const process = spawn('R', ['--vanilla', '--quiet'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.processes.push({
        id: i,
        process,
        busy: false,
        executionCount: 0,
        lastError: null,
      });

      this.available.push(i);

      // Load bootstrap
      await this.executeOnProcess(i, `source('/tmp/r_bootstrap_ondemand.R')`);
    }

    console.log(`✅ R Process Pool ready with ${this.size} processes`);
    console.log('📦 On-demand package installation enabled to /tmp/Rlibs\n');
  }

  async executeOnProcess(processId, code) {
    return new Promise((resolve, reject) => {
      const proc = this.processes[processId];
      let stdout = '';
      let stderr = '';

      const cleanup = () => {
        proc.process.stdout.removeAllListeners('data');
        proc.process.stderr.removeAllListeners('data');
      };

      proc.process.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Send code
      proc.process.stdin.write(code + '\n');
      proc.process.stdin.write('cat("\\n__END_OF_OUTPUT__\\n")\n');

      // Wait for completion marker
      const checkOutput = setInterval(() => {
        if (stdout.includes('__END_OF_OUTPUT__')) {
          clearInterval(checkOutput);
          cleanup();

          // Remove marker
          stdout = stdout.replace('__END_OF_OUTPUT__', '').trim();

          resolve({ stdout, stderr });
        }
      }, 100);

      // EXPERT FIX #3: Increase timeout from 5 min to 20 min for large packages
      // With PPM binaries, most packages should install in seconds/minutes
      // But allow 20 min for truly heavy packages or slow network
      setTimeout(() => {
        clearInterval(checkOutput);
        cleanup();
        reject(new Error('R execution timeout after 20 minutes'));
      }, 1200000); // 20 minutes = 1200000ms
    });
  }

  async execute(code, requiredPackages = { cran: [], github: [] }) {
    const startTime = Date.now();

    if (this.available.length === 0) {
      throw new Error('No R processes available');
    }

    const processId = this.available.shift();
    const proc = this.processes[processId];
    proc.busy = true;

    try {
      let fullOutput = '';
      let installTime = 0;

      // Install required packages on-demand
      if (requiredPackages.cran.length > 0 || requiredPackages.github.length > 0) {
        console.log(`📦 Process ${processId}: Installing required packages...`);

        const ensureCode = `ensure_packages(
          cran_pkgs = c(${requiredPackages.cran.map(p => `"${p}"`).join(', ')}),
          github_pkgs = c(${requiredPackages.github.map(p => `"${p}"`).join(', ')})
        )`;

        const installResult = await this.executeOnProcess(processId, ensureCode);
        fullOutput += '=== PACKAGE INSTALLATION ===\n';
        fullOutput += installResult.stdout + '\n';
        fullOutput += installResult.stderr + '\n\n';

        // Extract install time from output
        const timeMatch = installResult.stdout.match(/took:\s*([\d.]+)\s*seconds/);
        if (timeMatch) {
          installTime = parseFloat(timeMatch[1]);
        }

        // Track installations
        for (const pkg of [...requiredPackages.cran, ...requiredPackages.github]) {
          this.stats.packageInstalls[pkg] = (this.stats.packageInstalls[pkg] || 0) + 1;
        }
      }

      // Execute actual code
      console.log(`⚙️ Process ${processId}: Executing R code...`);
      const result = await this.executeOnProcess(processId, code);

      fullOutput += '=== R CODE EXECUTION ===\n';
      fullOutput += result.stdout + '\n';
      if (result.stderr) {
        fullOutput += '\n=== WARNINGS/MESSAGES ===\n';
        fullOutput += result.stderr + '\n';
      }

      const executionTime = Date.now() - startTime;
      const codeTime = executionTime - (installTime * 1000);

      proc.executionCount++;
      this.stats.totalExecutions++;

      // Update avg execution time
      const prevAvg = this.stats.avgExecutionTime;
      this.stats.avgExecutionTime =
        (prevAvg * (this.stats.totalExecutions - 1) + executionTime) / this.stats.totalExecutions;

      return {
        output: fullOutput,
        success: true,
        executionTime,
        installTime: installTime * 1000,
        codeTime,
        processId,
      };

    } catch (error) {
      proc.lastError = error.message;
      return {
        output: '',
        error: error.message,
        success: false,
        processId,
      };
    } finally {
      proc.busy = false;
      this.available.push(processId);
    }
  }

  getStats() {
    return {
      totalProcesses: this.size,
      availableProcesses: this.available.length,
      busyProcesses: this.size - this.available.length,
      totalExecutions: this.stats.totalExecutions,
      avgExecutionTimeMs: Math.round(this.stats.avgExecutionTime),
      packageInstalls: this.stats.packageInstalls,
      processStats: this.processes.map(p => ({
        id: p.id,
        busy: p.busy,
        executionCount: p.executionCount,
        lastError: p.lastError,
      })),
    };
  }
}

// EXPERT FIX #4: Fix pool initialization race
// Wait for pool init before starting server to prevent requests
// arriving before pool is ready
let rPool = null;

// Health endpoint
app.get('/health', (req, res) => {
  const stats = rPool ? rPool.getStats() : null;
  res.json({
    status: 'ok',
    service: 'on-demand-r-installation',
    mode: 'r-process-pool-with-ondemand',
    poolReady: !!rPool,
    poolStats: stats,
    features: [
      'On-demand R package installation to /tmp/Rlibs (using PPM binaries + pak)',
      'CRAN and GitHub package support',
      'Automatic package caching within container instance',
      'Installation time tracking (20 min timeout)',
      'R process pool for performance (3 processes)',
      'Posit Package Manager Linux binaries for fast installs'
    ]
  });
});

// Execute R code with on-demand package installation
app.post('/api/analyze', async (req, res) => {
  try {
    const { query, packages } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    if (!rPool) {
      return res.status(503).json({ error: 'R pool not initialized yet' });
    }

    console.log(`\n📊 Analysis Request: ${query.substring(0, 60)}...`);

    // Parse required packages from query or explicit packages param
    const requiredPackages = packages || detectRequiredPackages(query);

    console.log('📦 Required packages:', requiredPackages);

    // Generate R code based on query
    const rCode = await generateRCode(query);

    // Execute with on-demand installation
    const result = await rPool.execute(rCode, requiredPackages);

    if (result.success) {
      res.json({
        success: true,
        query,
        output: result.output,
        performance: {
          totalTime: result.executionTime,
          installTime: result.installTime,
          codeExecutionTime: result.codeTime,
          processId: result.processId,
        },
        poolStats: rPool.getStats(),
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        output: result.output,
      });
    }

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: Detect required packages from query
function detectRequiredPackages(query) {
  const packages = { cran: [], github: [] };

  // Common package keywords
  const packageMap = {
    'power analysis': ['pwr'],
    'sample size': ['pwr'],
    'pwr': ['pwr'],
    'mixed model': ['lme4'],
    'lme4': ['lme4'],
    'survival': ['survival'],
    'cluster randomized': ['CRTSize'],
    'lmer': ['lme4'],
    'glmer': ['lme4'],
  };

  const lowerQuery = query.toLowerCase();
  for (const [keyword, pkgs] of Object.entries(packageMap)) {
    if (lowerQuery.includes(keyword)) {
      packages.cran.push(...pkgs);
    }
  }

  // Remove duplicates
  packages.cran = [...new Set(packages.cran)];

  return packages;
}

// Helper: Generate R code from query (simple version)
async function generateRCode(query) {
  // Simple pattern matching for common queries
  if (query.toLowerCase().includes('sample size') && query.toLowerCase().includes('t-test')) {
    return `
library(pwr)
result <- pwr.t.test(d=0.5, sig.level=0.05, power=0.80, type='two.sample')
cat('Sample size per group:', ceiling(result$n), '\\n')
cat('Total sample size:', ceiling(result$n) * 2, '\\n')
print(result)
`;
  }

  // Default: just try to execute as-is
  return query;
}

// Get pool stats
app.get('/api/stats', (req, res) => {
  if (!rPool) {
    return res.status(503).json({ error: 'R pool not initialized' });
  }
  res.json(rPool.getStats());
});

// EXPERT FIX #4 (continued): Initialize pool BEFORE starting server
// This prevents the race condition where requests arrive before pool is ready
(async () => {
  try {
    console.log('🔧 Initializing R Process Pool (this may take 3-4 minutes)...');
    console.log('📦 Using Posit Package Manager for Linux binaries');
    console.log('⚙️ Using pak for fast, parallel package installation\n');

    rPool = new RProcessPool(30);
    await rPool.init();

    console.log('\n✅ R Process Pool fully initialized and ready!');

    // Only start server AFTER pool is ready
    app.listen(PORT, () => {
      console.log(`\n🚀 On-Demand R Installation Server running on port ${PORT}`);
      console.log(`📍 Endpoints:`);
      console.log(`   POST /api/analyze - Execute R code with on-demand package installation`);
      console.log(`   GET  /health - Health check`);
      console.log(`   GET  /api/stats - Pool statistics`);
      console.log(`\n✨ Improvements applied:`);
      console.log(`   ✅ PPM Linux binaries (10-15 min → seconds for most packages)`);
      console.log(`   ✅ pak installer (parallel downloads + smart caching)`);
      console.log(`   ✅ 20 minute timeout (was 5 minutes)`);
      console.log(`   ✅ Pool init before server start (no race conditions)`);
      console.log(``);
    });
  } catch (error) {
    console.error('❌ Failed to initialize R Process Pool:', error);
    process.exit(1);
  }
})();
