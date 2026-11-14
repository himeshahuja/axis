// Where the band hand is on a whiteboard.
//
// The band feels only acceleration and turning, so its position comes from
// adding up motion. Tracker (../fusion.js) does that: it sets the speed to zero
// at every pause and takes the drift out of each movement once the hand rests.
// This file adds the board. Two taps set it up, one on the board's left edge and
// one on its far right edge, and from then on every position is read in board
// coordinates:
//
//   x   0 at the left edge, 1 at the right edge
//   y   up, on the same scale as x, 0 at the height of the left tap; no limit either way
//   d   metres off the board's surface, + toward the writer (shown, not trusted: it drifts)
//
// Only x and y place the hand, so drift toward or away from the board never
// moves the cursor. No DOM here, so the tests run it under Node.

import { G, Tracker, qrot } from '../fusion.js';
import { Intake } from './intake.js';

const RAD = Math.PI / 180;
export const MIN_WIDTH = 0.2;   // metres: two taps closer than this are not the two edges of a board
const SETTLE_S = 0.15;          // a tap's place is read at least this long after it, with the hand at rest
const FAST_S = 0.015;           // the hand's acceleration is averaged over about this long before it is judged
const SLOW_S = 0.25;            // ... and over about this long, to see whether it holds steady
const NO_REST_S = 3;            // waiting this long for a rest is worth saying so

/** A motion event from the kit's Band (t in ms, ax ay az in g, gx gy gz in degrees/second) as a Tracker sample. */
export function fromBand(m) {
  return { t: m.t / 1000, ax: m.ax * G, ay: m.ay * G, az: m.az * G, gx: m.gx * RAD, gy: m.gy * RAD, gz: m.gz * RAD };
}

// Tracker's timings, in seconds here (Tracker itself counts samples).
export const TIMES = {
  settle: 0.6,       // held still at the start: which way is up, and the gyro's bias
  stillFor: 0.1,     // this long calm is a rest. Writers pause between letters for about 0.1 to 0.2 s,
                     // so Tracker's own 0.3 s (tuned for drawing shapes) would see no rest in a whole sentence
  settleOver: 0.05,  // the end of the calm stretch read for the tilt the gyro lost
  tail: 0.02,        // of that, the very end, taken as truly stopped
  lead: 0.3,         // a movement is taken to have begun this long before it was noticed
  biasAfter: 0.2,    // this long at rest before the gyro's bias is touched
};
// These, kp and stillWorld below were picked with tests/board.mjs: on its pretend sessions
// they halve the error of Tracker's own settings (which were tuned for drawing shapes).

/** Tracker's settings for `rate` samples a second. Times in `extra` are in seconds, as in TIMES. */
export function trackerOptions(rate, extra = {}) {
  const options = { ...extra }, times = { ...TIMES };
  for (const key of Object.keys(TIMES)) {
    if (key in options) { times[key] = options[key]; delete options[key]; }
  }
  const n = (seconds) => Math.max(1, Math.round(seconds * rate));
  return {
    settle: n(times.settle), stillFor: n(times.stillFor), settleOver: n(times.settleOver),
    tail: n(times.tail), lead: n(times.lead), biasAfter: n(times.biasAfter),
    biasRate: 1 - 0.99 ** (100 / rate),   // the same pull per second as Tracker's 0.01 a sample at 100 a second
    kp: 10,             // rests between letters are short, so the tilt is pulled back to gravity faster than Tracker's 2
    // A hand held still trembles more than a band on a desk; js/app.js uses these for the live band too.
    stillGyro: 0.06, stillAccel: 0.25,
    stillWorld: 0.25,   // m/s^2: the hand's own acceleration (gravity taken out) must be this small too; see step()
    stillSteady: 0.08,  // m/s^2: ... or hold this steady, which is gravity leaking through a tilt that is off
    calmSmooth: 0,      // s: turning and the size of the reading are averaged over this long before they are judged
    pushSmooth: FAST_S, // s: and the hand's own acceleration over this long
    startStill: [0.1, 0.4],   // rad/s, m/s^2: moving more than this while Tracker reads its start-up stillness starts it again
    ...options,
  };
}

