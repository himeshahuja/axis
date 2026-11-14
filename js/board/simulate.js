// A pretend session at a whiteboard, with the true path kept, so the board
// tracker can be checked (tests/board.mjs) and shown without a band (board.html
// with the pretend band). What the band's motion sensor reads is worked out the
// way js/fake.js does for its shapes: acceleration from the positions either
// side of each sample, turning from the change in how the band is held, then a
// bias and noise. The readings come out in the band's own units, as the kit
// reports them: t in ms, acceleration in g (to 1 mg), turning in degrees/second
// (to 0.1).
//
// Board axes: x along the board (its left edge at 0), y up, z out of the board
// toward the writer. Metres and seconds.

import { G, qaxis, qconj, qmul, qnorm, qrot } from '../fusion.js';

const DEG = 180 / Math.PI;
const OFF = 0.03;             // metres off the board while the marker is lifted
const START_MS = 5000;        // the band's clock when a session starts
const TABLE = [0.6, 1.0, 0.45];
const START = [0.6, 1.35, OFF];

const glide = (u) => u * u * u * (10 - 15 * u + 6 * u * u);    // a hand starts and stops gently
const bump = (u) => (1 - Math.cos(2 * Math.PI * u)) / 2;       // 0, up to 1, back to 0, still at both ends
const mix = (a, b, s) => a.map((v, k) => v + (b[k] - v) * s);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A smooth curve through the points (Catmull-Rom), as a dense list with the
// distance along the curve at each entry.
function curve(points) {
  const n = points.length, at = (i) => points[Math.max(0, Math.min(n - 1, i))], pts = [];
  for (let s = 0; s < n - 1; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let j = 0; j < 48; j++) {
      const u = j / 48, u2 = u * u, u3 = u2 * u;
      pts.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u3)));
    }
  }
  pts.push([...points[n - 1]]);
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + dist(pts[i], pts[i - 1]));
  return { pts, d, length: d[d.length - 1] };
}

function along(c, s) {
  let lo = 0, hi = c.d.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (c.d[mid] <= s) lo = mid; else hi = mid;
  }
  return mix(c.pts[lo], c.pts[hi], (s - c.d[lo]) / (c.d[hi] - c.d[lo] || 1));
}

// Joined-up letters in a box one letter wide and one tall (ascenders reach 1.7),
// each from the left edge of the box to just past its right edge.
const LETTERS = {
  a: [[0.85, 0.75], [0.45, 1], [0.1, 0.55], [0.35, 0.05], [0.8, 0.45], [0.85, 0.95], [0.85, 0.15], [1.05, 0.1]],
  e: [[0.15, 0.45], [0.85, 0.65], [0.5, 1], [0.1, 0.55], [0.4, 0.05], [1.05, 0.2]],
  l: [[0.2, 0.3], [0.55, 1.15], [0.5, 1.7], [0.3, 1.5], [0.35, 0.3], [0.6, 0], [1.05, 0.15]],
  n: [[0.05, 0.95], [0.1, 0.05], [0.2, 0.7], [0.55, 1], [0.8, 0.75], [0.85, 0.05], [1.05, 0.1]],
  o: [[0.75, 0.95], [0.3, 0.9], [0.1, 0.45], [0.45, 0.05], [0.85, 0.4], [0.75, 0.95], [1.05, 0.85]],
  u: [[0.05, 0.95], [0.1, 0.2], [0.45, 0.02], [0.8, 0.45], [0.85, 0.95], [0.85, 0.1], [1.05, 0.15]],
};

