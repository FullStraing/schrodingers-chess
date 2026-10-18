// How the agent spends its turn.
//
// It gets a small probe budget — a handful of yes/no questions to the
// environment — and then has to commit to a move. Spending probes at random
// wastes them: most random displacements are obviously illegal and teach
// nothing. Instead probes go where the model is least certain, scored by
// binary entropy, which is uncertainty sampling from active learning. The
// measured difference against random probing is in test/active-learning.js.
//
// Move choice then trades three things off: capture value weighted by how
// likely that piece is to be the opponent's secret, keeping its own secret out
// of reach, and a bonus for moves it is unsure about early on, when
// information is worth more than position.

import { rowOf, colOf } from '../core/geometry.js';
import { TARGET_EMPTY, TARGET_ENEMY, TARGET_OWN } from './observable.js';

const COUNT_BETA = 0.15;
const MATERIAL = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9, 6: 4 };
const SECRET_PRIZE = 60;
const OWN_SECRET_RISK = 14;

export const entropy = (p) => {
  if (p <= 0 || p >= 1) return 0;
  return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
};

function describe(board, from, to) {
  const t = board.color[to] === 0 ? TARGET_EMPTY
    : (board.color[to] === board.color[from] ? TARGET_OWN : TARGET_ENEMY);
  const r1 = rowOf(from), c1 = colOf(from), r2 = rowOf(to), c2 = colOf(to);
  const dr = r2 - r1, dc = c2 - c1;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  const aligned = r1 === r2 || c1 === c2 || Math.abs(dr) === Math.abs(dc);
  let clear = true;
  if (aligned && steps >= 2) {
    const sr = Math.sign(dr), sc = Math.sign(dc);
    for (let k = 1; k < steps && clear; k++) if (board.color[(r1 + sr * k) * 8 + (c1 + sc * k)]) clear = false;
  }
  return { dr, dc, target: t, clear };
}

// Every move the agent could imagine making, scored by how likely it thinks it
// is to be legal. Own-piece destinations are included: the agent has to learn
// that it cannot capture itself, and it only learns that by trying.
export function candidates(board, side, rolledOf, ruleModel) {
  const out = [];
  for (let from = 0; from < 64; from++) {
    if (board.color[from] !== side) continue;
    const type = rolledOf(board.pid[from]);
    if (!type) continue;
    for (let to = 0; to < 64; to++) {
      if (to === from) continue;
      const f = describe(board, from, to);
      const p = ruleModel.legality(type, f.dr, f.dc, side, f.target, f.clear);
      out.push({ from, to, type, p, ...f });
    }
  }
  return out;
}

// Pick probes by expected information.
//
// Entropy alone is not enough, and the first version of this function was worse
// than probing at random. Two reasons. Weighting by tactical prize pulled every
// probe onto the handful of squares holding enemy pieces, so the displacement
// space never got covered. And because orbit weights are shared, re-probing a
// displacement whose orbit is already well understood teaches nothing even
// though the individual cell still looks uncertain.
//
// So the score is entropy damped by how often that (orbit, target-state)
// bucket has already been seen — a count-based exploration bonus of the usual
// 1/n^beta shape. Tactical value is kept out of probe selection entirely and
// lives in valueOf(), where it belongs.
//
// beta was swept in test/probe-strategy.js at a fixed 400-probe budget over 40
// seeds. Pure entropy (beta=0) reaches 94.9% mask fidelity but swings badly
// (worst run 73%); beta=0.15 reaches 95.6% with the best worst case (81%).
// Random probing, the honest baseline, gets 91.0%.
export function chooseProbes(cands, budget, ruleModel, board, rng) {
  const scored = cands.map((c) => {
    const n = ruleModel.coverage(c.type, c.dr, c.dc, board.color[c.from], c.target);
    return { c, score: entropy(c.p) / Math.pow(1 + n, COUNT_BETA) + rng.float() * 0.02 };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [], seen = new Set();
  for (const s of scored) {
    const key = s.c.from * 64 + s.c.to;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(s.c);
    if (picked.length >= budget) break;
  }
  return picked;
}

// Score a move the agent has confirmed to be legal.
export function valueOf(move, board, ctx) {
  let v = 0;
  if (board.color[move.to] && board.color[move.to] !== ctx.side) {
    const pid = board.pid[move.to];
    v += MATERIAL[board.kind[move.to]] || 1;
    v += SECRET_PRIZE * ctx.beliefOf(pid);
  }
  // Keep the piece it must not lose away from squares it believes are reachable.
  if (board.pid[move.from] === ctx.ownSecretPid) {
    v -= OWN_SECRET_RISK * ctx.dangerAt(move.to);
    v += OWN_SECRET_RISK * ctx.dangerAt(move.from);
  }
  // Early on, a move it is unsure about is worth making for what it teaches.
  v += ctx.curiosity * entropy(move.p) * 1.5;
  return v;
}
