// Turns accelerometer and gyroscope samples into the path the sensor moved
// along. No DOM here, so the tests run it under Node.
//
// A sample is { t, ax, ay, az, gx, gy, gz, pen }:
//   t         seconds
//   ax ay az  accelerometer, m/s^2, in the sensor's own axes, gravity included
//             (lying still and level it reads about +9.81 on the axis pointing up)
//   gx gy gz  gyroscope, rad/s, about the sensor's own axes
//   pen       optional: 0 while the pen is lifted (a button on the device), else 1
//
// World axes: x right, y up, z toward the viewer.

export const G = 9.80665;

// Quaternions are [w, x, y, z].
export const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
export const qnorm = (q) => {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};
// Rotate vector v by q.
export function qrot(q, v) {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
// The rotation of `angle` radians about `axis` (unit length).
export const qaxis = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), axis[0] * s, axis[1] * s, axis[2] * s];
};
// The rotation a body turning at rate w (rad/s) makes in dt seconds.
export function qstep(w, dt) {
  const rate = Math.hypot(w[0], w[1], w[2]);
  if (rate < 1e-12) return [1, 0, 0, 0];
  return qaxis([w[0] / rate, w[1] / rate, w[2] / rate], rate * dt);
}
// The shortest rotation taking unit vector a onto unit vector b.
export function qbetween(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) return [0, 1, 0, 0];
  return qnorm([1 + d, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
}

const DEFAULTS = {
  settle: 60,        // samples held still at the start, to find which way is up and the gyro's bias
  kp: 2,             // how hard the accelerometer pulls the tilt back toward gravity, at rest
  stillGyro: 0.03,   // rad/s: turning slower than this...
  stillAccel: 0.15,  // m/s^2: ...with the accelerometer this close to 1 g...
  stillFor: 30,      // ...for this many samples in a row means the sensor is at rest
  settleOver: 15,    // samples of that calm stretch averaged to read the tilt the gyro lost
  tail: 5,           // of those, how many at the end are taken as truly stopped
  lead: 60,          // a movement is taken to have begun this many samples before it was noticed
  biasAfter: 20,     // samples of rest before the gyro bias is touched
  biasRate: 0.01,    // how fast the gyro bias then follows the readings
};

export class Tracker {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.q = [1, 0, 0, 0];      // sensor axes -> world axes
    this.bias = [0, 0, 0];      // gyro bias, rad/s
    this.v = [0, 0, 0];
    this.p = [0, 0, 0];
    this.ready = false;         // true once the start-up stillness has been read
    this.still = true;
    this.calm = 0;              // samples in a row that looked still
    this.sum = [0, 0, 0, 0, 0, 0];
    this.count = 0;
    this.lastT = null;
    // One entry per sample fed after start-up.
    this.t = []; this.x = []; this.y = []; this.z = []; this.pen = [];
    this.vel = [];              // the velocity that moved the sensor on from each sample
    this.acc = [];              // world acceleration at each sample
    this.gyro = [];             // gyro reading at each sample
    this.rest = 0;              // first sample of the latest rest
    this.from = 0;              // first sample of the movement now under way
  }

  get length() { return this.t.length; }

  feed(s) {
    const o = this.o;
    const f = [s.ax, s.ay, s.az], w = [s.gx, s.gy, s.gz];
    const dt = this.lastT == null ? 0 : s.t - this.lastT;
    this.lastT = s.t;

    // Start-up: held still, the accelerometer reads only gravity, which gives
    // the tilt, and whatever the gyro reads is its bias.
    if (!this.ready) {
      for (let k = 0; k < 3; k++) { this.sum[k] += f[k]; this.sum[k + 3] += w[k]; }
      if (++this.count < o.settle) return;
      const n = this.count, up = [this.sum[0] / n, this.sum[1] / n, this.sum[2] / n];
      const m = Math.hypot(...up) || 1;
      this.q = qbetween([up[0] / m, up[1] / m, up[2] / m], [0, 1, 0]);
      this.bias = [this.sum[3] / n, this.sum[4] / n, this.sum[5] / n];
      this.ready = true;
      return;
    }
    if (dt <= 0) return;

    // Is it at rest? Barely turning, and feeling nothing but gravity.
    const fn = Math.hypot(...f), turn = Math.hypot(w[0] - this.bias[0], w[1] - this.bias[1], w[2] - this.bias[2]);
    const calm = turn < o.stillGyro && Math.abs(fn - G) < o.stillAccel;
    this.calm = calm ? this.calm + 1 : 0;

    // Orientation: turn by the gyro. While the sensor looks still the
    // accelerometer reads only gravity, so it nudges the tilt back (the gyro
    // alone would drift). On the move it also feels the hand, so it is left out.
    const rate = [w[0] - this.bias[0], w[1] - this.bias[1], w[2] - this.bias[2]];
    if (this.calm >= o.stillFor) {
      const upBody = qrot(qconj(this.q), [0, 1, 0]);
      const kp = o.kp / fn;
      rate[0] += kp * (f[1] * upBody[2] - f[2] * upBody[1]);
      rate[1] += kp * (f[2] * upBody[0] - f[0] * upBody[2]);
      rate[2] += kp * (f[0] * upBody[1] - f[1] * upBody[0]);
    }
    this.q = qnorm(qmul(this.q, qstep(rate, dt)));

    // Acceleration in the world, with gravity taken out.
    const a = qrot(this.q, f);
    a[1] -= G;

    const wasStill = this.still;
    if (this.calm >= o.stillFor) {
      if (!wasStill) { this.settle(); this.rest = this.length - o.tail; }
      this.still = true;
      this.v = [0, 0, 0];
      // A long rest teaches the gyro's bias, from readings a little in the
      // past: the first moments of a slow movement look like rest too, and
      // by the time one is noticed they must not have been learned as bias.
      const old = this.gyro[this.length - o.lead];
      if (old && this.calm >= o.biasAfter + o.lead) for (let k = 0; k < 3; k++) this.bias[k] += o.biasRate * (old[k] - this.bias[k]);
    } else if (!calm && wasStill) {
      this.still = false;
      this.begin();
    }

    this.t.push(s.t); this.x.push(this.p[0]); this.y.push(this.p[1]); this.z.push(this.p[2]);
    this.pen.push(s.pen === 0 ? 0 : 1);
    this.vel.push(this.still ? [0, 0, 0] : [...this.v]);
    this.acc.push(a);
    this.gyro.push(w);
    if (!this.still) {
      for (let k = 0; k < 3; k++) { this.p[k] += this.v[k] * dt; this.v[k] += a[k] * dt; }
    }
  }

  // A movement starts too gently to notice at once. Go back a few samples
  // (never past the start of the rest) and count the acceleration from there.
  begin() {
    const n = this.length, from = (this.from = Math.max(this.rest, n - this.o.lead, 0));
    if (from >= n) return;
    const p = [this.x[from], this.y[from], this.z[from]], v = [0, 0, 0];
    for (let i = from; i < n; i++) {
      this.x[i] = p[0]; this.y[i] = p[1]; this.z[i] = p[2];
      this.vel[i] = [...v];
      const dt = (i + 1 < n ? this.t[i + 1] : this.lastT) - this.t[i];
      for (let k = 0; k < 3; k++) { p[k] += v[k] * dt; v[k] += this.acc[i][k] * dt; }
    }
    this.p = p; this.v = v;
  }

  // The sensor has come to rest, so its true velocity is zero. Whatever
  // velocity the sums had reached is drift. Take it back out of the movement
  // just finished, growing evenly from its start to its end, and redo the
  // positions. A constant error in acceleration (a little leftover tilt, an
  // accelerometer bias) is removed exactly this way.
  settle() {
    // The hand slows to a stop gently, so the sums run on through the calm
    // stretch and velocity is taken as zero only near its end.
    const end = this.length - this.o.tail;
    const start = this.from;
    if (end - start < 2) { this.p = [this.x[start] ?? this.p[0], this.y[start] ?? this.p[1], this.z[start] ?? this.p[2]]; return; }
    const t0 = this.t[start], span = this.t[end] - t0;
    // First the tilt. At rest the world acceleration should read zero; what
    // it reads sideways instead is gravity leaking through tilt the gyro lost
    // on the way. Taking that tilt to have built up evenly, its leak grew as a
    // straight line, so the velocity it added grew as time squared.
    const leak = [0, 0, 0], m = Math.min(this.o.settleOver, end - start);
    for (let i = end - m; i < end; i++) { leak[0] += this.acc[i][0] / m; leak[2] += this.acc[i][2] / m; }
    for (let i = start; i <= end && i < this.length; i++) {
      const tau = this.t[i] - t0, grown = (tau * tau) / (2 * span);
      this.vel[i] = [this.vel[i][0] - leak[0] * grown, this.vel[i][1], this.vel[i][2] - leak[2] * grown];
    }
    const drift = this.vel[end] ?? this.v;
    const p = [this.x[start], this.y[start], this.z[start]];
    for (let i = start; i < this.length; i++) {
      this.x[i] = p[0]; this.y[i] = p[1]; this.z[i] = p[2];
      if (i >= end) { this.vel[i] = [0, 0, 0]; continue; }
      const share = (this.t[i] - t0) / span, dt = this.t[i + 1] - this.t[i];
      for (let k = 0; k < 3; k++) p[k] += (this.vel[i][k] - drift[k] * share) * dt;
    }
    this.p = p;
  }
}
