/**
 * Google Cloud Run Jobs executor
 * Provides E2B-compatible interface for executing R/Python code via Cloud Run
 */

import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

class CloudRunExecutor {
  constructor(config = {}) {
    this.projectId = config.projectId || process.env.GCP_PROJECT_ID;
    this.region = config.region || process.env.GCP_REGION || 'us-central1';
    this.jobName = config.jobName || process.env.GCP_JOB_NAME || 'rpy-agent-job';
    this.timeout = config.timeout || 3600000; // 1 hour default (can be up to 48h)
  }

  /**
   * Execute code in Cloud Run Job
   * @param {string} code - Code to execute
   * @param {string} language - 'R' or 'Python'
   * @param {Object} options - Additional options
   * @returns {Promise<{results: Array, logs: {stdout: Array, stderr: Array}, error: any}>}
   */
  async execute(code, language = 'R', options = {}) {
    const startTime = Date.now();

    // Use base64 encoding to avoid all shell escaping issues
    const encodedCode = Buffer.from(code).toString('base64');

    // Prepare environment variables for Cloud Run Job
    const envVars = {
      LANGUAGE: language,
      ACTION: 'run',
    };

    if (language === 'R') {
      envVars.R_CODE_BASE64 = encodedCode;
    } else if (language === 'Python') {
      envVars.PY_CODE_BASE64 = encodedCode;
    }

    // Build env vars string (base64 is safe, no escaping needed)
    const envVarsStr = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join(',');

    try {
      console.log(`🚀 Executing ${language} code on Cloud Run Job: ${this.jobName}`);

      // Step 1: Clear all env vars first, then set new ones
      // This prevents old env vars from lingering
      const clearCmd = `gcloud run jobs update ${this.jobName} --region=${this.region} --clear-env-vars --quiet 2>&1`;
      await execAsync(clearCmd, { maxBuffer: 10 * 1024 * 1024 });

      // Step 2: Update job with new env vars
      const updateCmd = `gcloud run jobs update ${this.jobName} --region=${this.region} --set-env-vars="${envVarsStr}" --quiet 2>&1`;
      await execAsync(updateCmd, { maxBuffer: 10 * 1024 * 1024 });
      console.log(`✅ Job updated with code`);

      // Step 2: Execute the job and wait for completion
      const executeCmd = `gcloud run jobs execute ${this.jobName} --region=${this.region} --wait --format=json 2>&1`;

      const { stdout: execOutput } = await execAsync(executeCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: this.timeout,
      });

      // Parse execution response
      const response = JSON.parse(execOutput);
      const executionId = response.metadata?.name || 'unknown';

      console.log(`✅ Cloud Run Job execution completed: ${executionId}`);

      // Step 3: Get logs and parse results
      const logs = await this.getExecutionLogs(executionId);
      const result = this.parseExecutionResult(logs.stdout);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Cloud Run execution complete in ${elapsed}s`);

      return {
        results: result.results,
        logs: {
          stdout: result.rawOutput ? [result.rawOutput] : logs.stdoutLines,
          stderr: logs.stderrLines,
        },
        error: result.error,
        executionId: executionId,
        elapsed: parseFloat(elapsed),
      };
    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      console.error(`❌ Cloud Run execution failed after ${elapsed}s:`, error.message);

      return {
        results: [],
        logs: {
          stdout: [],
          stderr: [error.message],
        },
        error: {
          message: error.message,
          traceback: error.stack,
        },
        elapsed: parseFloat(elapsed),
      };
    }
  }

  /**
   * Parse execution result from R script JSON output
   * @param {string} stdout - Raw stdout from execution
   * @returns {Object} Parsed result with results array and error
   */
  parseExecutionResult(stdout) {
    try {
      // Look for JSON output from R script (run_code.R outputs JSON)
      const jsonMatch = stdout.match(/\{[\s\S]*?"status"[\s\S]*?\}/);

      if (jsonMatch) {
        const jsonResult = JSON.parse(jsonMatch[0]);

        if (jsonResult.status === 'success') {
          // Extract result value and format like E2B
          const resultValue = jsonResult.result !== undefined ? jsonResult.result : null;

          return {
            results: resultValue !== null ? [{
              text: String(resultValue),
              formats: () => ({ 'text/plain': String(resultValue) })
            }] : [],
            rawOutput: jsonResult.output ? jsonResult.output.join('\n') : '',
            error: null,
          };
        } else {
          // Error case
          return {
            results: [],
            rawOutput: jsonResult.output || '',
            error: {
              message: jsonResult.message || 'Execution failed',
              traceback: jsonResult.output || '',
            },
          };
        }
      }

      // No JSON found, return raw output
      return {
        results: [],
        rawOutput: stdout,
        error: null,
      };
    } catch (error) {
      console.error('Error parsing execution result:', error.message);
      return {
        results: [],
        rawOutput: stdout,
        error: { message: 'Failed to parse result', traceback: error.stack },
      };
    }
  }

  /**
   * Get logs from Cloud Run Job execution
   * @param {string} executionId - Execution ID
   * @returns {Promise<{stdout: string, stdoutLines: Array, stderr: string, stderrLines: Array}>}
   */
  async getExecutionLogs(executionId) {
    try {
      const command = `gcloud logging read \
        "resource.type=cloud_run_job AND labels.\\"run.googleapis.com/execution_name\\"=${executionId}" \
        --limit=1000 \
        --format="value(textPayload)" \
        --project=${this.projectId} \
        2>&1`;

      const { stdout } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024,
      });

      // Filter out empty lines and reverse for chronological order
      const logLines = stdout.split('\n').filter(line => line.trim()).reverse();

      // Combine into single string
      const stdoutStr = logLines.join('\n');

      return {
        stdout: stdoutStr,
        stdoutLines: logLines,
        stderr: '',
        stderrLines: [],
      };
    } catch (error) {
      console.error(`Error fetching logs for ${executionId}:`, error.message);
      return {
        stdout: '',
        stdoutLines: [],
        stderr: `Error fetching logs: ${error.message}`,
        stderrLines: [error.message],
      };
    }
  }

  /**
   * Install R packages (for dynamic package installation)
   * @param {Array<string>} packages - Package names to install
   * @returns {Promise<{success: boolean, installed: Array, failed: Array}>}
   */
  async installPackages(packages) {
    const startTime = Date.now();

    // Escape and join package names
    const packagesStr = packages.join(',');

    const envVarsStr = `LANGUAGE=R,ACTION=install,R_PACKAGES='${packagesStr}'`;

    try {
      console.log(`📦 Installing R packages: ${packagesStr}`);

      // Step 1: Clear all env vars first
      const clearCmd = `gcloud run jobs update ${this.jobName} --region=${this.region} --clear-env-vars --quiet 2>&1`;
      await execAsync(clearCmd, { maxBuffer: 10 * 1024 * 1024 });

      // Step 2: Update job with new env vars
      const updateCmd = `gcloud run jobs update ${this.jobName} --region=${this.region} --set-env-vars="${envVarsStr}" --quiet 2>&1`;
      await execAsync(updateCmd, { maxBuffer: 10 * 1024 * 1024 });

      // Step 2: Execute install
      const executeCmd = `gcloud run jobs execute ${this.jobName} --region=${this.region} --wait --format=json 2>&1`;
      const { stdout: execOutput } = await execAsync(executeCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: this.timeout,
      });

      const response = JSON.parse(execOutput);
      const executionId = response.metadata?.name || 'unknown';

      // Step 3: Get logs
      const logs = await this.getExecutionLogs(executionId);

      // Parse install result
      const jsonMatch = logs.stdout.match(/\{[\s\S]*?"status"[\s\S]*?\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`✅ Package installation complete in ${elapsed}s`);

        return {
          success: result.status === 'success',
          installed: result.installed || [],
          failed: result.failed || [],
        };
      }

      return { success: false, installed: [], failed: packages };
    } catch (error) {
      console.error(`❌ Package installation failed:`, error.message);
      return { success: false, installed: [], failed: packages };
    }
  }

  /**
   * E2B-compatible interface: create a "sandbox"
   * (Cloud Run Jobs don't need sandboxes, but we provide this for compatibility)
   */
  async create() {
    return {
      id: `cloudrun-${Date.now()}`,
      executor: this,
    };
  }

  /**
   * E2B-compatible interface: close sandbox
   */
  async close() {
    // No-op for Cloud Run (jobs are ephemeral)
  }
}

export default CloudRunExecutor;
