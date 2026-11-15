// What comes in from the band, made fit for the tracker, with figures on how it
// arrives. The band sends its motion over Bluetooth in packets (up to 50 ms of
// samples each). Packets get lost, readings can be cut off at the sensor's
// range, and a real accelerometer reads 1 g a few percent off: chips like the
// band's can be up to about 0.4 m/s^2 off on each axis. The intake counts all of
// that (the bench shows it), fills in short gaps, and scales the accelerometer
// so that a still band reads exactly 1 g. No DOM here, so the tests run it under Node.

export const BRIDGE_MS = 250;      // a gap up to this long is filled in; a longer one loses the position
export const ONE_G = [0.9, 1.1];   // a band reading 1 g outside this (in g) is taken to be faulty, not just off
const RAD = Math.PI / 180;
const STILL_S = 0.3;               // still for this long, the band's reading of 1 g can be learned...
const STILL_TURN = 0.15;           // ...if it turns slower than this (rad/s, with the gyro's bias in)...
const STILL_WOBBLE = 0.06;         // ...and the size of its reading wobbles by less than this (g)
const LEARN_S = 1.0;               // the learned 1 g follows the band over about this long
const RECENT_MS = 2000;            // the rate, jitter and packets are worked out over this long

export class Intake {
  /**
   * `lowpass`: if given (Hz), every channel goes through a low-pass filter at that
   * frequency before the tracker sees it; `rate` is the samples a second it is built for.
   * Off by default: which frequency, if any, comes from the bench's spectrum of a real band.
   */
  constructor({ accelRange = 16, gyroRange = 2000, lowpass = null, rate = 208 } = {}) {
    this.range = { accel: accelRange, gyro: gyroRange };
    this.filter = lowpass ? CHANNELS.map(() => new LowPass(lowpass, rate)) : null;
    this.last = null;          // the last sample passed on
    this.periodMs = null;      // the usual time between samples, ms
    this.oneG = null;          // what this band reads for 1 g (in g), once learned
    this.window = [];          // the last STILL_S of readings: [t, size of reading (g), turning (rad/s)]
    this.spacing = [];         // [t, ms since the sample before], for RECENT_MS
    this.arrivals = [];        // the computer's times packets arrived, for RECENT_MS
    this.lastArrival = null;
    this.stats = { samples: 0, lost: 0, bridged: 0, gaps: 0, longestGap: 0, clipped: 0, packets: 0 };
  }

  /**
   * One motion event from the band, and when it arrived on the computer (ms, any clock).
   * Returns { samples, gap }: the samples to pass on, oldest first (usually just this one,
   * more when a short gap was filled in), and gap, the ms missing when too many were
   * lost to fill in (the position is lost; this sample starts afresh), else null.
   */
  feed(m, arrival = null) {
    const st = this.stats, out = [];
    st.samples++;
    if (arrival !== null) {
      if (this.lastArrival === null || arrival - this.lastArrival > 2) {
        st.packets++;
        this.arrivals.push(arrival);
        while (this.arrivals.length && arrival - this.arrivals[0] > RECENT_MS) this.arrivals.shift();
      }
      this.lastArrival = arrival;
    }
    if (Math.max(Math.abs(m.ax), Math.abs(m.ay), Math.abs(m.az)) >= this.range.accel - 0.001
      || Math.max(Math.abs(m.gx), Math.abs(m.gy), Math.abs(m.gz)) >= this.range.gyro - 0.05) st.clipped++;
    this.learn(m);
    const now = this.scaled(m);
    let gap = null;
    if (this.last) {
      const dt = m.t - this.last.t;
      if (dt <= 0) {
        gap = dt;                  // time went backwards: a new connection
      } else {
        // Missing samples: the band numbers every sample, and a jump in the number is a
        // loss. A jump in time without one is a pause in sampling; either way the hand
        // moved unseen for that long, so the longer of the two counts.
        const numbered = Number.isInteger(m.n) && Number.isInteger(this.last.n) && m.n > this.last.n;
        const byTime = Math.max(0, Math.round(dt / (this.periodMs ?? dt)) - 1);
        const lostHere = numbered ? m.n - this.last.n - 1 : byTime;
        const missing = Math.max(lostHere, byTime);
        if (missing > 0) {
          st.lost += lostHere;
          if (dt <= BRIDGE_MS) {
            st.bridged += lostHere;
            for (let k = 1; k <= missing; k++) out.push(between(this.last, now, k / (missing + 1)));
          } else {
            gap = dt;
            st.gaps++;
            st.longestGap = Math.max(st.longestGap, dt);
          }
        }
        if (!missing) this.periodMs = this.periodMs === null ? dt : this.periodMs + (dt - this.periodMs) * 0.05;
        this.spacing.push([m.t, dt]);
        while (this.spacing.length && m.t - this.spacing[0][0] > RECENT_MS) this.spacing.shift();
      }
    }
    out.push(now);
    this.last = now;
    return { samples: out, gap };
  }

