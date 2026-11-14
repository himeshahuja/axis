// node tests/check.mjs
// Feeds the fake sensor data for every shape through the tracker and
// compares the path it recovers with the path that was really drawn.

import { Tracker } from '../js/fusion.js';
import { SHAPES, synth } from '../js/fake.js';

let failed = 0;
const run = (shape, options) => {
  const { samples, truth } = synth(shape, options);
  const tr = new Tracker();
  for (const s of samples) tr.feed(s);
  const at = new Map(truth.map((p) => [p.t.toFixed(4), p]));
  let sum = 0, worst = 0, n = 0, size = 0;
  for (let i = 0; i < tr.length; i++) {
    const p = at.get(tr.t[i].toFixed(4));
    const e = Math.hypot(tr.x[i] - p.x, tr.y[i] - p.y, tr.z[i] - p.z);
    sum += e * e; worst = Math.max(worst, e); n++;
    size = Math.max(size, Math.hypot(p.x, p.y));
  }
  return { rms: Math.sqrt(sum / n), worst, size, n };
};

for (const shape of Object.keys(SHAPES)) {
  const clean = run(shape, { noise: 0 });
  const noisy = [1, 2, 3, 4, 5].map((seed) => run(shape, { seed }));
  const rms = Math.max(...noisy.map((r) => r.rms)), worst = Math.max(...noisy.map((r) => r.worst));
  // Within 2.5 cm on clean data. With noise, 4 cm on average (root mean square).
  const ok = clean.worst < 0.025 && rms < 0.04;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${shape.padEnd(7)} no noise: worst ${(clean.worst * 1000).toFixed(2)} mm | with noise (5 seeds): rms ${(rms * 100).toFixed(2)} cm, worst ${(worst * 100).toFixed(2)} cm, drawing ${(clean.size * 100).toFixed(0)} cm across`);
}
process.exit(failed ? 1 : 0);