// How the band sits on the wrist (any way, as long as it is not level), how it
// lies on a table before it is picked up, and how the forearm turns as the hand
// moves about the board: along it, up and down, and away from it.
const MOUNT = qnorm(qmul(qaxis([0, 0, 1], 0.5), qaxis([1, 0, 0], -1.1)));
const FLAT = qaxis([1, 0, 0], -Math.PI / 2);         // the band's z axis up, as the pretend band lies at rest
const arm = (p) => qmul(qaxis([0, 1, 0], 0.3 * (p[0] - 0.6)), qaxis([1, 0, 0], -0.4 * (p[1] - 1.35) + 1.2 * p[2]));
const turn = ([rx, ry, rz]) => qmul(qaxis([1, 0, 0], rx), qmul(qaxis([0, 1, 0], ry), qaxis([0, 0, 1], rz)));

function slerp(a, b, s) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((v) => -v); d = -d; }
  if (d > 0.9995) return qnorm(mix(a, b, s));
  const th = Math.acos(d), sa = Math.sin((1 - s) * th) / Math.sin(th), sb = Math.sin(s * th) / Math.sin(th);
  return a.map((v, k) => v * sa + b[k] * sb);
}

/** A session as a list of parts, each with the hand's place (and the wrist's extra turn) through it. */
class Script {
  constructor(start) {
    this.parts = [];          // { t0, dur, at(u) -> [x, y, z], twist(u) -> [rx, ry, rz], held(u) -> 0 lying flat .. 1 worn }
    this.t = 0;
    this.here = start;
    this.taps = [];           // seconds: when the band feels each knock
    this.words = [];          // [t0, t1] seconds: the marker writing a word
    this.gestures = [];       // { label, t0, t1 } seconds
  }

  part(dur, at, twist = null, held = null) {
    const t0 = this.t;
    this.parts.push({ t0, dur, at, twist, held });
    this.t += dur;
    this.here = at(1);
    return [t0, this.t];
  }

  rest(dur) {
    const p = this.here;
    return this.part(dur, () => p);
  }

  /** Straight to `to`, at about `speed` m/s on average. */
  move(to, speed = 0.8) {
    const from = this.here;
    return this.part(Math.max(0.25, dist(from, to) / speed), (u) => mix(from, to, glide(u)));
  }

  lift() { return this.move([this.here[0], this.here[1], OFF], 0.15); }
  down() { return this.move([this.here[0], this.here[1], 0], 0.15); }

  /**
   * A knock on the board from just off it: the hand speeds up toward the board
   * and stops dead on it in 12 ms, about 5 g, as a real knock does. The band
   * feels the tap in the middle of the stop.
   */
  knock() {
    if (this.here[2] < OFF / 2) this.lift();
    const [x, y, z0] = this.here, v = 0.4, stop = 0.012, near = (v * stop) / 2, run = z0 - near, ta = 0.15;
    const k = (v * ta) / run, a = 3 - k, b = k - 2;     // z0 - run (a w^2 + b w^3): still at first, at speed v at the end
    this.part(ta + stop, (u) => {
      const s = u * (ta + stop);
      if (s <= ta) { const w = s / ta; return [x, y, z0 - run * (a * w * w + b * w * w * w)]; }
      const w = (s - ta) / stop;                         // the speed falls from v to 0 along half a cosine
      return [x, y, near - near * (w + Math.sin(Math.PI * w) / Math.PI)];
    });
    this.taps.push(this.t - stop / 2);
  }

  /** The marker along a smooth curve through `points`, the wrist working as it goes. */
  stroke(points, speed = 0.3, wiggle = 0.06) {
    const c = curve([this.here, ...points]), dur = Math.max(0.3, c.length / speed);
    const sign = this.parts.length % 2 ? 1 : -1;
    return this.part(dur, (u) => along(c, glide(u) * c.length), (u) => [sign * wiggle * bump(u), 0.6 * wiggle * bump(u), 0]);
  }

  /** The points of a word written from (x, y), letters `size` metres tall. */
  static letters(x, y, word, size) {
    const wide = size * 0.75, points = [];
    word.split('').forEach((ch, i) => {
      for (const [u, v] of LETTERS[ch]) points.push([x + (i * 1.05 + u) * wide, y + v * size, 0]);
    });
    return points;
  }