export class BoardTracker {
  /**
   * `rate`: samples a second the band sends. `accelRange`, `gyroRange`: the sensor's
   * ranges (g, degrees/second), to count readings cut off at them. `auto`: ask for the
   * board's two edges by itself whenever there is no board. Any other option goes to Tracker.
   */
  constructor({ rate = 208, accelRange = 16, gyroRange = 2000, auto = false, lowpass = null, ...options } = {}) {
    this.rate = rate;
    this.auto = auto;
    this.options = trackerOptions(rate, options);
    this.intake = new Intake({ accelRange, gyroRange, lowpass, rate });
    this.news = [];             // what happened, oldest first, for the page to show: { type, ... }
    this.heard = 0;             // taps heard, used or not
    this.starts = 0;            // times the start-up began again because the hand moved
    this.lost = 0;              // times the position was lost to missing samples
    this.restart();
  }

  /** Forget the path and the board. The new Tracker first needs the hand held still. */
  restart() {
    this.tracker = new Tracker(this.options);
    this.frame = null;          // the board: { origin, ux, n, width }, from the two taps
    this.want = null;           // what the next tap is for: 'left', 'right', 'anchor', or null = ignore it
    this.pending = [];          // taps whose place is read once the hand rests: { t (s), use }
    this.left = null;           // where the left tap was, until the right one comes
    this.lastT = null;          // the band's time of the last sample, ms
    this.restAt = null;         // the band's time the hand was last at rest, ms: drift builds up from then
    this.push = [0, 0, 0];      // the hand's own acceleration in the world, averaged over about FAST_S, m/s^2
    this.held = [0, 0, 0];      // the same averaged over about SLOW_S
    this.turning = 0;           // rad/s, gyro bias taken out, averaged over calmSmooth
    this.size = G;              // m/s^2: the size of the accelerometer's reading, averaged over calmSmooth
    this.why = null;            // why the last sample was or was not calm, for the bench
    this.hidden = 0;            // samples before this one are cleared from the trail
    this.skips = [];            // [first, last] sample numbers that were gestures, not writing
  }

  get ready() { return this.tracker.ready; }    // the start-up stillness has been read
  get still() { return this.tracker.still; }
  get length() { return this.tracker.length; }
  /** Samples before this one keep their place from now on: Tracker only redoes the latest movement. */
  get settled() { return Math.min(this.tracker.rest, this.tracker.length); }

  /**
   * One motion event from the band, and when it arrived on the computer (ms), if known.
   * It goes through the intake first: short gaps are filled in, and the accelerometer
   * is scaled so that the band at rest reads 1 g.
   */
  feed(m, arrival = null) {
    const { samples, gap } = this.intake.feed(m, arrival);
    if (gap !== null) {
      // Too many samples lost, or the link was down: the hand moved in ways nobody saw.
      this.restart();
      this.lost++;
      this.news.push({ type: 'lost', gap });
    }
    for (const s of samples) this.step(s);
    if (this.auto && this.tracker.ready && !this.frame && !this.want && !this.pending.length) this.setUp();
    if (this.pending.length) this.place();
  }

