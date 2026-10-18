// Layer 3: which of the opponent's pieces is the secret one.
//
// Two kinds of evidence, combined in one posterior over the opponent's 16
// pieces.
//
// Hard: every capture that does NOT end the game proves that piece was not the
// secret, so its probability drops to zero and the mass redistributes. This is
// the fast-moving part and it is very visible on the board.
//
// Soft: people protect what they cannot afford to lose. After each opponent
// move the agent measures, for every enemy piece, how much the move changed
// that piece's exposure to capture — using its own learned movement model, so
// this layer is only as good as Layer 1. Moves that pull a piece out of danger
// raise that piece's likelihood of being the secret.


const PROTECTION_WEIGHT = 0.75;

export class BeliefModel {
  constructor(pids) {
    this.pids = pids.slice();
    this.p = new Map(this.pids.map((id) => [id, 1 / this.pids.length]));
    this.eliminated = new Set();
    this.history = [];
  }

  probability(pid) { return this.p.get(pid) || 0; }

  entropy() {
    let h = 0;
    for (const v of this.p.values()) if (v > 0) h -= v * Math.log2(v);
    return h;
  }

  ranked() {
    return [...this.p.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  }

  // A capture that did not win the game rules that piece out completely.
  eliminate(pid) {
    if (!this.p.has(pid) || this.eliminated.has(pid)) return;
    this.eliminated.add(pid);
    this.p.set(pid, 0);
    this.normalise();
    this.history.push({ kind: 'eliminated', pid, entropy: this.entropy() });
  }

  // Bayes: P(secret = i | move) proportional to P(move | secret = i) P(i),
  // with the likelihood a softmax over how much the move sheltered piece i.
  updateFromMove(before, after) {
    let total = 0;
    const like = new Map();
    for (const pid of this.pids) {
      if (this.eliminated.has(pid)) { like.set(pid, 0); continue; }
      const b = before.get(pid), a = after.get(pid);
      // A piece that left the board without ending the game is handled by
      // eliminate(); here it simply carries no new evidence.
      const delta = (b === undefined || a === undefined) ? 0 : b - a;
      const l = Math.exp(PROTECTION_WEIGHT * delta);
      like.set(pid, l);
      total += l * this.probability(pid);
    }
    if (total <= 0) return;
    for (const pid of this.pids) {
      this.p.set(pid, this.probability(pid) * like.get(pid) / total);
    }
    this.normalise();
    this.history.push({ kind: 'move', entropy: this.entropy() });
  }

  normalise() {
    let s = 0;
    for (const v of this.p.values()) s += v;
    if (s <= 0) {
      const live = this.pids.filter((id) => !this.eliminated.has(id));
      for (const id of this.pids) this.p.set(id, live.includes(id) ? 1 / live.length : 0);
      return;
    }
    for (const [k, v] of this.p) this.p.set(k, v / s);
  }
}
