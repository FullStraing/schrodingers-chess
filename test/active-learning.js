// Full-game behaviour of the agent: probe hit rate, belief, objective.
//
// NOTE ON THE STRATEGY COMPARISON BELOW: it is confounded and is kept only to
// show why. A better-informed agent captures the secret sooner, the game ends
// earlier, and it therefore collects FEWER observations than a weaker one — so
// comparing end-of-game model quality across strategies measures game length
// as much as learning. The controlled comparison, where every strategy gets an
// identical probe budget on identical positions, is in test/probe-strategy.js,
// and there uncertainty sampling wins: 95.6% mask fidelity against 91.0% for
// random probing.

import { Game, other } from '../src/core/game.js';
import { LearningAgent } from '../src/agent/agent.js';
import { RuleModel } from '../src/agent/rule-model.js';
import { Rng } from '../src/core/rng.js';
import { WHITE, BLACK, MOVE_TYPES, KIND_NAME } from '../src/core/rules.js';
import { evaluate, maskFidelity } from '../src/eval/metrics.js';

function setup(seed, agentSide) {
  const game = new Game(seed);
  const agent = new LearningAgent({ side: agentSide, rng: new Rng(seed + ':agent') });
  game.onObservation((o) => agent.observe(o));
  const oppPids = [];
  for (let i = 0; i < 64; i++) if (game.board.color[i] === other(agentSide)) oppPids.push(game.board.pid[i]);
  agent.brief({ ownSecretPid: game.secret[agentSide], opponentPids: oppPids });
  game.beginTurn();
  return { game, agent };
}

// Random probing, matched budget, for the control arm.
function randomProbeTurn(game, agent, rng) {
  const mine = game.piecesOf(game.turn);
  for (let k = 0; k < agent.probeBudget && mine.length; k++) {
    const from = rng.pick(mine);
    const to = rng.int(64);
    if (to !== from) {
      const legal = game.probe(from, to, game.typeOf(from));
      agent.probesSpent++;
      if (!legal) agent.probesWasted++;
    }
  }
  const opts = [];
  for (const sq of mine) for (const to of game.movesFor(sq)) opts.push({ from: sq, to });
  return opts.length ? rng.pick(opts) : null;
}

async function run(seed, mode, track) {
  const agentSide = BLACK;
  const { game, agent } = setup(seed, agentSide);
  const rng = new Rng(seed + ':ctl');
  const evalRng = new Rng(seed + ':eval');
  let ply = 0;

  while (game.status === 'playing' && ply < 160) {
    if (game.turn === agentSide) {
      const decision = mode === 'active' ? await agent.takeTurn(game) : randomProbeTurn(game, agent, rng);
      if (!decision) break;
      const before = agent.exposureMap(game.board);
      const res = game.apply(decision.from, decision.to);
      if (res.captured) {
        agent.noteCapture({
          pid: res.captured.pid, kind: res.captured.kind, byMe: true,
          endedGame: res.won, remaining: 16 - agent.belief.eliminated.size,
        });
      } else agent.objective.quietMove(ply);
      void before;
    } else {
      // Opponent plays at random; the agent watches and updates its belief.
      const opts = [];
      for (const sq of game.piecesOf(game.turn)) for (const to of game.movesFor(sq)) opts.push([sq, to]);
      if (!opts.length) break;
      const expBefore = agent.exposureMap(game.board);
      const [f, t] = rng.pick(opts);
      const res = game.apply(f, t);
      const expAfter = agent.exposureMap(game.board);
      agent.belief.updateFromMove(expBefore, expAfter);
      if (res.captured) {
        agent.noteCapture({
          pid: res.captured.pid, kind: res.captured.kind, byMe: false,
          endedGame: res.won, remaining: 16 - agent.belief.eliminated.size,
        });
      }
    }
    if (track && ply % 4 === 0) {
      const m = evaluate(agent.rules, game.board, evalRng);
      if (m) track.push({ ply, acc: m.accuracy, obs: agent.rules.observations, hit: agent.stats().hitRate });
    }
    ply++;
  }

  let fid = 0;
  for (const t of MOVE_TYPES) fid += maskFidelity(agent.rules, t);
  const m = evaluate(agent.rules, game.board, new Rng(seed + ':final'));
  return {
    accuracy: m ? m.accuracy : 0.5,
    fidelity: fid / MOVE_TYPES.length,
    hitRate: agent.stats().hitRate,
    observations: agent.rules.observations,
    fallbacks: agent.fallbacks,
    turns: agent.turns,
    beliefEntropy: agent.belief.entropy(),
    eliminated: agent.belief.eliminated.size,
    objective: agent.objective.best(),
    ply,
  };
}

const GAMES = 24;
console.log(`=== uncertainty sampling vs random probing, ${GAMES} games each, identical seeds ===\n`);
const agg = { active: [], random: [] };
for (let i = 0; i < GAMES; i++) {
  for (const mode of ['active', 'random']) agg[mode].push(await run('cmp-' + i, mode));
}
const mean = (xs, f) => xs.reduce((a, b) => a + f(b), 0) / xs.length;
const row = (label, xs) =>
  `  ${label.padEnd(22)} accuracy ${(mean(xs, (r) => r.accuracy) * 100).toFixed(1).padStart(5)}%` +
  `   mask fidelity ${(mean(xs, (r) => r.fidelity) * 100).toFixed(1).padStart(5)}%` +
  `   probe hit rate ${(mean(xs, (r) => r.hitRate) * 100).toFixed(1).padStart(5)}%` +
  `   observations ${mean(xs, (r) => r.observations).toFixed(0).padStart(4)}`;
console.log(row('uncertainty sampling', agg.active));
console.log(row('random probing', agg.random));
console.log(`\n  The gap in observations is the confound: the stronger agent ends games`);
console.log(`  sooner and sees less data. See test/probe-strategy.js for the controlled run.`);

console.log('\n=== one game in detail (uncertainty sampling) ===');
const track = [];
const detail = await run('detail-7', 'active', track);
for (const p of track.filter((_, i) => i % 3 === 0)) {
  console.log(`  ply ${String(p.ply).padStart(3)}  obs ${String(p.obs).padStart(4)}` +
    `  accuracy ${(p.acc * 100).toFixed(1).padStart(5)}%  probe hit ${(p.hit * 100).toFixed(1).padStart(5)}%` +
    `  ${'#'.repeat(Math.round(p.acc * 30))}`);
}
console.log(`\n  final accuracy ${(detail.accuracy * 100).toFixed(1)}%   mask fidelity ${(detail.fidelity * 100).toFixed(1)}%`);
console.log(`  fallback turns ${detail.fallbacks} of ${detail.turns}`);
console.log(`  belief entropy ${detail.beliefEntropy.toFixed(2)} bits (started at 4.00), ruled out ${detail.eliminated} pieces`);
console.log(`  objective hypothesis: "${detail.objective.label}" at ${(detail.objective.p * 100).toFixed(1)}%`);