  step(m) {
    const s = fromBand(m), tr = this.tracker, f = [s.ax, s.ay, s.az], o = this.options;
    if (!tr.ready) {
      // Tracker learns which way is up, and the gyro's bias, from its first moments,
      // taking them to be still. If the hand moves then, it would learn them wrong
      // for good: start again until it really is still.
      const turning = Math.hypot(s.gx, s.gy, s.gz), off = Math.hypot(...f) - G;
      const ok = turning <= o.startStill[0] + 0.05 && Math.abs(off) <= o.startStill[1];
      this.why = { startUp: true, turning, size: off, calm: ok };
      if (!ok && tr.count > 0) {
        this.tracker = new Tracker(o);
        this.starts++;
      }
    } else {
      // Whether the hand is calm is decided here, and Tracker is told through the two
      // limits it reads every sample. Tracker alone calls the hand calm when it barely
      // turns and the accelerometer reads about 1 g. But slowing down sideways hardly
      // changes that reading (1 g and 0.2 g at right angles make 1.02 g), so with rests
      // as short as the pauses between letters, the end of every long move would pass
      // for a rest, and the slowing down would be taken out as drift. So a sample is
      // calm only if the hand's own acceleration in the world, gravity taken out, is
      // small as well. That needs the tilt, and a tilt a degree or two off leaks enough
      // gravity to look like a push, while the tilt is only put right at rests. But
      // gravity leaks steadily, and a hand slowing down does not: so a push that has
      // held steady for a while (a pause of half a second or so) counts as calm too,
      // and at that rest the tilt is put right.
      const dt = (m.t - this.lastT) / 1000, kf = 1 - Math.exp(-dt / o.pushSmooth), ks = 1 - Math.exp(-dt / SLOW_S);
      const kc = o.calmSmooth > 0 ? 1 - Math.exp(-dt / o.calmSmooth) : 1;
      const a = qrot(tr.q, f);
      a[1] -= G;
      for (let i = 0; i < 3; i++) {
        this.push[i] += (a[i] - this.push[i]) * kf;
        this.held[i] += (a[i] - this.held[i]) * ks;
      }
      this.turning += (Math.hypot(s.gx - tr.bias[0], s.gy - tr.bias[1], s.gz - tr.bias[2]) - this.turning) * kc;
      this.size += (Math.hypot(...f) - this.size) * kc;
      const why = {
        turning: this.turning, size: this.size - G, push: Math.hypot(...this.push),
        steady: Math.hypot(this.push[0] - this.held[0], this.push[1] - this.held[1], this.push[2] - this.held[2]),
      };
      why.calm = why.turning < o.stillGyro && Math.abs(why.size) < o.stillAccel && (why.push < o.stillWorld || why.steady < o.stillSteady);
      this.why = why;
      tr.o.stillGyro = why.calm ? Infinity : -1;
      tr.o.stillAccel = why.calm ? Infinity : -1;
    }
    this.lastT = m.t;
    tr.feed(s);
    if (tr.still) this.restAt = m.t;
    // For the camera's fusion: this sample's acceleration in the world (gravity out), and whether at rest.
    if (this.onSample && tr.ready && tr.length) this.onSample(m.t, tr.acc[tr.length - 1], tr.still);
  }

  /** What the tracker is waiting for, in words, for the page and the bench: { text, detail }. */
  status() {
    const quiet = this.restAt === null || this.lastT === null ? null : (this.lastT - this.restAt) / 1000;
    const lost = this.lost ? `Lost track ${this.lost} time${this.lost > 1 ? 's' : ''}: samples went missing.` : '';
    if (this.lastT === null) return { text: 'Waiting for the band', detail: '' };
    if (!this.ready) {
      return { text: 'Hold the band still', detail: this.starts ? 'It moved while starting up; it starts again once still.' : lost };
    }
    const noRest = quiet !== null && quiet > NO_REST_S ? `No rest for ${Math.floor(quiet)} s: is the hand still?` : '';
    if (this.pending.length) return { text: 'Heard the knock: hold still', detail: noRest || lost };
    if (this.want === 'left') return { text: 'Knock the board\'s left edge', detail: this.heard ? lost : `No taps heard yet. ${lost}`.trim() };
    if (this.want === 'right') return { text: 'Now knock its far right edge', detail: lost };
    if (this.want === 'anchor') return { text: 'Knock the left or right edge to re-anchor', detail: '' };
    if (!this.frame) return { text: 'Set up the board', detail: lost };
    return { text: 'Tracking', detail: noRest ? 'Pause for a moment now and then: while the hand never stops, the cursor drifts.' : lost };
  }

  /** The next two taps set up the board: first its left edge, then its far right edge. */
  setUp() {
    this.frame = null;
    this.left = null;
    this.pending = [];
    this.want = 'left';
  }

  /** The next tap is on the left or the right edge, and puts that edge back where the hand is. */
  reanchor() {
    if (this.frame) this.want = 'anchor';
  }

  /** Taps are ignored again (Cancel). */
  stopWaiting() {
    this.want = null;
  }

  /** A tap from the band, at its time `tMs`. Returns what it was taken as, or null if it was ignored. */
  tap(tMs) {
    this.heard++;
    if (!this.want || !this.ready) return null;
    const use = this.want;
    this.pending.push({ t: tMs / 1000, use });
    this.want = use === 'left' ? 'right' : null;
    return use;
  }

