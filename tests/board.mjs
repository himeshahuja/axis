// node tests/board.mjs                        the board tracker, the band's input, and the Take/Put gestures
// node tests/board.mjs --bench file.json      what a recording (bench.html or board.html) shows: the stream,
//                                             its spectrum, and why the tracker did or did not set up the
//                                             board. --lowpass 8 replays it through an 8 Hz low-pass
//
// Plays pretend sessions at a whiteboard (js/board/simulate.js) through the
// board tracker and says how far its cursor is from where the hand really was,
// in centimetres on the board:
//   width    how far off the board's width came out, from the two taps
//   settled  the trail once each movement has been corrected (median, 95th percentile)
//   live     the cursor as it was shown at the time, before that correction
//   shape    each word against itself, both started at the same point: what decides legibility
// Then the gestures, and the same session played through the kit's own pretend band.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BAND } from '../js/board/config.js';
import { alongBoard, Fused } from '../js/board/fuse.js';
import { decode, encode, Gestures, loadFromBand, saveToBand } from '../js/board/gestures.js';
import { apply, homography, invert } from '../js/board/homography.js';
import { findColour, findLight, sample, vivid, VIVID_ENOUGH } from '../js/board/light.js';
import { fromSession, readRecording, Recorder } from '../js/board/recording.js';
import { examples, session } from '../js/board/simulate.js';
import { bands, peaks, spectrum } from '../js/board/spectrum.js';
import { BoardTracker } from '../js/board/tracker.js';

let failed = 0;
const check = (ok, line) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
  if (!ok) failed++;
};
const cm = (m) => (m * 100).toFixed(1).padStart(5);
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN;
};

/** Feed a session to a board tracker as the page does: taps as they come, the board set up by the first two. */
export function track(s, options = {}) {
  const bt = new BoardTracker({ rate: s.rate, ...options });
  bt.setUp();
  const live = new Map();
  let k = 0;
  s.samples.forEach((m, i) => {
    while (k < s.taps.length && s.taps[k] <= m.t) bt.tap(s.taps[k++]);
    bt.feed(m);
    if (bt.frame) live.set(i, bt.cursor);
  });
  return { bt, live };
}

/** How far the tracker was from the truth, in metres on the board. */
export function measure(s, { bt, live }) {
  const W = s.board.width, [x0, y0] = s.board.left;
  const truth = (i) => [s.truth[i][0] - x0, s.truth[i][1] - y0];
  const boardOf = (i) => bt.boardAt(bt.indexAt(s.samples[i].t / 1000));
  if (!bt.frame) return { width: NaN, settled: [NaN, NaN], live: [NaN, NaN], shape: [NaN, NaN] };
  const words = s.words.map(([a, b]) => s.samples.flatMap((m, i) => (m.t >= a && m.t <= b ? [i] : [])));
  const settled = [], shown = [];
  for (const i of words.flat()) {
    const b = boardOf(i), [tx, ty] = truth(i), l = live.get(i);
    settled.push(Math.hypot(b.x * W - tx, b.y * W - ty));
    if (l) shown.push(Math.hypot(l.x * W - tx, l.y * W - ty));
  }
  const shapes = words.map((idx) => {
    const bf = boardOf(idx[0]), tf = truth(idx[0]);
    let sum = 0;
    for (const i of idx) {
      const b = boardOf(i), t = truth(i);
      sum += ((b.x - bf.x) * W - (t[0] - tf[0])) ** 2 + ((b.y - bf.y) * W - (t[1] - tf[1])) ** 2;
    }
    return Math.sqrt(sum / idx.length);
  });
  return {
    width: bt.frame.width - W,
    settled: [quantile(settled, 0.5), quantile(settled, 0.95)],
    live: [quantile(shown, 0.5), quantile(shown, 0.95)],
    shape: [quantile(shapes, 0.5), Math.max(...shapes)],
  };
}

const row = (name, rate, r) =>
  `${name.padEnd(7)}${String(rate).padStart(4)}/s  width ${cm(r.width)}   settled ${cm(r.settled[0])} ${cm(r.settled[1])}   live ${cm(r.live[0])} ${cm(r.live[1])}   shape ${cm(r.shape[0])} ${cm(r.shape[1])}`;

function accuracy() {
  console.log('     cm on the board         width      settled 50% 95%      live 50% 95%      shape 50% worst');
  const results = {};
  for (const name of ['reach', 'walk', 'steady']) {
    for (const rate of [100, 208, 416]) {
      const s = session(name, { rate });
      results[`${name}@${rate}`] = measure(s, track(s));
      console.log('     ' + row(name, rate, results[`${name}@${rate}`]));
    }
  }
  console.log('     (reach: 1.2 m board, short pauses between letters; walk: 2.4 m board, side-steps;');
  console.log('      steady: written without a single pause, the worst case for motion sensors alone)');
  const reach = results['reach@208'], walk = results['walk@208'];
  check(Math.abs(reach.width) < 0.02, `reach at 208/s: the board's width within 2 cm (${cm(reach.width).trim()} cm)`);
  check(reach.settled[0] < 0.04 && reach.settled[1] < 0.1, `reach at 208/s: trail within 4 cm half the time, 10 cm 95% (${cm(reach.settled[0]).trim()}, ${cm(reach.settled[1]).trim()} cm)`);
  check(reach.shape[0] < 0.012, `reach at 208/s: words keep their shape to 1.2 cm (${cm(reach.shape[0]).trim()} cm)`);
  check(Math.abs(walk.width) < 0.06 && walk.settled[0] < 0.05, `walk at 208/s: width within 6 cm, trail within 5 cm half the time (${cm(walk.width).trim()}, ${cm(walk.settled[0]).trim()} cm)`);
  return results;
}

