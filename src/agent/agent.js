// The agent. Holds the three learning layers and decides what to do with a turn.
//
// It never imports src/core/rules.js. Everything it knows about how pieces move
// came in through observe(), and the only question it can ask the environment
// is game.probe(from, to, type), which costs it one probe from its budget.

import { RuleModel } from './rule-model.js';
import { BeliefModel } from './belief-model.js';
import { ObjectiveModel } from './objective-model.js';
import { candidates, chooseProbes, valueOf, entropy } from './policy.js';
import { MOVE_TYPES, TARGET_ENEMY } from './observable.js';
import { rowOf, colOf } from '../core/geometry.js';

const DEFAULT_BUDGET = 14;
const RESCUE_PROBES = 24;

export class LearningAgent {
  constructor({ side, rng, probeBudget = DEFAULT_BUDGET, savedObjective = null }) {
    this.side = side;
    this.rng = rng;
    this.probeBudget = probeBudget;
    this.rules = new RuleModel();
    this.objective = new ObjectiveModel(savedObjective);
    this.belief = null;
    this.ownSecretPid = -1;
    this.probesSpent = 0;
    this.probesWasted = 0;
    this.fallbacks = 0;
    this.lastProbes = [];
    this.turns = 0;
  }

  // Told the same thing a human player is told at setup: which of its own
  // pieces is secret, and that the opponent has one too.
  brief({ ownSecretPid, opponentPids }) {
    this.ownSecretPid = ownSecretPid;
    this.belief = new BeliefModel(opponentPids);
  }

  observe(obs) { this.rules.observe(obs); }

  // Curiosity falls off as the movement model firms up: early moves are worth
  // making for what they teach, later ones are not.
  get curiosity() {
    return Math.max(0, 1 - this.rules.observations / 320);
  }

  // Probability that a square can be reached by some enemy piece next turn,
  // marginalised over the roll it has not seen yet. Every enemy piece is
  // equally likely to come up as any of the six types, so the agent averages
  // over all six rather than assuming the worst.
  dangerAt(board, square) {
    let safe = 1;
    for (let from = 0; from < 64; from++) {
      if (!board.color[from] || board.color[from] === this.side) continue;
      const dr = rowOf(square) - rowOf(from), dc = colOf(square) - colOf(from);
      const clear = pathClear(board, from, square);
      let acc = 0;
      for (const t of MOVE_TYPES) {
        acc += this.rules.legality(t, dr, dc, board.color[from], TARGET_ENEMY, clear);
      }
      safe *= 1 - acc / MOVE_TYPES.length;
    }
    return 1 - safe;
  }

  // Expected number of attackers on each enemy piece, again marginalised over
  // the unseen roll. Feeds the protection signal in the belief update.
  exposureMap(board) {
    const out = new Map();
    for (let to = 0; to < 64; to++) {
      if (!board.color[to] || board.color[to] === this.side) continue;
      let sum = 0;
      for (let from = 0; from < 64; from++) {
        if (board.color[from] !== this.side) continue;
        const dr = rowOf(to) - rowOf(from), dc = colOf(to) - colOf(from);
        const clear = pathClear(board, from, to);
        let acc = 0;
        for (const t of MOVE_TYPES) acc += this.rules.legality(t, dr, dc, this.side, TARGET_ENEMY, clear);
        sum += acc / MOVE_TYPES.length;
      }
      out.set(board.pid[to], sum);
    }
    return out;
  }

