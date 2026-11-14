// What a sensor on the wrist reads while the hand writes in the air, and how
// those readings are prepared for the network. The same sums as
// train/synth.py; tests/read.mjs checks the two agree. No DOM.
//
// Axes: x right, y up, z toward the writer. Metres, seconds, m/s^2, rad/s.

export const G = 9.80665;
export const RATE = 100;
export const STEPS = 96;   // every character is stretched or squeezed to this many steps
const DT = 1 / RATE;
const SMOOTH = 3;          // samples: a hand cannot move faster than this blur allows
const REST = 8;            // samples of stillness kept either side of a character

// 3 x 3 matrices as flat arrays, row by row.
const mul = (a, b) => {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
};
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const applyT = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];

// Gaussian blur along time, holding the ends where they are.
export function blur(path, sigma = SMOOTH) {
  const half = Math.ceil(sigma * 3), k = [];
  let sum = 0;
  for (let i = -half; i <= half; i++) { k.push(Math.exp(-0.5 * (i / sigma) ** 2)); sum += k[k.length - 1]; }
  const n = path.length;
  return path.map((_, i) => {
    const o = [0, 0, 0];
    for (let j = -half; j <= half; j++) {
      const p = path[Math.max(0, Math.min(n - 1, i + j))], w = k[j + half] / sum;
      o[0] += p[0] * w; o[1] += p[1] * w; o[2] += p[2] * w;
    }
    return o;
  });
}

// Sensor readings for a hand moving along `path` ([x, y, z] per sample,
// already smooth). The forearm swings about a joint `arm` metres away, so
// moving the hand also turns the sensor. `pose` is the sensor's [roll, pitch,
// yaw] at the start. Returns [ax, ay, az, gx, gy, gz] per sample.
export function wrist(path, pose, arm, twist = 0) {
  const base = mul(mul(rotY(pose[2]), rotX(pose[1])), rotZ(pose[0]));
  const turn = path.map((p) => {
    const x = p[0] - path[0][0], y = p[1] - path[0][1];
    return mul(mul(mul(base, rotY(-x / arm)), rotX(y / arm)), rotZ((twist * x) / arm)); // sensor -> world
  });
  const n = path.length, at = (i) => path[Math.max(0, Math.min(n - 1, i))];
  return path.map((p, i) => {
    // Acceleration from the positions either side, plus the push that holds
    // the sensor up against gravity; then into the sensor's own axes.
    const a = [0, 1, 2].map((k) => (at(i + 1)[k] - 2 * p[k] + at(i - 1)[k]) / (DT * DT));
    a[1] += G;
    // Turn rate from the turn made since the last sample.
    const prev = turn[Math.max(0, i - 1)], now = turn[i], step = new Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) step[r * 3 + c] = prev[r] * now[c] + prev[3 + r] * now[3 + c] + prev[6 + r] * now[6 + c];
    return [...applyT(now, a), (step[7] - step[5]) / (2 * DT), (step[2] - step[6]) / (2 * DT), (step[3] - step[1]) / (2 * DT)];
  });
}

// Readings for one character, as the 6 x STEPS array the network takes (one
// channel after another). However the sensor is strapped on, gravity says
// which way is up: the readings are turned so that up is the same axis every
// time. Gravity and any steady offset are then taken out of the
// accelerometer, and the whole thing is resampled to a fixed length.
export function features(imu) {
  const n = imu.length;
  let up = [0, 0, 0];
  for (const s of imu) { up[0] += s[0] / n; up[1] += s[1] / n; up[2] += s[2] / n; }
  const len = Math.hypot(...up) + 1e-12;
  up = up.map((v) => v / len);
  // The shortest turn taking `up` onto the y axis (Rodrigues' formula).
  const axis = [up[2], 0, -up[0]], s = Math.hypot(...axis), c = up[1];
  let level;
  if (s < 1e-9) level = c > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, -1, 0, 0, 0, -1];
  else {
    const k = axis.map((v) => v / s), K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0], K2 = mul(K, K);
    level = [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v, i) => v + s * K[i] + (1 - c) * K2[i]);
  }
  let x = imu.map((r) => [...apply(level, r.slice(0, 3)), ...apply(level, r.slice(3, 6))]);
  const mean = [0, 0, 0];
  for (const r of x) for (let k = 0; k < 3; k++) mean[k] += r[k] / n;
  x = x.map((r) => [(r[0] - mean[0]) / 4, (r[1] - mean[1]) / 4, (r[2] - mean[2]) / 4, r[3], r[4], r[5]]);
  // Average over a window as wide as the step being taken, then sample.
  const w = Math.max(1, Math.floor(n / STEPS + 0.5));
  if (w > 1) {
    const lead = (w - 1) >> 1, src = x;
    x = src.map((_, i) => {
      const o = [0, 0, 0, 0, 0, 0];
      for (let j = i - lead; j < i - lead + w; j++) { const r = src[Math.max(0, Math.min(n - 1, j))]; for (let k = 0; k < 6; k++) o[k] += r[k] / w; }
      return o;
    });
  }
  const out = new Float32Array(6 * STEPS);
  for (let t = 0; t < STEPS; t++) {
    const at = (t * (n - 1)) / (STEPS - 1), lo = Math.floor(at), hi = Math.min(lo + 1, n - 1), f = at - lo;
    for (let k = 0; k < 6; k++) out[k * STEPS + t] = x[lo][k] * (1 - f) + x[hi][k] * f;
  }
  return out;
}

// A cursor's trail as a hand in the air. `trail` is [x, y, ms] points in
// screen pixels (y down), in time order, from the first touch to the last
// lift; `box` is the drawing's bounding box in pixels. The larger side of the
// character becomes `size` metres. Returns positions at RATE.
export function airPath(trail, box, size = 0.2) {
  const scale = size / Math.max(box.w, box.h, 1), t0 = trail[0][2], t1 = trail[trail.length - 1][2];
  const n = Math.max(2, Math.round(((t1 - t0) / 1000) * RATE) + 1), path = [];
  for (let i = 0; i < REST; i++) path.push([0, 0, 0]);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i * 1000) / RATE;
    while (j < trail.length - 2 && trail[j + 1][2] <= t) j++;
    const a = trail[j], b = trail[Math.min(j + 1, trail.length - 1)], f = b[2] > a[2] ? Math.max(0, Math.min(1, (t - a[2]) / (b[2] - a[2]))) : 0;
    path.push([(a[0] + (b[0] - a[0]) * f - trail[0][0]) * scale, -(a[1] + (b[1] - a[1]) * f - trail[0][1]) * scale, 0]);
  }
  const last = path[path.length - 1];
  for (let i = 0; i < REST; i++) path.push([...last]);
  return blur(path);
}