function trackerRules() {
  const s = session('reach', { rate: 208 });
  const firstTap = s.taps[0];
  // Moving while the tracker reads its start-up stillness: it waits until the hand is still.
  const fidget = new BoardTracker({ rate: 208 });
  let readyAt = null;
  s.samples.slice(0, 600).forEach((m, i) => {
    fidget.feed(i < 100 ? { ...m, gz: m.gz + 40 } : m);   // turning at 40 degrees/second for the first half second
    if (fidget.ready && readyAt === null) readyAt = i;
  });
  check(readyAt !== null && readyAt >= 100 + 124, `moving at start-up: it waits for 0.6 s of stillness after the hand stops (ready at sample ${readyAt})`);

  // A tracker that started with the gyro's bias 1 degree/second off gets it back at
  // pauses of a second, and loses the board without them (the page says to pause).
  const off = (pause) => measure(...[session('reach', { rate: 208, cleanStart: true, pause })].map((one) => [one, track(one)]).flat());
  const paused = off(1.0), never = off(0);
  check(paused.settled[0] < 0.08 && never.settled[0] > 1, `gyro bias 1 deg/s off: ${cm(paused.settled[0]).trim()} cm with 1 s pauses before words, ${cm(never.settled[0]).trim()} cm with none`);

  // Taps are ignored unless the board is being set up or re-anchored.
  const idle = new BoardTracker({ rate: 208 });
  for (const m of s.samples.slice(0, 1000)) idle.feed(m);
  check(idle.tap(firstTap) === null, 'a tap with nothing asked for is ignored');

  // A gap in the band's time loses track, and says so.
  const gap = new BoardTracker({ rate: 208 });
  s.samples.slice(0, 600).forEach((m) => gap.feed(m));
  gap.feed({ ...s.samples[600], t: s.samples[600].t + 400 });
  check(gap.news.some((n) => n.type === 'lost') && !gap.ready, 'a 400 ms gap in the samples loses track and starts again');

  // Two taps too close together are not a board: it asks for the left edge again.
  const close = new BoardTracker({ rate: 208 });
  close.setUp();
  const left = s.samples.findIndex((m) => m.t >= firstTap), soon = s.samples.findIndex((m) => m.t > firstTap + 1000);
  s.samples.forEach((m, i) => {
    if (i === left) close.tap(firstTap);
    if (i === soon) close.tap(m.t);       // a second later the hand has barely left the left edge
    close.feed(m);
  });
  check(close.news.some((n) => n.type === 'too-close') && close.want === 'left', 'two taps 0 cm apart: "too close", and the left edge is asked for again');

  // Re-anchoring: a tap on the right edge, where the board says x = 0.97, puts x back to exactly 1.
  const { bt } = track(s);
  bt.frame.origin = [bt.frame.origin[0] + 0.036 * bt.frame.ux[0], bt.frame.origin[1], bt.frame.origin[2] + 0.036 * bt.frame.ux[2]];
  const right = s.taps[1], before = bt.at(right).x;
  bt.reanchor();
  bt.tap(right);
  bt.feed({ ...s.samples.at(-1), t: s.samples.at(-1).t + 1 });   // a sample at rest, after it: the tap is placed
  check(Math.abs(before - 0.97) < 0.01 && Math.abs(bt.at(right).x - 1) < 1e-9, `re-anchor at the right edge: x ${before.toFixed(3)} -> ${bt.at(right).x.toFixed(3)}`);
}

