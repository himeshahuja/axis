// Fake sensor data: a hand draws a shape in the air, and this works out what
// an accelerometer and gyroscope strapped to it would have read, noise and
// bias included. The true path is kept so the result can be checked.

import { G, qaxis, qconj, qmul, qnorm, qrot } from './fusion.js';

// Shapes are strokes of [x, y] points in metres, joined by a smooth curve.
// `closed` strokes return to their first point.
const ring = (cx, cy, r, n = 12, from = Math.PI / 2) =>
  Array.from({ length: n }, (_, i) => [cx + r * Math.cos(from + (i / n) * Math.PI * 2), cy + r * Math.sin(from + (i / n) * Math.PI * 2)]);

export const SHAPES = {
  Spiral: [{ points: Array.from({ length: 40 }, (_, i) => { const a = i * 0.48, r = 0.012 + i * 0.0048; return [r * Math.cos(a), r * Math.sin(a)]; }) }],
  Star: [{ closed: true, sharp: true, points: Array.from({ length: 5 }, (_, i) => { const a = Math.PI / 2 + i * ((4 * Math.PI) / 5); return [0.2 * Math.cos(a), 0.2 * Math.sin(a)]; }) }],
  Heart: [{ closed: true, points: Array.from({ length: 28 }, (_, i) => { const a = (i / 28) * Math.PI * 2; return [0.012 * 16 * Math.sin(a) ** 3, 0.012 * (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) + 0.03]; }) }],
  Smiley: [
    { closed: true, points: ring(0, 0, 0.2, 16) },
    { closed: true, points: ring(-0.075, 0.06, 0.022, 8) },
    { closed: true, points: ring(0.075, 0.06, 0.022, 8) },
    { points: Array.from({ length: 9 }, (_, i) => { const a = Math.PI * (1.15 + (i / 8) * 0.7); return [0.12 * Math.cos(a), 0.12 * Math.sin(a) + 0.02]; }) },
  ],
};

// A Catmull-Rom curve through the points, as a dense list with the distance
// along the curve at each entry.
function curve({ points, closed }) {
  const pts = points;
  const n = pts.length, segs = closed ? n : n - 1, at = (i) => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  for (let s = 0; s < segs; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let j = 0; j < 40; j++) {
      const u = j / 40, u2 = u * u, u3 = u2 * u;
      out.push([0, 1].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3)));
    }
  }
  out.push(closed ? [...out[0]] : [...pts[n - 1]]);
  const dist = [0];
  for (let i = 1; i < out.length; i++) dist.push(dist[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
  return { pts: out, dist, length: dist[dist.length - 1] };
}

function along(c, d) {
  let lo = 0, hi = c.dist.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c.dist[mid] <= d) lo = mid; else hi = mid; }
  const u = (d - c.dist[lo]) / (c.dist[hi] - c.dist[lo] || 1);
  return [c.pts[lo][0] + (c.pts[hi][0] - c.pts[lo][0]) * u, c.pts[lo][1] + (c.pts[hi][1] - c.pts[lo][1]) * u];
}

