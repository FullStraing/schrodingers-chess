// Wiring. You play White; EGO plays Black and starts from nothing.

import { Game } from '../core/game.js';
import { WHITE, BLACK, KIND_NAME } from '../core/rules.js';
import { sqName, rowOf, colOf } from '../core/geometry.js';
import { Rng, randomSeed } from '../core/rng.js';
import { LearningAgent } from '../agent/agent.js';
import { HYPOTHESES } from '../agent/objective-model.js';
import { TYPE_NAMES, MOVE_TYPES } from '../agent/observable.js';
import { evaluate, maskFidelity } from '../eval/metrics.js';
import { MasksView } from './masks-view.js';
import { ChartView } from './chart-view.js';
import { clearTokenCache } from './theme.js';
import { nextQuip, mood } from './quips.js';

const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };
const PROBE_DELAY = 46;
const MOVE_PAUSE = 300;
const STORE_KEY = 'schrodinger-chess.objective';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let game, agent, evalRng, masks, curve;
let selected = null, legal = [], lastMove = null;
let showBelief = false, busy = false, phase = 'intro';
let curtainState = null;
let accuracy = 0.5, prevAccuracy = 0.5;
let rejectedStreak = 0, turnProbes = 0, turnHits = 0;
let quipLines = [], lastObjective = null;
let signals = {};

function start(seed) {
  clearTokenCache();
  game = new Game(seed);
  $('seed').value = game.seed;
  evalRng = new Rng(seed + ':eval');

  agent = new LearningAgent({ side: BLACK, rng: new Rng(seed + ':agent'), savedObjective: loadObjective() });
  game.onObservation((o) => agent.observe(o));

  const humanPids = [];
  for (let i = 0; i < 64; i++) if (game.board.color[i] === WHITE) humanPids.push(game.board.pid[i]);
  agent.brief({ ownSecretPid: game.secret[BLACK], opponentPids: humanPids });

  selected = null; legal = []; lastMove = null; busy = false; phase = 'intro';
  accuracy = 0.5; prevAccuracy = 0.5;
  rejectedStreak = 0; turnProbes = 0; turnHits = 0;
  quipLines = []; lastObjective = null; signals = baseSignals();
  curve.clear();
  game.beginTurn();
  renderAll();
}

const baseSignals = () => ({
  rejectedStreak: 0, turnProbes: 0, turnHits: 0, accuracy: 0.5, accuracyJump: 0,
  captured: null, lostPiece: null, tookSecret: false, eliminatedJust: false,
  suspects: 16, observations: 0, bestType: null, bestFidelity: 0,
  objectiveFlip: false, objectiveShort: '',
});

/* ---------------- board ---------------- */

function buildBoard() {
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.i = i;
    b.className = 'square' + ((rowOf(i) + colOf(i)) % 2 === 0 ? ' light' : '');
    b.addEventListener('click', onSquare);
    board.appendChild(b);
  }
  for (const id of ['filesTop', 'filesBot']) {
    const el = $(id); el.innerHTML = '';
    for (const f of 'abcdefgh') { const s = document.createElement('span'); s.textContent = f; el.appendChild(s); }
  }
  for (const id of ['ranksL', 'ranksR']) {
    const el = $(id); el.innerHTML = '';
    for (let r = 8; r >= 1; r--) { const s = document.createElement('span'); s.textContent = r; el.appendChild(s); }
  }
}

