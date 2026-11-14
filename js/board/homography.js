// From a camera's picture of the board to places on the board. A flat board seen
// by a camera at any angle is a homography: a 3x3 matrix H taking a pixel (u, v)
// to the board's (x, y) as (H [u v 1]) divided by its third part. Four points
// whose places are known in both (the board's corners) fix it. No DOM: the tests run it.

/** The homography taking each of four `from` points [u, v] to its `to` point [x, y]. */
export function homography(from, to) {
  // Eight unknowns (h33 = 1), two equations per point pair (the usual direct linear transform).
  const rows = [], rhs = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = from[i], [x, y] = to[i];
    rows.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    rhs.push(x);
    rows.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    rhs.push(y);
  }
  const h = solve(rows, rhs);
  if (!h) throw new Error('Those four points do not make a quadrilateral: three of them are in a line.');
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

/** Where H takes the point [u, v]. */
export function apply(H, [u, v]) {
  const w = H[2][0] * u + H[2][1] * v + H[2][2];
  return [(H[0][0] * u + H[0][1] * v + H[0][2]) / w, (H[1][0] * u + H[1][1] * v + H[1][2]) / w];
}

/** The homography going the other way. */
export function invert(H) {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  const m = [
    [A, -(b * i - c * h), b * f - c * e],
    [B, a * i - c * g, -(a * f - c * d)],
    [C, -(a * h - b * g), a * e - b * d],
  ];
  return m.map((row) => row.map((v) => v / det));
}

// Gaussian elimination with partial pivoting; null if the system has no single answer.
function solve(rows, rhs) {
  const n = rows.length, m = rows.map((r, i) => [...r, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j <= n; j++) m[r][j] -= k * m[c][j];
    }
  }
  return m.map((r, i) => r[n] / r[i]);
}
