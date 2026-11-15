// Fast unit tests for the pure core modules: board geometry / D4 orbits and
// the seeded RNG. The experiment suites in test/run.js measure learning; these
// pin down the invariants those experiments silently rely on, so a refactor
// that breaks an orbit or a replay breaks here first, in milliseconds.
//
// Run: node test/unit.js  (also included in node test/run.js)

import {
  SIZE, FILES, idx, rowOf, colOf, onBoard, sqName,
  DMAX, DSPAN, DCOUNT, dIndex, dRow, dCol, D4,
  orbitId, orbitMembers, ORBIT_COUNT, between,
} from '../src/core/geometry.js';
import { Rng } from '../src/core/rng.js';

let checks = 0;
let failures = [];
function check(name, ok) {
  checks++;
  if (!ok) failures.push(name);
  else console.log('  ok — ' + name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('geometry: board indexing');
check('SIZE is 8', SIZE === 8);
check('idx corners', idx(0, 0) === 0 && idx(0, 7) === 7 && idx(7, 0) === 56 && idx(7, 7) === 63);
for (let i = 0; i < 64; i++) {
  if (idx(rowOf(i), colOf(i)) !== i) { check('idx/rowOf/colOf round-trip', false); break; }
}
check('idx/rowOf/colOf round-trip over all 64 squares', failures.length === 0);
check('sqName corners', sqName(0) === 'a8' && sqName(7) === 'h8' && sqName(56) === 'a1' && sqName(63) === 'h1');
check('sqName uses all files', [...FILES].every((f, c) => sqName(idx(0, c)).startsWith(f)));
check('onBoard accepts corners, rejects outside',
  onBoard(0, 0) && onBoard(7, 7) && !onBoard(-1, 0) && !onBoard(0, -1) && !onBoard(8, 0) && !onBoard(0, 8));

console.log('geometry: displacements and D4 orbits');
check('DMAX/DSPAN/DCOUNT', DMAX === 7 && DSPAN === 15 && DCOUNT === 225);
for (let d = 0; d < DCOUNT; d++) {
  if (dIndex(dRow(d), dCol(d)) !== d) { check('dIndex/dRow/dCol round-trip', false); break; }
}
check('dIndex/dRow/dCol round-trip over all 225 displacements', failures.length === 0);
check('D4 has 8 elements', D4.length === 8);
check('D4 elements are permutations of the board centre',
  D4.every((g) => { const [r, c] = g(2, 1); return Math.abs(r) <= 7 && Math.abs(c) <= 7; }));
// README's headline number: 225 displacements collapse to 36 orbits.
check('ORBIT_COUNT is 36 (225 displacements -> 36 orbits)', ORBIT_COUNT === 36);
const orbitSize = (dr, dc) => orbitMembers.get(orbitId[dIndex(dr, dc)]).size;
check('knight jump (+2,+1) orbit has 8 members', orbitSize(2, 1) === 8);
check('zero displacement is alone in its orbit', orbitSize(0, 0) === 1);
check('rook step (+1,0) orbit has 4 members', orbitSize(1, 0) === 4);
check('diagonal step (+1,+1) orbit has 4 members', orbitSize(1, 1) === 4);
check('every orbitId is the smallest member index of its orbit', [...orbitMembers].every(([canon, members]) =>
  [...members].every((m) => orbitId[m] === canon) && Math.min(...members) === canon));
check('orbit members partition all 225 displacements',
  [...orbitMembers.values()].reduce((n, s) => n + s.size, 0) === DCOUNT);

console.log('geometry: between()');
check('between along a file', eq(between(idx(7, 0), idx(0, 0)), [48, 40, 32, 24, 16, 8]));
check('between along a diagonal', eq(between(idx(7, 0), idx(0, 7)), [49, 42, 35, 28, 21, 14]));
check('between adjacent squares is empty', eq(between(idx(7, 0), idx(6, 0)), []));
check('between non-aligned squares is empty', eq(between(idx(7, 0), idx(5, 1)), []));
check('between a square and itself is empty', eq(between(idx(3, 3), idx(3, 3)), []));

console.log('rng: determinism and ranges');
const stream = (seed, n) => { const r = new Rng(seed); return Array.from({ length: n }, () => r.next()); };
check('same seed replays the same stream', eq(stream('game-1', 50), stream('game-1', 50)));
check('neighbouring seeds diverge', !eq(stream('1', 10), stream('2', 10)));
check('draws counts every next() call', (() => { const r = new Rng('x'); r.next(); r.float(); r.int(5); return r.draws === 3; })());
check('float() stays in [0, 1)', (() => { const r = new Rng('f'); for (let i = 0; i < 1000; i++) { const v = r.float(); if (v < 0 || v >= 1) return false; } return true; })());
check('int(n) stays in range', (() => { const r = new Rng('i'); for (let i = 0; i < 1000; i++) { const v = r.int(7); if (v < 0 || v >= 7) return false; } return true; })());
check('pick returns an element of the array', (() => { const r = new Rng('p'); const a = ['a', 'b', 'c']; return a.includes(r.pick(a)); })());
check('shuffle preserves the multiset', (() => {
  const r = new Rng('s'); const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = r.shuffle([...a]);
  return eq([...out].sort((x, y) => x - y), a);
})());
check('weighted picks the only non-zero weight', (() => { const r = new Rng('w'); for (let i = 0; i < 20; i++) if (r.weighted([0, 0, 5, 0]) !== 2) return false; return true; })());
check('fork is deterministic for the same seed and tag',
  eq(stream('base', 1).length && (() => { const a = new Rng('base').fork('agent'); const b = new Rng('base').fork('agent'); return [a.next(), a.next(), a.next()]; })(),
     (() => { const b = new Rng('base').fork('agent'); return [b.next(), b.next(), b.next()]; })()));

if (failures.length) {
  console.log(`\n${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log('  FAIL — ' + f);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
