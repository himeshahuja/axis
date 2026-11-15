// Vexo Board, a concept: what its hardware would report during a pretend session.
//
// The hand's true path and the band's motion samples come from js/board/simulate.js.
// On top of them: the clicks the band sends and when each puck hears them (with the
// timing's jitter, the hand or the body sometimes in the way, and echoes), and the
// band's microphone, 20 ms at a time, with the marker hissing on the board, the
// writer sometimes talking, and the room. The band sits on the wrist, a hand's length
// from the marker's tip, and turns with the hand. No DOM: the tests and concept.html
// run it.

import { qconj, qrot } from '../fusion.js';
import { session } from '../board/simulate.js';
import { FRAME } from './contact.js';
import { BLOCK, CHANNELS } from './emg.js';
import { speedOfSound, survey } from './ultrasound.js';

const BOTTOM = 0.8;                 // the board's bottom edge above the floor, m
const HEIGHT = 1.2;                 // the board's height, m (its width is the scene's)
const OFF = 0.03;                   // the marker held this far off the board between strokes
const TOUCHING = 0.003;             // the marker this close to the board is on it

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A session with the concept's hardware. Options: `pingHz` clicks a second; `jitter`
 * seconds of timing noise per puck; `delay` ms from a click to its timings reaching
 * the computer; `blocked` whether the hand or body sometimes blocks a puck (it then
 * hears an echo or nothing); `talk` whether the writer talks now and then; `celsius`
 * the room. Returns the board session (samples, truth, ...) and: `layout` (as the
 * pucks measure it), `pings` [{ t, arrives, delays }], `audio` [{ t, samples }],
 * `tip` and `band` (true places in board metres, per sample), `touching` (per sample),
 * and `tipBody` (where the tip is from the band, in the band's own axes).
 */
export function conceptSession(name = 'reach', {
  seed = 1, pingHz = 50, jitter = 10e-6, delay = 15, blocked = true, talk = true, celsius = 22, rate = 208,
  noisy = false,      // a loud room (air conditioning, a projector fan): hiss on the microphone all the time
  emg = true,         // the band has EMG electrodes
} = {}) {
  const prelude = (s) => {
    // Touch the marker's tip to the bottom left puck and hold it there: the band learns
    // where the tip is from itself.
    s.move([0.0, BOTTOM + 0.0, OFF], 0.7);
    s.move([0.0, BOTTOM, 0], 0.15);
    s.rest(1.2);
    s.move([0.0, BOTTOM, OFF], 0.15);
  };
  const base = session(name, { rate, seed, prelude });
  const W = base.board.width, rand = mulberry(seed * 97 + 13);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  // The band on the wrist: the tip is 13 cm above it, 3 cm along and 7 cm nearer the
  // board while writing, and the offset turns with the hand.
  const first = base.words[0][0], ref = base.samples.findIndex((m) => m.t >= first + 300);
  const tipBody = qrot(qconj(base.turns[ref]), [0.03, 0.13, -0.07]);
  const tip = base.truth.map((p) => [p[0], p[1] - BOTTOM, p[2]]);
  const band = base.truth.map((p, i) => {
    const d = qrot(base.turns[i], tipBody);
    return [p[0] - d[0], p[1] - BOTTOM - d[1], p[2] - d[2]];
  });
  const touching = tip.map((p) => p[2] < TOUCHING);

  // The pucks, and the distances between them as they measure them (to a millimetre).
  const pucks = [[0, 0, 0], [0, HEIGHT, 0], [W, HEIGHT, 0]];
  const layout = survey({ across: W + 0.001 * gauss(), up: HEIGHT + 0.001 * gauss(), diagonal: Math.hypot(W, HEIGHT) + 0.001 * gauss() });

  // Spells when a puck's straight path is blocked: about a tenth of the time each.
  const t0 = base.samples[0].t, t1 = base.samples.at(-1).t, spells = [[], [], []];
  if (blocked) {
    for (const list of spells) {
      for (let t = t0 + 3000 * rand(); t < t1; t += 4000 + 4000 * rand()) list.push([t, t + 200 + 600 * rand(), rand() < 0.6]);
    }
  }
  const c = speedOfSound(celsius), pings = [];
  let i = 0;
  for (let t = t0; t <= t1; t += 1000 / pingHz) {
    while (i < base.samples.length - 1 && base.samples[i + 1].t <= t) i++;
    const b = band[i], at = base.samples[i].t;
    const delays = pucks.map((p, k) => {
      const d = Math.hypot(b[0] - p[0], b[1] - p[1], b[2] - p[2]) / c + jitter * gauss();
      const spell = spells[k].find(([a, z]) => at >= a && at < z);
      if (!spell) return d;
      return spell[2] ? d + (0.05 + 0.35 * rand()) / c : null;       // an echo: the long way round; or nothing
    });
    pings.push({ t: at, arrives: at + delay, delays });
  }

  // The microphone, 20 ms at a time.
  const speeds = tip.map((p, k) => (k ? Math.hypot(p[0] - tip[k - 1][0], p[1] - tip[k - 1][1]) * rate : 0));
  const talking = [];
  if (talk) for (let t = t0 + 2000 * rand(); t < t1; t += 3000 + 5000 * rand()) talking.push([t, t + 1000 + 2000 * rand()]);
  const audio = [];
  let j = 0, prev = 0, phase = 0;
  for (let t = t0; t + 20 <= t1; t += 20) {
    while (j < base.samples.length - 1 && base.samples[j + 1].t <= t + 10) j++;
    const samples = new Float32Array(FRAME);
    const scratch = touching[j] && speeds[j] > 0.01 ? 0.02 * (0.4 + Math.min(1, speeds[j] / 0.5)) : 0;
    const speaking = talking.some(([a, z]) => t >= a && t < z);
    const syllable = speaking ? Math.max(0, Math.sin((2 * Math.PI * 4 * (t - t0)) / 1000)) : 0;
    const fricative = speaking && rand() < 0.15;
    const f0 = 140 + 30 * Math.sin(t / 300);
    for (let n = 0; n < FRAME; n++) {
      const white = gauss();
      let v = (noisy ? 0.006 : 0.0006) * white + (noisy ? 0.02 * (white - prev) : 0);   // the room
      if (scratch) { v += scratch * (white - prev) * 0.7; }        // hiss: noise tilted to the highs
      if (syllable) {
        phase += (2 * Math.PI * f0) / 16000;
        for (let h = 1; h * f0 < 3500; h++) v += (0.05 * syllable * Math.sin(h * phase)) / h;
      }
      if (fricative) v += 0.012 * (white - prev);
      prev = white;
      samples[n] = v;
    }
    audio.push({ t, samples, touching: touching[j] });
  }
  // The forearm's muscles, 1000 samples a second on 8 channels, in 20 ms blocks. Each
  // channel is noise whose strength follows how hard its muscles work: a little at rest,
  // some to hold the marker (once picked up), more to press it on the board, a little more
  // while the arm moves; and two pinches, in still moments when not writing.
  const muscle = [];
  const pinches = [];
  if (emg) {
    const still = [];
    for (let k = 0; k < tip.length; k += 52) {
      if (!touching[k] && speeds[k] < 0.01 && base.samples[k].t > t0 + 4000) still.push(base.samples[k].t);
    }
    for (const at of [still[Math.floor(still.length * 0.4)], still[Math.floor(still.length * 0.8)]]) if (at) pinches.push([at, at + 300]);
    const picked = t0 + 1500, strength = [1, 0.9, 1.1, 0.8, 0.7, 0.9, 1, 1.2];   // electrodes sit a little differently
    let k = 0;
    for (let t = t0; t + 20 <= t1; t += 20) {
      while (k < base.samples.length - 1 && base.samples[k + 1].t <= t + 10) k++;
      const holding = t > picked ? 0.12 : 0, press = touching[k] ? 0.14 + 0.06 * Math.min(1, speeds[k] / 0.4) : 0;
      const moving = 0.06 * Math.min(1, speeds[k] / 0.8), pinch = pinches.some(([a, z]) => t >= a && t < z) ? 0.7 : 0;
      const block = [];
      for (let c = 0; c < CHANNELS; c++) {
        const effort = 0.02 + moving + (c < 4 ? holding + press : 0) + (c === 4 || c === 5 ? pinch : 0) + (c < 4 ? 0.1 * pinch : 0);
        const samples = new Float32Array(BLOCK);
        for (let n = 0; n < BLOCK; n++) samples[n] = strength[c] * (effort * gauss() + 0.004 * gauss()) * 1e-3 + 2e-3;   // volts, and the electrode's offset
        block.push(samples);
      }
      muscle.push({ t, block });
    }
  }
  // The calibration a real band would ask for, a second each: relaxed, squeezing hard, and
  // holding the marker in the air (the grip that is not pressing).
  const strength = [1, 0.9, 1.1, 0.8, 0.7, 0.9, 1, 1.2];
  const blocks = (effort) => Array.from({ length: 50 }, () => strength.map((k, c) => Float32Array.from({ length: BLOCK }, () => k * (effort(c) * gauss() + 0.004 * gauss()) * 1e-3 + 2e-3)));
  const emgCalibration = emg ? { relaxed: blocks(() => 0.02), hard: blocks(() => 1), holding: blocks((c) => 0.02 + (c < 4 ? 0.12 : 0)) } : null;
  return { ...base, layout, pucks, pings, audio, emg: muscle, emgCalibration, pinches, tip, band, touching, tipBody, celsius, bottom: BOTTOM };
}
