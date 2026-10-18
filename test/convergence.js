// Does the rule model actually learn inside one game? This is the question the
// whole demo rests on, so it gets measured rather than assumed.

import { Game } from '../src/core/game.js';
import { RuleModel } from '../src/agent/rule-model.js';
import { evaluate, maskFidelity } from '../src/eval/metrics.js';
import { Rng } from '../src/core/rng.js';
import { KIND_NAME, MOVE_TYPES } from '../src/core/rules.js';

function playOneGame(seed, probesPerTurn, curve) {
  const game = new Game(seed);
  const model = new RuleModel();
  const rng = new Rng(seed + ':probe');
  const evalRng = new Rng(seed + ':eval');
  game.onObservation((obs) => model.observe(obs));
  game.beginTurn();

  let ply = 0;
  while (game.status === 'playing' && ply < 220) {
    // The agent spends a small probe budget on displacements it is unsure
    // about. This is the only way it can ask the environment anything.
    const mine = game.piecesOf(game.turn);
    for (let k = 0; k < probesPerTurn && mine.length; k++) {
      const from = rng.pick(mine);
      const to = rng.int(64);
      if (to !== from) game.probe(from, to, game.typeOf(from));
    }

    const options = [];
    for (const sq of mine) for (const to of game.movesFor(sq)) options.push([sq, to]);
    if (!options.length) break;

    if (curve && ply % 2 === 0) {
      const m = evaluate(model, game.board, evalRng);
      if (m) curve.push({ ply, accuracy: m.accuracy, brier: m.brier, obs: model.observations });
    }

    const [from, to] = options[rng.int(options.length)];
    game.apply(from, to);
    ply++;
  }
  return { game, model, ply };
}

console.log('=== single game, probe budget 12/turn ===');
const curve = [];
const { model, game, ply } = playOneGame('conv-1', 12, curve);
console.log(`plies: ${ply}   observations: ${model.observations}   probes: ${game.probes}`);
console.log('\nbalanced accuracy over the game:');
for (const p of curve.filter((_, i) => i % 4 === 0)) {
  const bars = '#'.repeat(Math.round(p.accuracy * 40));
  console.log(`  ply ${String(p.ply).padStart(3)}  obs ${String(p.obs).padStart(4)}  ${(p.accuracy * 100).toFixed(1).padStart(5)}%  ${bars}`);
}
const last = curve[curve.length - 1];
console.log(`\nfinal: ${(last.accuracy * 100).toFixed(1)}% balanced accuracy, Brier ${last.brier.toFixed(3)}`);

console.log('\nper-type mask fidelity after one game (how much of the true shape it has):');
for (const t of MOVE_TYPES) {
  const f = maskFidelity(model, t);
  console.log(`  ${KIND_NAME[t].padEnd(7)} ${(f * 100).toFixed(1).padStart(5)}%  ${'#'.repeat(Math.round(f * 40))}`);
}

console.log('\nlearned traits (positive blocking => it worked out this type is blocked by pieces):');
for (const t of MOVE_TYPES) {
  const tr = model.traits(t);
  if (!tr) { console.log(`  ${KIND_NAME[t].padEnd(7)} not enough data`); continue; }
  console.log(`  ${KIND_NAME[t].padEnd(7)} obs ${String(tr.observations).padStart(4)}  blocking ${tr.blocking >= 0 ? '+' : ''}${tr.blocking.toFixed(2)}  own-piece ${tr.ownPiece.toFixed(2)}`);
}

console.log('\n=== averaged over 12 games, varying probe budget ===');
for (const budget of [0, 6, 12, 24]) {
  let acc = 0, fid = 0, n = 0;
  for (let g = 0; g < 12; g++) {
    const c = [];
    const r = playOneGame('budget-' + budget + '-' + g, budget, c);
    if (!c.length) continue;
    acc += c[c.length - 1].accuracy;
    let f = 0;
    for (const t of MOVE_TYPES) f += maskFidelity(r.model, t);
    fid += f / MOVE_TYPES.length;
    n++;
  }
  console.log(`  probes/turn ${String(budget).padStart(2)}  balanced accuracy ${(acc / n * 100).toFixed(1)}%   mask fidelity ${(fid / n * 100).toFixed(1)}%`);
}
