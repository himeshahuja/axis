// Where the hand is on the board, from the camera and the band together.
//
// The camera sees the band's light and says exactly where on the board it is,
// 30 times a second and a little late; the band feels every movement 208 times a
// second but drifts. A Kalman filter for each of the board's two axes (across and
// up, in metres) keeps three things: position, speed, and the accelerometer's bias
// along that axis. The band's acceleration (gravity out, turned into the board's
// axes) moves it on; each camera fix pulls the position to where the light was
// seen; a rest sets the speed to zero. A camera fix is a picture taken a moment
// ago, so the filter keeps its recent past and, when a fix comes, goes back to the
// moment of the picture, takes it in, and plays the band's samples since forward
// again. No DOM: the tests run it.

const KEEP_MS = 400;     // how far back a late camera fix can still be taken in

export const NOISE = {
  push: 0.6,     // m/s^2: how far the band's acceleration along the board may be off (tilt, tremor, the lever of the wrist)
  blind: 3,      // m/s^2: the same while the board's direction in the band's axes is not known yet
  bias: 0.02,    // m/s^2 per root second: how fast the accelerometer's bias may wander
  camera: 0.015, // m: how far one camera fix may be off (a pose model's wrist, at a few metres)
  rest: 0.01,    // m/s: the speed at a rest
};

/** One axis of the filter: position, speed, accelerometer bias, and how unsure of each. */
class Axis {
  constructor() {
    this.s = [0, 0, 0];
    this.P = [[1, 0, 0], [0, 1, 0], [0, 0, 0.01]];
  }

  copy() {
    const a = new Axis();
    a.s = [...this.s];
    a.P = this.P.map((r) => [...r]);
    return a;
  }

  // Move on by dt seconds with acceleration a (bias not yet taken out).
  predict(dt, a, push) {
    const [p, v, b] = this.s, d2 = (dt * dt) / 2;
    this.s = [p + v * dt + (a - b) * d2, v + (a - b) * dt, b];
    const F = [[1, dt, -d2], [0, 1, -dt], [0, 0, 1]], P = this.P;
    const FP = F.map((r) => [0, 1, 2].map((j) => r[0] * P[0][j] + r[1] * P[1][j] + r[2] * P[2][j]));
    const q = push * push, g = [d2, dt, 0];
    this.P = FP.map((r, i) => [0, 1, 2].map((j) => r[0] * F[j][0] + r[1] * F[j][1] + r[2] * F[j][2] + q * g[i] * g[j]));
    this.P[2][2] += NOISE.bias * NOISE.bias * dt;
  }

  // Take in a measurement of part k (0 position, 1 speed) with the given spread.
  measure(k, value, spread) {
    const P = this.P, S = P[k][k] + spread * spread, K = [P[0][k] / S, P[1][k] / S, P[2][k] / S], y = value - this.s[k];
    this.s = this.s.map((s, i) => s + K[i] * y);
    this.P = P.map((r, i) => r.map((v, j) => v - K[i] * P[k][j]));
  }
}

export class Fused {
  /**
   * `width`, `height`: the board's size in metres (the camera's board coordinates run
   * from its bottom left corner). `tip`: [x, y] metres from the tracked point to the marker's tip.
   * `fixNoise`: how far one fix may be off, metres (a camera's by default).
   */
  constructor({ width, height, tip = [0, 0], fixNoise = NOISE.camera } = {}) {
    this.size = { width, height };
    this.tip = tip;
    this.fixNoise = fixNoise;
    this.axes = null;          // the filter, once the first camera fix has said where to start
    this.past = [];            // { t, a, rest, axes } for KEEP_MS: what each step took in, and where it ended
    this.t = [];               // the trail, one entry per band sample since the first fix: time (ms), metres
    this.x = [];
    this.y = [];
    this.lastFix = null;       // the band's time of the last camera fix
    this.fixes = 0;
    this.y0 = 0;               // metres up from the bottom edge where the left knock was: the trail's 0 height
    this.hidden = 0;
    this.skips = [];
    this.frame = { width };    // what the board page reads for the board's width
  }

  /**
   * One sample from the band at its time `t` (ms): `a` its acceleration along the
   * board [across, up] in m/s^2 (null while the board's direction is not known), and
   * whether it is at rest.
   */
  step(t, a, rest) {
    if (!this.axes) return;
    const last = this.past.length ? this.past[this.past.length - 1].t : t;
    this.advance(t, (t - last) / 1000, a, rest);
    this.past.push({ t, a, rest, axes: this.axes.map((x) => x.copy()) });
    while (this.past.length && t - this.past[0].t > KEEP_MS) this.past.shift();
    this.t.push(t);
    this.x.push(this.axes[0].s[0]);
    this.y.push(this.axes[1].s[0]);
  }

  advance(t, dt, a, rest) {
    if (dt > 0) this.axes.forEach((axis, k) => axis.predict(dt, a ? a[k] : 0, a ? NOISE.push : NOISE.blind));
    if (rest) this.axes.forEach((axis) => axis.measure(1, 0, NOISE.rest));
  }