function renderBoard() {
  const cells = $('board').children;
  const legalMap = new Map(legal.map((to) => [to, game.board.color[to] !== 0]));

  for (let i = 0; i < 64; i++) {
    const cell = cells[i];
    const kind = game.board.kind[i], color = game.board.color[i], pid = game.board.pid[i];
    let cls = 'square' + ((rowOf(i) + colOf(i)) % 2 === 0 ? ' light' : '');
    cell.innerHTML = '';

    if (selected === i) cls += ' sel';
    if (lastMove && (lastMove.from === i || lastMove.to === i)) cls += ' last';
    if (legalMap.has(i)) {
      cls += ' playable';
      if (legalMap.get(i)) cls += ' cap';
      else { const d = document.createElement('span'); d.className = 'dot'; cell.appendChild(d); }
    }

    if (kind) {
      const g = document.createElement('span');
      g.className = 'glyph ' + (color === WHITE ? 'w' : 'b');
      g.textContent = GLYPH[kind];
      cell.appendChild(g);

      if (color === game.turn && game.rolled[pid] && phase === 'play') {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = GLYPH[game.rolled[pid]];
        cell.appendChild(badge);
      }
      if (showBelief && color === WHITE && agent.belief) {
        const p = agent.belief.probability(pid);
        if (p > 0.001) {
          const tag = document.createElement('span');
          tag.className = 'belief-tag';
          tag.textContent = Math.round(p * 100);
          cell.appendChild(tag);
        }
      }
      if (color === WHITE && phase === 'play' && game.turn === WHITE) cls += ' playable';
      cell.setAttribute('aria-label', `${sqName(i)}, ${color === WHITE ? 'your' : 'its'} ${KIND_NAME[kind]}`);
    } else {
      cell.setAttribute('aria-label', `${sqName(i)}, empty`);
    }
    cell.className = cls;
  }
}

function onSquare(ev) {
  if (busy || phase !== 'play' || game.turn !== WHITE) return;
  const i = Number(ev.currentTarget.dataset.i);
  if (legal.includes(i) && selected !== null) { humanMove(selected, i); return; }
  if (game.board.color[i] === WHITE) {
    if (selected === i) { selected = null; legal = []; }
    else { selected = i; legal = game.movesFor(i); }
  } else { selected = null; legal = []; }
  renderBoard();
  renderMoveNote();
}

/* ---------------- turns ---------------- */

async function humanMove(from, to) {
  busy = true;
  const kindMoved = game.board.kind[from];
  const expBefore = agent.exposureMap(game.board);
  const res = game.apply(from, to);
  lastMove = { from, to };
  selected = null; legal = [];

  const expAfter = agent.exposureMap(game.board);
  agent.belief.updateFromMove(expBefore, expAfter);
  if (res.captured) {
    agent.noteCapture({
      pid: res.captured.pid, kind: res.captured.kind, byMe: false,
      endedGame: res.won, remaining: 16 - agent.belief.eliminated.size,
    });
    signals.lostPiece = KIND_NAME[res.captured.kind];
  } else agent.objective.quietMove(game.ply);
  void kindMoved;

  measure();
  renderAll();
  if (game.status === 'over') { finish(); return; }
  await sleep(reduced ? 0 : MOVE_PAUSE);
  await agentTurn();
  busy = false;
}

async function agentTurn() {
  setStatus('EGO is forming an unsupported theory…');
  turnProbes = 0; turnHits = 0;

  const decision = await agent.takeTurn(game, {
    onProbe: async (record) => {
      turnProbes++;
      if (record.legal) { turnHits++; rejectedStreak = 0; } else rejectedStreak++;
      pushProbe(record);
      flashProbe(record);
      masks.render(agent.rules);
      renderEgo();
      renderStats();
      if (!reduced) await sleep(PROBE_DELAY);
    },
  });

  clearFlashes();
  if (!decision) { finish(); return; }

  const suspectsBefore = agent.belief.eliminated.size;
  const res = game.apply(decision.from, decision.to);
  lastMove = { from: decision.from, to: decision.to };
  if (res.captured) {
    agent.noteCapture({
      pid: res.captured.pid, kind: res.captured.kind, byMe: true,
      endedGame: res.won, remaining: 16 - agent.belief.eliminated.size,
    });
    signals.captured = KIND_NAME[res.captured.kind];
    signals.tookSecret = res.won;
    signals.eliminatedJust = agent.belief.eliminated.size > suspectsBefore;
  } else agent.objective.quietMove(game.ply);

  measure();
  speak();
  renderAll();
  if (game.status === 'over') finish();
}

