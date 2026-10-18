// The central claim of this project is that the agent does not know the rules.
// That is only credible if it is enforced, so it is a test: nothing under
// src/agent/ may import the ground-truth rules or the instrumentation that is
// allowed to see them.

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const FORBIDDEN = [
  { path: 'core/rules.js', why: 'ground truth: how pieces actually move' },
  { path: 'core/game.js', why: 'owns the oracle; the agent receives it as an argument instead' },
  { path: 'eval/metrics.js', why: 'instrumentation, scores the agent against ground truth' },
];

const dir = new URL('../src/agent/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const violations = [];

for (const file of files) {
  const src = readFileSync(join(dir, file), 'utf8');
  // Only real import statements count; a comment naming the path does not.
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) {
    for (const f of FORBIDDEN) {
      if (spec.includes(f.path)) violations.push(`src/agent/${file} imports ${spec} — ${f.why}`);
    }
  }
}

console.log(`checked ${files.length} agent modules`);
for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8');
  const imports = [...src.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  console.log(`  ${f.padEnd(22)} ${imports.join(', ') || '(no imports)'}`);
}

if (violations.length) {
  console.log('\nVIOLATIONS:');
  for (const v of violations) console.log('  ' + v);
  process.exit(1);
}
console.log('\nclean: the agent reaches the environment only through the probe oracle it is handed');
