// xorshift128+ instead of Math.random() so a game can be replayed from its seed.
// Every random draw in the project goes through here: piece rolls, secret
// selection, the agent's exploration, the Monte Carlo rollouts.

export class Rng {
  constructor(seed) {
    // SplitMix64-style scramble so that neighbouring seeds ("1", "2") don't
    // produce correlated streams.
    let h = 0x9e3779b9 ^ hashString(String(seed));
    this.s0 = mix(h);
    this.s1 = mix(this.s0);
    this.s2 = mix(this.s1);
    this.s3 = mix(this.s2);
    this.seed = String(seed);
    this.draws = 0;
  }

  // xorshift128+ returns a 32-bit word; we take 53 bits across two calls only
  // where real precision matters, which is nowhere here, so one word is fine.
  next() {
    this.draws++;
    let t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = (this.s3 << 11) | (this.s3 >>> 21);
    return (this.s0 + this.s3) >>> 0;
  }

  float() { return this.next() / 4294967296; }
  int(n) { return this.next() % n; }
  pick(arr) { return arr[this.int(arr.length)]; }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Sample an index from unnormalised weights.
  weighted(weights) {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    if (total <= 0) return this.int(weights.length);
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  fork(tag) { return new Rng(this.seed + ':' + tag + ':' + this.next()); }
}

function mix(x) {
  x = (x ^ (x >>> 16)) >>> 0;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function randomSeed() {
  const bytes = new Uint32Array(2);
  (globalThis.crypto || require('crypto').webcrypto).getRandomValues(bytes);
  return (bytes[0].toString(36) + bytes[1].toString(36)).slice(0, 9);
}
