// Board indexing and the dihedral group D4.
//
// D4 matters because of how the agent learns. A displacement like (+2,+1) and
// its seven rotations/reflections are the same fact about a knight, so evidence
// for one should count for all eight. Pooling over orbits is what lets the rule
// model converge inside a single game instead of needing hundreds.

export const SIZE = 8;
export const FILES = 'abcdefgh';

export const idx = (r, c) => r * SIZE + c;
export const rowOf = (i) => i >> 3;
export const colOf = (i) => i & 7;
export const onBoard = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
export const sqName = (i) => FILES[colOf(i)] + (SIZE - rowOf(i));

// Displacements live on a 15x15 grid centred on (0,0): dr,dc both in [-7,7].
export const DMAX = 7;
export const DSPAN = DMAX * 2 + 1;
export const DCOUNT = DSPAN * DSPAN;
export const dIndex = (dr, dc) => (dr + DMAX) * DSPAN + (dc + DMAX);
export const dRow = (d) => Math.floor(d / DSPAN) - DMAX;
export const dCol = (d) => (d % DSPAN) - DMAX;

// The eight elements of D4 acting on (dr, dc).
export const D4 = [
  (dr, dc) => [dr, dc],
  (dr, dc) => [-dc, dr],
  (dr, dc) => [-dr, -dc],
  (dr, dc) => [dc, -dr],
  (dr, dc) => [dr, -dc],
  (dr, dc) => [-dr, dc],
  (dr, dc) => [dc, dr],
  (dr, dc) => [-dc, -dr],
];

// orbitId[d] is the smallest displacement index in d's orbit, used as the
// orbit's canonical name. orbitMembers maps that name back to the full set.
export const orbitId = new Int16Array(DCOUNT);
export const orbitMembers = new Map();

for (let d = 0; d < DCOUNT; d++) {
  const dr = dRow(d), dc = dCol(d);
  let canon = d;
  const members = [];
  for (const g of D4) {
    const [r2, c2] = g(dr, dc);
    if (Math.abs(r2) > DMAX || Math.abs(c2) > DMAX) continue;
    const j = dIndex(r2, c2);
    if (members.indexOf(j) === -1) members.push(j);
    if (j < canon) canon = j;
  }
  orbitId[d] = canon;
  if (!orbitMembers.has(canon)) orbitMembers.set(canon, new Set());
  for (const m of members) orbitMembers.get(canon).add(m);
}

export const ORBIT_COUNT = orbitMembers.size;

// Squares strictly between two aligned squares; empty when they are not
// aligned or are adjacent. The agent uses this to test whether a path was
// blocked, which is how it discovers that some pieces slide and some jump.
export function between(from, to) {
  const r1 = rowOf(from), c1 = colOf(from), r2 = rowOf(to), c2 = colOf(to);
  const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
  const aligned = r1 === r2 || c1 === c2 || Math.abs(r2 - r1) === Math.abs(c2 - c1);
  if (!aligned || steps < 2) return [];
  const out = [];
  for (let k = 1; k < steps; k++) out.push(idx(r1 + dr * k, c1 + dc * k));
  return out;
}
