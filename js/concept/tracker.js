// Vexo Board, a concept: the marker's tip on the board, from the band's clicks, its
// motion and its microphone together.
//
//   pucks' timings  -> where the band is (ultrasound.js), 50 times a second, exact to a few mm
//   band's motion   -> moves it on between clicks, 208 times a second (js/board/fuse.js),
//                      and says how the hand is turned, so the tip (a hand's length from the
//                      band) can be placed: it is measured once, by touching the tip to the
//                      bottom left puck
//   band's mic      -> whether the marker is on the board (contact.js): what is ink
//
// The board is set up as in js/board: knock its left edge, then its right edge. The
// knocks also tell the motion sensor which way the board runs. No DOM: the tests run it.

import { qconj, qrot } from '../fusion.js';
import { alongBoard, Fused } from '../board/fuse.js';
import { BoardTracker } from '../board/tracker.js';
import { Contact, features } from './contact.js';
import { Envelope, Muscles } from './emg.js';
import { Pings } from './ultrasound.js';

const NEAR_PUCK = 0.3;       // m: the band this close to the bottom left puck and still is the tip held on it
const FIX_NOISE = 0.004;     // m: one click's place, from all three pucks
const PARTIAL_NOISE = 0.025; // m: from two pucks and a guess at the band's distance out from the board

export class VexoBoard {
  /** `layout`: from survey() (the pucks' own measurements). */
  constructor(layout, { rate = 208, celsius = 20 } = {}) {
    this.layout = layout;
    this.bt = new BoardTracker({ rate, auto: true });
    this.pings = new Pings(layout, { celsius });
    this.fused = new Fused({ width: layout.width, height: layout.height, fixNoise: FIX_NOISE });
    this.contact = new Contact();
    this.envelope = new Envelope();
    this.muscles = new Muscles();
    this.pressing = new Map();   // band time of each 20 ms EMG block -> pressing (for the microphone's frame then)
    this.qs = [];            // how the band was turned at each entry of the trail (sensor -> motion world)
    this.held = null;        // the tip held on the bottom left puck: { q, at (mean of its clicks), n }
    this.tipBody = null;     // the tip, from the band, in the band's own axes
    this.news = [];
    this.bt.onSample = (t, acc, still) => {
      const n = this.fused.length;
      this.fused.step(t, this.bt.frame ? alongBoard(acc, this.bt.frame.ux) : null, still);
      if (this.fused.length > n) this.qs.push([...this.bt.tracker.q]);
    };
  }

  /** A motion sample from the band. */
  feed(m) {
    this.bt.feed(m);
    for (const n of this.bt.news.splice(0)) {
      this.news.push(n);
      if (n.type === 'board' && this.held && !this.tipBody) this.learnTip();
    }
  }

  /** The pucks' timings for one click: { t, delays }. */
  ping(p) {
    const f = this.fused, expect = f.axes ? [f.axes[0].s[0], f.axes[1].s[0]] : null;
    const at = this.pings.fix(p.t, p.delays, expect);
    if (!at) return null;
    if (at.regained) this.fused.jump(p.t, at.x, at.y, at.v);
    else this.fused.fix(p.t, at.x, at.y, at.used === 3 ? FIX_NOISE : PARTIAL_NOISE);
    // The tip held on the bottom left puck: the band near it and still, before the board is
    // set up. One click's distance out from the board is noisy (the pucks all lie on it), so
    // every click of the hold is averaged; moving away and back starts a new hold.
    if (!this.tipBody && this.bt.tracker.ready) {
      const near = at.used === 3 && this.bt.still && Math.hypot(at.x, at.y, at.z) < NEAR_PUCK;
      if (near) {
        const h = this.holding ?? { q: null, sum: [0, 0, 0], n: 0 };
        h.q = [...this.bt.tracker.q];
        h.sum = h.sum.map((v, k) => v + [at.x, at.y, at.z][k]);
        h.n++;
        this.holding = h;
        if (h.n >= 10) this.held = { q: h.q, at: h.sum.map((v) => v / h.n), n: h.n };
      } else if (!this.bt.still) {
        this.holding = null;
      }
    }
    return at;
  }

