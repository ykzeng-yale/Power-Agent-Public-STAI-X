import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Storage } from '@google-cloud/storage';
import fsSync from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Workspace base directory - configurable for local vs Docker environments
// In Docker: /workspace (default)
// Locally: set WORKSPACE_BASE_DIR env var or defaults to OS temp dir
const WORKSPACE_BASE = process.env.WORKSPACE_BASE_DIR ||
  (fsSync.existsSync('/workspace') ? '/workspace' : path.join(process.env.TMPDIR || '/tmp', 'r-workspace'));

console.log(`[R-POOL] 📁 Workspace base directory: ${WORKSPACE_BASE}`);

// Initialize Google Cloud Storage
let storage = null;
let gcsBucket = null;
try {
  storage = new Storage();
  gcsBucket = storage.bucket('power-agent-results-476822');
  console.log('[R-POOL] ✅ Google Cloud Storage initialized');
} catch (error) {
  console.warn('[R-POOL] ⚠️  GCS not available:', error.message);
}

class RProcessPool extends EventEmitter {
  constructor(poolSize = 4) {  // Reduced from 10 to 4: each R process needs ~1-2GB for simr simulations
    super();
    this.poolSize = poolSize;
    this.processes = [];
    this.availableProcesses = [];
    this.queue = [];
    this.executionCount = 0;
    this.totalExecutionTime = 0;

    // Session affinity: ensures same sessionId always uses same R process
    // This allows variables to persist across iterations within a session
    this.sessionProcessMap = new Map(); // sessionId -> processId
    this.sessionLastUsed = new Map();   // sessionId -> timestamp
  }

  async initialize() {
    console.log(`[R-POOL] Initializing R process pool with ${this.poolSize} processes...`);
    const startTime = Date.now();

    try {
      for (let i = 0; i < this.poolSize; i++) {
        const rProcess = await this.createRProcess(i);
        this.processes.push(rProcess);
        this.availableProcesses.push(rProcess);
      }

      const initTime = Date.now() - startTime;
      console.log(`[R-POOL] R process pool initialized successfully in ${initTime}ms`);
      console.log(`[R-POOL] Available processes: ${this.availableProcesses.length}`);

      // Start session cleanup timer
      this.startSessionCleanup();

      return true;
    } catch (error) {
      console.error('[R-POOL] Failed to initialize pool:', error);
      throw error;
    }
  }

  /**
   * Start periodic cleanup of idle sessions and watchdog for stuck processes
   * Sessions idle for more than 10 minutes will be released
   * Processes stuck busy for more than 15 minutes will be killed and restarted
   */
  startSessionCleanup() {
    // Check for idle sessions every minute
    this.cleanupInterval = setInterval(async () => {
      const now = Date.now();
      const idleTimeout = 10 * 60 * 1000; // 10 minutes
      const stuckTimeout = 15 * 60 * 1000; // 15 minutes - process stuck busy

      // WATCHDOG: Check for stuck processes
      for (const rProcess of this.processes) {
        if (rProcess.busy && rProcess.busySince) {
          const busyDuration = now - rProcess.busySince;
          if (busyDuration > stuckTimeout) {
            console.error(`[R-POOL] 🚨 WATCHDOG: Process ${rProcess.id} stuck busy for ${Math.round(busyDuration/60000)} minutes`);
            console.error(`[R-POOL] 🔧 Killing and restarting stuck process ${rProcess.id}`);

            try {
              // Kill the stuck process
              rProcess.process.kill('SIGKILL');
            } catch (e) {
              console.error(`[R-POOL] Failed to kill process ${rProcess.id}:`, e.message);
            }

            // Recreate the process
            try {
              const newProcess = await this.createRProcess(rProcess.id);
              this.processes[rProcess.id] = newProcess;
              this.availableProcesses.push(newProcess);
              console.log(`[R-POOL] ✓ Process ${rProcess.id} restarted successfully`);
            } catch (createError) {
              console.error(`[R-POOL] Failed to recreate process ${rProcess.id}:`, createError.message);
            }

            // Clear any sessions assigned to this process
            for (const [sessionId, processId] of this.sessionProcessMap.entries()) {
              if (processId === rProcess.id) {
                console.log(`[R-POOL] Clearing session ${sessionId} from stuck process`);
                this.sessionProcessMap.delete(sessionId);
              }
            }
          }
        }
      }

      // Cleanup idle sessions
      for (const [sessionId, lastUsed] of this.sessionLastUsed.entries()) {
        if (now - lastUsed > idleTimeout) {
          const processId = this.sessionProcessMap.get(sessionId);
          console.log(`[R-POOL] 🧹 Cleaning up idle session ${sessionId} (idle for ${Math.round((now - lastUsed) / 60000)} minutes)`);

          // Release session mapping
          this.sessionProcessMap.delete(sessionId);
          this.sessionLastUsed.delete(sessionId);

          // Clear R workspace for this process to free memory
          if (processId !== undefined && this.processes[processId]) {
            const rProcess = this.processes[processId];
            if (!rProcess.busy && rProcess.process && !rProcess.process.killed) {
              console.log(`[R-POOL]    Clearing workspace for process ${processId}`);
              try {
                // Clear all objects from R workspace
                rProcess.process.stdin.write('rm(list=ls())\n');
                rProcess.process.stdin.write('gc()\n'); // Force garbage collection
              } catch (error) {
                console.error(`[R-POOL]    Failed to clear workspace for process ${processId}:`, error.message);
              }
            }
          }
        }
      }
    }, 60000); // Run every minute

    console.log('[R-POOL] ✓ Session cleanup timer started (10 minute idle timeout)');
    console.log('[R-POOL] ✓ Watchdog started (15 minute stuck process detection)');
  }

  async createRProcess(id) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      console.log(`[R-POOL] Creating R process ${id}...`);

      const proc = spawn('R', ['--slave', '--vanilla', '--quiet'], {
        env: {
          ...process.env,
          // Don't override R_LIBS_USER - use system library where packages are pre-installed
          R_PROFILE_USER: '/dev/null'  // Skip user profile to speed up
        }
      });

