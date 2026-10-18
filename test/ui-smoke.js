// Runs the real interface end to end against a stub DOM: deal the secrets,
// walk through the curtain, then play a full game of alternating human and
// agent moves. Catches the kind of bug that only appears when every render
// path actually executes.

const TOKENS = {
  '--cold': '#3C5A6E', '--surface-2': '#DEDAD0', '--brass': '#9A6B1E', '--ink-3': '#8A8F9C',
  '--line': '#CBC5B8', '--line-2': '#B8B1A2', '--ink-2': '#565D6F', '--ink': '#191E2A',
};

function ctx2d() {
  const noop = () => {};
  return {
    setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop, moveTo: noop,
    lineTo: noop, stroke: noop, arc: noop, fill: noop, fillText: noop, setLineDash: noop,
    putImageData: noop,
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '',
  };
}

let created = 0;
function El(tag = 'div') {
  created++;
  const el = {
    tag, dataset: {}, style: {}, className: '', value: '', textContent: '', _html: '',
    _children: [], _listeners: {}, _classes: new Set(), _attrs: {},
    clientWidth: 420, width: 0, height: 0,
    get children() { return this._children; },
    get firstChild() { return this._children[0] || null; },
    get lastChild() { return this._children[this._children.length - 1] || null; },
    set innerHTML(v) { this._html = v; if (v === '') this._children = []; },
    get innerHTML() { return this._html; },
    appendChild(c) { this._children.push(c); return c; },
    append(...cs) { this._children.push(...cs); },
    insertBefore(c) { this._children.unshift(c); return c; },
    removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); return c; },
    addEventListener(k, fn) { (this._listeners[k] ||= []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    getContext: () => ctx2d(),
    querySelectorAll: () => [],
    classList: {
      add(...c) { c.forEach((x) => el._classes.add(x)); },
      remove(...c) { c.forEach((x) => el._classes.delete(x)); },
      contains(c) { return el._classes.has(c); },
    },
    fire(kind, ev) { for (const fn of this._listeners[kind] || []) fn(ev || { currentTarget: this, target: this }); },
  };
  return el;
}

const byId = new Map();
globalThis.document = {
  getElementById(id) { if (!byId.has(id)) byId.set(id, El()); return byId.get(id); },
  createElement: (t) => El(t),
  addEventListener() {},
  documentElement: El(),
};
globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => TOKENS[n] || '#888888' });
globalThis.matchMedia = () => ({ matches: true, addEventListener() {} });
globalThis.addEventListener = () => {};
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; },
};
globalThis.devicePixelRatio = 2;
globalThis.window = globalThis;
// node 24 already exposes a global crypto; nothing to stub

const errors = [];

// Import failures must be loud: an earlier version of this test registered an
// uncaughtException handler, which swallowed the real error and exited 0.
try {
  await import('../src/ui/app.js');
  console.log('  app.js loaded');
} catch (e) {
  console.log('  app.js FAILED to load: ' + e.message);
  console.log(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}

const fail = (m) => { console.log('  FAIL: ' + m); errors.push(new Error(m)); };
const board = document.getElementById('board');

if (board.children.length !== 64) fail('board has ' + board.children.length + ' squares, expected 64');
if (document.getElementById('masks').children.length !== 6) fail('expected 6 mask panels');

// Deal the secrets and walk the curtain.
document.getElementById('beginBtn').fire('click');
document.getElementById('curtainGo').fire('click');
document.getElementById('curtainDone').fire('click');
console.log('  curtain flow completed');

// Pull the live game out through the module that owns it, by replaying what a
// player does: click a piece, then click a highlighted square.
const { Game } = await import('../src/core/game.js');

let plies = 0, agentTurns = 0;
for (let round = 0; round < 60; round++) {
  // Find a square whose click produces legal destinations.
  let moved = false;
  for (let i = 0; i < 64 && !moved; i++) {
    const cell = board.children[i];
    cell.fire('click', { currentTarget: cell });
    // After selecting, legal destinations carry the 'playable' class.
    const targets = [];
    for (let j = 0; j < 64; j++) {
      const c = board.children[j];
      if (j !== i && typeof c.className === 'string' && c.className.includes('playable') && c.className.includes('square')) targets.push(j);
    }
    const dots = targets.filter((j) => {
      const c = board.children[j];
      return c.className.includes('cap') || c._children.some((ch) => ch.className === 'dot');
    });
    if (dots.length) {
      const t = board.children[dots[0]];
      t.fire('click', { currentTarget: t });
      moved = true; plies++; agentTurns++;
    }
  }
  if (!moved) break;
  await new Promise((r) => setTimeout(r, 0));
  if (document.getElementById('overOv')._classes.has('on')) break;
}

console.log(`  played ${plies} human moves (agent replied to each)`);
const stats = document.getElementById('stats');
const feed = document.getElementById('feed');
const masksNote = document.getElementById('masksNote');
console.log('  masks note:', masksNote.textContent);
console.log('  feed entries rendered:', feed.children.length);
console.log('  belief rows:', document.getElementById('beliefBars').children.length);
console.log('  objective rows:', document.getElementById('objBars').children.length);
console.log('  curve note:', document.getElementById('curveNote').textContent);
console.log('  game over panel shown:', document.getElementById('overOv')._classes.has('on'));

if (plies === 0) fail('no moves were playable through the UI');
if (feed.children.length === 0) fail('experiment feed never rendered');
if (document.getElementById('beliefBars').children.length === 0) fail('belief panel never rendered');
if (!masksNote.textContent.includes('observations')) fail('masks note missing observation count');

console.log(errors.length ? `\nUI SMOKE: ${errors.length} problem(s)` : '\nUI SMOKE: clean');
if (errors.length) { for (const e of errors.slice(0, 3)) console.log('   ' + e.message); process.exit(1); }