  /** A word on the board from (x, y), one letter at a time with a short pause after each. */
  word(x, y, word, size = 0.08) {
    if (this.here[2] < OFF / 2) this.lift();
    this.move([x, y, OFF]);
    this.down();
    if (this.pause) this.rest(this.pause);        // a writer who stops before each word to think
    const t0 = this.t;
    const wide = size * 0.75;
    word.split('').forEach((ch, i) => {
      this.stroke(LETTERS[ch].map(([u, v]) => [x + (i * 1.05 + u) * wide, y + v * size, 0]));
      this.rest(0.1 + 0.05 * (i % 3));
    });
    this.words.push([t0, this.t]);
    this.lift();
  }

  /** Writing without a single pause: every letter of `text` in one sweep. */
  sweep(x, y, text, size = 0.08) {
    if (this.here[2] < OFF / 2) this.lift();
    this.move([x, y, OFF]);
    this.down();
    const t0 = this.t;
    this.stroke(Script.letters(x, y, text, size), 0.3);
    this.words.push([t0, this.t]);
    this.lift();
  }

  /** Side-steps along the board, `dx` metres, the hand riding along a little off the board. */
  walk(dx, steps = Math.max(1, Math.round(Math.abs(dx) / 0.45))) {
    if (this.here[2] < OFF / 2) this.lift();
    const from = this.here;
    return this.part(steps * 0.55, (u) => {
      const s = u * steps, k = Math.min(steps - 1, Math.floor(s)), w = s - k;
      return [
        from[0] + (dx * (k + glide(w))) / steps,           // each step starts and stops
        from[1] + 0.012 * Math.sin(Math.PI * w) ** 2,       // the body rises mid-step
        from[2] + 0.01 * Math.sin(Math.PI * s) * Math.sin(Math.PI * u),   // and rocks toward the board and back
      ];
    }, (u) => [0.12 * Math.sin(2 * Math.PI * u * steps) * Math.sin(Math.PI * u), 0, 0]);   // the arm swings
  }

  /**
   * Take: pull the writing off the board, back toward you and a little down, the wrist curling.
   * Put: push it out to the side, toward the laptop, with a flick of the wrist.
   */
  gesture(label, { size = 1, pace = 1 } = {}) {
    const from = this.here;
    let span;
    if (label === 'take') {
      const to = [from[0], from[1] - 0.05 * size, from[2] + 0.22 * size];
      span = this.part(0.5 * pace, (u) => mix(from, to, glide(u)), (u) => [0.9 * size * bump(u), 0, 0.2 * size * bump(u)]);
    } else {
      const to = [from[0] - 0.25 * size, from[1] + 0.03 * size, Math.max(OFF, from[2] - 0.08 * size)];
      span = this.part(0.45 * pace, (u) => mix(from, to, glide(u)), (u) => [0, -1.1 * size * bump(u), 0.4 * size * bump(u)]);
    }
    this.gestures.push({ label, t0: span[0], t1: span[1] });
  }

  /** The two taps that set up the board: its left edge, then its far right edge (a little higher: nobody taps level). */
  edges(width, y, { walk = false } = {}) {
    this.move([0, y, OFF]);
    this.rest(0.3);
    this.knock();
    this.rest(0.6);
    this.lift();
    if (walk) {
      this.move([0.4, y, OFF]);
      this.walk(width - 0.8);
      this.move([width, y + 0.03, OFF]);
    } else {
      this.move([width, y + 0.03, OFF], 0.9);
    }
    this.rest(0.3);
    this.knock();
    this.rest(0.6);
    this.lift();
  }