/** Gestures taught from pretend examples, then a session with one Take and one Put in the middle of writing. */
function gestures() {
  const book = new Gestures(208);
  const taught = ['take', 'put', 'none'].map((label) => book.teach(label, examples(label, 5, { rate: 208, seed: 3 })));
  check(taught[0] === 5 && taught[1] === 5 && taught[2] >= 3, `taught take ${taught[0]}, put ${taught[1]}, not-a-gesture ${taught[2]} examples`);

  const s = session('reach', { rate: 208, gestures: true });
  const bt = new BoardTracker({ rate: 208 });
  bt.setUp();
  const found = [];
  let k = 0;
  for (const m of s.samples) {
    while (k < s.taps.length && s.taps[k] <= m.t) bt.tap(s.taps[k++]);
    bt.feed(m);
    const g = book.feed(m);
    if (g && (g.label === 'take' || g.label === 'put')) found.push({ label: g.label, t0: g.samples[0].t, at: bt.at(g.samples[0].t), distance: g.distance });
  }
  const want = s.gestures.map((g) => g.label).join(' '), got = found.map((g) => g.label).join(' ');
  check(got === want, `in a session of writing: found "${got}", made "${want}"`);
  const take = found.find((g) => g.label === 'take'), made = s.gestures.find((g) => g.label === 'take');
  if (take && made) {
    const i = s.samples.findIndex((m) => m.t >= made.t0), W = s.board.width;
    const off = Math.hypot(take.at.x * W - s.truth[i][0], take.at.y * W - (s.truth[i][1] - s.board.left[1]));
    check(off < 0.05 && Math.abs(take.t0 - made.t0) < 150, `Take is placed where the hand was when it began: ${cm(off).trim()} cm off, ${Math.round(take.t0 - made.t0)} ms from its start`);
  }

  // Writing alone, with long words and side-steps: nothing is taken for a gesture.
  let falses = 0;
  for (const name of ['walk', 'steady', 'reach']) {
    const plain = session(name, { rate: 208, seed: 5 });
    for (const m of plain.samples) {
      const g = book.feed(m);
      if (g && (g.label === 'take' || g.label === 'put')) falses++;
    }
  }
  check(falses === 0, `three sessions of writing and walking, no gestures in them: ${falses} false Take/Put`);

  // Kept on the band as bytes and read back, every example still matches its own label.
  const round = new Gestures(208);
  for (const label of ['take', 'put', 'none']) round.examples[label] = book.examples[label].map((shape) => decode(encode(label, shape)).shape);
  const worst = Math.max(...['take', 'put', 'none'].flatMap((label) => book.examples[label].map((shape, i) =>
    Math.max(...shape.map((v, j) => Math.abs(v - round.examples[label][i][j]))))));
  check(worst <= 1 / 32 + 1e-9, `an example kept as bytes comes back within 1/32 (worst ${worst.toFixed(4)})`);
  check(decode(new TextEncoder().encode('not ours')) === null, "another program's data in those slots is ignored");
  return book;
}

/** The same kind of session through the kit's own pretend band: units, times and taps as the page gets them. */
async function throughTheKit(book) {
  let kit;
  try {
    kit = await import('../vexo-open-kit/js/src/index.js');
  } catch {
    console.log('skip the kit is missing: run  git submodule update --init');
    return;
  }
  const { Band, SimTransport } = kit;
  // The pretend band's chip runs 0.8 % slow (CHIP_CLOCK in the kit's sim.js) and plays one
  // entry of a list per sample it takes, so the session is made at the rate it really samples.
  const s = session('reach', { rate: 208 / 1.008, gestures: true });
  const sim = new SimTransport(BAND, { autoTap: false, realtime: false });
  const band = await Band.connect(BAND, { transport: sim });
  const motion = [], taps = [];
  band.on('motion', (m) => motion.push(m));
  band.on('tap', (e) => taps.push(e.t));
  await band.setMotion({ accelRange: 16 });
  await band.setEvents({ kinds: ['tap', 'double-tap'] });
  sim.playMotion(s.samples.map(({ ax, ay, az, gx, gy, gz }) => ({ ax, ay, az, gx, gy, gz })));
  await band.configure({ motion: 208, events: true });
  for (const t of s.taps) sim.after((t - s.samples[0].t) / 1000, () => sim.tap('tap'));
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const span = s.samples.at(-1).t - s.samples[0].t;
  for (let ms = 0; ms < span; ms += 50) {
    sim.step(50);
    await tick();
  }
  // The pretend band's clock only moves when told to, and its storage takes 10 writes a
  // second of that clock: keep it moving while the examples are saved and read back.
  const meanwhile = async (work) => {
    let done = false;
    const result = work().finally(() => { done = true; });
    while (!done) {
      sim.step(100);
      await tick();
    }
    return result;
  };
  await band.configure({ motion: false });
  const kept = await meanwhile(() => saveToBand(band, book.examples));
  const back = await meanwhile(() => loadFromBand(band));
  await band.disconnect();

  check(motion.length >= s.samples.length - 15 && taps.length === s.taps.length, `the pretend band sent ${motion.length} of ${s.samples.length} samples and ${taps.length} of ${s.taps.length} taps`);
  // The k-th sample it sent is the k-th one played: the truth goes with it.
  const n = Math.min(motion.length, s.samples.length), at = (t) => motion[Math.min(n - 1, s.samples.findIndex((m) => m.t >= t))].t;
  const played = { ...s, samples: motion.slice(0, n), truth: s.truth.slice(0, n), taps, words: s.words.map(([a, b]) => [at(a), at(b)]) };
  const r = measure(played, track(played)), direct = measure(s, track(s));
  console.log('     ' + row('kit', 208, r));
  console.log('     ' + row('direct', 208, direct));
  check(Math.abs(r.width) < 0.02 && Math.abs(r.settled[0] - direct.settled[0]) < 0.01,
    'through the kit, the board comes out as it does fed directly (width within 2 cm, trail within 1 cm of it)');
  check(kept === back.take.length + back.put.length + back.none.length && back.take.length === book.examples.take.length,
    `${kept} examples saved to the band's storage and loaded back`);
}

