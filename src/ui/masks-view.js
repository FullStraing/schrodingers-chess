// What the agent thinks each movement type can do, drawn as a 15x15 field of
// displacements with the piece at the centre and "forward" pointing up.
//
// Cold blue means it believes the move is illegal, brass that it is legal, and
// the flat middle tone means it has no opinion yet. At the start every panel is
// a uniform middle tone. Watching a knight's eight jumps separate out of that
// grey is the whole point of this screen.

import { rgb, lerp } from './theme.js';
import { MOVE_TYPES, TYPE_NAMES } from '../agent/observable.js';
import { maskFidelity } from '../eval/metrics.js';

const GRID = 15;
const CENTRE = 7;

export class MasksView {
  constructor(root) {
    this.root = root;
    this.cells = new Map();
    for (const type of MOVE_TYPES) {
      const wrap = document.createElement('div');
      wrap.className = 'mask';
      const canvas = document.createElement('canvas');
      canvas.width = GRID; canvas.height = GRID;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Learned movement field for ${TYPE_NAMES[type]}`);
      const name = document.createElement('span');
      name.className = 'mask-name';
      name.textContent = TYPE_NAMES[type];
      const meta = document.createElement('span');
      meta.className = 'mask-meta';
      meta.textContent = '0 obs';
      wrap.append(canvas, name, meta);
      this.root.appendChild(wrap);
      this.cells.set(type, { canvas, meta, ctx: canvas.getContext('2d') });
    }
  }

  render(ruleModel, { showFidelity = true } = {}) {
    const cold = rgb('--cyan-dim');
    const mid = rgb('--card-3');
    const warm = rgb('--pink');
    const edge = rgb('--text-3');

    for (const type of MOVE_TYPES) {
      const { ctx, meta } = this.cells.get(type);
      const { values, observations } = ruleModel.mask(type);
      const img = ctx.createImageData(GRID, GRID);

      for (let py = 0; py < GRID; py++) {
        for (let px = 0; px < GRID; px++) {
          // Display row 0 is the furthest square forward, so the relative row
          // runs downward from +7 while the pixel row runs from the top.
          const d = (GRID - 1 - py) * GRID + px;
          const o = (py * GRID + px) * 4;
          let c;
          if (px === CENTRE && py === CENTRE) {
            c = edge;
          } else {
            const p = values[d];
            c = p >= 0.5 ? lerp(mid, warm, (p - 0.5) * 2) : lerp(mid, cold, (0.5 - p) * 2);
          }
          img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);

      if (showFidelity && observations > 0) {
        const f = maskFidelity(ruleModel, type);
        meta.innerHTML = `${observations} obs · <span class="fid">${Math.round(f * 100)}%</span>`;
      } else {
        meta.textContent = `${observations} obs`;
      }
    }
  }
}
