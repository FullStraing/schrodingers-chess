// Instrumentation, not part of the agent.
//
// This module is allowed to look at ground truth because its only job is to
// score how well the agent's model matches reality. Nothing in src/agent/
// imports it, and it never feeds anything back into the model.
//
// Accuracy is measured on a balanced sample — equal numbers of legal and
// illegal moves — because the raw class balance is roughly 1 legal move per 30
// candidates, and a model that answered "illegal" to everything would score
// 97% while having learned nothing. On a balanced sample, knowing nothing
// scores 50%.

import { legalMoves, isLegal, targetState, pathClear } from '../core/rules.js';
import { rowOf, colOf } from '../core/geometry.js';
import { MOVE_TYPES } from '../core/rules.js';

export function evaluate(model, board, rng, samples = 160) {
  const occupied = [];
  for (let i = 0; i < 64; i++) if (board.color[i]) occupied.push(i);
  if (!occupied.length) return null;

  const positives = [], negatives = [];
  let guard = 0;
  while ((positives.length < samples / 2 || negatives.length < samples / 2) && guard++ < samples * 40) {
    const from = rng.pick(occupied);
    const type = rng.pick(MOVE_TYPES);
    const legal = legalMoves(board, from, type);
    if (legal.length && positives.length < samples / 2) {
      positives.push([from, rng.pick(legal), type, 1]);
    }
    if (negatives.length < samples / 2) {
      const to = rng.int(64);
      if (to !== from && !isLegal(board, from, to, type)) negatives.push([from, to, type, 0]);
    }
  }

  const cases = positives.concat(negatives);
  if (!cases.length) return null;

  let correct = 0, brier = 0;
  for (const [from, to, type, y] of cases) {
    const p = model.legality(
      type, rowOf(to) - rowOf(from), colOf(to) - colOf(from), board.color[from],
      targetState(board, from, to), pathClear(board, from, to),
    );
    if ((p >= 0.5 ? 1 : 0) === y) correct++;
    brier += (p - y) * (p - y);
  }
  return {
    accuracy: correct / cases.length,
    brier: brier / cases.length,
    n: cases.length,
    positives: positives.length,
    negatives: negatives.length,
  };
}

// How close the learned mask is to the true shape of a type, as a fraction of
// the 225 displacement cells it gets right on an empty board.
export function maskFidelity(model, type, color = 1) {
  const kind = new Int8Array(64), col = new Int8Array(64), pid = new Int8Array(64).fill(-1);
  const from = 27; // d5, central enough that most displacements stay on the board
  kind[from] = 1; col[from] = color; pid[from] = 0;
  const board = { kind, color: col, pid };
  const truth = new Set(legalMoves(board, from, type));
  let correct = 0, total = 0;
  for (let to = 0; to < 64; to++) {
    if (to === from) continue;
    total++;
    const p = model.legality(type, rowOf(to) - rowOf(from), colOf(to) - colOf(from), color, 0, true);
    const want = truth.has(to) ? 1 : 0;
    if ((p >= 0.5 ? 1 : 0) === want) correct++;
  }
  return correct / total;
}