      proc.stdout.setEncoding('utf8');
      proc.stderr.setEncoding('utf8');

      let initBuffer = '';
      let errorBuffer = '';

      // Error handler
      proc.stderr.on('data', (data) => {
        errorBuffer += data;
        if (errorBuffer.length > 5000) {
          errorBuffer = errorBuffer.slice(-2500); // Keep last 2500 chars
        }
      });

      // Success handler
      const onData = (data) => {
        initBuffer += data;
        if (initBuffer.includes('R_PROCESS_READY')) {
          proc.stdout.removeListener('data', onData);
          const setupTime = Date.now() - startTime;
          console.log(`[R-POOL] Process ${id} ready in ${setupTime}ms`);

          const rProcess = {
            id,
            process: proc,
            busy: false,
            executionCount: 0,
            lastError: null
          };

          // Handle unexpected process death
          proc.on('exit', (code, signal) => {
            console.error(`[R-POOL] ⚠️ Process ${id} exited unexpectedly (code=${code}, signal=${signal})`);
            rProcess.crashed = true;
            rProcess.busy = false;
            // Remove from available pool
            const idx = this.availableProcesses.indexOf(rProcess);
            if (idx >= 0) this.availableProcesses.splice(idx, 1);
            // Auto-restart
            this.createRProcess(id).then(newProc => {
              this.processes[id] = newProc;
              this.availableProcesses.push(newProc);
              console.log(`[R-POOL] ✓ Process ${id} auto-restarted`);
            }).catch(err => {
              console.error(`[R-POOL] Failed to auto-restart process ${id}:`, err.message);
            });
          });

          resolve(rProcess);
        }
      };

      proc.stdout.on('data', onData);

      // Signal ready immediately - all packages pre-installed in Docker image
      const initScript = `
# R process ready (all packages pre-installed in Docker image)
cat("R_PROCESS_READY\\n")
flush.console()
`;

      // Add newline to signal end of input and trigger execution
      proc.stdin.write(initScript + '\n');

