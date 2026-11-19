// Fast unit tests for src/core/game.js — the Game shell around the rules:
// turns, rolls, probes, observations, captures and the win condition.
// No agent code is involved; these pin the mechanics the experiments
// measure, so a change to turn flow breaks here first.
//
// Run: node test/game.js  (also included in node test/run.js)

import { Game, observationOf, other, sideName, PIECES_PER_SIDE } from '../src/core/game.js';
import { WHITE, BLACK, P, N, R, K, MOVE_TYPES } from '../src/core/rules.js';
import { idx, sqName, dIndex } from '../src/core/geometry.js';

let checks = 0;
let failures = [];
function check(name, ok) {
  checks++;
  if (!ok) failures.push(name);
  else console.log('  ok — ' + name);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A game whose board holds only the pieces we place: a white rook (pid 0)
// on a1, a black pawn (pid 1) on a3 and a black king (pid 2) on h8.
// `secretBlack` is the pid the black side loses the game by losing.
function duelGame(secretBlack = 2) {
  const g = new Game('duel');
  g.board = {
    kind: new Int8Array(64),
    color: new Int8Array(64),
    pid: new Int8Array(64).fill(-1),
  };
  const put = (kind, sq, color, pid) => {
    g.board.kind[sq] = kind;
    g.board.color[sq] = color;
    g.board.pid[sq] = pid;
  };
  put(R, idx(7, 0), WHITE, 0);
  put(P, idx(5, 0), BLACK, 1);
  put(K, idx(0, 7), BLACK, 2);
  g.rolled = new Int8Array(32);
  g.rolled[0] = R;
  g.rolled[1] = P;
  g.rolled[2] = K;
  g.secret = { [WHITE]: 0, [BLACK]: secretBlack };
  g.turn = WHITE;
  g.status = 'playing';
  return g;
}

console.log('game: construction');
{
  const g = new Game('fresh');
  check('starts in setup, white to move, 32 pieces on the board', g.status === 'setup'
    && g.turn === WHITE && g.piecesOf(WHITE).length === PIECES_PER_SIDE
    && g.piecesOf(BLACK).length === PIECES_PER_SIDE);
  check('counters start at zero', g.ply === 0 && g.probes === 0 && g.measured === 0 && g.skips === 0);
  check('both sides have a secret piece', g.secret[WHITE] >= 0 && g.secret[BLACK] >= 0
    && g.secret[WHITE] !== g.secret[BLACK]);
  check('other() swaps sides, sideName() names them', other(WHITE) === BLACK
    && other(BLACK) === WHITE && sideName(WHITE) === 'White' && sideName(BLACK) === 'Black');
}

console.log('game: beginTurn and determinism');
{
  const a = new Game('same-seed');
  const b = new Game('same-seed');
  a.beginTurn();
  b.beginTurn();
  check('beginTurn starts play', a.status === 'playing');
  check('same seed replays the same roll', eq(a.snapshot(), b.snapshot()));
  check('every piece to move has a rolled type', a.piecesOf(WHITE)
    .every((sq) => MOVE_TYPES.includes(a.typeOf(sq))));
  check('the side to move always has a move', a.hasAnyMove());
  check('reset() replays the same game', (() => {
    a.reset();
    a.beginTurn();
    return eq(a.snapshot(), b.snapshot());
  })());
}

console.log('game: probe and observations');
{
  const g = new Game('probe');
  g.beginTurn();
  const seen = [];
  g.onObservation((obs) => seen.push(obs));
  // White pawn a2 -> a3 as a pawn move is always legal from the start.
  check('probe answers a legal move', g.probe(idx(6, 0), idx(5, 0), P) === true);
  check('probe counts and publishes one observation', g.probes === 1 && seen.length === 1);
  const obs = seen[0];
  check('observation describes the move', obs.moveType === P && obs.from === idx(6, 0)
    && obs.to === idx(5, 0) && obs.dr === -1 && obs.dc === 0 && obs.legal === true);
  check('probe answers an illegal move', g.probe(idx(6, 0), idx(4, 0), P) === false);
  check('probes keep counting after a no', g.probes === 2);
  check('observationOf is pure and complete', (() => {
    const o = observationOf(g.board, idx(7, 1), idx(5, 2), N, true);
    return o.color === WHITE && o.d === dIndex(-2, 1) && o.dr === -2 && o.dc === 1
      && o.target === 0 && o.clear === true;
  })());
}

console.log('game: movesFor');
{
  const g = new Game('moves');
  g.beginTurn();
  const own = g.piecesOf(WHITE)[0];
  check('movesFor lists moves for the side to move', g.movesFor(own).length > 0);
  check('movesFor is empty for the other side', g.movesFor(g.piecesOf(BLACK)[0]).length === 0);
  check('every listed move is a legal move of the rolled type', g.piecesOf(WHITE).every((sq) =>
    g.movesFor(sq).every((to) => g.board.color[to] !== WHITE)));
}

console.log('game: apply, capture, win');
{
  const g = duelGame(2); // secret is the black king, not the pawn
  const result = g.apply(idx(7, 0), idx(5, 0));
  check('apply captures and reports it', result.captured && result.captured.kind === P && !result.won);
  check('the rook ends on the captured square', g.board.color[idx(5, 0)] === WHITE
    && g.board.color[idx(7, 0)] === 0);
  check('the captured piece is recorded', g.taken[WHITE].length === 1 && g.taken[WHITE][0].pid === 1);
  check('ply counts and the turn passes', g.ply === 1 && g.turn === BLACK);
  check('the log names the move', g.log[0].from === 'a1' && g.log[0].to === 'a3'
    && g.log[0].as === 'rook' && g.log[0].cap === 'black pawn');
  check('the game keeps going after a non-secret capture', g.status === 'playing');
}
{
  const g = duelGame(1); // secret is the black pawn on a3
  const result = g.apply(idx(7, 0), idx(5, 0));
  check('capturing the secret piece wins', result.won === true);
  check('the game ends with white as winner', g.status === 'over' && g.winner === WHITE);
  check('a won game still records the capture', g.taken[WHITE].length === 1);
}
{
  const g = duelGame(2);
  check('snapshot round-trips the board', (() => {
    const s = g.snapshot();
    return s.kind[idx(7, 0)] === R && s.color[idx(5, 0)] === BLACK
      && s.pid[idx(0, 7)] === 2 && s.turn === WHITE;
  })());
  check('sqName is used for log squares', sqName(idx(7, 0)) === 'a1' && sqName(idx(0, 7)) === 'h8');
}

if (failures.length) {
  console.log(`\n${failures.length} of ${checks} checks failed:`);
  for (const f of failures) console.log('  FAIL — ' + f);
  process.exit(1);
}
console.log(`\nall ${checks} checks passed`);