  /** Where the hand is, and how the band is turned, at `time` seconds. */
  pose(time) {
    const parts = this.parts;
    let lo = 0, hi = parts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (parts[mid].t0 <= time) lo = mid; else hi = mid - 1;
    }
    const part = parts[lo], u = Math.max(0, Math.min(1, (time - part.t0) / part.dur));
    const p = part.at(u), worn = qnorm(qmul(arm(p), qmul(turn(part.twist ? part.twist(u) : [0, 0, 0]), MOUNT)));
    const held = part.held ? part.held(u) : 1;
    return { p, q: held >= 1 ? worn : slerp(FLAT, worn, held) };
  }

  /**
   * What the band reads, a sample every 1/rate seconds, as the kit reports it,
   * with the true place of the hand at each sample.
   */
  readings({ rate = 208, seed = 1, noise = 1, accelRange = 16, gyroRange = 2000, quietUntil = 0 } = {}) {
    const dt = 1 / rate, n = Math.floor(this.t * rate);
    const rand = mulberry(seed), gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
    const loud = noise * Math.sqrt(rate / 100);          // the same noise per root hertz at every rate
    const accelBias = [0.03, -0.02, 0.025].map((b) => b * noise), gyroBias = [0.012, -0.008, 0.01].map((b) => b * noise);
    const creep = [0.5, -0.3, 0.4].map((b) => (b * 1e-3 * noise) / 60);   // rad/s a second: the gyro's bias wanders
    const cut = (v, range, step) => Math.round(Math.max(-range, Math.min(range, v)) * step) / step;
    const samples = [], truth = [], turns = [];
    let prev = this.pose(-dt);
    for (let i = 0; i < n; i++) {
      const time = i * dt, now = this.pose(time), next = this.pose(time + dt);
      const a = [0, 1, 2].map((k) => (next.p[k] - 2 * now.p[k] + prev.p[k]) / (dt * dt));
      a[1] += G;
      const f = qrot(qconj(now.q), a);
      let dq = qmul(qconj(prev.q), now.q);
      if (dq[0] < 0) dq = dq.map((v) => -v);
      const s = Math.hypot(dq[1], dq[2], dq[3]), angle = 2 * Math.atan2(s, dq[0]);
      const w = s < 1e-12 ? [0, 0, 0] : [dq[1], dq[2], dq[3]].map((c) => ((c / s) * angle) / dt);
      // Before `quietUntil` the readings are perfect, as the kit's pretend band's are while it lies at rest.
      const on = time >= quietUntil ? 1 : 0;
      const accel = f.map((v, k) => (v + on * (accelBias[k] + gauss() * 0.04 * loud)) / G);
      const gyro = w.map((v, k) => (v + on * (gyroBias[k] + creep[k] * time + gauss() * 0.003 * loud)) * DEG);
      samples.push({
        t: START_MS + time * 1000,
        ax: cut(accel[0], accelRange, 1000), ay: cut(accel[1], accelRange, 1000), az: cut(accel[2], accelRange, 1000),
        gx: cut(gyro[0], gyroRange, 10), gy: cut(gyro[1], gyroRange, 10), gz: cut(gyro[2], gyroRange, 10),
      });
      truth.push(now.p);
      turns.push(now.q);
      prev = now;
    }
    return { samples, truth, turns };
  }
}

