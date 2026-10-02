import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Fresh R processes provide reproducible runs and avoid sharing .GlobalEnv.
 * On Linux a privilege-dropping seccomp worker denies network/metadata access.
 * On other operating systems this is process isolation, not a security sandbox.
 */
export class ScientificRExecutor {
  constructor({ root = path.join(os.tmpdir(), 'power-agent-scientific'), rscript = 'Rscript', timeoutMs = 120000, maxOutputBytes = 2000000,
    maxArtifactBytes = 2000000, maxRunArtifactBytes = 8000000, maxArtifacts = 16 } = {}) {
    this.root = root;
    this.rscript = rscript;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.maxArtifactBytes = maxArtifactBytes;
    this.maxRunArtifactBytes = maxRunArtifactBytes;
    this.maxArtifacts = maxArtifacts;
    this.restrictedLinux = process.platform === 'linux' && (process.env.NODE_ENV === 'production' || process.env.POWER_AGENT_LOCAL_R_UNRESTRICTED !== '1');
  }

  async createWorkspace() {
    const runId = randomUUID();
    const directory = path.join(this.root, runId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return { runId, directory, artifactBytes: 0, artifactCount: 0,
      ...(this.restrictedLinux ? { uid: randomInt(100000, 2000000000) } : {}) };
  }

  async executeRCode(code, { workspace, timeout, signal, phase } = {}) {
    const activeWorkspace = workspace || await this.createWorkspace();
    const executionId = randomUUID();
    const blindCheck = this.restrictedLinux && /^blind(?:_|-)/.test(phase || '');
    let workerUid = activeWorkspace.uid;
    if (blindCheck) { do { workerUid = randomInt(100000, 2000000000); } while (workerUid === activeWorkspace.uid); }
    const executionDirectory = path.join(activeWorkspace.directory, `execution-${executionId}`);
    const artifactDirectory = path.join(activeWorkspace.directory, 'artifacts', executionId);
    const inputDirectory = path.join(activeWorkspace.directory, 'inputs');
    await fs.mkdir(executionDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
    await fs.mkdir(inputDirectory, { recursive: true, mode: 0o700 });
    const scriptPath = path.join(executionDirectory, 'analysis.R');
    // Self-contained scripts, a fixed working directory, and sessionInfo in the
    // capture make rerunning the exported code possible without cached objects.
    const script = `options(warn=1)\n${code}\ncat("\\nPOWER_AGENT_SESSION_INFO_BEGIN\\n")\nprint(sessionInfo())\ncat("POWER_AGENT_SESSION_INFO_END\\n")\n`;
    await fs.writeFile(scriptPath, script, { mode: 0o600 });
    const env = {};
    // R workers do not inherit model, database, or cloud credentials.
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'R_HOME', 'R_LIBS', 'R_LIBS_USER', 'R_LIBS_SITE', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'TZ']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    env.HOME = executionDirectory;
    env.R_ENVIRON_USER = '/dev/null';
    env.R_PROFILE_USER = '/dev/null';
    env.OPENBLAS_NUM_THREADS = '1';
    env.OMP_NUM_THREADS = '1';
    if (this.restrictedLinux) {
      if (typeof process.getuid !== 'function' || process.getuid() !== 0) return { success: false, output: '', stderr: 'Restricted Linux worker needs a root launcher; R itself runs without privileges', exitCode: 125 };
      // The run parent is root-owned and traversable only by this run's group.
      // Workers can write their fresh execution directory, read immutable
      // input/evidence copies, and cannot replace server-captured artifacts.
      await fs.chown(activeWorkspace.directory, 0, activeWorkspace.uid);
      await fs.chmod(activeWorkspace.directory, 0o710);
      await fs.chown(inputDirectory, 0, activeWorkspace.uid);
      await fs.chmod(inputDirectory, blindCheck ? 0o700 : 0o710);
      await fs.chown(executionDirectory, workerUid, activeWorkspace.uid);
      for (const name of await fs.readdir(activeWorkspace.directory)) {
        const filePath = path.join(activeWorkspace.directory, name);
        const info = await fs.lstat(filePath);
        if (info.isFile() && !info.isSymbolicLink()) { await fs.chmod(filePath, 0o440); await fs.chown(filePath, 0, activeWorkspace.uid); }
      }
      await fs.chown(scriptPath, workerUid, activeWorkspace.uid);
    }
    const started = Date.now();
    const result = await new Promise(resolve => {
      let output = '', stderr = '', outputBytes = 0, timedOut = false, outputLimit = false, settled = false;
      const command = this.restrictedLinux ? 'python3' : this.rscript;
      const commandArgs = this.restrictedLinux ? [fileURLToPath(new URL('./scientific-r-worker.py', import.meta.url)), '--uid', String(workerUid), '--gid', String(activeWorkspace.uid), '--cpu-seconds', String(Math.ceil(this.timeoutMs / 1000)), '--memory-mb', '1536', '--', this.rscript, '--vanilla', scriptPath] : ['--vanilla', scriptPath];
      const child = spawn(command, commandArgs, { cwd: executionDirectory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const stop = () => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
      const timer = setTimeout(() => { timedOut = true; stop(); }, Math.min(timeout || this.timeoutMs, this.timeoutMs));
      const abort = () => stop();
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const capture = (chunk, isError) => {
        outputBytes += chunk.length;
        if (outputBytes > this.maxOutputBytes) { outputLimit = true; stop(); return; }
        if (isError) stderr += chunk.toString(); else output += chunk.toString();
      };
      child.stdout.on('data', chunk => capture(chunk, false));
      child.stderr.on('data', chunk => capture(chunk, true));
      const finish = (exitCode, error = null) => {
        if (settled) return;
        settled = true;
        // Descendants cannot escape this process group under the restricted worker.
        // Kill any redirected background child before artifact capture or another phase.
        stop();
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const success = exitCode === 0 && !timedOut && !outputLimit && !signal?.aborted && !error;
        resolve({ success, output, stderr, exitCode, timedOut, outputLimit, error, executionTime: Date.now() - started, executionId, scriptPath });
      };
      child.on('error', error => finish(null, error.message));
      child.on('close', exitCode => finish(exitCode));
    });
    // The harness serializes precheck/reveal phases. Restore candidate read
    // copies only after the distinct blind worker has completely terminated.
    if (blindCheck) await fs.chmod(inputDirectory, 0o710);
    result.blind_artifact_isolation = blindCheck;
    result.output_files = [];
    result.artifact_issues = [];
    if (!result.success) return result;
    const mime = { csv: 'text/csv', json: 'application/json', png: 'image/png', pdf: 'application/pdf',
      svg: 'image/svg+xml', html: 'text/html', md: 'text/markdown', txt: 'text/plain' };
    const visit = async (directory, prefix = '', depth = 0) => {
      for (const name of (await fs.readdir(directory)).sort()) {
        const sourcePath = path.join(directory, name), info = await fs.lstat(sourcePath);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) { if (depth < 2) await visit(sourcePath, prefix + name + '/', depth + 1); continue; }
        const type = path.extname(name).slice(1).toLowerCase();
        if (!info.isFile() || info.nlink !== 1 || !mime[type]) continue;
        const relativeName = prefix + name;
        if (info.size === 0 || info.size > this.maxArtifactBytes || (activeWorkspace.artifactBytes || 0) + info.size > this.maxRunArtifactBytes || (activeWorkspace.artifactCount || 0) >= this.maxArtifacts) {
          result.artifact_issues.push({ name: relativeName, reason: 'Empty artifact or artifact capture limit exceeded' }); continue;
        }
        // O_NOFOLLOW closes a symlink-swap race; bytes and hashes describe this
        // snapshot, rather than files left over by another successful execution.
        const handle = await fs.open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
        let bytes;
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.nlink !== 1 || opened.size !== info.size) continue;
          const bounded = Buffer.alloc(info.size + 1);
          const { bytesRead } = await handle.read(bounded, 0, bounded.length, 0);
          bytes = bounded.subarray(0, bytesRead);
        }
        finally { await handle.close(); }
        if (bytes.length !== info.size || bytes.length > this.maxArtifactBytes) { result.artifact_issues.push({ name: relativeName, reason: 'Artifact changed during capture' }); continue; }
        const safeName = relativeName.replace(/[^A-Za-z0-9_.-]/g, '_') + (result.output_files.some(file => file.original_name.replace(/[^A-Za-z0-9_.-]/g, '_') === relativeName.replace(/[^A-Za-z0-9_.-]/g, '_')) ? '-' + result.output_files.length : '');
        const capturedPath = path.join(artifactDirectory, safeName), readPath = path.join(inputDirectory, executionId + '-' + safeName);
        await fs.writeFile(capturedPath, bytes, { flag: 'wx', mode: 0o400 });
        await fs.writeFile(readPath, bytes, { flag: 'wx', mode: 0o400 });
        if (this.restrictedLinux) { await fs.chown(readPath, 0, activeWorkspace.uid); await fs.chmod(readPath, 0o440); }
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        activeWorkspace.artifactBytes = (activeWorkspace.artifactBytes || 0) + bytes.length;
        activeWorkspace.artifactCount = (activeWorkspace.artifactCount || 0) + 1;
        result.output_files.push({ artifact_id: 'a-' + executionId + '-' + result.output_files.length,
          name: safeName, original_name: relativeName, size: bytes.length, type, mime_type: mime[type],
          path: capturedPath, read_path: readPath, sha256, execution_id: executionId,
          content_base64: bytes.toString('base64') });
      }
    };
    await visit(executionDirectory);
    result.executionDirectory = executionDirectory;
    return result;
  }
}