/** Real-band trouble, simulated: an accelerometer a little off, a trembling hand, lost samples. */
function realInput() {
  const base = session('reach', { rate: 208 }), clean = measure(base, track(base));
  const run = (options, trackerOptions = {}) => {
    const s = session('reach', { rate: 208, ...options }), t = track(s, trackerOptions);
    return { s, t, r: measure(s, t) };
  };
  const high = run({ chip: { scale: [1.03, 1.03, 1.03] } });
  check(Boolean(high.t.bt.frame) && high.r.settled[0] < 0.06, `an accelerometer reading 3% high: board set up, trail within ${cm(high.r.settled[0]).trim()} cm (it learned 1 g reads ${high.t.bt.intake.oneG.toFixed(3)} g)`);
  const offset = run({ chip: { offset: [0.3, -0.25, 0.3] } });
  check(Boolean(offset.t.bt.frame) && offset.r.settled[0] < 0.06, `an accelerometer 0.3 m/s² off on each axis: board set up, trail within ${cm(offset.r.settled[0]).trim()} cm`);

  const few = run({ drop: [[10.5, 14]] }), frame = run({ drop: [[10.5, 50]] });
  const st = frame.t.bt.intake.stats;
  check(Math.abs(few.r.settled[0] - clean.settled[0]) < 0.005 && Math.abs(frame.r.settled[0] - clean.settled[0]) < 0.005 && !frame.t.bt.lost,
    `3 lost samples and a lost 50 ms frame are filled in: trail ${cm(few.r.settled[0]).trim()} and ${cm(frame.r.settled[0]).trim()} cm, against ${cm(clean.settled[0]).trim()} with none lost`);
  check(st.lost === st.bridged && st.lost >= 9 && st.lost <= 11 && st.gaps === 0, `the intake counts the lost frame: ${st.lost} lost, ${st.bridged} filled in, ${st.gaps} gaps`);

  const cut = new BoardTracker({ rate: 208 });
  base.samples.slice(0, 50).forEach((m, i) => cut.feed(i % 10 ? m : { ...m, ax: 16, gz: -2000 }));
  check(cut.intake.stats.clipped === 5, `readings at the sensor's range are counted as cut off: ${cut.intake.stats.clipped} of 5`);

  const auto = new BoardTracker({ rate: 208, auto: true });
  let k = 0;
  for (const m of base.samples) {
    while (k < base.taps.length && base.taps[k] <= m.t) auto.tap(base.taps[k++]);
    auto.feed(m);
  }
  check(Boolean(auto.frame) && Math.abs(auto.frame.width - base.board.width) < 0.02, `with nothing pressed, the board sets itself up from the first two knocks (${cm(auto.frame?.width ?? NaN).trim()} cm wide)`);

  const shaky = run({ tremor: 0.2 }), filtered = run({ tremor: 0.2 }, { lowpass: 6 });
  check(Boolean(filtered.t.bt.frame) && filtered.r.settled[0] < 0.15,
    `a trembling hand (0.2 m/s² at 8 to 12 Hz): ${shaky.t.bt.frame ? `${cm(shaky.r.settled[0]).trim()} cm` : 'no board'} unfiltered, ${cm(filtered.r.settled[0]).trim()} cm with a 6 Hz low-pass`);
}

/**
 * A session with a camera, fused as the board page does: the camera's corners give the
 * board, each fix goes in at the time of its picture (or of its arrival, uncompensated).
 */
export function fuseSession(s, { compensate = true, imu = true } = {}) {
  const c = s.camera, W = c.board.width, H = c.board.height;
  const toBoard = homography(c.corners, [[0, H], [W, H], [W, 0], [0, 0]]);
  const bt = new BoardTracker({ rate: s.rate });
  bt.setUp();
  const fused = new Fused({ width: W, height: H });
  bt.onSample = (t, acc, still) => fused.step(t, imu && bt.frame ? alongBoard(acc, bt.frame.ux) : null, imu && still);
  const fixes = [...c.fixes].sort((a, b) => a.arrives - b.arrives);
  let f = 0, k = 0;
  for (const m of s.samples) {
    while (f < fixes.length && fixes[f].arrives <= m.t) {
      const fx = fixes[f++], [x, y] = apply(toBoard, [fx.u, fx.v]);
      fused.fix(compensate ? fx.t : fx.arrives, x, y);
    }
    while (k < s.taps.length && s.taps[k] <= m.t) bt.tap(s.taps[k++]);
    bt.feed(m);
  }
  // Against the truth, in metres, while writing (and, separately, while the light was hidden).
  const at = new Map(s.samples.map((m, i) => [m.t, i])), all = [], hidden = [], t0 = s.samples[0].t;
  for (let i = 0; i < fused.length; i++) {
    const j = at.get(fused.t[i]), t = fused.t[i];
    if (j === undefined || !s.words.some(([a, b]) => t >= a && t <= b)) continue;
    const e = Math.hypot(fused.x[i] - s.truth[j][0], fused.y[i] - (s.truth[j][1] - c.board.bottom));
    all.push(e);
    if ((s.hidden ?? []).some(([a, len]) => t >= t0 + a * 1000 && t < t0 + (a + len) * 1000)) hidden.push(e);
  }
  return { bt, fused, median: quantile(all, 0.5), p95: quantile(all, 0.95), hiddenWorst: hidden.length ? Math.max(...hidden) : NaN };
}

