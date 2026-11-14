// node tests/board.mjs                       the board tracker and the Take/Put gestures
// node tests/board.mjs --replay session.json  how a session recorded on board.html came out
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
import { decode, encode, Gestures, loadFromBand, saveToBand } from '../js/board/gestures.js';
import { examples, session } from '../js/board/simulate.js';
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
  check(paused.settled[0] < 0.06 && never.settled[0] > 1, `gyro bias 1 deg/s off: ${cm(paused.settled[0]).trim()} cm with 1 s pauses before words, ${cm(never.settled[0]).trim()} cm with none`);

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

/** A session recorded on board.html: its taps on measured dots, against where the dots really are. */
function replay(file) {
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  let bt = new BoardTracker({ rate: rec.rate });
  const events = [...rec.events].sort((a, b) => a.t - b.t);
  const placed = [];
  let k = 0, measuring = false;
  for (const [t, ax, ay, az, gx, gy, gz] of rec.samples) {
    while (k < events.length && events[k].t <= t) {
      const e = events[k++];
      if (e.kind === 'restart') bt = new BoardTracker({ rate: rec.rate });
      else if (e.kind === 'set-up') bt.setUp();
      else if (e.kind === 'reanchor') bt.reanchor();
      else if (e.kind === 'measure') measuring = e.on;
      else if (e.kind === 'tap' && bt.tap(e.t) === null && measuring && bt.frame) placed.push(e.t);
    }
    bt.feed({ t, ax, ay, az, gx, gy, gz });
  }
  console.log(`${rec.samples.length} samples at ${rec.rate}/s from ${rec.band}, ${placed.length} taps on dots`);
  for (const n of bt.news) console.log('  ', JSON.stringify(n));
  const width = rec.measure?.width;          // cm, by tape
  if (!bt.frame) return console.log('the board was never set up');
  console.log(`board width from the taps ${(bt.frame.width * 100).toFixed(1)} cm` + (width ? `, by tape ${width} cm` : ''));
  placed.forEach((t, i) => {
    const b = bt.at(t), dot = rec.measure?.dots?.[i], scale = width ?? bt.frame.width * 100;
    const x = b.x * scale, y = b.y * scale;
    console.log(`  tap ${i + 1}: (${x.toFixed(1)}, ${y.toFixed(1)}) cm` + (dot ? `   dot (${dot[0]}, ${dot[1]}), off by ${Math.hypot(x - dot[0], y - dot[1]).toFixed(1)} cm` : ''));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--replay');
  if (at > 0) {
    replay(process.argv[at + 1]);
  } else {
    accuracy();
    trackerRules();
    const book = gestures();
    await throughTheKit(book);
    process.exitCode = failed ? 1 : 0;
  }
}
