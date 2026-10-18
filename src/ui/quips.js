// EGO's commentary. Every line is triggered by a real number coming out of the
// agent — rejected probes, a jump in accuracy, a suspect ruled out — so the
// personality is a readout, not set dressing. Rules are checked in order and
// the first match that is not a repeat of the last line wins.

const RULES = [
  {
    when: (s) => s.rejectedStreak >= 10,
    say: (s) => `${s.rejectedStreak} refusals in a row. My next theory will be delivered in a smaller font.`,
  },
  {
    when: (s) => s.turnProbes >= 6 && s.turnHits === 0,
    say: (s) => `I asked ${s.turnProbes} times this turn. Apparently the pieces are screening my calls.`,
  },
  {
    when: (s) => s.accuracyJump >= 0.08,
    say: (s) => `Something just clicked. I now get ${Math.round(s.accuracy * 100)}% of these right. Don't make it weird.`,
  },
  {
    when: (s) => s.tookSecret,
    say: () => `I took the one that mattered. I want it on record that I did not know that.`,
  },
  {
    when: (s) => s.captured,
    say: (s) => `Took your ${s.captured}. No idea whether that helped.`,
  },
  {
    when: (s) => s.lostPiece,
    say: (s) => `You took my ${s.lostPiece}. I had plans for it. Vague ones.`,
  },
  {
    when: (s) => s.eliminatedJust,
    say: (s) => `Not that one, then. ${s.suspects} suspects left.`,
  },
  {
    when: (s) => s.bestType && s.bestFidelity >= 0.95,
    say: (s) => `I have the ${s.bestType} worked out. One down, five to go, no applause necessary.`,
  },
  {
    when: (s) => s.objectiveFlip,
    say: (s) => `Scratch that theory. Now I think it ends when ${s.objectiveShort}.`,
  },
  {
    when: (s) => s.turnHits >= 4,
    say: (s) => `${s.turnHits} of ${s.turnProbes} allowed. I am becoming insufferable.`,
  },
  {
    when: (s) => s.observations < 40,
    say: () => `Thirty-two pieces, zero instructions. Standard onboarding, I assume.`,
  },
  {
    when: (s) => s.accuracy < 0.6,
    say: (s) => `Current understanding: ${Math.round(s.accuracy * 100)}%. Statistically, a coin resents me.`,
  },
  {
    when: () => true,
    say: (s) => `${s.observations} observations in. Forming an unsupported theory.`,
  },
];

// Mood drives the face and the status line, and is read off the same numbers.
export function mood(s) {
  if (s.tookSecret) return { face: '🏆', state: 'Victorious · still confused' };
  if (s.rejectedStreak >= 10) return { face: '😤', state: 'Meltdown · loudly unqualified' };
  if (s.accuracy >= 0.85) return { face: '😎', state: 'Dangerous · briefly competent' };
  if (s.accuracy >= 0.7) return { face: '🤓', state: 'Theorising · mostly right' };
  if (s.observations < 40) return { face: '🫠', state: 'Booting · knows nothing' };
  return { face: '🤔', state: 'Experimenting · tolerating failure' };
}

export function nextQuip(signals, lastLine) {
  for (const rule of RULES) {
    if (!rule.when(signals)) continue;
    const line = rule.say(signals);
    if (line !== lastLine) return line;
  }
  return null;
}
