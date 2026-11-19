// Fast unit tests for src/core/rules.js — the ground-truth movement rules.
// The agent never sees this module; these pin the rules the oracle enforces,
// so a refactor that changes how a piece moves breaks here first.
//
// Run: node test/rules.js  (also included in node test/run.js)

import {
  EMPTY, P, N, B, R, Q, K, WHITE, BLACK,
  KIND_LETTER, KIND_NAME, MOVE_TYPES,
  forwardDir, legalMoves, isLegal,
  TARGET_EMPTY, TARGET_ENEMY, TARGET_OWN, targetState, pathClear,
  makeStartBoard, cloneBoard, findPid,
} from '../src/core/rules.js';
import { idx } from '../src/core/geometry.js';

let checks = 0;
let failures = [];
function check(name, ok) {
  checks++;
  if (!ok) failures.push(name);
  else console.log('  ok — ' + name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (arr) => [...arr].sort((a, b) => a - b);

// A board with exactly one piece: `kind` on `square`, colour `color`.
function loneBoard(kind, square, color = WHITE, pid = 0) {
  const board = {
    kind: new Int8Array(64),
    color: new Int8Array(64),
    pid: new Int8Array(64).fill(-1),
  };
  board.kind[square] = kind;
  board.color[square] = color;
  board.pid[square] = pid;
  return board;
}

function place(board, kind, square, color, pid) {
  board.kind[square] = kind;
  board.color[square] = color;
  board.pid[square] = pid;
}

console.log('rules: constants');
check('piece codes are 1..6', eq(MOVE_TYPES, [P, N, B, R, Q, K]) && P === 1 && K === 6);
check('KIND_LETTER maps every piece', eq(KIND_LETTER, { 1: 'p', 2: 'n', 3: 'b', 4: 'r', 5: 'q', 6: 'k' }));
check('KIND_NAME maps every piece', KIND_NAME[P] === 'pawn' && KIND_NAME[K] === 'king');
check('forwardDir: white goes up (-1), black goes down (+1)', forwardDir(WHITE) === -1 && forwardDir(BLACK) === 1);

console.log('rules: makeStartBoard');
{
  const b = makeStartBoard();
  const white = [], black = [];
  for (let i = 0; i < 64; i++) {
    if (b.color[i] === WHITE) white.push(i);
    if (b.color[i] === BLACK) black.push(i);
  }
  check('16 pieces per side', white.length === 16 && black.length === 16);
  check('white back rank is R N B Q K B N R', eq([...b.kind.slice(56, 64)], [R, N, B, Q, K, B, N, R]));
  check('black back rank is R N B Q K B N R', eq([...b.kind.slice(0, 8)], [R, N, B, Q, K, B, N, R]));
  check('pawns on ranks 2 and 7', b.kind.slice(8, 16).every((k) => k === P) && b.kind.slice(48, 56).every((k) => k === P));
  check('middle ranks are empty', b.kind.slice(16, 48).every((k) => k === EMPTY));
  check('pids are 0..31, unique', eq([...b.pid].filter((p) => p >= 0).sort((a, b) => a - b),
    Array.from({ length: 32 }, (_, i) => i)));
}

console.log('rules: knights');
check('knight in the centre has 8 moves',
  eq(sorted(legalMoves(loneBoard(N, idx(3, 3)), idx(3, 3), N)),
    sorted([idx(1, 2), idx(1, 4), idx(2, 1), idx(2, 5), idx(4, 1), idx(4, 5), idx(5, 2), idx(5, 4)])));
check('knight in the corner has 2 moves',
  eq(sorted(legalMoves(loneBoard(N, idx(0, 0)), idx(0, 0), N)), sorted([idx(1, 2), idx(2, 1)])));
check('knight jumps over pieces', (() => {
  const b = loneBoard(N, idx(3, 3));
  place(b, P, idx(2, 3), WHITE, 1); // directly between — knights ignore it
  return legalMoves(b, idx(3, 3), N).length === 8;
})());
check('knight cannot land on its own piece', (() => {
  const b = loneBoard(N, idx(3, 3));
  place(b, P, idx(1, 2), WHITE, 1);
  return legalMoves(b, idx(3, 3), N).length === 7
    && !legalMoves(b, idx(3, 3), N).includes(idx(1, 2));
})());

console.log('rules: pawns');
check('white pawn steps one square forward', eq(legalMoves(loneBoard(P, idx(6, 0)), idx(6, 0), P), [idx(5, 0)]));
check('black pawn steps one square forward', eq(legalMoves(loneBoard(P, idx(1, 0), BLACK), idx(1, 0), P), [idx(2, 0)]));
check('no double step (the spec drops it)', (() => {
  const moves = legalMoves(loneBoard(P, idx(6, 0)), idx(6, 0), P);
  return moves.length === 1 && !moves.includes(idx(4, 0));
})());
check('pawn blocked straight ahead has no forward move', (() => {
  const b = loneBoard(P, idx(6, 0));
  place(b, P, idx(5, 0), BLACK, 1);
  return legalMoves(b, idx(6, 0), P).length === 0;
})());
check('pawn captures diagonally, not straight ahead', (() => {
  const b = loneBoard(P, idx(6, 1));
  place(b, P, idx(5, 0), BLACK, 1);
  place(b, P, idx(5, 2), BLACK, 2);
  return eq(sorted(legalMoves(b, idx(6, 1), P)), sorted([idx(5, 0), idx(5, 1), idx(5, 2)]));
})());
check('pawn cannot capture its own piece', (() => {
  const b = loneBoard(P, idx(6, 1));
  place(b, P, idx(5, 0), WHITE, 1);
  return eq(legalMoves(b, idx(6, 1), P), [idx(5, 1)]);
})());

console.log('rules: sliding pieces');
check('rook in the centre has 14 moves on an empty board',
  legalMoves(loneBoard(R, idx(3, 3)), idx(3, 3), R).length === 14);
check('rook stops before its own piece', (() => {
  const b = loneBoard(R, idx(3, 3));
  place(b, P, idx(3, 5), WHITE, 1);
  const moves = legalMoves(b, idx(3, 3), R);
  return moves.includes(idx(3, 4)) && !moves.includes(idx(3, 5)) && !moves.includes(idx(3, 6));
})());
check('rook captures the first enemy piece, then stops', (() => {
  const b = loneBoard(R, idx(3, 3));
  place(b, P, idx(3, 5), BLACK, 1);
  const moves = legalMoves(b, idx(3, 3), R);
  return moves.includes(idx(3, 4)) && moves.includes(idx(3, 5)) && !moves.includes(idx(3, 6));
})());
check('bishop in the centre has 13 moves on an empty board',
  legalMoves(loneBoard(B, idx(3, 3)), idx(3, 3), B).length === 13);
check('queen in the centre has 27 moves on an empty board',
  legalMoves(loneBoard(Q, idx(3, 3)), idx(3, 3), Q).length === 27);
check('king in the corner has 3 moves',
  legalMoves(loneBoard(K, idx(0, 0)), idx(0, 0), K).length === 3);

console.log('rules: isLegal / targetState / pathClear');
check('isLegal accepts a real move', isLegal(loneBoard(N, idx(3, 3)), idx(3, 3), idx(1, 2), N));
check('isLegal rejects a non-move', !isLegal(loneBoard(N, idx(3, 3)), idx(3, 3), idx(3, 4), N));
check('isLegal rejects from === to and off-board squares',
  !isLegal(loneBoard(N, idx(3, 3)), idx(3, 3), idx(3, 3), N)
  && !isLegal(loneBoard(N, idx(3, 3)), -1, idx(3, 3), N)
  && !isLegal(loneBoard(N, idx(3, 3)), idx(3, 3), 64, N));
check('isLegal on an empty square is false',
  !isLegal(loneBoard(N, idx(3, 3)), idx(0, 0), idx(1, 2), N));
check('targetState distinguishes empty / enemy / own', (() => {
  const b = loneBoard(R, idx(3, 3));
  place(b, P, idx(3, 5), BLACK, 1);
  place(b, P, idx(3, 1), WHITE, 2);
  return targetState(b, idx(3, 3), idx(3, 4)) === TARGET_EMPTY
    && targetState(b, idx(3, 3), idx(3, 5)) === TARGET_ENEMY
    && targetState(b, idx(3, 3), idx(3, 1)) === TARGET_OWN;
})());
check('pathClear is false when a piece stands between', (() => {
  const b = loneBoard(R, idx(7, 0));
  place(b, P, idx(5, 0), BLACK, 1);
  return !pathClear(b, idx(7, 0), idx(0, 0)) && pathClear(b, idx(7, 0), idx(6, 0));
})());
check('pathClear is true for a knight jump over pieces', (() => {
  const b = loneBoard(N, idx(3, 3));
  place(b, P, idx(2, 3), WHITE, 1);
  return pathClear(b, idx(3, 3), idx(1, 2));
})());

console.log('rules: board helpers');
check('cloneBoard is a deep copy', (() => {
  const b = makeStartBoard();
  const c = cloneBoard(b);
  c.color[idx(6, 0)] = EMPTY;
  return b.color[idx(6, 0)] === WHITE && c.color[idx(6, 0)] === EMPTY;
})());
check('findPid locates a piece and reports -1 when absent', (() => {
  const b = makeStartBoard();
  return findPid(b, 0) >= 0 && findPid(b, 31) >= 0 && findPid(b, 99) === -1;
})());
check('legalMoves on an empty square is empty', legalMoves(makeStartBoard(), idx(3, 3), N).length === 0);
check('legalMoves with no move type is empty', legalMoves(loneBoard(N, idx(3, 3)), idx(3, 3), 0).length === 0);

if (failures.length) {
  console.log(`\n${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log('  FAIL — ' + f);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