  /** 20 ms from the band's microphone: { t, samples }. Uses the EMG block of the same 20 ms, if there is one. */
  audio(a) {
    const press = this.pressing.has(a.t) ? this.pressing.get(a.t) : null;
    this.pressing.delete(a.t);
    return this.contact.frame(a.t, features(a.samples), this.speedAt(a.t + 10), press);
  }

  /**
   * The EMG's calibration, a second of blocks each: relaxed, squeezing as hard as is
   * comfortable, and holding the marker in the air.
   */
  calibrateEmg(relaxed, hard, holding) {
    this.envelope.calibrate(relaxed, hard);
    this.muscles.holding(holding.map((b) => this.envelope.level(b)));
  }

  /** 20 ms of EMG from the band: { t, block } (block[c]: samples of channel c). Returns { pressing, pinch }. */
  emg(e) {
    const m = this.muscles.frame(e.t, this.envelope.level(e.block));
    this.pressing.set(e.t, m.pressing);
    if (m.pinch) this.news.push({ type: 'pinch', t: e.t });
    return m;
  }

  // The tip is at the puck, (0, 0, 0); the band was at `held.at`. In the motion sensor's
  // world that offset is turned by the board's direction, known once the board is set up.
  learnTip() {
    const { q, at } = this.held, d = [-at[0], -at[1], -at[2]];
    this.tipBody = qrot(qconj(q), this.toWorld(d));
    this.news.push({ type: 'tip', length: Math.hypot(...d) });
  }

  toWorld([x, y, z]) {
    const { ux, n } = this.bt.frame;
    return [x * ux[0] + z * n[0], y, x * ux[2] + z * n[2]];
  }

  /** The tip at entry i of the trail, board metres [x, y] (the band's place until the tip is known). */
  tipAt(i) {
    const f = this.fused, band = [f.x[i], f.y[i]];
    if (!this.tipBody || !this.bt.frame) return band;
    const v = qrot(this.qs[i], this.tipBody), { ux } = this.bt.frame;
    return [band[0] + v[0] * ux[0] + v[2] * ux[2], band[1] + v[1]];
  }

  /** The hand's speed along the board at band time t, m/s, from the trail; null before there is one. */
  speedAt(t) {
    const f = this.fused;
    if (f.length < 12) return null;
    const i = f.indexAt(t), j = Math.max(0, i - 10);
    const dt = (f.t[i] - f.t[j]) / 1000;
    return dt > 0 ? Math.hypot(f.x[i] - f.x[j], f.y[i] - f.y[j]) / dt : null;
  }

  get ready() { return Boolean(this.bt.frame && this.tipBody); }

  /** What to do now. */
  status() {
    if (!this.fused.axes) return 'Waiting for the pucks to hear the band';
    if (!this.tipBody && !this.held) return 'Touch the marker\'s tip to the bottom left puck and hold it there';
    if (!this.bt.frame) return this.bt.status().text;
    return 'Writing';
  }

  /** The ink: each stroke the marker made on the board, as tip places { x, y, t } in board metres. */
  strokes() {
    const out = [], f = this.fused;
    if (!this.ready) return out;
    let stroke = null;
    for (let i = 0; i < f.length; i++) {
      if (this.contact.at(f.t[i])) {
        if (!stroke) out.push((stroke = []));
        const [x, y] = this.tipAt(i);
        stroke.push({ x, y, t: f.t[i] });
      } else {
        stroke = null;
      }
    }
    return out.filter((s) => s.length > 2);
  }

  /** The ink as a file for a handwriting recogniser: centimetres from the board's bottom left, ms. */
  ink() {
    const r = (v) => Math.round(v * 1000) / 10;
    return {
      kind: 'vexo-board ink', unit: 'cm', board: { width: r(this.layout.width), height: r(this.layout.height) },
      strokes: this.strokes().map((s) => ({ x: s.map((p) => r(p.x)), y: s.map((p) => r(p.y)), t: s.map((p) => Math.round(p.t)) })),
    };
  }
}
