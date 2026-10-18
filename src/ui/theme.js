// Canvas drawing needs real colour values, but the palette lives in CSS custom
// properties so that light and dark themes stay in one place. These helpers
// read the tokens back out at draw time, which also means a theme switch is
// picked up on the next repaint without any extra wiring.

const cache = new Map();

export function token(name) {
  if (cache.has(name)) return cache.get(name);
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  cache.set(name, v);
  return v;
}

export function clearTokenCache() { cache.clear(); }

export function rgb(name) {
  const v = token(name);
  if (v.startsWith('#')) {
    const h = v.length === 4
      ? v.slice(1).split('').map((c) => parseInt(c + c, 16))
      : [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    return h;
  }
  const m = v.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map(Number) : [128, 128, 128];
}

export const lerp = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));

// Set up a canvas for the device pixel ratio and return a context already
// scaled to CSS pixels.
export function fitCanvas(canvas, cssWidth, cssHeight) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