  /**
   * A fix: the tracked point seen at board metres (x, y) at band time `t`. `noise`: how
   * far this one may be off, m, if not the usual.
   */
  fix(t, x, y, noise = this.fixNoise) {
    this.fixes++;
    this.lastFix = Math.max(this.lastFix ?? t, t);
    if (!this.axes) {
      this.axes = [new Axis(), new Axis()];
      this.axes[0].s[0] = x;
      this.axes[1].s[0] = y;
      this.axes.forEach((axis) => { axis.P = [[this.fixNoise ** 2, 0, 0], [0, 0.01, 0], [0, 0, 0.01]]; });
      return;
    }
    // Back to the step at or just before the picture, take the fix in, and replay the rest.
    let k = this.past.length - 1;
    while (k > 0 && this.past[k].t > t) k--;
    if (k < 0 || !this.past.length) {
      this.axes[0].measure(0, x, noise);
      this.axes[1].measure(0, y, noise);
      return;
    }
    if (this.past[k].t > t) return;                 // older than anything kept: too late to use
    this.axes = this.past[k].axes.map((a) => a.copy());
    this.axes[0].measure(0, x, noise);
    this.axes[1].measure(0, y, noise);
    this.past[k].axes = this.axes.map((a) => a.copy());
    const first = this.t.length - (this.past.length - k);
    this.x[first] = this.axes[0].s[0];
    this.y[first] = this.axes[1].s[0];
    for (let i = k + 1; i < this.past.length; i++) {
      const p = this.past[i];
      this.advance(p.t, (p.t - this.past[i - 1].t) / 1000, p.a, p.rest);
      p.axes = this.axes.map((a) => a.copy());
      this.x[first + i - k] = this.axes[0].s[0];
      this.y[first + i - k] = this.axes[1].s[0];
    }
  }

  /**
   * Start again from a fix that is surely right, at band time `t`: position (x, y),
   * speed `v` [m/s across, up]. For when the filter has wandered off and been refused
   * every fix since: its own speed is then wrong too, so it is not kept. Earlier fixes
   * arriving late are no longer used.
   */
  jump(t, x, y, v = [0, 0]) {
    if (!this.axes) return this.fix(t, x, y);
    [x, y].forEach((p, k) => {
      const axis = this.axes[k];
      axis.s = [p, v[k], axis.s[2]];
      axis.P = [[this.fixNoise ** 2, 0, 0], [0, 0.04, 0], [0, 0, axis.P[2][2]]];
    });
    this.past = [];
    this.lastFix = Math.max(this.lastFix ?? t, t);
    this.fixes++;
  }

  /** How long the camera has not seen the light, ms, at band time `now`. */
  blindFor(now) {
    return this.lastFix === null ? Infinity : now - this.lastFix;
  }

  // ------------------------------------------------ the same trail as the band-only tracker, for the page

  get length() { return this.t.length; }
  /** Entries before this one no longer change: a late camera fix only reaches back KEEP_MS. */
  get settled() { return Math.max(0, this.t.length - this.past.length); }

  /** Entry i in board coordinates: across 0 to 1, up in board widths from the left knock's height. */
  boardAt(i) {
    const W = this.size.width;
    return { x: (this.x[i] + this.tip[0]) / W, y: (this.y[i] + this.tip[1] - this.y0) / W, d: 0 };
  }

  get cursor() { return this.length ? this.boardAt(this.length - 1) : null; }

  indexAt(tMs) {
    const ts = this.t;
    if (!ts.length) return -1;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= tMs) lo = mid; else hi = mid;
    }
    return Math.abs(ts[hi] - tMs) < Math.abs(ts[lo] - tMs) ? hi : lo;
  }

  at(tMs) {
    const i = this.indexAt(tMs);
    return i < 0 ? null : this.boardAt(i);
  }

  clearTrail() { this.hidden = this.length; }

  skip(t0, t1) {
    const a = this.indexAt(t0), b = this.indexAt(t1);
    if (a >= 0) this.skips.push([a, b]);
  }

  shown(i) {
    return i >= this.hidden && !this.skips.some(([a, b]) => i >= a && i <= b);
  }

  near(x, y, w = 0.3, h = 0.12) {
    const W = this.size.width, hw = w / 2 / W, hh = h / 2 / W, strokes = [];
    let stroke = null;
    for (let i = this.hidden; i < this.length; i++) {
      const b = this.boardAt(i);
      if (this.shown(i) && Math.abs(b.x - x) <= hw && Math.abs(b.y - y) <= hh) {
        if (!stroke) strokes.push((stroke = []));
        stroke.push({ x: b.x, y: b.y });
      } else {
        stroke = null;
      }
    }
    return strokes;
  }

  /**
   * Is the knock at band time `tMs` on the `edge` it should be ('left' or 'right')? The
   * camera saw where it was. Returns { ok, across } with across from 0 (left) to 1 (right).
   */
  knockAt(tMs, edge) {
    const i = this.indexAt(tMs);
    if (i < 0) return { ok: true, across: null };                    // no camera yet: take the knock as given
    const across = this.x[i] / this.size.width;
    return { ok: edge === 'left' ? across < 0.25 : across > 0.75, across };
  }
}

/** The band's acceleration along the board, [across, up] m/s^2, from Tracker's world acceleration and the board's direction. */
export function alongBoard(world, ux) {
  return [world[0] * ux[0] + world[2] * ux[2], world[1]];
}
