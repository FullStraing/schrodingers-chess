// Controlled comparison of probe-selection strategies at a FIXED data budget.
//
// The earlier version of this experiment let each strategy play a full game,
// which confounded the result: a stronger agent ends the game sooner and
// therefore sees fewer observations, so it looked like the better strategy
// learned less. Here every strategy gets exactly the same number of probes on
// the same sequence of positions, and nothing else differs.

import { Game } from '../src/core/game.js';
import { RuleModel } from '../src/agent/rule-model.js';
import { candidates, chooseProbes, entropy } from '../src/agent/policy.js';
import { Rng } from '../src/core/rng.js';
import { WHITE, MOVE_TYPES, KIND_NAME } from '../src/core/rules.js';
import { maskFidelity, evaluate } from '../src/eval/metrics.js';

const PROBE_BUDGET = 400;
const PER_TURN = 10;

const STRATEGIES = {
  // Uniform over (piece, destination). The baseline to beat.
  random(cands, n, model, board, rng) {
    return rng.shuffle(cands.slice()).slice(0, n);
  },
  // Highest binary entropy first.
  entropy(cands, n, model, board, rng) {
    return cands.map((c) => ({ c, s: entropy(c.p) + rng.float() * 0.02 }))
      .sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
  },
  // Entropy with a 1/sqrt(n) count bonus over (orbit, target) buckets.
  coverage(cands, n, model, board, rng) {
    return chooseProbes(cands, n, model, board, rng);
  },
  // Pure coverage: ignore the model, just spread over unseen buckets.
  spread(cands, n, model, board, rng) {
    return cands.map((c) => ({
      c, s: 1 / Math.sqrt(1 + model.coverage(c.type, c.dr, c.dc, board.color[c.from], c.target)) + rng.float() * 0.02,
    })).sort((a, b) => b.s - a.s).slice(0, n).map((x) => x.c);
  },
};

function trial(seed, strategy) {
  const game = new Game(seed);
  const model = new RuleModel();
  game.onObservation((o) => model.observe(o));
  game.beginTurn();
  const rng = new Rng(seed + ':' + strategy);
  const pick = STRATEGIES[strategy];

  let spent = 0, hits = 0;
  while (spent < PROBE_BUDGET && game.status === 'playing') {
    const cands = candidates(game.board, game.turn, (pid) => (pid < 0 ? 0 : game.rolled[pid]), model);
    const take = Math.min(PER_TURN, PROBE_BUDGET - spent);
    for (const c of pick(cands, take, model, game.board, rng)) {
      if (game.probe(c.from, c.to, c.type)) hits++;
      spent++;
    }
    // Advance the position with a move chosen independently of the strategy,
    // so every arm sees the same kind of board sequence.
    const opts = [];
    for (const sq of game.piecesOf(game.turn)) for (const to of game.movesFor(sq)) opts.push([sq, to]);
    if (!opts.length) break;
    const [f, t] = opts[rng.int(opts.length)];
    game.apply(f, t);
  }

  let fid = 0;
  const per = {};
  for (const t of MOVE_TYPES) { const f = maskFidelity(model, t); per[t] = f; fid += f; }
  const m = evaluate(model, game.board, new Rng(seed + ':ev'));
  return { fidelity: fid / MOVE_TYPES.length, accuracy: m ? m.accuracy : 0.5, hitRate: hits / Math.max(spent, 1), per, spent };
}

const N = 30;
console.log(`=== probe-selection strategies, ${PROBE_BUDGET} probes each, ${N} seeds ===\n`);
const results = {};
for (const name of Object.keys(STRATEGIES)) {
  const runs = [];
  for (let i = 0; i < N; i++) runs.push(trial('ps-' + i, name));
  const mean = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  const sd = (f) => {
    const m = mean(f);
    return Math.sqrt(runs.reduce((a, r) => a + (f(r) - m) ** 2, 0) / runs.length);
  };
  results[name] = {
    fidelity: mean((r) => r.fidelity), fidSd: sd((r) => r.fidelity),
    accuracy: mean((r) => r.accuracy), hit: mean((r) => r.hitRate),
    per: Object.fromEntries(MOVE_TYPES.map((t) => [t, mean((r) => r.per[t])])),
  };
}
for (const [name, r] of Object.entries(results)) {
  console.log(`  ${name.padEnd(9)} mask fidelity ${(r.fidelity * 100).toFixed(1).padStart(5)}% ±${(r.fidSd * 100).toFixed(1)}` +
    `   balanced accuracy ${(r.accuracy * 100).toFixed(1).padStart(5)}%   legal probes ${(r.hit * 100).toFixed(1).padStart(4)}%`);
}
const best = Object.entries(results).sort((a, b) => b[1].fidelity - a[1].fidelity)[0];
console.log(`\n  best: ${best[0]} at ${(best[1].fidelity * 100).toFixed(1)}%` +
  `   (random baseline ${(results.random.fidelity * 100).toFixed(1)}%)`);

console.log('\n  per-type mask fidelity:');
console.log('            ' + MOVE_TYPES.map((t) => KIND_NAME[t].padStart(8)).join(''));
for (const [name, r] of Object.entries(results)) {
  console.log(`  ${name.padEnd(9)} ` + MOVE_TYPES.map((t) => ((r.per[t] * 100).toFixed(0) + '%').padStart(8)).join(''));
}
