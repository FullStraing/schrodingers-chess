// Constants the agent is allowed to know: they describe what it can see on the
// board, not how pieces move. Duplicated here rather than imported from
// src/core/rules.js so that the agent's import graph stays clean.

export const TARGET_EMPTY = 0;
export const TARGET_ENEMY = 1;
export const TARGET_OWN = 2;
export const MOVE_TYPES = [1, 2, 3, 4, 5, 6];
export const TYPE_NAMES = { 1: 'pawn', 2: 'knight', 3: 'bishop', 4: 'rook', 5: 'queen', 6: 'king' };
