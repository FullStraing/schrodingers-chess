import { Rng } from './rng.js';
import { rowOf, colOf, sqName, dIndex } from './geometry.js';
import {
  EMPTY, P, Q, WHITE, BLACK, MOVE_TYPES, KIND_NAME,
  legalMoves, isLegal, makeStartBoard, findPid, targetState, pathClear,
} from './rules.js';

export const PIECES_PER_SIDE = 16;
const REROLL_LIMIT = 12;

// One attempted move, described only in terms the agent is allowed to see:
// which movement type was in force, how far the piece travelled, what was on
// the destination, whether the path was blocked, and whether it was allowed.
export function observationOf(board, from, to, moveType, legal) {
  return {
    moveType,
    color: board.color[from],
    from, to,
    dr: rowOf(to) - rowOf(from),
    dc: colOf(to) - colOf(from),
    d: dIndex(rowOf(to) - rowOf(from), colOf(to) - colOf(from)),
    target: targetState(board, from, to),
    clear: pathClear(board, from, to),
    legal,
  };
}

export class Game {
  constructor(seed) {
    this.rng = new Rng(seed);
    this.seed = String(seed);
    this.reset();
  }

  reset() {
    this.rng = new Rng(this.seed);
    this.board = makeStartBoard();
    this.turn = WHITE;
    this.rolled = new Int8Array(32);
    this.secret = { [WHITE]: -1, [BLACK]: -1 };
    this.secretHome = {};
    this.log = [];
    this.taken = { [WHITE]: [], [BLACK]: [] };
    this.status = 'setup';
    this.winner = 0;
    this.ply = 0;
    this.measured = 0;
    this.probes = 0;
    this.skips = 0;
    this.listeners = [];

    const ids = { [WHITE]: [], [BLACK]: [] };
    for (let i = 0; i < 64; i++) if (this.board.color[i]) ids[this.board.color[i]].push(this.board.pid[i]);
    for (const side of [WHITE, BLACK]) {
      this.secret[side] = this.rng.pick(ids[side]);
      const at = findPid(this.board, this.secret[side]);
      this.secretHome[side] = { kind: this.board.kind[at], at: sqName(at) };
    }
  }

  onObservation(fn) { this.listeners.push(fn); }
  emit(obs) { for (const fn of this.listeners) fn(obs); }

  // The only way the agent can ask the environment a question. Every call is
  // counted, and every answer is published as an observation, so a probe is
  // never free and never secret.
  probe(from, to, moveType) {
    this.probes++;
    const legal = isLegal(this.board, from, to, moveType);
    this.emit(observationOf(this.board, from, to, moveType, legal));
    return legal;
  }

  typeOf(square) {
    const id = this.board.pid[square];
    return id < 0 ? 0 : this.rolled[id];
  }

  movesFor(square) {
    if (this.board.color[square] !== this.turn) return [];
    return legalMoves(this.board, square, this.typeOf(square));
  }

  piecesOf(side) {
    const out = [];
    for (let i = 0; i < 64; i++) if (this.board.color[i] === side) out.push(i);
    return out;
  }

  hasAnyMove() {
    for (const sq of this.piecesOf(this.turn)) if (this.movesFor(sq).length) return true;
    return false;
  }

  rollTypes() {
    let n = 0;
    for (const sq of this.piecesOf(this.turn)) {
      this.rolled[this.board.pid[sq]] = this.rng.pick(MOVE_TYPES);
      n++;
    }
    this.measured += n;
    return n;
  }

  // Roll, and if the roll leaves the side to move with nothing at all, roll
  // again. Two stuck sides in a row ends the game; in 3000 simulated games
  // this never fired once, so it is a guard, not a mechanic.
  beginTurn() {
    let stuckStreak = 0;
    for (;;) {
      let tries = 0, ok = false;
      while (!ok && tries < REROLL_LIMIT) { this.rollTypes(); ok = this.hasAnyMove(); tries++; }
      if (ok) { this.status = 'playing'; return; }
      this.skips++;
      this.log.unshift({ skip: true, side: this.turn, text: sideName(this.turn) + ' could not move. Turn skipped.' });
      if (++stuckStreak >= 2) { this.status = 'over'; this.winner = 0; return; }
      this.turn = other(this.turn);
    }
  }

  apply(from, to) {
    const board = this.board;
    const moveType = this.typeOf(from);
    const mover = board.color[from];
    const shownKind = board.kind[from];
    const captured = board.color[to] ? { kind: board.kind[to], color: board.color[to], pid: board.pid[to] } : null;

    this.emit(observationOf(board, from, to, moveType, true));

    board.kind[to] = board.kind[from];
    board.color[to] = board.color[from];
    board.pid[to] = board.pid[from];
    board.kind[from] = EMPTY; board.color[from] = EMPTY; board.pid[from] = -1;

    let promoted = false;
    const lastRank = mover === WHITE ? 0 : 7;
    if (shownKind === P && rowOf(to) === lastRank) { board.kind[to] = Q; promoted = true; }

    let won = false;
    if (captured) {
      this.taken[mover].push(captured);
      if (captured.pid === this.secret[captured.color]) won = true;
    }

    this.ply++;
    this.log.unshift({
      n: this.ply, side: sideName(mover), kind: KIND_NAME[shownKind], as: KIND_NAME[moveType],
      from: sqName(from), to: sqName(to),
      cap: captured ? sideName(captured.color).toLowerCase() + ' ' + KIND_NAME[captured.kind] : null,
      promo: promoted,
    });

    if (won) { this.status = 'over'; this.winner = mover; return { captured, promoted, won }; }
    this.turn = other(this.turn);
    this.beginTurn();
    return { captured, promoted, won };
  }

  snapshot() {
    return {
      kind: Array.from(this.board.kind), color: Array.from(this.board.color),
      pid: Array.from(this.board.pid), rolled: Array.from(this.rolled), turn: this.turn,
    };
  }
}

export const other = (side) => (side === WHITE ? BLACK : WHITE);
export const sideName = (side) => (side === WHITE ? 'White' : 'Black');
