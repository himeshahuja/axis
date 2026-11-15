// Vexo Board, a concept: the forearm's muscles, read by electrodes inside the band (EMG).
//
// Muscles that move the fingers and wrist sit in the forearm, under the band. Each
// fires small electrical bursts when it works; electrodes on the skin pick them up as
// a noisy signal whose strength (its envelope) follows how hard the muscle works.
// Eight electrodes round the wrist, read 1000 times a second, give:
//
//   - pressing: holding a marker takes some grip; pressing it on the board takes more,
//     in the flexors on the palm side. A second way to tell the marker is on the board,
//     which keeps working when the room is too loud for the microphone.
//   - pinch: thumb and index pressed together, a gesture with no arm movement, to take
//     the writing near the hand (pinch) and put it down (pinch again).
//   - later, handwriting itself: Meta's sEMG wristband research decodes handwriting from
//     these signals (Nature, 2025). That needs a trained model, so here it is only the
//     shape of the data such a model would take (`window`).
//
// No position: muscles do not know where the hand is. No DOM: the tests run it.

export const EMG_RATE = 1000;          // samples a second, each channel
export const CHANNELS = 8;             // electrodes round the wrist
export const BLOCK = 20;               // samples in 20 ms: the band sends EMG in 20 ms blocks
export const FLEXORS = [0, 1, 2, 3];   // palm side: grip and press
export const PINCH = [4, 5];           // thumb side: pinch

/**
 * The strength of each channel, 50 times a second: each 20 ms block's own mean taken
 * out (the electrodes' offset and slow drift; the muscles' signal is all above 20 Hz),
 * then its root mean square. Then scaled
 * by what each channel reads at rest and at its strongest, so 0 is relaxed and 1 is as
 * hard as the person pressed when asked to (a two-second calibration).
 */
export class Envelope {
  constructor() {
    this.rest = null;          // per channel, raw strength at rest
    this.max = null;           // per channel, raw strength at its hardest
  }

  /** One block: `block[c]` a Float32Array of BLOCK samples for channel c. Returns raw strengths. */
  raw(block) {
    const out = new Float64Array(CHANNELS);
    for (let c = 0; c < CHANNELS; c++) {
      const x = block[c], mean = x.reduce((a, v) => a + v, 0) / x.length;
      let sum = 0;
      for (const v of x) sum += (v - mean) * (v - mean);
      out[c] = Math.sqrt(sum / x.length);
    }
    return out;
  }

  /** Learn rest and strongest from blocks recorded relaxed and pressing hard. */
  calibrate(relaxed, hard) {
    const avg = (blocks) => Array.from({ length: CHANNELS }, (_, c) => blocks.reduce((a, b) => a + b[c], 0) / blocks.length);
    this.rest = avg(relaxed.map((b) => this.raw(b)));
    this.max = avg(hard.map((b) => this.raw(b)));
  }

  /** One block, as 0 (relaxed) to 1 (hardest) per channel. */
  level(block) {
    const r = this.raw(block);
    if (!this.rest) return Array.from(r);
    return Array.from(r, (v, c) => Math.max(0, (v - this.rest[c]) / Math.max(1e-9, this.max[c] - this.rest[c])));
  }
}

/**
 * Pressing and pinching, from the levels. Pressing is the flexors working harder than
 * they do just holding the marker. Moving the arm works every muscle a little, so the
 * flexors are measured against the back-of-the-wrist channels, smoothed over about 60 ms
 * (one 20 ms reading of a muscle is noisy), and the holding level is learned as it goes.
 * A pinch is the thumb-side channels high while the rest stay low, for a tenth of a
 * second at least.
 */
export class Muscles {
  constructor({ press = 0.08, pinch = 0.45, pinchMs = 100 } = {}) {
    this.o = { press, pinch, pinchMs };
    this.hold = null;          // flexors over the rest, while just holding the marker
    this.smooth = null;
    this.pinching = null;      // ms the pinch began, while it lasts
    this.events = [];          // { t, type: 'pinch' }
    this.last = null;
  }

  /** The grip of holding the marker in the air, from a second of levels recorded that way. */
  holding(levels) {
    const d = levels.map((l) => FLEXORS.reduce((a, k) => a + l[k], 0) / FLEXORS.length - (l[6] + l[7]) / 2);
    this.hold = d.reduce((a, b) => a + b, 0) / d.length;
    this.calibrated = true;
  }

  /** One block at band time t (ms): `level` per channel. Returns { pressing, pinch }. */
  frame(t, level) {
    const mean = (ks) => ks.reduce((a, k) => a + level[k], 0) / ks.length;
    const flex = mean(FLEXORS), thumb = mean(PINCH), others = mean([6, 7]);
    this.smooth = this.smooth === null ? flex - others : this.smooth + (flex - others - this.smooth) * 0.4;
    const d = this.smooth;
    if (this.calibrated) {
      // Measured holding the marker: it only drifts (electrodes settle, the arm tires),
      // so it follows slowly, and only readings near it (not relaxed, not pressing).
      if (Math.abs(d - this.hold) < this.o.press / 2) this.hold += (d - this.hold) * 0.005;
    } else {
      // Not measured: learned as the low end of what the flexors do, down fast, up slowly.
      this.hold = this.hold === null ? d : d < this.hold ? this.hold + (d - this.hold) * 0.2 : this.hold + 0.0004;
    }
    const pressing = d - this.hold > this.o.press;
    let pinch = false;
    if (thumb > this.o.pinch && others < this.o.pinch / 2) {
      this.pinching ??= t;
      if (t - this.pinching >= this.o.pinchMs && !this.fired) {
        this.events.push({ t: this.pinching, type: 'pinch' });
        this.fired = true;
        pinch = true;
      }
    } else {
      this.pinching = null;
      this.fired = false;
    }
    this.last = { t, flex, thumb, pressing };
    return { pressing, pinch };
  }
}

/**
 * The last `ms` of levels, every channel, as rows of numbers: what a handwriting model
 * trained on sEMG would read (the model itself is not part of this concept's code).
 */
export function window(history, t, ms = 2000) {
  return history.filter((h) => h.t > t - ms && h.t <= t).map((h) => h.level);
}
