// node tests/read.mjs
// Checks the page's copies of the wrist simulation, the features and the
// network against the Python ones the network was trained with, and that
// characters drawn as strokes are read.

import { readFileSync } from 'node:fs';
import { Net } from '../js/net.js';
import { airPath, features, wrist } from '../js/wrist.js';
import { settle } from '../js/context.js';

const here = new URL('..', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('model/model.json', here)));
const bin = readFileSync(new URL('model/weights.bin', here));
const net = new Net(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const vectors = JSON.parse(readFileSync(new URL('tests/vectors.json', here)));
let failed = 0;
const check = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) failed++; };
const gapOf = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

// 1. The wrist simulation: the same readings as Python for the same movement.
{
  const v = vectors.wrist, imu = wrist(v.path, v.pose, v.arm, v.twist);
  const gap = gapOf(imu.flat(), v.imu.flat());
  // The saved path is rounded to a micrometre, which alone moves accelerations by up to 0.02.
  check(gap < 5e-2, `wrist readings match the Python simulation over ${imu.length} samples (largest gap ${gap.toExponential(1)})`);
}

// 2. Features and scores, on readings saved at training time.
{
  let fGap = 0, sGap = 0, right = 0;
  for (const r of vectors.readings) {
    const f = features(r.imu);
    fGap = Math.max(fGap, gapOf(Array.from(f), r.features.flat()));
    sGap = Math.max(sGap, gapOf(Array.from(net.scores(f)), r.scores));
    if (net.read(f)[0].label === r.label) right++;
  }
  check(fGap < 1e-3, `features match on ${vectors.readings.length} readings (largest gap ${fGap.toExponential(1)})`);
  check(sGap < 5e-3, `scores match the trained network (largest gap ${sGap.toExponential(1)}); ${right} of ${vectors.readings.length} read correctly`);
}

// 3. Characters drawn the way the page gets them: a cursor trail with times.
// These are real pen strokes from writers the network never learned from,
// drawn at a steady 500 pixels a second.
{
  let right = 0, top3 = 0;
  const lines = [];
  for (const { label, strokes } of vectors.strokes) {
    const all = strokes.flat(), xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
    const k = 300 / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1); // 300 pixels on its larger side
    const trail = [];
    let t = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of strokes) {
      st.forEach(([x, y], i) => {
        const px = x * k, py = -y * k; // saved strokes have y up; the screen's points down
        if (trail.length) { const q = trail[trail.length - 1]; t += (Math.hypot(px - q[0], py - q[1]) / 500) * 1000 + (i === 0 ? 60 : 0); }
        trail.push([px, py, t]);
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      });
    }
    const guesses = net.read(features(wrist(airPath(trail, { w: x1 - x0, h: y1 - y0 }, 0.2), [0, 0, 0], 0.6, 0)));
    if (guesses[0].label === label) right++;
    if (guesses.slice(0, 3).some((g) => g.label === label)) top3++;
    lines.push(`${label}→${guesses[0].label}`);
  }
  const n = vectors.strokes.length;
  check(right >= n * 0.7, `read ${right} of ${n} drawn characters (${top3} in the top three): ${lines.join(' ')}`);
}

// 4. Neighbours settle look-alikes: O among letters, 0 among digits.
{
  const g = (pairs) => ({ guesses: Object.entries(pairs).map(([label, p]) => ({ label, p })) });
  const round = g({ 0: 0.55, O: 0.43, D: 0.02 }), stick = g({ 1: 0.6, I: 0.3, L: 0.1 }), clear = (l) => g({ [l]: 0.98, [l === 'X' ? 'K' : 'X']: 0.01, 8: 0.01 });
  const cases = [
    ['HELLO', [clear('H'), clear('E'), clear('L'), clear('L'), round]],
    ['2025', [g({ 2: 0.9, Z: 0.1 }), round, g({ 2: 0.9, Z: 0.1 }), g({ 5: 0.7, S: 0.3 })]],
    ['HI', [clear('H'), stick]],
    ['10', [stick, round]],
    ['MP3', [clear('M'), clear('P'), g({ 3: 0.97, B: 0.02, J: 0.01 })]],
    ['R0', [clear('R'), { fixed: '0' }]],
  ];
  const bad = cases.filter(([want, word]) => settle(word).join('') !== want).map(([want, word]) => `${want}→${settle(word).join('')}`);
  check(!bad.length, `look-alikes settled by their neighbours in ${cases.length} words${bad.length ? `: ${bad.join(', ')}` : ''}`);
}
process.exit(failed ? 1 : 0);