/** The camera: the board in its picture, finding the light, and the fusion with the band. */
function cameraChecks() {
  const corners = [[170, 80], [1130, 120], [1150, 640], [150, 690]], board = [[0, 1.2], [1.6, 1.2], [1.6, 0], [0, 0]];
  const H = homography(corners, board), back = invert(H);
  const worst = Math.max(...corners.map((p, i) => Math.hypot(...apply(H, p).map((v, k) => v - board[i][k]))), ...board.map((p) => {
    const there = apply(H, apply(back, p));
    return Math.hypot(there[0] - p[0], there[1] - p[1]);
  }));
  check(worst < 1e-9, `the board's corners map exactly, and back again (${worst.toExponential(1)} m)`);

  // A picture: a white board, the green light at (73.4, 41.7), its dimmer reflection beside it.
  const width = 160, height = 100, data = new Uint8ClampedArray(width * height * 4);
  const blob = (x, y, cx, cy, size, strength) => strength * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * size * size));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = Math.min(1, blob(x + 0.5, y + 0.5, 73.4, 41.7, 2.2, 1) + blob(x + 0.5, y + 0.5, 95, 60, 2.6, 0.55));
      const p = (y * width + x) * 4, grey = 235 + ((x * 7 + y * 13) % 9);
      data[p] = grey * (1 - a) + 40 * a; data[p + 1] = grey * (1 - a) + 255 * a; data[p + 2] = grey * (1 - a) + 60 * a; data[p + 3] = 255;
    }
  }
  const lit = findLight({ data, width, height }, { near: [70, 45], within: 40 });
  const far = findLight({ data, width, height }, { near: null });
  check(lit && Math.hypot(lit.u - 73.4, lit.v - 41.7) < 0.3 && far && Math.hypot(far.u - 73.4, far.v - 41.7) < 0.3,
    `the light is found at (${lit?.u.toFixed(2)}, ${lit?.v.toFixed(2)}) for (73.4, 41.7), its reflection passed over`);
  // Green marker ink, and a big bright green thing (a poster, a wall), are not the light.
  const paint = (x0, y0, w, h, rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const p = (y * width + x) * 4; [data[p], data[p + 1], data[p + 2]] = rgb; }
  };
  paint(5, 5, 50, 4, [40, 140, 70]);
  paint(100, 5, 55, 30, [60, 230, 50]);
  const busy = findLight({ data, width, height }, { near: null });
  check(busy && Math.hypot(busy.u - 73.4, busy.v - 41.7) < 0.3, `green ink and a big green patch in the picture do not pass for the light (found at ${busy?.u.toFixed(1)}, ${busy?.v.toFixed(1)})`);

  // The band by its own colour: an orange strap on a white board, half of it in shadow, beside black ink and a hand.
  const pic = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4, grey = 228 + ((x * 5 + y * 11) % 7);
      let rgb = [grey, grey, grey];
      if (x >= 60 && x < 84 && y >= 30 && y < 40) rgb = x < 72 ? [230, 120, 40] : [138, 72, 24];   // the strap, its right half shaded
      else if (y >= 70 && y < 74 && x >= 10 && x < 140) rgb = [30, 30, 34];                       // a line of black ink
      else if (x >= 110 && x < 140 && y >= 20 && y < 50) rgb = [215, 170, 140];                    // a hand
      [pic[p], pic[p + 1], pic[p + 2]] = rgb;
      pic[p + 3] = 255;
    }
  }
  const strap = { data: pic, width, height }, taught = sample(strap, 66, 35, 2), band = findColour(strap, taught, { near: null });
  check(band && Math.hypot(band.u - 72, band.v - 35) < 1 && vivid(taught) > VIVID_ENOUGH && vivid([30, 30, 34]) < VIVID_ENOUGH,
    `the band by its colour: taught by one click, found at (${band?.u.toFixed(1)}, ${band?.v.toFixed(1)}) for (72, 35), shade and all, not the hand or the ink; a black band is flagged as too grey`);

  const s = session('reach', { rate: 208, camera: {} }), on = fuseSession(s), late = fuseSession(s, { compensate: false }), alone = fuseSession(s, { imu: false });
  check(on.median < 0.01 && on.p95 < 0.03, `camera and band: trail within ${cm(on.median).trim()} cm half the time, ${cm(on.p95).trim()} cm 95% (camera alone: ${cm(alone.median).trim()}, ${cm(alone.p95).trim()})`);
  check(late.median > 2 * on.median, `pictures taken 80 ms before they arrive: ${cm(late.median).trim()} cm if that is ignored, ${cm(on.median).trim()} cm when each goes in at its own time`);
  const hide = [[16, 1.5], [24, 0.8]], hidden = session('reach', { rate: 208, camera: { hide } });
  const through = fuseSession({ ...hidden, hidden: hide }), blindCam = fuseSession({ ...hidden, hidden: hide }, { imu: false });
  check(through.hiddenWorst < 0.05, `the light hidden for 1.5 s: the band keeps the trail within ${cm(through.hiddenWorst).trim()} cm (camera alone: ${cm(blindCam.hiddenWorst).trim()} cm)`);

  const wrong = session('reach', { rate: 208, camera: {}, reversed: true }), r = fuseSession(wrong), first = r.fused.knockAt(wrong.taps[0], 'left');
  check(!first.ok && first.across > 0.75, `knocking the right edge first: the camera saw it ${Math.round(first.across * 100)}% across, so it is refused as the left edge`);
}

