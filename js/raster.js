// Turns pen strokes into the 28 x 28 picture the character reader was
// trained on: the drawing scaled to fit a 20 x 20 box in the middle, drawn
// with a soft pen about three pixels wide, white (1) on black (0).

export const SIZE = 28;

// `strokes` is a list of strokes, each a list of [x, y] with y pointing down.
export function rasterize(strokes) {
  const out = new Float32Array(SIZE * SIZE);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x0 === Infinity) return out;
  const scale = 20 / Math.max(x1 - x0, y1 - y0, 1e-6);
  const ox = SIZE / 2 - ((x0 + x1) / 2) * scale, oy = SIZE / 2 - ((y0 + y1) / 2) * scale;

  // Every stroke as line segments in picture coordinates. A lone point is a dot.
  const segs = [];
  for (const s of strokes) {
    const p = s.map(([x, y]) => [x * scale + ox, y * scale + oy]);
    if (p.length === 1) segs.push([p[0][0], p[0][1], p[0][0], p[0][1]]);
    for (let i = 1; i < p.length; i++) segs.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
  }
  // A pixel is as bright as it is close to the nearest stroke.
  const HALF = 1.3, EDGE = 1.1; // full brightness within HALF - EDGE / 2, none beyond HALF + EDGE / 2
  for (let py = 0; py < SIZE; py++) for (let px = 0; px < SIZE; px++) {
    const cx = px + 0.5, cy = py + 0.5;
    let best = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2)) : 0;
      const ex = cx - ax - dx * t, ey = cy - ay - dy * t, d2 = ex * ex + ey * ey;
      if (d2 < best) best = d2;
    }
    out[py * SIZE + px] = Math.max(0, Math.min(1, (HALF + EDGE / 2 - Math.sqrt(best)) / EDGE));
  }
  return out;
}