function measure() {
  const m = evaluate(agent.rules, game.board, evalRng);
  if (m) {
    prevAccuracy = accuracy;
    accuracy = m.accuracy;
    curve.push({ x: game.ply, y: m.accuracy });
    $('curveNote').textContent = `${Math.round(m.accuracy * 100)}% on ${m.n} held-out moves`;
  }
}

/* ---------------- EGO ---------------- */

function collectSignals() {
  let bestType = null, bestFidelity = 0;
  if (agent.rules.observations > 30) {
    for (const t of MOVE_TYPES) {
      const f = maskFidelity(agent.rules, t);
      if (f > bestFidelity) { bestFidelity = f; bestType = TYPE_NAMES[t]; }
    }
  }
  const best = agent.objective.best();
  const flip = lastObjective !== null && lastObjective !== best.id;
  lastObjective = best.id;

  return {
    ...signals,
    rejectedStreak, turnProbes, turnHits,
    accuracy, accuracyJump: accuracy - prevAccuracy,
    suspects: 16 - agent.belief.eliminated.size,
    observations: agent.rules.observations,
    bestType, bestFidelity,
    objectiveFlip: flip,
    objectiveShort: best.label.toLowerCase().replace(/^.*?ends it$/, best.label.toLowerCase()),
  };
}

function speak() {
  const s = collectSignals();
  const line = nextQuip(s, quipLines[0]);
  if (line) quipLines.unshift(line);
  if (quipLines.length > 6) quipLines.pop();
  // Consume one-shot signals so they do not retrigger next turn.
  signals.captured = null; signals.lostPiece = null;
  signals.eliminatedJust = false;
}

function renderEgo() {
  const s = collectSignals();
  const m = mood(s);
  $('egoFace').textContent = m.face;
  $('egoState').textContent = m.state;

  const frustration = turnProbes ? 1 - turnHits / turnProbes : (rejectedStreak ? 1 : 0);
  const metrics = [
    ['frustration', 'Frustration', frustration],
    ['understanding', 'Understanding', accuracy],
    ['curiosity', 'Curiosity', agent.curiosity],
    ['suspicion', 'Suspicion', 1 - agent.belief.entropy() / 4],
  ];
  $('meters').innerHTML = metrics.map(([cls, label, v]) => {
    const pct = Math.max(0, Math.min(1, v));
    return `<div class="metric ${cls}"><div class="metric-head"><span>${label}</span><b>${Math.round(pct * 100)}</b></div>` +
      `<div class="meter"><span style="width:${pct * 100}%"></span></div></div>`;
  }).join('');

  $('quips').innerHTML = quipLines.length
    ? quipLines.map((l, i) => `<div class="quip${i === 0 ? ' fresh' : ''}"><span class="who">EGO</span>` +
        `<div class="bubble">${l}</div></div>`).join('')
    : '<div class="quip"><span class="who">EGO</span><div class="bubble">Thirty-two pieces and no instructions. Let me get back to you.</div></div>';

  $('egoFoot').textContent = `${agent.rules.observations} observations · ${agent.probesSpent} questions asked`;
}

/* ---------------- panels ---------------- */

function pushProbe(r) {
  const li = document.createElement('li');
  const verdict = r.legal ? '<span class="verdict yes">yes</span>' : '<span class="verdict no">no</span>';
  const surprised = r.surprise > 0.6 ? ' <span class="surprise">!</span>' : '';
  li.innerHTML = `<span>${TYPE_NAMES[r.type]}</span><span>${sqName(r.from)}→${sqName(r.to)}${surprised}</span>` +
    `<span>${Math.round(r.predicted * 100)}%</span>${verdict}`;
  const feed = $('feed');
  feed.insertBefore(li, feed.firstChild);
  while (feed.children.length > 40) feed.removeChild(feed.lastChild);
}