  // While the band is still, the size of its reading is what it reads for 1 g.
  learn(m) {
    const w = this.window;
    w.push([m.t, Math.hypot(m.ax, m.ay, m.az), Math.hypot(m.gx, m.gy, m.gz) * RAD]);
    while (w.length && m.t - w[0][0] > STILL_S * 1000) w.shift();
    if (w.length < 3 || m.t - w[0][0] < STILL_S * 1000 * 0.9) return;
    let lo = Infinity, hi = -Infinity, sum = 0, fastest = 0;
    for (const [, size, turning] of w) {
      lo = Math.min(lo, size);
      hi = Math.max(hi, size);
      sum += size;
      fastest = Math.max(fastest, turning);
    }
    const mean = sum / w.length;
    if (fastest >= STILL_TURN || hi - lo >= STILL_WOBBLE || mean <= ONE_G[0] || mean >= ONE_G[1]) return;
    const dt = w.length > 1 ? (w[w.length - 1][0] - w[w.length - 2][0]) / 1000 : 0;
    this.oneG = this.oneG === null ? mean : this.oneG + (mean - this.oneG) * (1 - Math.exp(-dt / LEARN_S));
  }

  /** The reading with the accelerometer scaled so that a still band reads 1 g, and filtered if asked. */
  scaled(m) {
    const k = this.oneG ? 1 / this.oneG : 1;
    const out = { t: m.t, n: m.n ?? null, ax: m.ax * k, ay: m.ay * k, az: m.az * k, gx: m.gx, gy: m.gy, gz: m.gz, filled: false };
    if (this.filter) CHANNELS.forEach((c, i) => { out[c] = this.filter[i].step(out[c]); });
    return out;
  }

  /** How the stream is doing, for the bench. */
  health() {
    const gaps = this.spacing.map(([, dt]) => dt), n = gaps.length;
    const mean = n ? gaps.reduce((a, b) => a + b, 0) / n : NaN;
    const jitter = n ? Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : NaN;
    const packetsPerSecond = this.arrivals.length / (RECENT_MS / 1000);
    return {
      ...this.stats,
      rate: n ? 1000 / mean : NaN,
      jitter,
      packetsPerSecond,
      perPacket: packetsPerSecond ? (n / (RECENT_MS / 1000)) / packetsPerSecond : NaN,
      oneG: this.oneG,
    };
  }
}

const CHANNELS = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];

/**
 * A second-order Butterworth low-pass filter (the usual biquad). It passes a steady
 * value unchanged, so the speed and distance added up from it over a whole movement
 * stay the same; it only smooths what changes faster than `hz`, a little late.
 */
export class LowPass {
  constructor(hz, rate) {
    const w = (2 * Math.PI * hz) / rate, alpha = Math.sin(w) / Math.SQRT2, cos = Math.cos(w), a0 = 1 + alpha;
    this.b = [(1 - cos) / 2 / a0, (1 - cos) / a0, (1 - cos) / 2 / a0];
    this.a = [(-2 * cos) / a0, (1 - alpha) / a0];
    this.x = null;       // the last two inputs and outputs
  }

  step(v) {
    if (!this.x) this.x = [v, v, v, v];    // start as if the value had always been there
    const [x1, x2, y1, y2] = this.x, b = this.b, a = this.a;
    const y = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    this.x = [v, x1, y, y1];
    return y;
  }
}

/** A sample a fraction `u` of the way from a to b, made up to fill a gap. */
function between(a, b, u) {
  const mix = (x, y) => x + (y - x) * u;
  return {
    t: mix(a.t, b.t), n: null, filled: true,
    ax: mix(a.ax, b.ax), ay: mix(a.ay, b.ay), az: mix(a.az, b.az), gx: mix(a.gx, b.gx), gy: mix(a.gy, b.gy), gz: mix(a.gz, b.gz),
  };
}
