#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
// Loading .env never prints its contents and never substitutes shell expressions.
const envPath = flag('--env-file') || path.join(moduleDirectory, '.env');
try {
  const content = await fs.readFile(envPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    process.env[match[1]] = value;
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }

let inputText = '';
if (flag('--input')) inputText = await fs.readFile(flag('--input'), 'utf8');
else for await (const chunk of process.stdin) inputText += chunk;
try {
  const input = JSON.parse(inputText);
  const { runScientificAnalysis } = await import('./scientific-harness.js');
  const { createSourceSearch, createSourceReader } = await import('./scientific-sources.js');
  const search = args.includes('--no-search') || input.enableSearch === false ? null : createSourceSearch();
  const readSource = args.includes('--no-search') || input.enableSearch === false ? null : createSourceReader();
  const result = await runScientificAnalysis(input.query, {
    ...input, workflowMode: flag('--mode') || input.workflowMode || 'single',
    search, readSource,
    ...(flag('--deadline-ms') ? { deadlineMs: Number(flag('--deadline-ms')) } : {}),
    onEvent: args.includes('--progress') ? event => process.stderr.write(`${event.type} ${event.role || ''}\n`) : null
  });
  const json = JSON.stringify(result, null, 2) + '\n';
  if (flag('--output')) await fs.writeFile(flag('--output'), json);
  process.stdout.write(json);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