/** The spectrum, and recordings written and read back. */
function benchParts() {
  const rate = 208, values = Array.from({ length: 2048 }, (_, i) => Math.sin(2 * Math.PI * 9 * (i / rate)) + 0.3 * Math.sin(2 * Math.PI * 1.5 * (i / rate)) + 0.05 * Math.sin(i * 12.9898));
  const sp = spectrum(values, rate), top = peaks(sp, 1, 3)[0], b = bands(sp);
  check(Math.abs(top.hz - 9) < 0.5 && Math.abs(b.tremor - Math.SQRT1_2) < 0.05, `spectrum of a 9 Hz sine: peak at ${top.hz.toFixed(2)} Hz, ${b.tremor.toFixed(3)} in the tremor band (0.707 expected)`);

  const rec = new Recorder({ rate: 208, band: 'Vexo-HACK-00' });
  rec.motion({ t: 1, n: 0, ax: 0, ay: 0, az: 1, gx: 0, gy: 0, gz: 0 }, 5);
  rec.event(1, 'tap');
  const back = readRecording(JSON.stringify(rec));
  const v1 = readRecording({ kind: 'air-draw board session', version: 1, rate: 208, samples: [[1, 0, 0, 1, 0, 0, 0]], events: [] });
  check(back.samples[0].az === 1 && back.samples[0].arrived === 5 && back.events[0].kind === 'tap' && v1.samples[0].az === 1,
    'a recording reads back the same, and board.html\'s older recordings still read');
  let refused = '';
  try { readRecording('{"kind":"something else","samples":[]}'); } catch (e) { refused = e.message; }
  check(refused.length > 0, `a file that is not a recording is refused: "${refused}"`);

  const report = benchReport(readRecording(fromSession(session('reach', { rate: 208, drop: [[12, 50]] }))));
  check(report.summary.width && Math.abs(report.summary.width - 1.2) < 0.03 && report.summary.lost >= 10 && report.summary.lost <= 11,
    `the bench report on a simulated recording: board ${(report.summary.width * 100).toFixed(1)} cm, ${report.summary.lost} samples lost`);
}

/**
 * What a recording shows: the stream's health, its spectrum, the stillness of each still
 * step of a guided capture, and the tracker's timeline: so a recording from a real band
 * says why there was or was not a cursor.
 */