// A hand starts and stops gently: distance covered at fraction u of a move.
const glide = (u) => u * u * u * (10 - 15 * u + 6 * u * u);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// What the sensor reads while a hand draws `shape`.
// Returns { samples, truth }: the samples to feed a Tracker, and the path
// really taken, as { t, x, y, z, pen } measured from where it started.
export function synth(shape, { rate = 100, seed = 1, noise = 1, speed = 0.5 } = {}) {
  // A sharp stroke keeps its corners: the hand runs each side as its own
  // straight move, with a short rest at the corner and the pen still down.
  const strokes = SHAPES[shape].flatMap((st) => {
    if (!st.sharp) return [curve(st)];
    const pts = st.closed ? [...st.points, st.points[0]] : st.points;
    return pts.slice(1).map((b, i) => Object.assign(curve({ points: [pts[i], b] }), { joined: i > 0 }));
  });
  // The timeline: rest, then each stroke, with a lifted move and a rest between strokes.
  const REST = 0.7, parts = [];
  let t = 0.9, run = 0; // `run` is the distance moved so far; the hand's wobble follows it
  const first = strokes[0].pts[0];
  strokes.forEach((c, i) => {
    if (i > 0 && !c.joined) {
      const a = strokes[i - 1].pts[strokes[i - 1].pts.length - 1], b = c.pts[0];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dur = Math.max(0.5, len / speed);
      parts.push({ t0: t, dur, len, run, pen: 0, at: (d) => [a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len] });
      t += dur + REST; run += len;
    }
    const dur = Math.max(0.8, c.length / speed);
    parts.push({ t0: t, dur, len: c.length, run, pen: 1, at: (d) => along(c, d) });
    t += dur + (strokes[i + 1]?.joined ? 0.45 : REST); run += c.length;
  });
  const total = t + 0.5;

  // Where the hand is, how far it has moved, and how it is turned, at time t.
  // Held a little off level to begin with (about a level axis, so there is no heading to guess).
  const tilt = qaxis([0.8, 0, -0.6], 0.25);
  const pose = (time) => {
    let part = parts[0], d = 0;
    for (const p of parts) if (time >= p.t0) part = p;
    if (time >= part.t0) d = part.len * glide(Math.min(1, (time - part.t0) / part.dur));
    const [x, y] = part.at(d), far = part.run + d;
    const z = 0.02 * Math.sin(far * 5);
    // The wrist turns as the hand travels, and holds still when it does.
    const q = qmul(tilt, qmul(qaxis([0, 1, 0], 0.4 * Math.sin(far * 4)), qmul(qaxis([1, 0, 0], 0.3 * Math.sin(far * 6.2)), qaxis([0, 0, 1], 0.35 * Math.sin(far * 3.1)))));
    return { p: [x - first[0], y - first[1], z], q: qnorm(q), pen: time >= part.t0 && time <= part.t0 + part.dur ? part.pen : 1 };
  };

  const rand = mulberry(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const accelBias = [0.03, -0.02, 0.025].map((b) => b * noise), gyroBias = [0.012, -0.008, 0.01].map((b) => b * noise);
  const dt = 1 / rate, n = Math.round(total * rate);
  const samples = [], truth = [];
  let prev = pose(-dt);
  for (let i = 0; i < n; i++) {
    const time = i * dt, now = pose(time), next = pose(time + dt);
    // Acceleration from the positions either side; the accelerometer feels it
    // along with the push holding it up against gravity.
    const a = [0, 1, 2].map((k) => (next.p[k] - 2 * now.p[k] + prev.p[k]) / (dt * dt));
    a[1] += G;
    const f = qrot(qconj(now.q), a);
    // Turn rate from the turn made since the last sample.
    const dq = qmul(qconj(prev.q), now.q), s = Math.hypot(dq[1], dq[2], dq[3]);
    const angle = 2 * Math.atan2(s, dq[0]), w = s < 1e-12 ? [0, 0, 0] : [dq[1], dq[2], dq[3]].map((c) => ((c / s) * angle) / dt);
    samples.push({
      t: time,
      ax: f[0] + accelBias[0] + gauss() * 0.04 * noise, ay: f[1] + accelBias[1] + gauss() * 0.04 * noise, az: f[2] + accelBias[2] + gauss() * 0.04 * noise,
      gx: w[0] + gyroBias[0] + gauss() * 0.003 * noise, gy: w[1] + gyroBias[1] + gauss() * 0.003 * noise, gz: w[2] + gyroBias[2] + gauss() * 0.003 * noise,
      pen: now.pen,
    });
    truth.push({ t: time, x: now.p[0], y: now.p[1], z: now.p[2], pen: now.pen });
    prev = now;
  }
  return { samples, truth };
}
