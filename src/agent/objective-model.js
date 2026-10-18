// Layer 2: working out what actually wins.
//
// The agent is not told the win condition. It watches games end and keeps a
// posterior over four competing explanations. The interesting part is that
// most of the work is done by events that are NOT the end of a game: every
// capture that fails to end it is strong evidence against "any capture wins",
// and a captured king that changes nothing kills "take the king" outright.
// Both usually happen within the first dozen moves, so this layer visibly
// moves during a single game rather than needing a long training run.

export const HYPOTHESES = [
  { id: 'any', label: 'Capturing any piece ends it' },
  { id: 'king', label: 'Capturing the king ends it' },
  { id: 'secret', label: 'One particular hidden piece ends it' },
  { id: 'clock', label: 'It ends after a set number of moves' },
];

const FLOOR = 1e-4;

export class ObjectiveModel {
  constructor(saved) {
    this.logp = new Map(HYPOTHESES.map((h) => [h.id, 0]));
    this.events = 0;
    this.games = 0;
    if (saved) this.load(saved);
  }

  posterior() {
    let max = -Infinity;
    for (const v of this.logp.values()) max = Math.max(max, v);
    const out = new Map();
    let total = 0;
    for (const [k, v] of this.logp) { const e = Math.exp(v - max); out.set(k, e); total += e; }
    for (const [k, v] of out) out.set(k, v / total);
    return out;
  }

  best() {
    let bestId = null, bestV = -1;
    for (const [k, v] of this.posterior()) if (v > bestV) { bestV = v; bestId = k; }
    return { id: bestId, p: bestV, label: HYPOTHESES.find((h) => h.id === bestId).label };
  }

  bump(id, likelihood) {
    this.logp.set(id, this.logp.get(id) + Math.log(Math.max(likelihood, FLOOR)));
  }

  // A capture happened and the game carried on.
  captureWithoutEnd({ wasKing, remaining }) {
    this.bump('any', FLOOR);
    this.bump('king', wasKing ? FLOOR : 1);
    this.bump('secret', Math.max(1 - 1 / Math.max(remaining, 1), FLOOR));
    this.bump('clock', 1);
    this.events++;
  }

  // A capture happened and the game stopped.
  captureWithEnd({ wasKing, remaining }) {
    this.bump('any', 1);
    this.bump('king', wasKing ? 1 : FLOOR);
    this.bump('secret', 1 / Math.max(remaining, 1));
    this.bump('clock', 0.02);
    this.events++;
  }

  // A move that captured nothing and ended nothing: only the clock hypothesis
  // cares, and only weakly.
  quietMove(ply) {
    if (ply > 0 && ply % 10 === 0) { this.bump('clock', 0.8); this.events++; }
  }

  gameFinished() { this.games++; }

  save() { return JSON.stringify({ logp: [...this.logp], events: this.events, games: this.games }); }

  load(raw) {
    try {
      const d = JSON.parse(raw);
      if (d && d.logp) { this.logp = new Map(d.logp); this.events = d.events || 0; this.games = d.games || 0; }
    } catch { /* a corrupt save just means starting over */ }
  }
}