  // Spend the probe budget, then commit. Returns a record of what it tried and
  // why, which is what the experiment feed in the UI renders.
  //
  // onProbe is awaited after each probe so the interface can show the model
  // changing as it learns rather than replaying a finished batch. Without a
  // callback this runs straight through, which is what the tests do.
  async takeTurn(game, { onProbe = null } = {}) {
    const board = game.board;
    const rolledOf = (pid) => (pid < 0 ? 0 : game.rolled[pid]);
    const beliefOf = (pid) => (this.belief ? this.belief.probability(pid) : 0);

    const cands = candidates(board, this.side, rolledOf, this.rules);
    const probes = chooseProbes(cands, this.probeBudget, this.rules, board, this.rng);

    const tried = [];
    const confirmed = [];
    for (const c of probes) {
      const before = c.p;
      const legal = game.probe(c.from, c.to, c.type);
      this.probesSpent++;
      if (!legal) this.probesWasted++;
      const record = { ...c, legal, predicted: before, surprise: Math.abs((legal ? 1 : 0) - before) };
      tried.push(record);
      if (legal) confirmed.push(c);
      if (onProbe) await onProbe(record);
    }

    // If uncertainty sampling happened to pick nothing legal, fall back to the
    // moves it is most confident about. This is rare once the model warms up,
    // and it is counted so the UI can be honest about it.
    if (!confirmed.length) {
      const ranked = cands.slice().sort((a, b) => b.p - a.p);
      for (let i = 0; i < Math.min(RESCUE_PROBES, ranked.length) && !confirmed.length; i++) {
        const c = ranked[i];
        if (tried.some((t) => t.from === c.from && t.to === c.to)) continue;
        const legal = game.probe(c.from, c.to, c.type);
        this.probesSpent++;
        if (!legal) this.probesWasted++;
        const record = { ...c, legal, predicted: c.p, surprise: Math.abs((legal ? 1 : 0) - c.p), rescue: true };
        tried.push(record);
        if (legal) confirmed.push(c);
        if (onProbe) await onProbe(record);
      }
    }

    this.lastProbes = tried;
    this.turns++;

    if (!confirmed.length) {
      // Last resort so a demo can never deadlock: take any move the
      // environment will accept. Counted and surfaced, not hidden.
      this.fallbacks++;
      const any = [];
      for (let from = 0; from < 64; from++) {
        if (board.color[from] !== this.side) continue;
        for (const to of game.movesFor(from)) any.push({ from, to, p: 0.5, type: rolledOf(board.pid[from]) });
      }
      if (!any.length) return null;
      const choice = this.rng.pick(any);
      return { ...choice, tried, value: 0, fellBack: true };
    }

    const ctx = {
      side: this.side,
      beliefOf,
      ownSecretPid: this.ownSecretPid,
      dangerAt: (sq) => this.dangerAt(board, sq),
      curiosity: this.curiosity,
    };
    let best = null, bestV = -Infinity;
    for (const c of confirmed) {
      const v = valueOf(c, board, ctx);
      if (v > bestV) { bestV = v; best = c; }
    }
    return { ...best, tried, value: bestV, fellBack: false };
  }

  // Called after any capture anywhere on the board.
  noteCapture({ pid, kind, byMe, endedGame, remaining }) {
    const wasKing = kind === 6;
    if (endedGame) this.objective.captureWithEnd({ wasKing, remaining });
    else this.objective.captureWithoutEnd({ wasKing, remaining });
    if (byMe && !endedGame && this.belief) this.belief.eliminate(pid);
  }

  stats() {
    return {
      observations: this.rules.observations,
      probes: this.probesSpent,
      wasted: this.probesWasted,
      hitRate: this.probesSpent ? 1 - this.probesWasted / this.probesSpent : 0,
      fallbacks: this.fallbacks,
      turns: this.turns,
      curiosity: this.curiosity,
      beliefEntropy: this.belief ? this.belief.entropy() : 0,
    };
  }
}

function pathClear(board, from, to) {
  const r1 = rowOf(from), c1 = colOf(from), r2 = rowOf(to), c2 = colOf(to);
  const dr = r2 - r1, dc = c2 - c1;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  const aligned = r1 === r2 || c1 === c2 || Math.abs(dr) === Math.abs(dc);
  if (!aligned || steps < 2) return true;
  const sr = Math.sign(dr), sc = Math.sign(dc);
  for (let k = 1; k < steps; k++) if (board.color[(r1 + sr * k) * 8 + (c1 + sc * k)]) return false;
  return true;
}
