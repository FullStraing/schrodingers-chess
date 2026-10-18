// The environment. This is ground truth: how pieces actually move.
//
// Nothing under src/agent/ imports this module. The agent only ever sees the
// oracle through Game.probe(), which answers one yes/no question at a time and
// charges the agent a probe for it. Keeping the import graph one-directional is
// what makes the claim "the agent does not know the rules" checkable rather
// than a promise.

import { SIZE, idx, rowOf, colOf, onBoard, between } from './geometry.js';

export const EMPTY = 0;
export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const WHITE = 1, BLACK = 2;

export const KIND_LETTER = { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' };
export const KIND_NAME = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
export const MOVE_TYPES = [P, N, B, R, Q, K];

const KNIGHT_STEPS = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];

export function forwardDir(color) { return color === WHITE ? -1 : 1; }

// All destinations for a piece on `from` that is moving as `moveType` this turn.
export function legalMoves(board, from, moveType) {
  const mover = board.color[from];
  if (!mover || !moveType) return [];
  const r = rowOf(from), c = colOf(from);
  const out = [];

  const consider = (rr, cc) => {
    if (!onBoard(rr, cc)) return false;
    const t = idx(rr, cc);
    if (board.color[t] === EMPTY) { out.push(t); return true; }
    if (board.color[t] !== mover) out.push(t);
    return false;
  };
  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (consider(rr, cc)) { rr += dr; cc += dc; }
    }
  };

  switch (moveType) {
    case P: {
      // One square only, and captures sideways-forward. No double step, no
      // en passant: the spec drops both.
      const d = forwardDir(mover);
      if (onBoard(r + d, c) && board.color[idx(r + d, c)] === EMPTY) out.push(idx(r + d, c));
      for (const dc of [-1, 1]) {
        if (!onBoard(r + d, c + dc)) continue;
        const t = idx(r + d, c + dc);
        if (board.color[t] !== EMPTY && board.color[t] !== mover) out.push(t);
      }
      break;
    }
    case N:
      for (const [dr, dc] of KNIGHT_STEPS) {
        if (!onBoard(r + dr, c + dc)) continue;
        const t = idx(r + dr, c + dc);
        if (board.color[t] !== mover) out.push(t);
      }
      break;
    case K:
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (!onBoard(r + dr, c + dc)) continue;
        const t = idx(r + dr, c + dc);
        if (board.color[t] !== mover) out.push(t);
      }
      break;
    case B: slide(DIAG); break;
    case R: slide(ORTH); break;
    case Q: slide(DIAG.concat(ORTH)); break;
  }
  return out;
}

export function isLegal(board, from, to, moveType) {
  if (from === to || from < 0 || to < 0 || from > 63 || to > 63) return false;
  return legalMoves(board, from, moveType).indexOf(to) !== -1;
}

// Features of an attempted move that the agent can observe without knowing the
// rules: what sits on the target square, and whether anything stood in the way.
export const TARGET_EMPTY = 0, TARGET_ENEMY = 1, TARGET_OWN = 2;

export function targetState(board, from, to) {
  if (board.color[to] === EMPTY) return TARGET_EMPTY;
  return board.color[to] === board.color[from] ? TARGET_OWN : TARGET_ENEMY;
}

export function pathClear(board, from, to) {
  for (const sq of between(from, to)) if (board.color[sq] !== EMPTY) return false;
  return true;
}

export function makeStartBoard() {
  const kind = new Int8Array(64);
  const color = new Int8Array(64);
  const pid = new Int8Array(64).fill(-1);
  const back = [R, N, B, Q, K, B, N, R];
  let id = 0;
  for (let c = 0; c < SIZE; c++) {
    kind[idx(0, c)] = back[c]; color[idx(0, c)] = BLACK; pid[idx(0, c)] = id++;
    kind[idx(1, c)] = P;       color[idx(1, c)] = BLACK; pid[idx(1, c)] = id++;
    kind[idx(6, c)] = P;       color[idx(6, c)] = WHITE; pid[idx(6, c)] = id++;
    kind[idx(7, c)] = back[c]; color[idx(7, c)] = WHITE; pid[idx(7, c)] = id++;
  }
  return { kind, color, pid };
}

export function cloneBoard(b) {
  return { kind: b.kind.slice(), color: b.color.slice(), pid: b.pid.slice() };
}

export function findPid(board, id) {
  for (let i = 0; i < 64; i++) if (board.pid[i] === id) return i;
  return -1;
}
