#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { ScientificRExecutor } from './runtime/scientific-r-executor.js';
const executor = new ScientificRExecutor();
if (executor.restrictedLinux) {
  await fs.mkdir(executor.root, { recursive: true, mode: 0o711 });
  await fs.chmod(executor.root, 0o711);
}
await import('./runtime/scientific-harness-cli.js');