      // Timeout protection
      setTimeout(() => {
        if (!initBuffer.includes('R_PROCESS_READY')) {
          proc.kill();
          reject(new Error(`R process ${id} initialization timeout. Error buffer: ${errorBuffer}`));
        }
      }, 30000); // 30 second timeout for initialization (Cloud Run cold starts are slow)
    });
  }

  /**
   * Detect required packages from R code
   */
  detectRequiredPackages(code) {
    const packages = new Set();

    // Match library() calls
    const libraryMatches = code.matchAll(/library\s*\(\s*["']?(\w+)["']?\s*\)/g);
    for (const match of libraryMatches) {
      packages.add(match[1]);
    }

    // Match require() calls
    const requireMatches = code.matchAll(/require\s*\(\s*["']?(\w+)["']?\s*\)/g);
    for (const match of requireMatches) {
      packages.add(match[1]);
    }

    // Match package::function() calls
    const packageCallMatches = code.matchAll(/(\w+)::/g);
    for (const match of packageCallMatches) {
      packages.add(match[1]);
    }

    // Remove common base packages that don't need installation
    const basePackages = new Set(['base', 'stats', 'utils', 'graphics', 'grDevices', 'methods', 'datasets', 'tools']);
    for (const pkg of basePackages) {
      packages.delete(pkg);
    }

    return Array.from(packages);
  }

  /**
   * Detect GitHub package installations
   */
  detectGitHubPackages(code) {
    const githubPackages = [];

    // Match install_github() or remotes::install_github() calls
    const githubMatches = code.matchAll(/(?:remotes::)?install_github\s*\(\s*["']([^"']+)["']/g);
    for (const match of githubMatches) {
      githubPackages.push(match[1]);
    }

    return githubPackages;
  }

  async execute(code, options = {}) {
    const startTime = Date.now();
    const executionId = ++this.executionCount;
    const sessionId = options.sessionId || `ephemeral-${executionId}`;

    console.log(`[R-POOL] Execution #${executionId} starting (session: ${sessionId})...`);

    // Detect required packages
    const requiredPackages = this.detectRequiredPackages(code);
    const githubPackages = this.detectGitHubPackages(code);

    if (requiredPackages.length > 0) {
      console.log(`[R-POOL] Detected required packages: ${requiredPackages.join(', ')}`);
    }
    if (githubPackages.length > 0) {
      console.log(`[R-POOL] Detected GitHub packages: ${githubPackages.join(', ')}`);
    }

    // Session affinity: reuse same process for same session
    let rProcess = null;
    if (this.sessionProcessMap.has(sessionId)) {
      const processId = this.sessionProcessMap.get(sessionId);
      rProcess = this.processes[processId];

      // Verify process is still healthy and not crashed
      if (!rProcess || rProcess.crashed || !rProcess.process || rProcess.process.killed) {
        console.warn(`[R-POOL] ⚠️  Process ${processId} for session ${sessionId} is unavailable, reassigning...`);
        this.sessionProcessMap.delete(sessionId);
        rProcess = null;
      } else {
        // Wait for process to become available if it's busy (with timeout to prevent deadlock)
        const maxWaitTime = 600000; // 10 minutes max wait
        const waitStartTime = Date.now();
        let waitLogged = false;

        while (rProcess.busy) {
          const waitedTime = Date.now() - waitStartTime;

          // Log every 10 seconds instead of every 100ms
          if (!waitLogged || waitedTime % 10000 < 100) {
            console.log(`[R-POOL] Session ${sessionId} waiting for process ${processId} (${Math.round(waitedTime/1000)}s elapsed)...`);
            waitLogged = true;
          }

          // CRITICAL FIX: Timeout to prevent infinite deadlock
          if (waitedTime > maxWaitTime) {
            console.error(`[R-POOL] ⚠️ DEADLOCK DETECTED: Process ${processId} stuck busy for ${Math.round(waitedTime/60000)} minutes`);
            console.error(`[R-POOL] 🔧 Force-releasing stuck process and killing R subprocess`);

            // Force release the stuck process
            rProcess.busy = false;

            // Kill the stuck R process
            try {
              rProcess.process.kill('SIGTERM');
              setTimeout(() => {
                if (rProcess.process && !rProcess.process.killed) {
                  rProcess.process.kill('SIGKILL');
                }
              }, 5000);
            } catch (killError) {
              console.error(`[R-POOL] Failed to kill process ${processId}:`, killError.message);
            }

            // Mark process as crashed so it gets recreated
            rProcess.crashed = true;

            // Remove session mapping so a new process gets assigned
            this.sessionProcessMap.delete(sessionId);
            rProcess = null;

            console.log(`[R-POOL] ✓ Deadlock resolved, will assign new process`);
            break;
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (rProcess && !rProcess.crashed) {
          console.log(`[R-POOL] ✓ Reusing process ${processId} for session ${sessionId} (session affinity)`);
        }
      }
    }

    // Get available process if not already assigned
    if (!rProcess) {
      rProcess = await this.getAvailableProcess();
      this.sessionProcessMap.set(sessionId, rProcess.id);
      console.log(`[R-POOL] Session ${sessionId} assigned to process ${rProcess.id}`);
    }

    // Track session usage for cleanup
    this.sessionLastUsed.set(sessionId, Date.now());

    console.log(`[R-POOL] Using process ${rProcess.id} for execution #${executionId}`);

    // Download workspace from GCS before execution
    console.log(`[R-POOL-DEBUG] Attempting to download workspace for session: ${sessionId}`);
    const downloadResult = await downloadWorkspaceFromGCS(sessionId);
    console.log(`[R-POOL-DEBUG] Workspace download result: ${downloadResult}`);

    return new Promise(async (resolve, reject) => {
      rProcess.busy = true;
      rProcess.busySince = Date.now();  // Track when process became busy for watchdog
      rProcess.executionCount++;

      let output = '';
      let errorOutput = '';
      let completed = false;

      const cleanup = () => {
        if (!completed) {
          completed = true;
          rProcess.busy = false;
          rProcess.busySince = null;  // Clear busy timestamp
          this.availableProcesses.push(rProcess);
          this.processQueue();
        }
      };

      // Clear any previous handlers from stdout/stderr
      rProcess.process.stdout.removeAllListeners('data');
      rProcess.process.stderr.removeAllListeners('data');

      // Output handler (async to support GCS upload)
      const outputHandler = async (data) => {
        output += data;

        // Check for completion marker
        if (output.includes('EXECUTION_COMPLETE_MARKER')) {
          const executionTime = Date.now() - startTime;
          this.totalExecutionTime += executionTime;

          console.log(`[R-POOL-DEBUG] ✅ EXECUTION_COMPLETE_MARKER detected for execution #${executionId}`);
          console.log(`[R-POOL-DEBUG] Execution time: ${executionTime}ms`);
          console.log(`[R-POOL-DEBUG] Total output length: ${output.length} chars`);

          cleanup();

          // Extract file metadata
          let outputFiles = [];
          const fileMetadataMatch = output.match(/__FILE_METADATA_START__([\s\S]*?)__FILE_METADATA_END__/);
          if (fileMetadataMatch) {
            const fileMetadataLines = fileMetadataMatch[1].trim().split('\n');
            for (const line of fileMetadataLines) {
              if (line.trim()) {
                try {
                  const fileInfo = JSON.parse(line);
                  outputFiles.push(fileInfo);
                } catch (e) {
                  console.error(`[R-POOL] Failed to parse file metadata: ${line}`);
                }
              }
            }
          }

          // Remove metadata and marker from output
          const cleanOutput = output
            .replace(/__FILE_METADATA_START__[\s\S]*?__FILE_METADATA_END__/, '')
            .replace(/EXECUTION_COMPLETE_MARKER[\s\S]*$/, '')
            .trim();

          console.log(`[R-POOL] Execution #${executionId} completed in ${executionTime}ms`);
          if (outputFiles.length > 0) {
            console.log(`[R-POOL] Generated ${outputFiles.length} output file(s):`, outputFiles.map(f => f.name).join(', '));
          }

          // Upload files to GCS if sessionId provided
          if (options.sessionId && outputFiles.length > 0) {
            try {
              const workspaceDir = WORKSPACE_BASE;
              const uploadedFiles = await uploadOutputFilesToGCS(options.sessionId, workspaceDir);

              if (uploadedFiles.length > 0) {
                // Merge uploaded metadata with original metadata
                outputFiles = outputFiles.map(file => {
                  const uploaded = uploadedFiles.find(u => u.name === file.name);
                  return uploaded || file;
                });
                console.log(`[R-POOL] ✅ Files uploaded with download URLs`);
              }
            } catch (uploadError) {
              console.error('[R-POOL] ⚠️  File upload failed, continuing with local metadata:', uploadError.message);
              // Continue with original metadata if upload fails
            }
          }

          // Upload workspace to GCS after execution - MUST WAIT for completion
          // CRITICAL FIX: Await workspace upload to ensure persistence across iterations
          // Without this, Cloud Run instances may not have workspace saved before next iteration
          console.log(`[R-POOL] 💾 CRITICAL: Waiting for workspace upload to complete before resolving...`);
          try {
            const uploadSuccess = await uploadWorkspaceToGCS(sessionId);
            console.log(`[R-POOL] ✅ Workspace upload completed: ${uploadSuccess ? 'success' : 'no file to upload'}`);
          } catch (err) {
            console.error('[R-POOL] ⚠️ Failed to upload workspace (non-fatal):', err.message);
          }

          resolve({
            success: true,
            output: cleanOutput,
            executionTime,
            processId: rProcess.id,
            executionId,
            outputFiles
          });
        }
      };

      // Error handler
      const errorHandler = (data) => {
        errorOutput += data;
        // Don't fail on warnings, only on actual errors
        if (data.toLowerCase().includes('error:')) {
          rProcess.lastError = data;
        }

        // CRITICAL FIX: Immediately fail on R crash (Execution halted)
        // Without this, the pool waits for 15-minute timeout when R crashes with syntax errors
        // This happens when LLM generates invalid R code (trailing comma, missing parenthesis, etc.)
        if (!completed && errorOutput.includes('Execution halted')) {
          cleanup();
          console.error(`[R-POOL-ERROR] ❌ R process crashed for execution #${executionId}`);
          console.error(`[R-POOL-ERROR] Session: ${sessionId}`);
          console.error(`[R-POOL-ERROR] R Error: ${errorOutput.substring(0, 500)}`);
          reject(new Error(`R execution failed (syntax error): ${errorOutput.trim().substring(0, 200)}`));
        }
      };

      rProcess.process.stdout.on('data', outputHandler);
      rProcess.process.stderr.on('data', errorHandler);

      // Generate GitHub package installation code
      const githubInstallCode = githubPackages.length > 0 ? `
  # ===========================
  # INSTALL GITHUB PACKAGES
  # ===========================
  cat("\\n📦 Installing GitHub packages...\\n")

  # Ensure remotes is installed (use PPM binary for fast installation)
  if (!require("remotes", quietly = TRUE)) {
    cat("📥 Installing remotes package (BINARY from PPM)...\\n")
    install.packages("remotes",
                    repos = "https://packagemanager.posit.co/cran/__linux__/jammy/latest",
                    quiet = TRUE,
                    dependencies = FALSE)
    library(remotes)
  }

  # Install each GitHub package with enhanced error handling
  github_packages <- c(${githubPackages.map(p => `"${p}"`).join(', ')})
  for (gh_pkg in github_packages) {
    cat(paste0("📥 Installing from GitHub: ", gh_pkg, "\\n"))
    install_start_time <- Sys.time()
    tryCatch({
      remotes::install_github(gh_pkg, quiet = FALSE, upgrade = "never", force = FALSE,
                              dependencies = TRUE, Ncpus = -1)
      install_duration <- round(as.numeric(difftime(Sys.time(), install_start_time, units = "secs")), 1)
      cat(paste0("✅ Installed ", gh_pkg, " from GitHub (", install_duration, "s)\\n"))
    }, error = function(e) {
      cat(paste0("❌ Failed to install ", gh_pkg, " from GitHub\\n"))
      cat(paste0("   Error: ", e$message, "\\n"))
      cat(paste0("   Possible causes:\\n"))
      cat(paste0("     1. GitHub repository does not exist or is private\\n"))
      cat(paste0("     2. Package name format should be: username/repo\\n"))
      cat(paste0("     3. Network connectivity issues\\n"))
      cat(paste0("     4. Package requires authentication (private repo)\\n"))
    })
  }
  cat("\\n")
` : '';

      // Generate package loading code (packages are pre-installed in Docker image)
      // CRITICAL: No installation needed - all packages pre-installed at build time
      const packageInstallCode = requiredPackages.length > 0 ? `
  # ===========================
  # LOAD OR INSTALL PACKAGES
  # ===========================
  # Strategy: Use pre-installed packages when available, install on-demand if needed

  required_packages <- c(${requiredPackages.map(p => `"${p}"`).join(', ')})

  cat("\\n📦 Loading required packages...\\n")

  for (pkg in required_packages) {
    # Try to load package
    pkg_loaded <- suppressPackageStartupMessages(
      library(pkg, character.only = TRUE, logical.return = TRUE)
    )

    if (pkg_loaded) {
      cat(paste0("✓ Loaded ", pkg, " (pre-installed)\\n"))
    } else {
      # Package not pre-installed - attempt on-demand installation using BINARY packages
      cat(paste0("⚠️  Package ", pkg, " not pre-installed, installing BINARY from Posit Package Manager...\\n"))

      install_start_time <- Sys.time()
      tryCatch({
        cat(paste0("   📥 Installing ", pkg, " BINARY package (fast, ~10-60 seconds)...\\n"))
        setTimeLimit(cpu = 600, elapsed = 600, transient = TRUE)

        # CRITICAL: Use Posit Package Manager (PPM) for pre-compiled binary packages
        # PPM provides Linux binaries for Ubuntu Jammy (22.04) which our Docker uses
        # This avoids source compilation which can take 20+ minutes for packages like lme4/simr
        install.packages(pkg,
                        repos = "https://packagemanager.posit.co/cran/__linux__/jammy/latest",
                        quiet = FALSE,
                        dependencies = TRUE,
                        Ncpus = -1)  # Use all available cores

        setTimeLimit(cpu = Inf, elapsed = Inf, transient = FALSE)

        install_duration <- round(as.numeric(difftime(Sys.time(), install_start_time, units = "secs")), 1)
        cat(paste0("   ✅ Installed ", pkg, " BINARY (", install_duration, "s)\\n"))

        # Load newly installed package
        if (!suppressPackageStartupMessages(library(pkg, character.only = TRUE, logical.return = TRUE))) {
          stop(paste0("Failed to load ", pkg, " after installation"))
        }

      }, error = function(e) {
        cat(paste0("❌ Failed to install ", pkg, " from Posit Package Manager\\n"))
        cat(paste0("   Error: ", e$message, "\\n"))
        cat(paste0("   Trying fallback: CRAN source compilation...\\n"))

        # Fallback to CRAN source if binary fails
        tryCatch({
          install.packages(pkg,
                          repos = "https://cloud.r-project.org/",
                          quiet = FALSE,
                          dependencies = TRUE,
                          Ncpus = -1)

          if (!suppressPackageStartupMessages(library(pkg, character.only = TRUE, logical.return = TRUE))) {
            stop(paste0("Failed to load ", pkg, " after source installation"))
          }
          cat(paste0("   ✅ Installed ", pkg, " from source (fallback)\\n"))
        }, error = function(e2) {
          cat(paste0("❌ Both binary and source installation failed\\n"))
          cat(paste0("   Possible causes:\\n"))
          cat(paste0("     1. Package not available on CRAN/PPM\\n"))
          cat(paste0("     2. Missing system dependencies\\n"))
          cat(paste0("     3. Network connectivity issues\\n"))
          stop(paste0("Required package ", pkg, " could not be installed"))
        })
      })
    }
  }

  cat("\\n✅ All required packages ready\\n\\n")
` : '';

      // Wrap code with package installation, file detection and completion marker
      const wrappedCode = `
tryCatch({
  # ===========================
  # NON-INTERACTIVE R OPTIONS
  # ===========================
  # NOTE: Repository configuration is handled by package installation code
  # Do NOT set default repos here - it interferes with on-demand installation
  options(
    menu.graphics = FALSE,                              # No graphical menus
    browser = FALSE,                                     # Disable all interactive prompts
    askYesNo = function(...) FALSE,
    pkg.sysreqs = FALSE,  # Don't check system requirements (we have them in Dockerfile)
    HTTPUserAgent = sprintf("R/%s R (%s)", getRversion(), paste(getRversion(), R.version$platform, R.version$arch, R.version$os))
  )

  # Set non-interactive mode
  Sys.setenv(R_INTERACTIVE = "false")

  # ===========================
  # WORKSPACE PERSISTENCE
  # ===========================
  # Load workspace if it exists for this session
  session_id <- "${sessionId}"
  workspace_base <- "${WORKSPACE_BASE}"
  workspace_file <- paste0(workspace_base, "/sessions/", session_id, "/workspace.RData")
  workspace_dir <- dirname(workspace_file)

  tryCatch({
    if (file.exists(workspace_file)) {
      cat("📂 Loading workspace from previous iteration...\\n")
      load(workspace_file, envir = .GlobalEnv)
      cat("✅ Workspace loaded successfully\\n\\n")
    } else {
      cat("📂 Starting fresh workspace (first iteration)\\n\\n")
    }
  }, error = function(e) {
    cat(paste("⚠️ Could not load workspace (non-fatal):", e$message, "\\n\\n"))
  })

${githubInstallCode}${packageInstallCode}
  # Capture files before execution in BOTH current directory AND workspace output
  cwd <- getwd()
  workspace_output <- paste0(workspace_base, "/output")

  # CRITICAL: Create /workspace/output directory if it doesn't exist
  # This ensures all R code can save files to this location
  dir.create(workspace_output, showWarnings = FALSE, recursive = TRUE)

  # CLEANUP: Remove old files from /workspace/output to prevent stale files
  # Only keep files from current session (prevents old HTML reports, etc.)
  old_files <- list.files(workspace_output, full.names = TRUE, pattern = "^analysis_report_.*\\\\.md$")
  if (length(old_files) > 0) {
    file.remove(old_files)
    cat("Cleaned", length(old_files), "old report file(s)\\n")
  }

  # Check current working directory
  files_before_cwd <- if (file.exists(cwd)) list.files(cwd, full.names = FALSE, all.files = FALSE) else character(0)

  # Check /workspace/output directory
  files_before_workspace <- if (file.exists(workspace_output)) list.files(workspace_output, full.names = FALSE, all.files = FALSE) else character(0)

  # Execute user code
  ${code}

  # Close any open graphics devices (prevents empty Rplots.pdf creation)
  # This ensures only intentionally created files (via ggsave, png(), etc.) are kept
  while (dev.cur() > 1) {
    dev.off()
  }

  # ===========================
  # NOTE: Markdown report generation is now handled by report-generator.js
  # which uses Claude LLM to create professional grant-application-ready reports
  # The old basic R-generated report has been removed to avoid duplicates
  # ===========================

  # Detect new files after execution in BOTH locations
  files_after_cwd <- if (file.exists(cwd)) list.files(cwd, full.names = FALSE, all.files = FALSE) else character(0)
  files_after_workspace <- if (file.exists(workspace_output)) list.files(workspace_output, full.names = FALSE, all.files = FALSE) else character(0)

  # DEBUG: Log file detection details
  cat(paste0("\\n🔍 DEBUG: File detection\\n"))
  cat(paste0("  cwd: ", cwd, "\\n"))
  cat(paste0("  files_before_cwd: ", length(files_before_cwd), " files\\n"))
  cat(paste0("  files_after_cwd: ", length(files_after_cwd), " files\\n"))

  # Find new files in both locations
  new_files_cwd <- setdiff(files_after_cwd, files_before_cwd)
  new_files_workspace <- setdiff(files_after_workspace, files_before_workspace)

  cat(paste0("  new_files_cwd: ", length(new_files_cwd), " files"))
  if (length(new_files_cwd) > 0) {
    cat(paste0(" - ", paste(new_files_cwd, collapse=", ")))
  }
  cat("\\n")

  cat(paste0("  new_files_workspace: ", length(new_files_workspace), " files"))
  if (length(new_files_workspace) > 0) {
    cat(paste0(" - ", paste(new_files_workspace, collapse=", ")))
  }
  cat("\\n")

  # Combine all new files
  all_new_files <- c(new_files_cwd, new_files_workspace)
  cat(paste0("  all_new_files: ", length(all_new_files), " files\\n"))

  # Filter for output files (images, data, reports, etc.)
  output_extensions <- c("png", "pdf", "jpg", "jpeg", "csv", "txt", "html", "svg", "md")
  output_files <- all_new_files[tools::file_ext(all_new_files) %in% output_extensions]
  cat(paste0("  output_files (after extension filter): ", length(output_files), " files\\n"))

  # Print file information as JSON
  if (length(output_files) > 0) {
    cat("\\n__FILE_METADATA_START__\\n")
    for (f in output_files) {
      # Determine full path for file.info
      full_path <- if (f %in% new_files_workspace) {
        file.path(workspace_output, f)
      } else {
        file.path(cwd, f)
      }

      file_info <- file.info(full_path)
      cat(paste0(
        '{"name":"', f,
        '","size":', file_info$size,
        ',"type":"', tools::file_ext(f),
        '"}\\n'
      ))
    }
    cat("__FILE_METADATA_END__\\n")
  }

  # ===========================
  # SAVE WORKSPACE FOR NEXT ITERATION
  # ===========================
  tryCatch({
    dir.create(workspace_dir, showWarnings = FALSE, recursive = TRUE)
    cat("\\n💾 Saving workspace for next iteration...\\n")
    save.image(file = workspace_file)
    cat(paste0("✅ Workspace saved to: ", workspace_file, "\\n"))
  }, error = function(e) {
    cat(paste("\\n⚠️ Could not save workspace (non-fatal):", e$message, "\\n"))
  })

  cat("\\nEXECUTION_COMPLETE_MARKER\\n")
  flush.console()
}, error = function(e) {
  cat(paste("ERROR:", e$message, "\\n"), file = stderr())
  cat(paste("\\n❌ R code error:", e$message, "\\n"))

  # Close any open graphics devices even on error
  tryCatch({ while (dev.cur() > 1) dev.off() }, error = function(e3) {})

  # Detect output files created BEFORE the error (don't lose partial outputs)
  tryCatch({
    files_after_cwd_err <- if (file.exists(cwd)) list.files(cwd, full.names = FALSE, all.files = FALSE) else character(0)
    files_after_ws_err <- if (file.exists(workspace_output)) list.files(workspace_output, full.names = FALSE, all.files = FALSE) else character(0)
    new_cwd_err <- setdiff(files_after_cwd_err, files_before_cwd)
    new_ws_err <- setdiff(files_after_ws_err, files_before_workspace)
    all_new_err <- c(new_cwd_err, new_ws_err)
    output_extensions <- c("png", "pdf", "jpg", "jpeg", "csv", "txt", "html", "svg", "md")
    output_files_err <- all_new_err[tools::file_ext(all_new_err) %in% output_extensions]
    if (length(output_files_err) > 0) {
      cat(paste0("\\n📁 Found ", length(output_files_err), " output file(s) created before error\\n"))
      cat("\\n__FILE_METADATA_START__\\n")
      for (f in output_files_err) {
        full_path <- if (f %in% new_ws_err) file.path(workspace_output, f) else file.path(cwd, f)
        file_info <- file.info(full_path)
        cat(paste0('{"name":"', f, '","size":', file_info$size, ',"type":"', tools::file_ext(f), '"}\\n'))
      }
      cat("__FILE_METADATA_END__\\n")
    }
  }, error = function(e3) {
    cat(paste("\\n⚠️ Could not detect output files (non-fatal):", e3$message, "\\n"))
  })

  # Save workspace even on error, so next iteration can continue
  tryCatch({
    cat("\\n💾 Saving workspace after error...\\n")
    dir.create(workspace_dir, showWarnings = FALSE, recursive = TRUE)
    save.image(file = workspace_file)
    cat(paste0("✅ Workspace saved to: ", workspace_file, "\\n"))
  }, error = function(e2) {
    cat(paste("\\n⚠️ Could not save workspace (non-fatal):", e2$message, "\\n"))
  })

  cat("\\nEXECUTION_COMPLETE_MARKER\\n")
  flush.console()
})
`;

      // Send code to R process (NO stdin.end() - keep process alive for reuse!)
      // R executes line-by-line and returns EXECUTION_COMPLETE_MARKER when done
      console.log(`[R-POOL-DEBUG] 📤 Sending code to R process ${rProcess.id} for execution #${executionId}`);
      console.log(`[R-POOL-DEBUG] Code length: ${wrappedCode.length} chars`);
      console.log(`[R-POOL-DEBUG] Session: ${sessionId}`);
      console.log(`[R-POOL-DEBUG] Waiting for EXECUTION_COMPLETE_MARKER...`);

      rProcess.process.stdin.write(wrappedCode + '\n');

      // Timeout protection
      // CRITICAL: Increased to 30 minutes for on-demand package installation
      // Binary packages: 30-90 seconds
      // Simple source packages: 2-5 minutes
      // Complex source packages (C++/Fortran/Java): 10-20 minutes
      // Very complex packages (with many dependencies): up to 30 minutes
      const timeout = options.timeout || 1800000; // 30 minutes

      console.log(`[R-POOL-DEBUG] Execution timeout set to ${timeout}ms (${Math.round(timeout/1000/60)} minutes)`);

      setTimeout(() => {
        if (!completed) {
          cleanup();
          console.error(`[R-POOL-ERROR] ⏱️  TIMEOUT! Execution #${executionId} exceeded ${timeout}ms`);
          console.error(`[R-POOL-ERROR] Session: ${sessionId}`);
          console.error(`[R-POOL-ERROR] Process: ${rProcess.id}`);
          console.error(`[R-POOL-ERROR] Output received so far (${output.length} chars):`);
          console.error(output.substring(0, 1000));
          console.error(`[R-POOL-ERROR] Error output (${errorOutput.length} chars):`);
          console.error(errorOutput.substring(0, 500));
          reject(new Error(`R execution timeout after ${timeout}ms (process ${rProcess.id})`));
        }
      }, timeout);
    });
  }

  async getAvailableProcess() {
    if (this.availableProcesses.length > 0) {
      return this.availableProcesses.shift();
    }

    console.log('[R-POOL] No available processes, waiting in queue...');

    // Wait for a process to become available, with timeout to prevent infinite hangs
    const queueTimeout = 120000; // 2 minutes max wait in queue
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.queue.findIndex(item => item.resolve === resolve);
        if (idx >= 0) this.queue.splice(idx, 1);
        reject(new Error(`Queue timeout: no R process available after ${queueTimeout/1000}s`));
      }, queueTimeout);
      const wrappedResolve = (process) => {
        clearTimeout(timer);
        resolve(process);
      };
      wrappedResolve._original = resolve;
      this.queue.push(wrappedResolve);
    });
  }

  processQueue() {
    if (this.queue.length > 0 && this.availableProcesses.length > 0) {
      const resolve = this.queue.shift();
      const process = this.availableProcesses.shift();
      console.log(`[R-POOL] Dequeuing request, assigning process ${process.id}`);
      resolve(process);
    }
  }

  /**
   * Render an Rmd file to PDF using rmarkdown::render()
   * @param {string} rmdPath - Path to the .Rmd file
   * @param {Object} options - Rendering options
   * @param {number} options.timeout - Timeout in ms (default 120000 = 2 min)
   * @returns {Promise<{success: boolean, pdfPath: string, error?: string}>}
   */
  async renderRmd(rmdPath, options = {}) {
    const timeout = options.timeout || 120000;
    // Find header.tex in either Docker or local path
    const outputDir = path.dirname(rmdPath);
    const rCode = `
tryCatch({
  cat("Rendering PDF report...\\n")
  # Find header.tex (Docker path or output dir copy)
  header_path <- NULL
  for (hp in c("/app/r-utils/header.tex", "${outputDir.replace(/\\/g, '/')}/header.tex")) {
    if (file.exists(hp)) { header_path <- hp; break }
  }
  render_args <- list(
    input = "${rmdPath.replace(/\\/g, '/')}",
    output_format = rmarkdown::pdf_document(
      latex_engine = "xelatex",
      toc = TRUE,
      number_sections = TRUE,
      fig_caption = TRUE
    ),
    quiet = TRUE,
    envir = new.env(parent = globalenv())
  )
  if (!is.null(header_path)) {
    render_args$output_format <- rmarkdown::pdf_document(
      latex_engine = "xelatex",
      toc = TRUE,
      number_sections = TRUE,
      fig_caption = TRUE,
      includes = rmarkdown::includes(in_header = header_path)
    )
  }
  output_file <- do.call(rmarkdown::render, render_args)
  cat(paste0("PDF_OUTPUT_PATH:", output_file, "\\n"))
  cat("PDF rendering complete\\n")
}, error = function(e) {
  cat(paste0("PDF_RENDER_ERROR:", e$message, "\\n"))
})
`;

    try {
      const result = await this.execute(rCode, { timeout, sessionId: options.sessionId || 'pdf-render' });

      // Extract PDF path from output
      const pathMatch = result.output.match(/PDF_OUTPUT_PATH:(.+)/);
      if (pathMatch) {
        return { success: true, pdfPath: pathMatch[1].trim() };
      }

      const errorMatch = result.output.match(/PDF_RENDER_ERROR:(.+)/);
      if (errorMatch) {
        return { success: false, error: errorMatch[1].trim() };
      }

      return { success: false, error: 'Unknown render error' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  getStats() {
    const busyCount = this.processes.filter(p => p.busy).length;
    const avgExecutionTime = this.executionCount > 0
      ? Math.round(this.totalExecutionTime / this.executionCount)
      : 0;

    return {
      totalProcesses: this.processes.length,
      availableProcesses: this.availableProcesses.length,
      busyProcesses: busyCount,
      queueLength: this.queue.length,
      totalExecutions: this.executionCount,
      avgExecutionTimeMs: avgExecutionTime,
      activeSessions: this.sessionProcessMap.size,
      sessionStats: Array.from(this.sessionProcessMap.entries()).map(([sessionId, processId]) => ({
        sessionId,
        processId,
        lastUsed: this.sessionLastUsed.get(sessionId),
        idleMinutes: Math.round((Date.now() - this.sessionLastUsed.get(sessionId)) / 60000)
      })),
      processStats: this.processes.map(p => ({
        id: p.id,
        busy: p.busy,
        executionCount: p.executionCount,
        lastError: p.lastError
      }))
    };
  }

  async destroy() {
    console.log('[R-POOL] Destroying process pool...');

    // Stop session cleanup timer
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      console.log('[R-POOL] Session cleanup timer stopped');
    }

    for (const rp of this.processes) {
      try {
        rp.process.stdin.end();
        rp.process.kill('SIGTERM');
      } catch (error) {
        console.error(`[R-POOL] Error killing process ${rp.id}:`, error);
      }
    }

    this.processes = [];
    this.availableProcesses = [];
    this.queue = [];
    this.sessionProcessMap.clear();
    this.sessionLastUsed.clear();

    console.log('[R-POOL] Process pool destroyed');
  }

  async healthCheck() {
    try {
      const result = await this.execute('cat("HEALTH_CHECK_OK\\n")', { timeout: 5000 });
      return result.output.includes('HEALTH_CHECK_OK');
    } catch (error) {
      console.error('[R-POOL] Health check failed:', error);
      return false;
    }
  }
}

/**
 * Upload workspace to Google Cloud Storage
 * @param {string} sessionId - Session ID for workspace persistence
 * @returns {boolean} Success status
 */
async function uploadWorkspaceToGCS(sessionId) {
  if (!gcsBucket) {
    console.warn('[R-POOL] ⚠️  GCS not available, skipping workspace upload');
    return false;
  }

  const workspaceFile = `${WORKSPACE_BASE}/sessions/${sessionId}/workspace.RData`;

  try {
    if (!fsSync.existsSync(workspaceFile)) {
      console.log('[R-POOL] 📂 No workspace file to upload (R may not have saved it)');
      return false;
    }

    // Check local file size before upload
    const localStats = fsSync.statSync(workspaceFile);
    const localSize = localStats.size;
    console.log(`[R-POOL] 📊 Local workspace file: ${localSize} bytes (${(localSize/1024).toFixed(2)} KB)`);

    if (localSize < 100) {
      console.warn(`[R-POOL] ⚠️ WARNING: Workspace file is very small (${localSize} bytes) - may be empty`);
    }

    const gcsPath = `workspaces/${sessionId}/workspace.RData`;
    const file = gcsBucket.file(gcsPath);

    console.log(`[R-POOL] 📤 Uploading workspace to GCS: gs://${gcsBucket.name}/${gcsPath}`);
    const fileContent = fsSync.readFileSync(workspaceFile);
    await file.save(fileContent);

    // Verify upload by checking metadata
    const [metadata] = await file.getMetadata();
    const uploadedSize = parseInt(metadata.size) || 0;
    console.log(`[R-POOL] ✅ Workspace uploaded successfully: ${uploadedSize} bytes (verified)`);

    if (uploadedSize !== localSize) {
      console.error(`[R-POOL] ⚠️ SIZE MISMATCH: Local ${localSize} vs GCS ${uploadedSize}`);
    }

    return true;
  } catch (error) {
    console.error('[R-POOL] ❌ Failed to upload workspace:', error.message);
    return false;
  }
}

/**
 * Download workspace from Google Cloud Storage
 * @param {string} sessionId - Session ID for workspace persistence
 * @returns {boolean} Success status
 */
async function downloadWorkspaceFromGCS(sessionId) {
  if (!gcsBucket) {
    console.warn('[R-POOL] ⚠️  GCS not available, skipping workspace download');
    return false;
  }

  const workspaceFile = `${WORKSPACE_BASE}/sessions/${sessionId}/workspace.RData`;
  const workspaceDir = path.dirname(workspaceFile);

  try {
    const gcsPath = `workspaces/${sessionId}/workspace.RData`;
    const file = gcsBucket.file(gcsPath);

    console.log(`[R-POOL] 🔍 Checking for workspace in GCS: gs://${gcsBucket.name}/${gcsPath}`);

    // Check if workspace exists in GCS
    const [exists] = await file.exists();
    if (!exists) {
      console.log('[R-POOL] 📂 No workspace in GCS for this session (first iteration)');
      return false;
    }

    // Get metadata to check file size
    const [metadata] = await file.getMetadata();
    const fileSize = parseInt(metadata.size) || 0;
    console.log(`[R-POOL] 📊 Workspace found in GCS: ${fileSize} bytes (${(fileSize/1024).toFixed(2)} KB)`);

    // Warn if workspace is suspiciously small (might be empty/corrupted)
    if (fileSize < 1000) {
      console.warn(`[R-POOL] ⚠️ WARNING: Workspace is very small (${fileSize} bytes) - may be empty or corrupted`);
    }

    // Create local directory
    fsSync.mkdirSync(workspaceDir, { recursive: true });

    console.log(`[R-POOL] 📥 Downloading workspace from GCS: ${gcsPath}`);
    const [buffer] = await file.download();
    fsSync.writeFileSync(workspaceFile, buffer);

    // Verify download
    const localStats = fsSync.statSync(workspaceFile);
    console.log(`[R-POOL] ✅ Workspace downloaded successfully: ${localStats.size} bytes to ${workspaceFile}`);

    return true;
  } catch (error) {
    console.error('[R-POOL] ❌ Failed to download workspace:', error.message);
    return false;
  }
}

/**
 * Upload output files from R execution to Google Cloud Storage
 * @param {string} sessionId - Session ID for organizing files
 * @param {string} workspaceDir - Workspace directory path
 * @returns {Array} Array of uploaded file metadata with download URLs
 */
async function uploadOutputFilesToGCS(sessionId, workspaceDir) {
  if (!gcsBucket) {
    console.warn('[R-POOL] ⚠️  GCS not available, skipping file upload');
    return [];
  }

  const outputDir = path.join(workspaceDir, 'output');
  const uploadedFiles = [];

  try {
    // Check if output directory exists
    if (!fsSync.existsSync(outputDir)) {
      console.log('[R-POOL] 📤 No output directory found');
      return [];
    }

    // Get all files in output directory
    const files = fsSync.readdirSync(outputDir);

    if (files.length === 0) {
      console.log('[R-POOL] 📤 Output directory is empty');
      return [];
    }

    console.log(`[R-POOL] 📤 Uploading ${files.length} file(s) to GCS...`);

    for (const fileName of files) {
      try {
        const filePath = path.join(outputDir, fileName);
        const stats = fsSync.statSync(filePath);

        // Skip directories
        if (stats.isDirectory()) {
          continue;
        }

        // Generate GCS path
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
        const gcsPath = `outputs/${sessionId}/${timestamp}_${fileName}`;

        // Upload to GCS
        console.log(`[R-POOL]    Uploading: ${fileName} -> gs://power-agent-results-476822/${gcsPath}`);
        await gcsBucket.upload(filePath, {
          destination: gcsPath,
          metadata: {
            contentType: getContentType(fileName),
            metadata: {
              sessionId: sessionId,
              originalName: fileName,
              uploadedAt: new Date().toISOString()
            }
          }
        });

        // Generate signed URL (valid for 7 days)
        const blob = gcsBucket.file(gcsPath);
        const [signedUrl] = await blob.getSignedUrl({
          version: 'v4',
          action: 'read',
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        // Use signed URL
        const publicUrl = signedUrl;

        // Determine file type
        const fileType = determineFileType(fileName);

        uploadedFiles.push({
          name: fileName,
          size: stats.size,
          type: fileType,
          file_type: fileType,
          mime_type: getContentType(fileName),
          gcs_path: `gs://power-agent-results-476822/${gcsPath}`,
          download_url: publicUrl,
          storage_path: gcsPath,
          url: publicUrl
        });

        console.log(`[R-POOL]    ✅ Uploaded: ${fileName} (${stats.size} bytes)`);
      } catch (fileError) {
        console.error(`[R-POOL]    ❌ Failed to upload ${fileName}:`, fileError.message);
        // Continue with other files
      }
    }

    if (uploadedFiles.length > 0) {
      console.log(`[R-POOL] ✅ Successfully uploaded ${uploadedFiles.length} file(s) to GCS`);
    }

    return uploadedFiles;
  } catch (error) {
    console.error('[R-POOL] ❌ Error uploading files to GCS:', error);
    return [];
  }
}

/**
 * Determine file type based on extension
 */
function determineFileType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const typeMap = {
    '.png': 'plot',
    '.pdf': 'plot',
    '.jpg': 'plot',
    '.jpeg': 'plot',
    '.svg': 'plot',
    '.csv': 'dataset',
    '.txt': 'text',
    '.md': 'report',
    '.html': 'report',
    '.rds': 'data'
  };
  return typeMap[ext] || 'document';
}

/**
 * Get content type for file
 */
function getContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const contentTypeMap = {
    '.png': 'image/png',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.rds': 'application/octet-stream'
  };
  return contentTypeMap[ext] || 'application/octet-stream';
}

export default RProcessPool;
export { uploadOutputFilesToGCS };