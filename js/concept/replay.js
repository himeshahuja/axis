// Vexo Board, a concept: a simulated session played into the tracker in the order its
// data would arrive, and scored against the truth. Shared by tests/concept.mjs and
// concept.html. No DOM.

import { VexoBoard } from './tracker.js';

/**
 * Everything the hardware sends, in the order it reaches the computer: motion samples as
 * they are made, each click's timings after the pucks' delay, and each 20 ms of EMG and of
 * sound once the 20 ms are over (EMG first, so the microphone's frame can use it).
 */
export function arrivals(s, { emg = true } = {}) {
  return [
    ...s.samples.map((m) => ({ at: m.t, kind: 'motion', data: m })),
    ...s.pings.map((p) => ({ at: p.arrives, kind: 'ping', data: p })),
    ...(emg && s.emg ? s.emg.map((e) => ({ at: e.t + 19.9, kind: 'emg', data: e })) : []),
    ...s.audio.map((a) => ({ at: a.t + 20, kind: 'audio', data: a })),
  ].sort((a, b) => a.at - b.at);
}

/** A tracker for the session, calibrated as a real band would be at the start. */
export function tracker(s, { emg = true } = {}) {
  const vb = new VexoBoard(s.layout, { celsius: s.celsius });
  if (emg && s.emgCalibration) vb.calibrateEmg(s.emgCalibration.relaxed, s.emgCalibration.hard, s.emgCalibration.holding);
  return vb;
}

/** Hand one arrival to the tracker. */
export function deliver(vb, a) {
  if (a.kind === 'motion') vb.feed(a.data);
  else if (a.kind === 'ping') vb.ping(a.data);
  else if (a.kind === 'emg') vb.emg(a.data);
  else vb.audio(a.data);
}

/** The whole session through a new tracker. */
export function play(s, options = {}) {
  const vb = tracker(s, options);
  for (const a of arrivals(s, options)) deliver(vb, a);
  return vb;
}

const quantile = (a, p) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.floor(p * (b.length - 1))] : NaN;
};

/**
 * How well it did: the tip's error while the marker was on the board (median and 95%,
 * m), the band's, the marker-on-board decision 50 times a second (precision: of the
 * moments it said "on", how many were; recall: of the moments the marker moved on the
 * board, how many it caught), strokes made against strokes written, and pinches.
 */
export function score(s, vb) {
  const index = new Map(s.samples.map((m, i) => [m.t, i])), f = vb.fused, tip = [], band = [];
  for (let i = 0; i < f.length; i++) {
    const k = index.get(f.t[i]);
    if (k === undefined || !s.touching[k] || !vb.ready) continue;
    const [x, y] = vb.tipAt(i);
    tip.push(Math.hypot(x - s.tip[k][0], y - s.tip[k][1]));
    band.push(Math.hypot(f.x[i] - s.band[k][0], f.y[i] - s.band[k][1]));
  }
  let right = 0, wrong = 0, missed = 0, k = 0;
  const moving = (j) => j > 0 && Math.hypot(s.tip[j][0] - s.tip[j - 1][0], s.tip[j][1] - s.tip[j - 1][1]) * s.rate > 0.02;
  for (const a of s.audio) {
    while (k < s.samples.length - 1 && s.samples[k].t < a.t + 10) k++;
    const on = vb.contact.at(a.t + 10);
    if (on && a.touching) right++;
    else if (on) wrong++;
    else if (a.touching && moving(k)) missed++;
  }
  // Strokes really written: the marker on the board and moving, apart by 60 ms or more.
  let written = 0, last = -Infinity;
  s.samples.forEach((m, j) => {
    if (s.touching[j] && moving(j)) {
      if (m.t - last > 60) written++;
      last = m.t;
    }
  });
  const pinched = vb.news.filter((n) => n.type === 'pinch').map((n) => n.t);
  const found = s.pinches.filter(([a, z]) => pinched.some((t) => t >= a - 50 && t <= z)).length;
  return {
    tip: [quantile(tip, 0.5), quantile(tip, 0.95)], band: [quantile(band, 0.5), quantile(band, 0.95)],
    precision: right / Math.max(1, right + wrong), recall: right / Math.max(1, right + missed),
    strokes: vb.strokes().length, written, pinches: { found, of: s.pinches.length, extra: pinched.length - found },
    clicks: { ...vb.pings.stats },
  };
}
