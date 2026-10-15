#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { ScientificRExecutor } from './runtime/scientific-r-executor.js';
if (process.argv.includes('--help')) {
  process.stdout.write('Optional frozen API 2.4.3 runner\nUsage: node run-power-agent.mjs --mode single|multi --input request.json --output record.json [--no-search] [--env-file private.env] [--deadline-ms milliseconds] [--progress]\nNative host-agent work uses the installed SKILL.md and host tools; this command invokes the separate API kernel.\n');
  process.exit(0);
}
const executor = new ScientificRExecutor();
if (executor.restrictedLinux) {
  await fs.mkdir(executor.root, { recursive: true, mode: 0o711 });
  await fs.chmod(executor.root, 0o711);
}
await import('./runtime/scientific-harness-cli.js');
