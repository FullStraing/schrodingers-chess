// Everything, in one command: node test/run.js
import { execFileSync } from 'child_process';
const suites = ['architecture.js', 'convergence.js', 'probe-strategy.js', 'active-learning.js', 'ui-smoke.js'];
let failed = 0;
for (const s of suites) {
  console.log('\n' + '='.repeat(66) + '\n' + s + '\n' + '='.repeat(66));
  try { console.log(execFileSync('node', ['test/' + s], { encoding: 'utf8' })); }
  catch (e) { failed++; console.log(e.stdout || ''); console.log('FAILED: ' + s); }
}
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
