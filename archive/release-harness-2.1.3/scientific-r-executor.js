import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Fresh R processes provide reproducible runs and avoid sharing .GlobalEnv.
 * On Linux a privilege-dropping seccomp worker denies network/metadata access.
 * On other operating systems this is process isolation, not a security sandbox.
 */
export class ScientificRExecutor {
  constructor({ root = path.join(os.tmpdir(), 'power-agent-scientific'), rscript = 'Rscript', timeoutMs = 120000, maxOutputBytes = 2000000 } = {}) {
    this.root = root;
    this.rscript = rscript;
    this.timeoutMs = timeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.restrictedLinux = process.platform === 'linux' && (process.env.NODE_ENV === 'production' || process.env.POWER_AGENT_LOCAL_R_UNRESTRICTED !== '1');
  }

  async createWorkspace() {
    const runId = randomUUID();
    const directory = path.join(this.root, runId);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    return { runId, directory, ...(this.restrictedLinux ? { uid: randomInt(100000, 2000000000) } : {}) };
  }

  async executeRCode(code, { workspace, timeout, signal } = {}) {
    const activeWorkspace = workspace || await this.createWorkspace();
    const executionId = randomUUID();
    const scriptPath = path.join(activeWorkspace.directory, `${executionId}.R`);
    // Self-contained scripts, a fixed working directory, and sessionInfo in the
    // capture make rerunning the exported code possible without cached objects.
    const script = `options(warn=1)\n${code}\ncat("\\nPOWER_AGENT_SESSION_INFO_BEGIN\\n")\nprint(sessionInfo())\ncat("POWER_AGENT_SESSION_INFO_END\\n")\n`;
    await fs.writeFile(scriptPath, script, { mode: 0o600 });
    const env = {};
    // R workers do not inherit model, database, or cloud credentials.
    for (const key of ['PATH', 'LANG', 'LC_ALL', 'TMPDIR', 'R_HOME', 'R_LIBS', 'R_LIBS_USER', 'R_LIBS_SITE', 'LD_LIBRARY_PATH', 'DYLD_LIBRARY_PATH', 'TZ']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    env.HOME = activeWorkspace.directory;
    env.R_ENVIRON_USER = '/dev/null';
    env.R_PROFILE_USER = '/dev/null';
    env.OPENBLAS_NUM_THREADS = '1';
    env.OMP_NUM_THREADS = '1';
    if (this.restrictedLinux) {
      if (typeof process.getuid !== 'function' || process.getuid() !== 0) return { success: false, output: '', stderr: 'Restricted Linux worker needs a root launcher; R itself runs without privileges', exitCode: 125 };
      await fs.chmod(activeWorkspace.directory, 0o700);
      await fs.chown(activeWorkspace.directory, activeWorkspace.uid, activeWorkspace.uid);
      for (const name of await fs.readdir(activeWorkspace.directory)) {
        const filePath = path.join(activeWorkspace.directory, name);
        const info = await fs.lstat(filePath);
        if (info.isFile() && !info.isSymbolicLink()) { await fs.chmod(filePath, 0o600); await fs.chown(filePath, activeWorkspace.uid, activeWorkspace.uid); }
      }
    }
    const started = Date.now();
    const result = await new Promise(resolve => {
      let output = '', stderr = '', outputBytes = 0, timedOut = false, outputLimit = false, settled = false;
      const command = this.restrictedLinux ? 'python3' : this.rscript;
      const commandArgs = this.restrictedLinux ? [fileURLToPath(new URL('./scientific-r-worker.py', import.meta.url)), '--uid', String(activeWorkspace.uid), '--gid', String(activeWorkspace.uid), '--cpu-seconds', String(Math.ceil(this.timeoutMs / 1000)), '--memory-mb', '1536', '--', this.rscript, '--vanilla', scriptPath] : ['--vanilla', scriptPath];
      const child = spawn(command, commandArgs, { cwd: activeWorkspace.directory, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        const success = exitCode === 0 && !timedOut && !outputLimit && !signal?.aborted && !error;
        resolve({ success, output, stderr, exitCode, timedOut, outputLimit, error, executionTime: Date.now() - started, executionId, scriptPath });
      };
      child.on('error', error => finish(null, error.message));
      child.on('close', exitCode => finish(exitCode));
    });
    const names = await fs.readdir(activeWorkspace.directory);
    result.output_files = [];
    for (const name of names) {
      if (!/\.(csv|json|png|pdf|svg|html|md|txt)$/i.test(name)) continue;
      const stat = await fs.lstat(path.join(activeWorkspace.directory, name));
      if (stat.isFile() && !stat.isSymbolicLink()) result.output_files.push({ name, size: stat.size, type: path.extname(name).slice(1), path: path.join(activeWorkspace.directory, name) });
    }
    return result;
  }
}