function flashProbe(r) {
  const cells = $('board').children;
  cells[r.to].classList.add(r.legal ? 'probe-hit' : 'probe-miss');
  setTimeout(() => cells[r.to].classList.remove('probe-hit', 'probe-miss'), PROBE_DELAY * 4);
}
function clearFlashes() {
  for (const c of $('board').children) c.classList.remove('probe-hit', 'probe-miss');
}

function renderPlayers() {
  for (const [side, ids] of [[WHITE, ['scoreW', 'meterW', 'footW', 'pcsW', 'cardW', 'tagW']],
                             [BLACK, ['scoreB', 'meterB', 'footB', 'pcsB', 'cardB', 'tagB']]]) {
    const [sc, mt, ft, pc, card, tag] = ids;
    const taken = game.taken[side];
    $(sc).textContent = taken.length;
    $(mt).style.width = (taken.length / 16) * 100 + '%';
    $(ft).textContent = taken.length
      ? `${taken.length} captured, none of them certain`
      : 'No captures. Yet.';
    $(pc).innerHTML = taken.map((p) => GLYPH[p.kind]).join('');
    $(card).className = 'card player' + (phase === 'play' && game.turn === side ? ' lit' : '');
    $(tag).className = 'tag' + (side === BLACK ? ' ai' : '') + (phase === 'play' && game.turn === side ? ' now' : '');
    $(tag).textContent = phase === 'play' && game.turn === side
      ? (side === WHITE ? 'Your turn' : 'Thinking')
      : (side === WHITE ? 'You' : 'Machine');
  }
}

function renderChaos() {
  const rows = game.log.slice(0, 14).map((e) => {
    if (e.skip) return `<li><span class="mark skip">✕</span><span><span class="who">${e.side === WHITE ? 'White' : 'Black'}</span>` +
      `<span class="what">${e.text}</span></span><span class="pt minus">stuck</span></li>`;
    const mine = e.side === 'Black';
    const mark = e.cap ? '<span class="mark take">◆</span>' : '<span class="mark quiet">·</span>';
    const what = e.cap
      ? `<b>${e.kind}</b> moved as a ${e.as} and took the ${e.cap.replace(/^(white|black) /, '')}`
      : `<b>${e.kind}</b> moved as a ${e.as}, ${e.from}→${e.to}`;
    const pt = e.cap ? `<span class="pt plus">+1 pt</span>` : `<span class="pt">${e.n}</span>`;
    return `<li>${mark}<span><span class="who">${mine ? 'EGO' : 'You'}</span><span class="what">${what}</span></span>${pt}</li>`;
  });
  $('chaos').innerHTML = rows.join('') ||
    '<li><span class="mark quiet">·</span><span><span class="who">System</span>' +
    '<span class="what">Nothing questionable has happened yet.</span></span><span class="pt">0</span></li>';
}

function renderBelief() {
  const bars = $('beliefBars');
  bars.innerHTML = '';
  if (!agent.belief) return;
  const ranked = agent.belief.ranked().slice(0, 6);
  const top = ranked.length ? ranked[0][1] : 1;
  for (const [pid, p] of ranked) {
    const at = findPidSquare(pid);
    const label = at >= 0 ? `your ${KIND_NAME[game.board.kind[at]]} on ${sqName(at)}` : 'a piece already taken';
    bars.appendChild(barRow(label, p, p / Math.max(top, 1e-9), ''));
  }
  $('beliefNote').textContent = `${agent.belief.entropy().toFixed(2)} bits · ${agent.belief.eliminated.size} ruled out`;
}

function renderObjective() {
  const bars = $('objBars');
  bars.innerHTML = '';
  const post = agent.objective.posterior();
  for (const h of HYPOTHESES) {
    const p = post.get(h.id) || 0;
    bars.appendChild(barRow(h.label, p, p, p < 0.02 ? 'dead' : (h.id === 'secret' ? '' : 'cold')));
  }
  $('objNote').textContent = agent.objective.events
    ? `${agent.objective.events} clues · ${agent.objective.games} games remembered`
    : 'no evidence yet';
}