// The scenes. Each writes on the board after setting it up, and returns its width
// and where the left tap was.
export const SCENARIOS = {
  // A 1.2 m board, all within reach: five words with the usual short pauses.
  reach(s, { gestures = false } = {}) {
    const width = 1.2, y = 1.4;
    s.edges(width, y);
    s.word(0.08, y + 0.06, 'lean');
    s.word(0.62, y + 0.06, 'one');
    if (gestures) {
      // Take the first word off the board, then put it on the laptop's screen.
      s.move([0.2, y + 0.1, OFF]);
      s.down();
      s.rest(0.5);
      s.gesture('take');
      s.rest(0.8);
      s.move([s.here[0] + 0.4, s.here[1], s.here[2]]);
      s.rest(0.6);
      s.gesture('put');
      s.rest(0.8);
    }
    s.word(0.1, y - 0.18, 'noel');
    s.word(0.62, y - 0.18, 'an');
    s.word(0.3, y - 0.4, 'loan');
    return { width, left: [0, y, 0] };
  },
  // A 2.4 m board: side-steps to reach its right edge, and between the words.
  walk(s) {
    const width = 2.4, y = 1.4;
    s.edges(width, y, { walk: true });
    s.word(1.9, y + 0.06, 'one');
    s.walk(-1.2);
    s.word(0.7, y + 0.06, 'lean');
    s.walk(-0.4);
    s.word(0.15, y - 0.18, 'noel');
    s.walk(1.5);
    s.word(1.7, y - 0.18, 'an');
    return { width, left: [0, y, 0] };
  },
  // A 1.2 m board, written without a single pause: the worst case for drift.
  steady(s) {
    const width = 1.2, y = 1.4;
    s.edges(width, y);
    s.sweep(0.08, y, 'leanoneunu');
    s.sweep(0.1, y - 0.25, 'noelanu');
    return { width, left: [0, y, 0] };
  },
};

/**
 * A pretend session: the band lies flat on a table for a second (as the pretend band
 * rests), is picked up, sets up the board and writes. Returns the band's motion
 * samples, the times of its taps, and the truth: where the hand really was at each
 * sample, the board's width, and when words and gestures were written.
 */
export function session(name = 'reach', { rate = 208, seed = 1, noise = 1, gestures = false, accelRange = 16, gyroRange = 2000, cleanStart = false, pause = 0 } = {}) {
  const s = new Script(TABLE);
  s.pause = pause;
  s.part(1.0, () => TABLE, null, () => 0);
  s.part(1.0, (u) => mix(TABLE, START, glide(u)), null, (u) => glide(u));
  s.rest(0.8);
  const board = SCENARIOS[name](s, { gestures });
  s.lift();
  s.rest(1.0);
  // Put the band back down flat, as the pretend band lies once a played motion is over.
  const end = s.here;
  s.part(1.0, (u) => mix(end, TABLE, glide(u)), null, (u) => 1 - glide(u));
  s.part(0.5, () => TABLE, null, () => 0);
  // cleanStart: the second lying flat has perfect readings, so a tracker started then
  // learns a gyro bias of zero, and is wrong about it (by about 1 degree/second) from then on.
  const { samples, truth, turns } = s.readings({ rate, seed, noise, accelRange, gyroRange, quietUntil: cleanStart ? 0.9 : 0 });
  const ms = (t) => START_MS + t * 1000;
  return {
    name, rate, samples, truth, turns, board,
    taps: s.taps.map(ms),
    words: s.words.map(([a, b]) => [ms(a), ms(b)]),
    gestures: s.gestures.map(({ label, t0, t1 }) => ({ label, t0: ms(t0), t1: ms(t1) })),
  };
}

/**
 * Examples to train the gesture recogniser with: `count` takes, puts, or bits of
 * ordinary writing ('none'), each on its own with a rest either side, made a
 * little differently every time.
 */
export function examples(label, count, { rate = 208, seed = 1 } = {}) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const rng = mulberry(seed * 7919 + k * 104729 + label.charCodeAt(0));
    const s = new Script([0.3 + 0.6 * rng(), 1.2 + 0.3 * rng(), 0]);
    s.rest(0.8);
    if (label === 'none') {
      const word = ['lean', 'one', 'noel', 'an', 'loan', 'nun'][k % 6];
      const [x, y] = s.here;
      s.stroke(Script.letters(x, y, word.slice(0, 2), 0.07 + 0.03 * rng()));
    } else {
      s.gesture(label, { size: 0.85 + 0.3 * rng(), pace: 0.85 + 0.35 * rng() });
    }
    s.rest(0.8);
    out.push(s.readings({ rate, seed: seed + k }).samples);
  }
  return out;
}
