// Take and Put: two gestures the wearer teaches the page, plus "not a gesture"
// (a few ordinary strokes of writing, so that writing does not pass for one).
// They are recognised the kit's way (recogniser.js, copied from its gesture
// trainer): the motion is cut into pieces at moments of stillness, each piece
// is squeezed into 24 points in time, and the nearest example names it.
//
// The examples can be kept on the band itself, in its storage, so they go
// wherever the band goes. No DOM here, so the tests run it under Node.

import { Segmenter, match, toShape, POINTS } from './recogniser.js';

export const LABELS = ['take', 'put', 'none'];
export const SLOTS = { first: 900, count: 30 };  // the band's storage keys 900 to 929 hold the examples
const VERSION = 1;
const SCALE = 16;            // each of a shape's numbers is kept on the band as one signed byte, times this
const TUNED_AT = 50;         // samples a second the recogniser's numbers were tuned for

export class Gestures {
  /** `rate`: samples a second the band sends. The recogniser gets about 50 of them a second. */
  constructor(rate = 208) {
    this.every = Math.max(1, Math.round(rate / TUNED_AT));
    this.count = 0;
    this.segmenter = new Segmenter();
    this.examples = { take: [], put: [], none: [] };
    this.recording = null;   // the label being taught, or null to recognise
  }

  get trained() {
    return this.examples.take.length > 0 || this.examples.put.length > 0;
  }

  /**
   * One motion event from the band. When a piece of motion has just ended, returns
   * { label, distance, samples }: while teaching, `label` is the one being taught;
   * otherwise it is the nearest example's ('none' or null when it is no gesture).
   */
  feed(m) {
    if (this.count++ % this.every) return null;
    const piece = this.segmenter.feed(m);
    if (!piece) return null;
    const shape = toShape(piece);
    if (this.recording) {
      this.examples[this.recording].push(shape);
      return { label: this.recording, taught: true, distance: 0, samples: piece };
    }
    if (!this.trained) return null;
    const found = match(shape, LABELS.flatMap((label) => this.examples[label].map((one) => ({ label, shape: one }))));
    return { label: found.label, distance: found.distance, samples: piece };
  }

  /** Drop a piece of motion in progress (the link dropped). */
  reset() {
    this.segmenter.reset();
  }

  /**
   * Learn `label` from recorded motion: a list of sample lists, each one example with
   * rest around it. Returns how many were learned.
   */
  teach(label, lists) {
    let learned = 0;
    for (const list of lists) {
      const segmenter = new Segmenter();
      for (let i = 0; i < list.length; i += this.every) {
        const piece = segmenter.feed(list[i], 0);
        if (piece) {
          this.examples[label].push(toShape(piece));
          learned++;
          break;
        }
      }
    }
    return learned;
  }
}

/** One example as the band keeps it: version, label, then the 144 numbers times 16, one signed byte each. */
export function encode(label, shape) {
  const bytes = new Uint8Array(2 + shape.length);
  bytes[0] = VERSION;
  bytes[1] = LABELS.indexOf(label);
  shape.forEach((v, i) => { bytes[2 + i] = Math.max(-127, Math.min(127, Math.round(v * SCALE))) & 0xff; });
  return bytes;
}

/**
 * The other way. Whatever is in the band's storage was written by whoever connected
 * last, so anything that is not one of our examples is ignored (null).
 */
export function decode(bytes) {
  if (!bytes || bytes.length !== 2 + POINTS * 6 || bytes[0] !== VERSION || !(bytes[1] < LABELS.length)) return null;
  return { label: LABELS[bytes[1]], shape: Array.from(bytes.subarray(2), (b) => (b > 127 ? b - 256 : b) / SCALE) };
}

/** Keep the examples on the band, in its storage slots 900 to 929, emptying any left over. Returns how many were kept. */
export async function saveToBand(band, examples) {
  const all = LABELS.flatMap((label) => examples[label].map((shape) => encode(label, shape))).slice(0, SLOTS.count);
  for (let i = 0; i < SLOTS.count; i++) {
    if (i < all.length) {
      await band.storage.put(SLOTS.first + i, all[i]);
    } else {
      try {
        await band.storage.delete(SLOTS.first + i);
      } catch (e) {
        if (e.code !== 'not-found') throw e;   // already empty
      }
    }
  }
  return all.length;
}

/** The examples kept on the band, or empty lists if there are none. */
export async function loadFromBand(band) {
  const examples = { take: [], put: [], none: [] };
  for (let i = 0; i < SLOTS.count; i++) {
    const one = decode(await band.storage.get(SLOTS.first + i));
    if (one) examples[one.label].push(one.shape);
  }
  return examples;
}
