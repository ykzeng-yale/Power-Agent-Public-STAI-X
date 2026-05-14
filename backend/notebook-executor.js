/**
 * Notebook Executor - Docker/Cloud Run Integration
 *
 * Executes R/Python notebooks in isolated Docker containers
 * with automatic error fixing and iteration
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Storage } from '@google-cloud/storage';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

class NotebookExecutor {
  constructor(config = {}) {
    this.dockerImage = config.dockerImage || 'biostat-notebook-executor:latest';
    this.workspaceDir = config.workspaceDir || path.join(__dirname, '..', 'cloudrun', 'workspace');
    this.maxIterations = config.maxIterations || 5;
    this.useDocker = config.useDocker !== false;  // Default to Docker
    this.gcpConfig = config.gcp || {};

    // Initialize GCS client for Cloud Run Jobs mode
    if (!this.useDocker) {
      this.storage = new Storage({
        projectId: this.gcpConfig.project || 'power-agent-476822'
      });
      this.notebookBucket = this.storage.bucket('power-agent-notebooks-476822');
      this.resultsBucket = this.storage.bucket('power-agent-results-476822');
      this.datasetBucket = this.storage.bucket('power-agent-datasets-476822');
    }

    console.log(`📓 NotebookExecutor initialized`);
    console.log(`   Mode: ${this.useDocker ? 'Docker' : 'Cloud Run Jobs'}`);
    console.log(`   Image: ${this.dockerImage}`);
    console.log(`   Workspace: ${this.workspaceDir}`);
    if (!this.useDocker) {
      console.log(`   GCS Notebooks: gs://power-agent-notebooks-476822/`);
      console.log(`   GCS Results: gs://power-agent-results-476822/`);
    }
  }

  /**
   * Execute R code by creating and running a notebook
   */
  async executeRCode(code, options = {}) {
    const startTime = Date.now();

    try {
      // Create workspace if it doesn't exist
      if (!existsSync(this.workspaceDir)) {
        await mkdir(this.workspaceDir, { recursive: true });
        await mkdir(path.join(this.workspaceDir, 'notebooks'), { recursive: true });
        await mkdir(path.join(this.workspaceDir, 'output'), { recursive: true });
      }

      // Generate notebook from code
      const notebookPath = await this.createNotebookFromCode(code, 'R', options);

      console.log(`📝 Created notebook: ${notebookPath}`);

      // Execute notebook
      const result = this.useDocker
        ? await this.executeWithDocker(notebookPath, options)
        : await this.executeWithCloudRun(notebookPath, options);

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

      return {
        success: result.success,
        iterations: result.iterations,
        notebook_path: notebookPath,
        html_path: result.html_path,
        output: result.output,
        errors: result.errors,
        output_files: result.output_files || [],  // CRITICAL: Propagate output files!
        timing: {
          total: parseFloat(totalTime),
          execution: result.execution_time
        },
        metadata: {
          executor: this.useDocker ? 'docker' : 'cloudrun',
          image: this.dockerImage,
          max_iterations: this.maxIterations
        }
      };

    } catch (error) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`❌ Execution failed after ${elapsed}s:`, error.message);

      return {
        success: false,
        error: {
          message: error.message,
          stack: error.stack
        },
        timing: {
          total: parseFloat(elapsed)
        }
      };
    }
  }

  /**
   * Create Jupyter notebook from R code
   */
  async createNotebookFromCode(code, language = 'R', options = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const notebookPath = path.join(
      this.workspaceDir,
      'notebooks',
      `analysis_${timestamp}.ipynb`
    );

    // Split code into lines, adding \n to each line (Jupyter format)
    // Jupyter notebooks require each source line to end with \n
    const splitCode = code.split('\n').map((line, idx, arr) => {
      // Add \n to all lines except the last (if it's empty)
      if (idx === arr.length - 1 && line === '') {
        return line;  // Don't add \n to final empty line
      }
      return line + '\n';
    });

    console.log(`📋 Created notebook cell with ${splitCode.length} source lines`);

    // Create notebook structure
    const notebook = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: {},
          source: [
            '# R Analysis\n',
            '\n',
            `**Generated**: ${new Date().toISOString()}\n`,
            `**Query**: ${options.query || 'N/A'}\n`
          ]
        },
        {
          cell_type: 'markdown',
          metadata: {},
          source: ['## Setup']
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: [
            '# Set options\n',
            'options(warn = -1)\n',
            'options(repos = c(CRAN = "https://cloud.r-project.org"))\n',
            '\n',
            'cat("R version:", R.version.string, "\\n")'
          ]
        },
        {
          cell_type: 'markdown',
          metadata: {},
          source: ['## Analysis']
        },
        {
          cell_type: 'code',
          execution_count: null,
          metadata: {},
          outputs: [],
          source: splitCode
        }
      ],
      metadata: {
        kernelspec: {
          display_name: 'R',
          language: 'R',
          name: 'ir'
        },
        language_info: {
          codemirror_mode: 'r',
          file_extension: '.r',
          mimetype: 'text/x-r-source',
          name: 'R',
          pygments_lexer: 'r',
          version: '4.x'
        }
      },
      nbformat: 4,
      nbformat_minor: 4
    };

    await writeFile(notebookPath, JSON.stringify(notebook, null, 2));
    return notebookPath;
  }

  /**
   * Execute notebook using Docker
   */
  async executeWithDocker(notebookPath, options = {}) {
    console.log(`🐳 Executing with Docker...`);

    const startTime = Date.now();
    const relNotebookPath = path.relative(this.workspaceDir, notebookPath);

    // Docker run command
    const dockerCmd = [
      'docker run --rm',
      `-v "${this.workspaceDir}:/workspace"`,
      `-e NOTEBOOK_PATH="/workspace/${relNotebookPath}"`,
      `-e MAX_ITERATIONS="${this.maxIterations}"`,
      `-e KERNEL_NAME="ir"`,
      this.dockerImage
    ].join(' ');

    console.log(`   Command: ${dockerCmd}`);

    try {
      const { stdout, stderr } = await execAsync(dockerCmd, {
        maxBuffer: 10 * 1024 * 1024  // 10MB buffer
      });

      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);

      // Parse result from stdout
      const jsonMatch = stdout.match(/\{[\s\S]*"success"[\s\S]*\}/);
      const result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

      if (result) {
        console.log(`✅ Execution complete: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.iterations} iterations)`);

        // Read the executed notebook to get actual cell outputs
        let cellOutputs = '';
        try {
          const notebookContent = await readFile(notebookPath, 'utf8');
          const notebook = JSON.parse(notebookContent);

          // Extract text outputs from all code cells
          for (const cell of notebook.cells) {
            if (cell.cell_type === 'code' && cell.outputs && cell.outputs.length > 0) {
              for (const output of cell.outputs) {
                if (output.output_type === 'stream' && output.text) {
                  cellOutputs += Array.isArray(output.text) ? output.text.join('') : output.text;
                } else if (output.output_type === 'execute_result' && output.data && output.data['text/plain']) {
                  const text = output.data['text/plain'];
                  cellOutputs += Array.isArray(text) ? text.join('') : text;
                  cellOutputs += '\n';
                } else if (output.output_type === 'error') {
                  cellOutputs += `ERROR: ${output.ename}: ${output.evalue}\n`;
                }
              }
            }
          }
        } catch (readError) {
          console.warn(`⚠️  Could not read notebook outputs: ${readError.message}`);
        }

        console.log(`   Cell outputs: ${cellOutputs.length} chars`);
        if (cellOutputs.length === 0) {
          console.warn(`   ⚠️  No cell outputs found - execution may have failed silently`);
        }

        return {
          success: result.success && cellOutputs.length > 0,  // Only success if we got output
          iterations: result.iterations,
          html_path: result.html_path,
          output: cellOutputs || stdout,  // Prefer cell outputs over raw stdout
          errors: result.execution_log?.filter(log => !log.success) || [],
          execution_time: parseFloat(executionTime),
          has_output: cellOutputs.length > 0
        };
      } else {
        // Fallback if no JSON found
        return {
          success: !stderr,
          iterations: 1,
          output: stdout,
          errors: stderr ? [{ message: stderr }] : [],
          execution_time: parseFloat(executionTime)
        };
      }

    } catch (error) {
      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`❌ Docker execution failed:`, error.message);

      return {
        success: false,
        iterations: 0,
        output: error.stdout || '',
        errors: [{ message: error.message, stderr: error.stderr }],
        execution_time: parseFloat(executionTime)
      };
    }
  }

  /**
   * Execute notebook using Cloud Run Jobs (GCS-based, production-ready)
   */
  async executeWithCloudRun(notebookPath, options = {}) {
    console.log(`☁️  Executing with Cloud Run Jobs (GCS-based)...`);

    const startTime = Date.now();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // CRITICAL FIX: Define GCS paths OUTSIDE try block so catch block can access them
    const notebookGcsPath = `notebooks/${timestamp}_input.ipynb`;
    const resultsGcsPath = `results/${timestamp}_result.json`;
    const executedNotebookPath = `notebooks/${timestamp}_executed.ipynb`;

    try {
      // 1. Upload notebook to GCS

      console.log(`   📤 Uploading notebook to gs://power-agent-notebooks-476822/${notebookGcsPath}`);
      await this.notebookBucket.upload(notebookPath, {
        destination: notebookGcsPath,
        metadata: {
          contentType: 'application/x-ipynb+json',
          metadata: {
            query: options.query || 'N/A',
            uploadTime: new Date().toISOString()
          }
        }
      });

      // 2. Execute Cloud Run Job with GCS paths
      const jobName = this.gcpConfig.jobName || 'biostat-notebook-job';
      const region = this.gcpConfig.region || 'us-central1';
      const project = this.gcpConfig.project || 'power-agent-476822';

      console.log(`   🚀 Triggering Cloud Run Job: ${jobName}`);

      // Build environment variables
      let envVars = `NOTEBOOK_GCS_PATH="gs://power-agent-notebooks-476822/${notebookGcsPath}",RESULT_GCS_PATH="gs://power-agent-results-476822/${resultsGcsPath}",MAX_ITERATIONS="${this.maxIterations}"`;

      // Add dataset env vars if dataset is provided
      if (options.dataset) {
        console.log(`   📊 Dataset provided: ${options.dataset.name}`);
        console.log(`   📍 Dataset location: gs://${options.dataset.gcsBucket}/${options.dataset.gcsPath}`);

        envVars += `,DATASET_GCS_PATH="gs://${options.dataset.gcsBucket}/${options.dataset.gcsPath}"`;
        envVars += `,DATASET_NAME="${options.dataset.name}"`;
        envVars += `,DATASET_LOCAL_PATH="${options.dataset.localPath}"`;
      }

      const executeCmd = [
        'gcloud run jobs execute',
        jobName,
        `--region=${region}`,
        `--project=${project}`,
        `--update-env-vars=${envVars}`,
        '--wait',
        '--format=json'
      ].join(' ');

      const { stdout } = await execAsync(executeCmd, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 600000  // 10 minutes timeout
      });

      const execution = JSON.parse(stdout);
      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);

      console.log(`   ⏱️  Execution completed in ${executionTime}s`);

      // 3. Download results from GCS
      console.log(`   📥 Downloading results from gs://power-agent-results-476822/${resultsGcsPath}`);

      const resultFile = await this.resultsBucket.file(resultsGcsPath);
      const [exists] = await resultFile.exists();

      if (!exists) {
        throw new Error('Result file not found in GCS - execution may have failed');
      }

      const [resultContent] = await resultFile.download();
      const result = JSON.parse(resultContent.toString());

      // 4. Download executed notebook if it exists
      const executedFile = await this.notebookBucket.file(executedNotebookPath);
      const [notebookExists] = await executedFile.exists();

      if (notebookExists) {
        const localPath = path.join(this.workspaceDir, 'notebooks', `${timestamp}_executed.ipynb`);
        await executedFile.download({ destination: localPath });
        console.log(`   📓 Downloaded executed notebook to ${localPath}`);
      }

      console.log(`✅ Cloud Run execution complete: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.iterations || 0} iterations)`);

      // Log output files if any were generated
      if (result.output_files && result.output_files.length > 0) {
        console.log(`   📤 Found ${result.output_files.length} output file(s) in result`);
        result.output_files.forEach(file => {
          console.log(`      - ${file.name} (${file.type}, ${file.size} bytes)`);
        });
      }

      return {
        success: result.success,
        iterations: result.iterations || 0,
        output: result.output || result.cell_outputs || '',
        errors: result.errors || [],
        execution_time: parseFloat(executionTime),
        cloud_run_execution: execution.metadata?.name,
        output_files: result.output_files || [],  // CRITICAL: Include output files!
        gcs_paths: {
          notebook: `gs://power-agent-notebooks-476822/${notebookGcsPath}`,
          executed: notebookExists ? `gs://power-agent-notebooks-476822/${executedNotebookPath}` : null,
          results: `gs://power-agent-results-476822/${resultsGcsPath}`
        }
      };

    } catch (error) {
      const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`❌ Cloud Run execution failed:`, error.message);

      // CRITICAL FIX: Even if gcloud command failed, the job may have written results to GCS!
      // Cloud Run Jobs exit with error status when R code has errors, but they still write result files
      console.log(`   📥 Attempting to download results from GCS despite gcloud failure...`);

      try {
        const resultFile = await this.resultsBucket.file(resultsGcsPath);
        const [exists] = await resultFile.exists();

        if (exists) {
          console.log(`   ✅ Result file found in GCS! Downloading...`);
          const [resultContent] = await resultFile.download();
          const result = JSON.parse(resultContent.toString());

          // Also try to download executed notebook
          const executedFile = await this.notebookBucket.file(executedNotebookPath);
          const [notebookExists] = await executedFile.exists();

          if (notebookExists) {
            const localPath = path.join(this.workspaceDir, 'notebooks', `${timestamp}_executed.ipynb`);
            await executedFile.download({ destination: localPath });
            console.log(`   📓 Downloaded executed notebook to ${localPath}`);
          }

          console.log(`✅ Retrieved results despite gcloud failure: ${result.success ? 'SUCCESS' : 'FAILED'} (${result.iterations || 0} iterations)`);

          // Log output files if any were generated
          if (result.output_files && result.output_files.length > 0) {
            console.log(`   📤 Found ${result.output_files.length} output file(s) in result`);
            result.output_files.forEach(file => {
              console.log(`      - ${file.name} (${file.type}, ${file.size} bytes)`);
            });
          }

          return {
            success: result.success,
            iterations: result.iterations || 0,
            output: result.output || result.cell_outputs || '',
            errors: result.errors || [],
            execution_time: parseFloat(executionTime),
            cloud_run_execution: 'failed-but-results-retrieved',
            output_files: result.output_files || [],  // CRITICAL: Include output files!
            gcs_paths: {
              notebook: `gs://power-agent-notebooks-476822/${notebookGcsPath}`,
              executed: notebookExists ? `gs://power-agent-notebooks-476822/${executedNotebookPath}` : null,
              results: `gs://power-agent-results-476822/${resultsGcsPath}`
            }
          };
        } else {
          console.log(`   ⚠️  No result file found in GCS - execution truly failed`);
        }
      } catch (gcsError) {
        console.error(`   ⚠️  Could not retrieve results from GCS: ${gcsError.message}`);
      }

      // If we couldn't get results from GCS, return the original error
      return {
        success: false,
        iterations: 0,
        output: error.stdout || '',
        errors: [{
          message: error.message,
          stderr: error.stderr,
          stack: error.stack
        }],
        execution_time: parseFloat(executionTime)
      };
    }
  }

  /**
   * Check if Docker image exists, build if needed
   */
  async ensureDockerImage() {
    try {
      const { stdout } = await execAsync(`docker images -q ${this.dockerImage}`);

      if (!stdout.trim()) {
        console.log(`📦 Docker image ${this.dockerImage} not found. Building...`);
        await this.buildDockerImage();
      } else {
        console.log(`✅ Docker image ${this.dockerImage} exists`);
      }
    } catch (error) {
      console.warn(`⚠️  Could not check Docker image:`, error.message);
    }
  }

  /**
   * Build Docker image
   */
  async buildDockerImage() {
    const dockerfilePath = path.join(__dirname, '..', 'cloudrun');
    console.log(`🔨 Building Docker image from ${dockerfilePath}...`);

    const buildCmd = `docker build -t ${this.dockerImage} ${dockerfilePath}`;

    try {
      const { stdout, stderr } = await execAsync(buildCmd, {
        maxBuffer: 50 * 1024 * 1024  // 50MB buffer for build logs
      });

      console.log(`✅ Docker image built successfully`);
      console.log(stdout);

      if (stderr) {
        console.warn(`Build warnings:`, stderr);
      }

    } catch (error) {
      console.error(`❌ Docker build failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get executor info
   */
  getInfo() {
    return {
      executor: 'NotebookExecutor',
      mode: this.useDocker ? 'docker' : 'cloudrun',
      dockerImage: this.dockerImage,
      workspace: this.workspaceDir,
      maxIterations: this.maxIterations,
      features: [
        'Headless Jupyter notebook execution',
        'Automatic error detection and fixing',
        'Iterative execution until success',
        'HTML/PDF report generation',
        'Full R + Python support',
        'Up to 7 days execution time (Cloud Run Jobs)',
        '100% CRAN coverage'
      ]
    };
  }
}

export default NotebookExecutor;