export function benchReport(rec, { lowpass = null } = {}) {
  const lines = [], line = (text) => lines.push(text);
  const samples = rec.samples, t0 = samples[0].t, at = (t) => `${((t - t0) / 1000).toFixed(2).padStart(7)} s`;
  const seconds = (samples.at(-1).t - t0) / 1000;
  line(`${rec.band ?? 'a recording'}: ${samples.length} samples over ${seconds.toFixed(1)} s, recorded at ${rec.rate} a second` +
    `${rec.firmware ? `, firmware ${rec.firmware}` : ''}${rec.motion ? `, ±${rec.motion.accelRange} g, ±${rec.motion.gyroRange} °/s` : ''}${lowpass ? `; replayed with a ${lowpass} Hz low-pass` : ''}`);

  // The stream.
  const gaps = [];
  for (let i = 1; i < samples.length; i++) gaps.push(samples[i].t - samples[i - 1].t);
  const typical = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? NaN, usual = gaps.filter((g) => g < 2.5 * typical);
  const mean = usual.reduce((a, b) => a + b, 0) / usual.length, jitter = Math.sqrt(usual.reduce((a, b) => a + (b - mean) ** 2, 0) / usual.length);
  const arrivals = samples.map((s) => s.arrived).filter(Number.isFinite);
  let packets = 0;
  arrivals.forEach((a, i) => { if (!i || a - arrivals[i - 1] > 2) packets++; });

  // The tracker, fed as the page fed it, and with the camera if the recording has one.
  const cam = rec.camera && rec.fixes?.length ? rec.camera : null;
  const toBoard = cam ? homography(cam.corners, [[0, cam.height], [cam.width, cam.height], [cam.width, 0], [0, 0]]) : null;
  let bt, fused = null, f = 0;
  const apart = [];                 // cm between the band alone and the camera, sample by sample
  const fresh = () => {
    bt = new BoardTracker({ rate: rec.rate, auto: rec.version !== 1, lowpass });
    if (cam) {
      fused = new Fused({ width: cam.width, height: cam.height, tip: cam.tip ?? [0, 0] });
      bt.onSample = (t, acc, still) => fused.step(t, bt.frame ? alongBoard(acc, bt.frame.ux) : null, still);
    }
  };
  fresh();
  const timeline = [], fails = { turning: 0, size: 0, push: 0, judged: 0, calm: 0 }, placed = [];
  let k = 0, measuring = false, wasStill = false, wasReady = false, rests = 0, firstRest = null;
  const heard = (e) => {
    if (e.kind === 'double-tap') {
      timeline.push(`${at(e.t)}  double-tap${bt.frame ? ': re-anchor next' : ''}`);
      if (bt.frame) bt.reanchor();
      return;
    }
    const use = bt.tap(e.t);
    if (use === null && measuring && bt.frame) placed.push(e.t);
    timeline.push(`${at(e.t)}  tap${use ? `: taken as the ${use === 'anchor' ? 're-anchor' : `${use} edge`}` : `, not used (${bt.status().text.toLowerCase()})`}`);
  };
  for (const m of samples) {
    while (k < rec.events.length && rec.events[k].t <= m.t) {
      const e = rec.events[k++];
      if (e.kind === 'tap' || e.kind === 'double-tap') heard(e);
      else if (e.kind === 'restart') fresh();
      else if (e.kind === 'set-up') bt.setUp();
      else if (e.kind === 'reanchor') bt.reanchor();
      else if (e.kind === 'measure') measuring = Boolean(e.on);
      else if (e.kind === 'step') timeline.push(`${at(e.t)}  capture step ${e.step + 1}: ${e.label}`);
      else if (e.kind === 'notice') timeline.push(`${at(e.t)}  notice from the band: ${e.notice}`);
    }
    while (cam && f < rec.fixes.length && rec.fixes[f].t <= m.t) {
      const fx = rec.fixes[f++], [x, y] = apply(toBoard, [fx.u, fx.v]);
      fused.fix(fx.t, x, y);
    }
    bt.feed(m, m.arrived);
    if (fused?.length && bt.frame && fused.blindFor(m.t) < 200) {
      const a = bt.cursor, b = fused.cursor;
      apart.push(Math.hypot(a.x * bt.frame.width - b.x * fused.size.width, a.y * bt.frame.width - b.y * fused.size.width));
    }
    if (bt.ready && !wasReady) timeline.push(`${at(m.t)}  tracker ready (start-up stillness read${bt.starts ? `, after ${bt.starts} restart${bt.starts > 1 ? 's' : ''}` : ''})`);
    wasReady = bt.ready;
    if (bt.still && !wasStill) { rests++; firstRest ??= m.t; }
    wasStill = bt.still;
    for (const n of bt.news.splice(0)) {
      if (fused && n.type === 'left') {
        const i = fused.indexAt(n.t);
        if (i >= 0) fused.y0 = fused.y[i] + fused.tip[1];
      }
      if (fused && (n.type === 'left' || n.type === 'board')) {
        const k = fused.knockAt(n.t, n.type === 'left' ? 'left' : 'right');
        if (k.across !== null) timeline.push(`${at(m.t)}  the camera saw that knock ${Math.round(k.across * 100)}% across${k.ok ? '' : ': the wrong edge'}`);
      }
      const text = n.type === 'board' ? `board set up: ${(n.width * 100).toFixed(1)} cm wide` : n.type === 'lost' ? `lost track: ${Math.round(n.gap)} ms missing` : n.type === 'left' ? 'left edge placed' : `${n.type} ${JSON.stringify(n)}`;
      timeline.push(`${at(m.t)}  ${text}`);
    }
    const w = bt.why, o = bt.options;
    if (bt.ready && w && !w.startUp) {
      fails.judged++;
      if (w.calm) fails.calm++;
      if (w.turning >= o.stillGyro) fails.turning++;
      if (Math.abs(w.size) >= o.stillAccel) fails.size++;
      if (w.push >= o.stillWorld && w.steady >= o.stillSteady) fails.push++;
    }
  }
  const h = bt.intake.stats, share = (n) => (fails.judged ? `${Math.round((100 * n) / fails.judged)}%` : '–');
  line(`stream: ${(1000 / mean).toFixed(1)} a second, jitter ${jitter.toFixed(2)} ms; ${h.lost} lost (${h.bridged} filled in, ${h.gaps} gaps, longest ${Math.round(h.longestGap)} ms); ${h.clipped} cut off at range` +
    (packets ? `; ${(packets / seconds).toFixed(1)} packets a second, ${(arrivals.length / packets).toFixed(1)} samples each` : ''));
  line(`1 g reads as ${bt.intake.oneG ? `${bt.intake.oneG.toFixed(3)} g` : 'unknown: the band was never still for 0.3 s'}`);

  // The spectrum, of all of it, and of each still step.
  const describeSpectrum = (part, label) => {
    if (part.length < 64) return;
    const r = (part.length - 1) / ((part.at(-1).t - part[0].t) / 1000);
    const sum = (keys, scale, unit, digits) => {
      let best = null, tremor = 0, above = 0, writing = 0;
      for (const key of keys) {
        const sp = spectrum(part.map((s) => s[key]), r), top = peaks(sp, 1, 1)[0], b = bands(sp);
        if (top && (!best || top.power > best.power)) best = top;
        tremor += b.tremor ** 2; above += b.above ** 2; writing += b.writing ** 2;
      }
      return `${best ? `peak ${best.hz.toFixed(1)} Hz, ` : ''}below 5 Hz ${(Math.sqrt(writing) * scale).toFixed(digits)}, tremor band ${(Math.sqrt(tremor) * scale).toFixed(digits)}, above 12 Hz ${(Math.sqrt(above) * scale).toFixed(digits)} ${unit}`;
    };
    line(`${label}: acceleration ${sum(['ax', 'ay', 'az'], 1000, 'mg', 1)}; turning ${sum(['gx', 'gy', 'gz'], 1, '°/s', 2)}`);
  };
  describeSpectrum(samples, 'spectrum, all of it');
  const steps = rec.events.filter((e) => e.kind === 'step');
  steps.forEach((step, i) => {
    if (step.label !== 'still') return;
    const end = steps[i + 1]?.t ?? samples.at(-1).t, part = samples.filter((s) => s.t >= step.t + 1000 && s.t <= end);
    describeSpectrum(part, `still step ${step.step + 1} (${((end - step.t - 1000) / 1000).toFixed(1)} s)`);
    if (part.length > 10) {
      const sizes = part.map((s) => Math.hypot(s.ax, s.ay, s.az)), m = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      line(`    the band read ${m.toFixed(3)} g for 1 g there, wobbling ±${(Math.sqrt(sizes.reduce((a, b) => a + (b - m) ** 2, 0) / sizes.length) * 1000).toFixed(1)} mg`);
    }
  });

  line(`rests: ${rests} found${firstRest === null ? '' : `, the first at ${at(firstRest).trim()}`}; calm ${share(fails.calm)} of the time after start-up. Over the limit: turning ${share(fails.turning)}, reading − 1 g ${share(fails.size)}, the hand's own push ${share(fails.push)}`);
  line('timeline:');
  for (const entry of timeline.slice(0, 60)) line(`  ${entry}`);
  if (timeline.length > 60) line(`  ... and ${timeline.length - 60} more`);
  line(`at the end: ${bt.status().text}${bt.status().detail ? ` (${bt.status().detail})` : ''}`);

  if (cam) {
    const fps = rec.fixes.length / seconds;
    line(`camera: ${rec.fixes.length} fixes (${fps.toFixed(1)} a second)` + (apart.length
      ? `; the band alone against the camera: ${cm(quantile(apart, 0.5)).trim()} cm half the time, ${cm(quantile(apart, 0.95)).trim()} cm 95%, worst ${cm(Math.max(...apart)).trim()} cm`
      : '; the band alone could not be compared (no board set up, or the light never seen)'));
  }

  // Taps on measured dots, and the truth of a simulated session.
  const width = rec.measure?.width;
  if (bt.frame && placed.length) {
    placed.forEach((t, i) => {
      const b = bt.at(t), dot = rec.measure?.dots?.[i], scale = width ?? bt.frame.width * 100, x = b.x * scale, y = b.y * scale;
      line(`  dot tap ${i + 1}: (${x.toFixed(1)}, ${y.toFixed(1)}) cm${dot ? `, the dot is at (${dot[0]}, ${dot[1]}): off by ${Math.hypot(x - dot[0], y - dot[1]).toFixed(1)} cm` : ''}`);
    });
  }
  if (rec.truth && rec.board && bt.frame) {
    const r = measure({ ...rec, words: rec.words ?? [] }, { bt, live: new Map() });
    line(`against the truth: width ${cm(r.width).trim()} cm off, trail ${cm(r.settled[0]).trim()} cm (95%: ${cm(r.settled[1]).trim()}), word shapes ${cm(r.shape[0]).trim()} cm`);
  }
  return { lines, bt, summary: { width: bt.frame?.width ?? null, ready: bt.ready, rests, heard: bt.heard, lost: h.lost, calm: fails.judged ? fails.calm / fails.judged : null } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = Math.max(process.argv.indexOf('--bench'), process.argv.indexOf('--replay'));
  const lp = process.argv.indexOf('--lowpass');
  if (at > 0) {
    const rec = readRecording(readFileSync(process.argv[at + 1], 'utf8'));
    for (const text of benchReport(rec, { lowpass: lp > 0 ? Number(process.argv[lp + 1]) : null }).lines) console.log(text);
  } else {
    accuracy();
    trackerRules();
    realInput();
    cameraChecks();
    benchParts();
    const book = gestures();
    await throughTheKit(book);
    process.exitCode = failed ? 1 : 0;
  }
}
