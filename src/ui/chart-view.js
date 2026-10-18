// The learning curve. One line, one baseline, no decoration.
//
// The baseline is at 50% because accuracy is measured on a balanced sample of
// legal and illegal moves; a model that knows nothing sits on that line. The
// distance between the line and the curve is the entire claim of the project,
// so it is drawn plainly and labelled.

import { fitCanvas, token } from './theme.js';

export class ChartView {
  constructor(canvas, { height = 150, yLabel = 'balanced accuracy' } = {}) {
    this.canvas = canvas;
    this.height = height;
    this.yLabel = yLabel;
    this.series = [];
  }

  push(point) { this.series.push(point); }
  clear() { this.series = []; }

  render() {
    const width = this.canvas.clientWidth || 420;
    const ctx = fitCanvas(this.canvas, width, this.height);
    const padL = 34, padR = 10, padT = 10, padB = 20;
    const w = width - padL - padR, h = this.height - padT - padB;

    ctx.clearRect(0, 0, width, this.height);
    ctx.fillStyle = token('--card-3');
    ctx.fillRect(0, 0, width, this.height);

    const yOf = (v) => padT + h - ((v - 0.4) / 0.62) * h;  // 0.40 .. 1.02
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'middle';

    for (const v of [0.5, 0.75, 1.0]) {
      const y = yOf(v);
      ctx.strokeStyle = v === 0.5 ? token('--line-2') : token('--line');
      ctx.setLineDash(v === 0.5 ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = token('--text-3');
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(v * 100) + '%', padL - 6, y);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = token('--text-3');
    ctx.fillText('knows nothing', padL + 4, yOf(0.5) - 8);

    if (this.series.length < 2) {
      ctx.fillStyle = token('--text-3');
      ctx.textAlign = 'center';
      ctx.fillText('waiting for the first moves', padL + w / 2, padT + h / 2);
      return;
    }

    const maxX = Math.max(this.series[this.series.length - 1].x, 10);
    const xOf = (x) => padL + (x / maxX) * w;

    ctx.strokeStyle = token('--pink');
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    this.series.forEach((p, i) => {
      const x = xOf(p.x), y = yOf(Math.max(0.4, Math.min(1.02, p.y)));
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const last = this.series[this.series.length - 1];
    ctx.fillStyle = token('--pink');
    ctx.beginPath();
    ctx.arc(xOf(last.x), yOf(Math.max(0.4, Math.min(1.02, last.y))), 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'right';
    ctx.fillStyle = token('--text-2');
    ctx.fillText(Math.round(last.y * 100) + '%', padL + w, yOf(Math.max(0.4, Math.min(1.02, last.y))) - 10);
    ctx.textAlign = 'center';
    ctx.fillStyle = token('--text-3');
    ctx.fillText('moves played', padL + w / 2, this.height - 6);
  }
}
