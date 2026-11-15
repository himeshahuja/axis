// Vexo Board, a concept: is the marker on the board? Heard by the band's microphone.
//
// A dry-wipe marker dragged across a whiteboard squeaks and hisses: a broad noise,
// strongest above 3 kHz. Speech is mostly below 3 kHz, in a few strong harmonics,
// except for its s and sh sounds, which hiss too. So each 20 ms of sound (what the
// band's microphone sends: 320 samples at 16 kHz) is split into a low band and a high
// band, and the marker is on the board when the high band stands out and is noise-
// like (flat, not a few harmonics), and the hand is moving at a writing pace. The
// band's microphone exists today; only the timing of each 20 ms is new. No DOM.

import { fft } from '../board/spectrum.js';

export const FRAME = 320;            // samples in 20 ms at 16 kHz
const RATE = 16000;
const N = 512;                       // FFT size: a frame, zero-padded
const HANN = Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/**
 * What one 20 ms frame sounds like: `low` and `high` (dB, energy from 200 Hz to 3 kHz
 * and from 3 to 7.5 kHz), and `flat` (0 to 1: how much the high band is noise rather
 * than tones; its spectral flatness).
 */
export function features(frame) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < FRAME; i++) re[i] = (frame[i] ?? 0) * HANN[i];
  fft(re, im);
  const bin = (hz) => Math.round((hz * N) / RATE);
  let low = 1e-12, high = 1e-12, logSum = 0, n = 0;
  for (let k = bin(200); k < bin(3000); k++) low += re[k] * re[k] + im[k] * im[k];
  for (let k = bin(3000); k < bin(7500); k++) {
    const p = re[k] * re[k] + im[k] * im[k] + 1e-12;
    high += p;
    logSum += Math.log(p);
    n++;
  }
  const flat = Math.exp(logSum / n) / (high / n);
  return { low: 10 * Math.log10(low), high: 10 * Math.log10(high), flat };
}

/**
 * Decides, 50 times a second, whether the marker is on the board. It learns the room's
 * quiet level by itself (the high band's floor), and needs the high band well above it,
 * noise-like, at least as strong as the low band (unless very loud), and the hand
 * moving at a writing pace. Hysteresis and a shortest stroke keep it from flickering.
 */
export class Contact {
  constructor({ rise = 12, fall = 7, slowest = 0.015, fastest = 2.0, shortest = 3 } = {}) {
    this.o = { rise, fall, slowest, fastest, shortest };
    this.floor = null;           // dB: the high band when nothing is going on
    this.on = false;
    this.run = 0;                // frames the raw decision has held
    this.intervals = [];         // [t0, t1] ms: the marker on the board
    this.start = null;
  }

  /**
   * One frame at band time `t` (ms) with its features, the hand's speed (m/s, or null),
   * and `pressing`: whether the forearm's muscles say the marker is pressed on the board
   * (EMG; null without it). Either the hiss or the press will do.
   */
  frame(t, f, speed, pressing = null) {
    // The quiet level: follows the high band down fast, up slowly.
    this.floor = this.floor === null ? f.high : f.high < this.floor ? f.high : this.floor + 0.02;
    const above = f.high - this.floor, o = this.o;
    const writing = speed == null || (speed > o.slowest && speed < o.fastest);
    const hiss = f.flat > 0.35 && (f.high > f.low - 3 || above > o.rise + 10);
    const heard = hiss && above > (this.on ? o.fall : o.rise);
    const raw = writing && (heard || pressing === true);
    if (raw === this.on) { this.run = 0; return this.on; }
    this.run++;
    // Turn on after `shortest` frames; turn off after two, so a stroke's end is not late.
    if (this.run >= (this.on ? 2 : o.shortest)) {
      this.on = raw;
      this.run = 0;
      const back = (this.on ? o.shortest - 1 : 1) * 20;
      if (this.on) this.start = t - back;
      else { this.intervals.push([this.start, t - back]); this.start = null; }
    }
    return this.on;
  }

  /** Was the marker on the board at band time t? */
  at(t) {
    if (this.on && this.start !== null && t >= this.start) return true;
    let lo = 0, hi = this.intervals.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, [a, b] = this.intervals[mid];
      if (t < a) hi = mid - 1; else if (t > b) lo = mid + 1; else return true;
    }
    return false;
  }
}