function barRow(label, value, width, variant) {
  const row = document.createElement('div');
  row.className = 'bar-row';
  row.innerHTML = `<span class="track"><span class="fill ${variant}" style="width:${Math.max(0, Math.min(1, width)) * 100}%"></span>` +
    `<span class="cap">${label}</span></span><span class="val">${(value * 100).toFixed(1)}%</span>`;
  return row;
}

function renderStats() {
  const s = agent.stats();
  const rows = [
    ['Observations', s.observations], ['Questions asked', s.probes],
    ['Answered yes', `${Math.round(s.hitRate * 100)}%`], ['Curiosity', s.curiosity.toFixed(2)],
    ['Fallback turns', `${s.fallbacks}/${s.turns}`], ['Rolls made', game.measured],
  ];
  $('stats').innerHTML = rows.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  $('masksNote').textContent = `${s.observations} observations`;
}

function renderMoveNote() {
  const note = $('moveNote');
  if (phase !== 'play') { note.textContent = 'Waiting to begin'; return; }
  if (selected !== null) {
    const pid = game.board.pid[selected];
    note.textContent = `Your ${KIND_NAME[game.board.kind[selected]]} moves like a ${KIND_NAME[game.rolled[pid]]} this turn`;
  } else note.textContent = 'Select a piece. Take a guess.';
}

function setStatus(text) { $('statusLine').textContent = text; }

function renderAll() {
  renderBoard();
  renderMoveNote();
  renderPlayers();
  renderChaos();
  renderBelief();
  renderObjective();
  renderStats();
  renderEgo();
  masks.render(agent.rules);
  curve.render();
  $('turnCount').textContent = 'Turn ' + String(game.ply).padStart(2, '0');
  if (phase === 'play') setStatus(game.turn === WHITE ? 'Your move' : 'EGO is experimenting…');
}

function findPidSquare(pid) {
  for (let i = 0; i < 64; i++) if (game.board.pid[i] === pid) return i;
  return -1;
}

/* ---------------- curtains and endings ---------------- */

function secretLabel(side) {
  const at = findPidSquare(game.secret[side]);
  return at >= 0 ? `the ${KIND_NAME[game.board.kind[at]]} on ${sqName(at)}` : 'a piece already captured';
}

function miniBoard(side) {
  let html = '<div class="board" style="margin:0 auto;">';
  for (let i = 0; i < 64; i++) {
    const kind = game.board.kind[i], color = game.board.color[i];
    const isSecret = color === side && game.board.pid[i] === game.secret[side];
    html += `<div class="square${(rowOf(i) + colOf(i)) % 2 === 0 ? ' light' : ''}${isSecret ? ' ring' : (kind ? ' dim' : '')}">`;
    if (kind) html += `<span class="glyph ${color === WHITE ? 'w' : 'b'}">${GLYPH[kind]}</span>`;
    html += '</div>';
  }
  return html + '</div>';
}

function showCurtain(after) {
  curtainState = { shown: false, after };
  drawCurtain();
  $('curtainOv').classList.add('on');
}

function drawCurtain() {
  const panel = $('curtainPanel');
  if (!curtainState.shown) {
    panel.innerHTML = '<p class="verdict">Classified</p><h2>Only you should see this.</h2>' +
      '<p class="lede">Your secret piece is about to be shown. Anyone reading over your shoulder will know exactly what to hunt.</p>' +
      '<button class="btn primary" id="curtainGo" type="button">Show me</button>';
    $('curtainGo').addEventListener('click', () => { curtainState.shown = true; drawCurtain(); });
  } else {
    panel.innerHTML = '<p class="verdict">Your secret piece</p><h2>Protect this one.</h2>' +
      `<div class="mini">${miniBoard(WHITE)}</div><p class="secret-name">${secretLabel(WHITE)}</p>` +
      '<p>If EGO takes it, it wins — and for most of the game it will have no idea that is what it was hunting.</p>' +
      '<button class="btn primary" id="curtainDone" type="button">Hide it and play</button>';
    $('curtainDone').addEventListener('click', () => {
      $('curtainOv').classList.remove('on');
      const fn = curtainState.after; curtainState = null;
      if (fn) fn();
    });
  }
}

