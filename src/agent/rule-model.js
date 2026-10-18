// Layer 1: learning what the movement types mean.
//
// The agent is handed a label each turn ("this piece moves as a knight") and
// has to work out what the label does. It never reads src/core/rules.js. All
// it gets is a stream of observations: a type, a displacement, what was on the
// destination, whether the path was blocked, and whether the move was allowed.
//
// Model: one logistic regression per movement type.
//
//   logit P(legal) = bias + wOrbit[orbit(d)] + wCell[d] + wTarget[target] + wClear[clear]
//
// The orbit term is the part that makes this converge inside a single game.
// Displacements related by a rotation or reflection share one weight, so seeing
// a knight jump (+2,+1) once teaches the agent all eight jumps at the same
// time: 225 displacements collapse to 36 orbits. wCell is a per-square residual
// kept small by L2, so symmetry is assumed until the evidence breaks it — which
// is exactly what happens with pawns, where forward is legal and backward is
// not. Weights are fit with AdaGrad; the per-weight step size matters because
// some orbits are seen constantly and others almost never.

import { DCOUNT, dIndex, orbitId, orbitMembers } from '../core/geometry.js';

const TYPES = [1, 2, 3, 4, 5, 6];
const TARGETS = 3;   // empty / enemy / own
const CLEARS = 2;    // path clear / path blocked
const L2_CELL = 0.004;
const LR = 0.6;

// Canonical orbit ordering so the model can index orbits as 0..35.
const ORBIT_IDS = [...new Set(Array.from({ length: DCOUNT }, (_, d) => orbitId[d]))].sort((a, b) => a - b);
const ORBIT_SLOT = new Int16Array(DCOUNT);
ORBIT_IDS.forEach((id, slot) => { for (const d of orbitMembers.get(id)) ORBIT_SLOT[d] = slot; });
export const ORBITS = ORBIT_IDS.length;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Displacement in the mover's own frame: forward is always +1, for both
// colours. This is a choice of coordinates, not knowledge of the rules — it
// just means what the agent learns from White's pawns transfers to Black's.
export function relativeD(dr, dc, color) {
  const forward = color === 1 ? -1 : 1;
  return dIndex(dr * forward, dc);
}

class TypeModel {
  constructor() {
    this.bias = 0;
    this.wOrbit = new Float64Array(ORBITS);
    this.wCell = new Float64Array(DCOUNT);
    this.wTarget = new Float64Array(TARGETS);
    this.wClear = new Float64Array(CLEARS);
    // AdaGrad accumulators.
    this.gBias = 1e-6;
    this.gOrbit = new Float64Array(ORBITS).fill(1e-6);
    this.gCell = new Float64Array(DCOUNT).fill(1e-6);
    this.gTarget = new Float64Array(TARGETS).fill(1e-6);
    this.gClear = new Float64Array(CLEARS).fill(1e-6);
    this.seen = 0;
    this.positives = 0;
    this.cellSeen = new Int32Array(DCOUNT);
    this.clearSeen = [0, 0];
    // (orbit, target-state) coverage, used by count-based exploration.
    this.bucketSeen = new Int32Array(ORBITS * 3);
  }

  score(d, target, clear) {
    return this.bias + this.wOrbit[ORBIT_SLOT[d]] + this.wCell[d]
      + this.wTarget[target] + this.wClear[clear ? 0 : 1];
  }

  predict(d, target, clear) { return sigmoid(this.score(d, target, clear)); }

  learn(d, target, clear, legal) {
    const y = legal ? 1 : 0;
    const p = this.predict(d, target, clear);
    const g = p - y;
    const ci = clear ? 0 : 1;
    const oi = ORBIT_SLOT[d];

    this.gBias += g * g; this.bias -= LR * g / Math.sqrt(this.gBias);
    this.gOrbit[oi] += g * g; this.wOrbit[oi] -= LR * g / Math.sqrt(this.gOrbit[oi]);
    this.gTarget[target] += g * g; this.wTarget[target] -= LR * g / Math.sqrt(this.gTarget[target]);
    this.gClear[ci] += g * g; this.wClear[ci] -= LR * g / Math.sqrt(this.gClear[ci]);

    // The cell residual carries a decay so symmetry stays the default
    // explanation and only persistent counter-evidence moves a single square.
    const gc = g + L2_CELL * this.wCell[d];
    this.gCell[d] += gc * gc; this.wCell[d] -= LR * gc / Math.sqrt(this.gCell[d]);

    this.seen++;
    if (legal) this.positives++;
    this.cellSeen[d]++;
    this.clearSeen[ci]++;
    this.bucketSeen[ORBIT_SLOT[d] * 3 + target]++;
  }
}

export class RuleModel {
  constructor() {
    this.types = new Map(TYPES.map((t) => [t, new TypeModel()]));
    this.observations = 0;
  }

  observe(obs) {
    const m = this.types.get(obs.moveType);
    if (!m) return;
    m.learn(relativeD(obs.dr, obs.dc, obs.color), obs.target, obs.clear, obs.legal);
    this.observations++;
  }

  // Probability that a piece of this type, belonging to this colour, may move
  // by (dr, dc) onto a square in state `target` with the path as given.
  legality(moveType, dr, dc, color, target, clear) {
    const m = this.types.get(moveType);
    if (!m) return 0.5;
    return m.predict(relativeD(dr, dc, color), target, clear);
  }

  // What the agent currently believes the shape of a type is, as a 15x15 grid
  // in the mover's frame with forward pointing up. Each cell is the best case
  // over landing on an empty square or on an enemy, which is what makes a
  // pawn's two capture diagonals show up alongside its one forward step.
  mask(moveType) {
    const m = this.types.get(moveType);
    const out = new Float32Array(DCOUNT);
    const seen = new Int32Array(DCOUNT);
    if (!m) return { values: out, seen, observations: 0 };
    for (let d = 0; d < DCOUNT; d++) {
      out[d] = Math.max(m.predict(d, 0, true), m.predict(d, 1, true));
      seen[d] = m.cellSeen[d];
    }
    return { values: out, seen, observations: m.seen };
  }

  // Readable summary of the non-geometric things it has worked out.
  traits(moveType) {
    const m = this.types.get(moveType);
    if (!m || m.seen < 4) return null;
    return {
      observations: m.seen,
      blockedSamples: m.clearSeen[1],
      // With no blocked-path observations the agent has no opinion on blocking;
      // knights are the usual case, since a jump is never geometrically blocked.
      blocking: m.clearSeen[1] < 3 ? null : sigmoid(m.wClear[0]) - sigmoid(m.wClear[1]),
      ownPiece: m.wTarget[2] - Math.max(m.wTarget[0], m.wTarget[1]),
      capture: m.wTarget[1] - m.wTarget[0],
    };
  }

  // How often this type has been seen moving by any displacement in d's orbit
  // onto a square in this state. Low counts mean a probe there is worth more.
  coverage(moveType, dr, dc, color, target) {
    const m = this.types.get(moveType);
    if (!m) return 0;
    return m.bucketSeen[ORBIT_SLOT[relativeD(dr, dc, color)] * 3 + target];
  }

  stats() {
    let seen = 0, perType = {};
    for (const [t, m] of this.types) { seen += m.seen; perType[t] = m.seen; }
    return { seen, perType, observations: this.observations };
  }
}