  // Read the place of each waiting tap once the hand is at rest after it. A tap
  // ends a movement, and when the hand comes to rest Tracker redoes that whole
  // movement, so a place read any earlier could still move.
  place() {
    const tr = this.tracker;
    if (!tr.still || !tr.length) return;
    const now = tr.t[tr.length - 1];
    while (this.pending.length && now >= this.pending[0].t + SETTLE_S) {
      const { t, use } = this.pending.shift();
      const p = this.worldAt(t);
      if (use === 'left') {
        this.left = p;
        this.news.push({ type: 'left', t: t * 1000 });
      } else if (use === 'right') {
        this.makeBoard(this.left, p, t * 1000);
      } else {
        this.anchor(p);
      }
    }
  }

  makeBoard(left, right, tMs = null) {
    // The board is upright, so only the level part of left-to-right says which way it runs.
    const dx = right[0] - left[0], dz = right[2] - left[2], width = Math.hypot(dx, dz);
    if (width < MIN_WIDTH) {
      this.news.push({ type: 'too-close', width, t: tMs });
      this.want = 'left';                 // the two taps again
      return;
    }
    const ux = [dx / width, 0, dz / width];
    this.frame = { origin: left, ux, n: [-ux[2], 0, ux[0]], width };
    this.hidden = this.length;            // the trail starts here: the way between the two taps is not writing
    this.news.push({ type: 'board', width, rise: right[1] - left[1], t: tMs });
  }

  // Move the nearer edge to where the hand tapped, and the board's surface to it too.
  anchor(p) {
    const f = this.frame, b = this.toBoard(p), edge = b.x < 0.5 ? 0 : 1;
    const along = (b.x - edge) * f.width;
    f.origin = [f.origin[0] + along * f.ux[0] + b.d * f.n[0], f.origin[1], f.origin[2] + along * f.ux[2] + b.d * f.n[2]];
    this.news.push({ type: 'anchor', edge, moved: Math.hypot(along, b.d) });
  }

  /** A point in Tracker's world (metres) in board coordinates. */
  toBoard(p) {
    const f = this.frame, r0 = p[0] - f.origin[0], r1 = p[1] - f.origin[1], r2 = p[2] - f.origin[2];
    return { x: (r0 * f.ux[0] + r2 * f.ux[2]) / f.width, y: r1 / f.width, d: r0 * f.n[0] + r2 * f.n[2] };
  }

  /** Sample i in board coordinates, or null before the board is set up. */
  boardAt(i) {
    const tr = this.tracker;
    return this.frame ? this.toBoard([tr.x[i], tr.y[i], tr.z[i]]) : null;
  }

  /** Where the hand is now, in board coordinates, or null. */
  get cursor() {
    return this.length ? this.boardAt(this.length - 1) : null;
  }

  /** Where the hand was at the band's time `tMs`, in board coordinates, or null. */
  at(tMs) {
    const i = this.indexAt(tMs / 1000);
    return i < 0 ? null : this.boardAt(i);
  }

  /** The sample nearest to time t (seconds), or -1 if there is none yet. */
  indexAt(t) {
    const ts = this.tracker.t;
    if (!ts.length) return -1;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid; else hi = mid;
    }
    return Math.abs(ts[hi] - t) < Math.abs(ts[lo] - t) ? hi : lo;
  }

  worldAt(t) {
    const i = Math.max(0, this.indexAt(t)), tr = this.tracker;
    return [tr.x[i], tr.y[i], tr.z[i]];
  }

  /** Clear the trail drawn so far. The board and the hand's place stay. */
  clearTrail() {
    this.hidden = this.length;
  }

  /** The band's time t0 to t1 (ms) was a gesture, not writing: leave it out of the trail. */
  skip(t0, t1) {
    const a = this.indexAt(t0 / 1000), b = this.indexAt(t1 / 1000);
    if (a >= 0) this.skips.push([a, b]);
  }

  /** Is sample i part of the trail? */
  shown(i) {
    return i >= this.hidden && !this.skips.some(([a, b]) => i >= a && i <= b);
  }

  /**
   * The trail inside a box around (x, y), both in board coordinates, as a list of
   * strokes, each a list of { x, y }. `w` and `h` are the box's size in metres.
   */
  near(x, y, w = 0.3, h = 0.12) {
    if (!this.frame) return [];
    const hw = w / 2 / this.frame.width, hh = h / 2 / this.frame.width, strokes = [];
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
}