function finish() {
  phase = 'over';
  agent.objective.gameFinished();
  saveObjective();
  const won = game.winner === WHITE;
  const draw = !game.winner;
  const best = agent.objective.best();

  const rows = [WHITE, BLACK].map((side) => {
    const h = game.secretHome[side];
    return `<div class="reveal-row"><span class="pc ${side === WHITE ? 'w' : 'b'}">${GLYPH[h.kind]}</span>` +
      `<span>${side === WHITE ? 'Your' : "EGO's"} secret was the <b>${KIND_NAME[h.kind]}</b> that started on <b>${h.at}</b>.</span></div>`;
  }).join('');

  $('overPanel').innerHTML = '<p class="verdict">Result</p>' +
    `<h2>${draw ? 'Nobody can move.' : won ? 'You win.' : 'EGO wins.'}</h2>` +
    `<p class="lede">${draw ? 'Both sides rolled themselves into a corner. Inconclusive.'
      : won ? 'You found its secret piece. It never did work out which of yours to hunt.'
      : 'It took your secret piece. Whether it meant to is a separate question.'}</p>` + rows +
    `<div class="reveal-row"><span>It made <b>${agent.rules.observations}</b> observations, asked <b>${agent.probesSpent}</b> questions, and finished predicting legal moves with <b>${Math.round(accuracy * 100)}%</b> accuracy — against 50% for knowing nothing.</span></div>` +
    `<div class="reveal-row"><span>Best guess at the win condition: <b>${best.label.toLowerCase()}</b>, at ${Math.round(best.p * 100)}%.</span></div>` +
    '<button class="btn primary" id="overNew" type="button">Play again</button>';
  $('overNew').addEventListener('click', () => newGame(randomSeed()));
  $('overOv').classList.add('on');
  setStatus(draw ? 'Stalemate' : won ? 'You win' : 'EGO wins');
}

function saveObjective() { try { localStorage.setItem(STORE_KEY, agent.objective.save()); } catch { /* private mode */ } }
function loadObjective() { try { return localStorage.getItem(STORE_KEY); } catch { return null; } }

/* ---------------- boot ---------------- */

function newGame(seed) {
  $('overOv').classList.remove('on');
  $('curtainOv').classList.remove('on');
  $('feed').innerHTML = '';
  start(seed);
  $('introOv').classList.add('on');
}

buildBoard();
masks = new MasksView($('masks'));
curve = new ChartView($('curve'));

$('beginBtn').addEventListener('click', () => {
  $('introOv').classList.remove('on');
  showCurtain(() => { phase = 'play'; renderAll(); });
});
$('peekBtn').addEventListener('click', () => { if (phase === 'play') showCurtain(() => renderAll()); });
$('beliefBtn').addEventListener('click', (e) => {
  showBelief = !showBelief;
  e.currentTarget.setAttribute('aria-pressed', String(showBelief));
  renderBoard();
});
$('rulesBtn').addEventListener('click', () => $('rulesOv').classList.add('on'));
$('rulesClose').addEventListener('click', () => $('rulesOv').classList.remove('on'));
$('newBtn').addEventListener('click', () => newGame(randomSeed()));
$('seed').addEventListener('change', (e) => { const v = e.target.value.trim(); if (v) newGame(v); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $('rulesOv').classList.remove('on');
  selected = null; legal = []; renderBoard(); renderMoveNote();
});
addEventListener('resize', () => curve.render());

newGame(randomSeed());
