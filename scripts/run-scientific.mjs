#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { ScientificRExecutor } from '../scientific/scientific-r-executor.js';
if (process.argv.includes('--help')) {
  process.stdout.write('Power Agent scientific CLI\n--input request.json (or JSON stdin) --mode single|multi --env-file private.env --output record.json --deadline-ms 600000 --progress\nThe request requires a query; missing scientific inputs remain unresolved.\n');
  process.exit(0);
}
const executor = new ScientificRExecutor();
if (executor.restrictedLinux) {
  await fs.mkdir(executor.root, { recursive: true, mode: 0o711 });
  await fs.chmod(executor.root, 0o711);
}
await import('../scientific/scientific-harness-cli.js');
