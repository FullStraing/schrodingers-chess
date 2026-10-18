# Schrödinger's Chess

A chess variant where every piece is randomly reassigned a way of moving at the
start of each turn, you win by capturing a secret piece neither player can see,
and the opponent is a machine that was never told any of the rules.

Built for a hackathon on the theme *Impractical Inventions*.

## Running it

```sh
./start.sh
```

Opens at `http://127.0.0.1:8777/`. No install, no build step, no dependencies —
it is plain ES modules served by the Python that ships with macOS. A server is
needed only because browsers refuse to load modules from `file://`.

```sh
node test/run.js      # every experiment and test below
```

## The idea

Normal chess engines are given the rules and search. Here the rules genuinely
change every turn, so there is a real inference problem rather than an invented
one: the agent is handed a label each turn ("this piece moves as a knight") and
has to work out what the label *does*.

It learns three separate things, and all three are on screen while you play.

### Layer 1 — what the movement types mean

One logistic regression per movement type:

```
logit P(legal) = bias + wOrbit[orbit(d)] + wCell[d] + wTarget[target] + wClear[clear]
```

The orbit term is what makes this converge inside a single game. Displacements
related by a rotation or reflection are the same fact about a piece, so they
share a weight: the 225 possible displacements collapse to **36 orbits** under
the dihedral group D₄, and seeing a knight jump once teaches all eight jumps at
the same time. `wCell` is a per-square residual held near zero by L2, so
symmetry is the default explanation and only persistent counter-evidence breaks
it — which is exactly what happens with pawns, where forward is legal and
backward is not. Fitting is AdaGrad, because some orbits are seen constantly
and others almost never.

The agent also learns things that are not geometry: that it cannot land on its
own pieces, that some types are stopped by pieces in the way and some jump over
them, and that pawns capture on squares they cannot move to.

### Layer 2 — what wins

The agent is not told the win condition. It keeps a posterior over four
explanations and updates it from what it sees. Most of the work is done by
events that are *not* the end of a game: the first capture that fails to end
things kills "any capture wins", and a captured king that changes nothing kills
"take the king". Both usually happen in the first dozen moves. What it believes
is saved between games.

### Layer 3 — which piece is yours

A posterior over your sixteen pieces, from two kinds of evidence. Hard: every
capture that does not win proves that piece was not the secret, so the mass
redistributes. Soft: people protect what they cannot afford to lose, so after
each of your moves it measures how much you changed each piece's exposure —
using its own learned movement model, which means this layer is only ever as
good as Layer 1.

### Acting

It gets a small budget of yes/no questions per turn ("may I move this there?")
and must commit to a move afterwards. Probes go where the model is least
certain, damped by how well that part of the space is already covered.

## What was measured

Everything below is reproducible with `node test/run.js`.

| | |
|---|---|
| Balanced accuracy after one game | **50% → 85–98%** |
| Mask fidelity after one game | pawn and knight ~100%, sliders 90%+ |
| D₄ compression | 225 displacements → 36 orbits |

Accuracy is measured each move on a fresh balanced sample of legal and illegal
moves. The balance matters: roughly one candidate move in thirty is legal, so a
model that answered "illegal" to everything would score 97% on the raw
distribution while having learned nothing. On a balanced sample, knowing
nothing scores 50%.

**Probe selection, 400 probes, 30 seeds** (`test/probe-strategy.js`):

| strategy | mask fidelity | balanced accuracy |
|---|---|---|
| uncertainty sampling | **95.0% ± 7.1** | 87.4% |
| + count bonus (β=0.15) | **95.6% ± 4.2** | 84.9% |
| random probing | 91.0% ± 5.1 | 76.2% |
| coverage only, model ignored | 89.8% ± 4.6 | 71.5% |

Two findings worth keeping:

- **With no probe budget at all the agent never gets past 50%.** Watching legal
  moves teaches it what is allowed but never what is forbidden. It has to try
  illegal moves to learn that they are illegal.
- **The first version of the probe comparison was confounded and said the
  opposite.** A better-informed agent captures the secret sooner, the game ends
  earlier, and it collects roughly half the observations — so end-of-game model
  quality was measuring game length as much as learning. `test/probe-strategy.js`
  fixes the data budget; `test/active-learning.js` keeps the confounded version
  and prints the observation gap that causes it.

## Layout

```
src/core/      the game and the environment
  rng.js       xorshift128+, so a seed replays a game exactly
  geometry.js  board indexing and the D4 group
  rules.js     ground truth — how pieces actually move
  game.js      state machine, turn flow, the probe oracle
src/agent/     the learner. Does NOT import src/core/rules.js
  rule-model.js       Layer 1
  objective-model.js  Layer 2
  belief-model.js     Layer 3
  policy.js           probe selection and move choice
  agent.js            the three layers plus a turn
src/eval/      instrumentation. Allowed to see ground truth; the agent is not
src/ui/        board, masks, curve, panels
test/          experiments and the end-to-end UI run
```

The one-directional import graph is the point: `src/agent/` cannot reach
`src/core/rules.js`, so "the agent does not know the rules" is a property you
can check rather than a claim you have to take on faith. Its only channel to
the environment is `game.probe(from, to, type)`, which answers one yes/no
question and publishes the answer as an observation.
