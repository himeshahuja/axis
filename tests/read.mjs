// node tests/read.mjs
// Checks the character reader: that the JavaScript network gives the same
// scores as the trained one, and that characters drawn as strokes are read.

import { readFileSync } from 'node:fs';
import { Net } from '../js/net.js';
import { rasterize } from '../js/raster.js';

const here = new URL('..', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('model/model.json', here)));
const bin = readFileSync(new URL('model/weights.bin', here));
const net = new Net(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
let failed = 0;

// 1. The same scores as PyTorch gave, on test images saved at training time.
const vectors = JSON.parse(readFileSync(new URL('tests/vectors.json', here)));
let gap = 0;
for (const v of vectors) {
  const s = net.scores(Float32Array.from(v.pixels, (p) => p / 255));
  v.scores.forEach((want, i) => { gap = Math.max(gap, Math.abs(want - s[i])); });
}
console.log(`${gap < 2e-3 ? 'ok  ' : 'FAIL'} scores match the trained network on ${vectors.length} images (largest gap ${gap.toExponential(1)})`);
if (gap >= 2e-3) failed++;

// 2. Characters drawn as plain strokes, as a cursor would (x right, y down).
const arc = (cx, cy, rx, ry, from, to, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const a = from + ((to - from) * i) / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const drawn = {
  7: [[[0, 0], [1, 0], [0.35, 1.4]]],
  T: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1.3]]],
  X: [[[0, 0], [1, 1.3]], [[1, 0], [0, 1.3]]],
  V: [[[0, 0], [0.5, 1.3], [1, 0]]],
  H: [[[0, 0], [0, 1.3]], [[1, 0], [1, 1.3]], [[0, 0.65], [1, 0.65]]],
  A: [[[0, 1.3], [0.5, 0], [1, 1.3]], [[0.22, 0.8], [0.78, 0.8]]],
  N: [[[0, 1.3], [0, 0], [1, 1.3], [1, 0]]],
  M: [[[0, 1.3], [0, 0], [0.5, 0.8], [1, 0], [1, 1.3]]],
  W: [[[0, 0], [0.25, 1.3], [0.5, 0.4], [0.75, 1.3], [1, 0]]],
  E: [[[1, 0], [0, 0], [0, 1.3], [1, 1.3]], [[0, 0.65], [0.8, 0.65]]],
  4: [[[0.7, 1.3], [0.7, 0], [0, 0.9], [1, 0.9]]],
  C: [arc(0.5, 0.65, 0.5, 0.65, -0.9, -5.4)],
  3: [[...arc(0.4, 0.32, 0.45, 0.32, -2.6, 1.5), ...arc(0.4, 0.97, 0.5, 0.33, -1.5, 2.6)]],
  8: [[...arc(0.5, 0.32, 0.38, 0.32, 1.57, 1.57 - 6.283), ...arc(0.5, 0.97, 0.45, 0.33, -1.57, -1.57 + 6.283)]],
  U: [[[0, 0], ...arc(0.5, 0.8, 0.5, 0.5, 3.14, 0), [1, 0]]],
};
let right = 0;
const lines = [];
for (const [want, strokes] of Object.entries(drawn)) {
  const [a, b] = net.read(rasterize(strokes));
  if (a.label === want) right++;
  lines.push(`${want}→${a.label} ${(a.p * 100).toFixed(0)}%${a.label === want ? '' : ` (then ${b.label})`}`);
}
const need = Object.keys(drawn).length - 2;
console.log(`${right >= need ? 'ok  ' : 'FAIL'} read ${right} of ${Object.keys(drawn).length} drawn characters: ${lines.join(', ')}`);
if (right < need) failed++;
process.exit(failed ? 1 : 0);
