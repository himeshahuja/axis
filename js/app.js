// The page: plays sensor samples into the tracker at the speed they were
// recorded, and draws the path it recovers.
//
// The samples come from js/fake.js for now. A real sensor replaces `load`
// and the loop in `frame` that feeds `tracker`: anything that can hand over
// { t, ax, ay, az, gx, gy, gz, pen } objects will do.

import { Tracker, qrot } from './fusion.js';
import { SHAPES, synth } from './fake.js';

const $ = (id) => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COL = { path: css('--path'), muted: css('--muted'), raised: css('--raised'), ink: css('--ink'), accent: css('--accent'), x: css('--x'), y: css('--y'), z: css('--z') };
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const names = Object.keys(SHAPES);
let shape = names[0], picked = false, run = 0;
let data, tracker, fed, clock, endedAt, last = 0;
const cam = { yaw: 0, pitch: 0, cx: 0, cy: 0, cz: 0, span: 0.3 };

function load(name) {
  shape = name;
  data = synth(name, { seed: ++run });
  tracker = new Tracker();
  fed = 0; clock = 0; endedAt = null;
  for (const b of $('shapes').children) b.setAttribute('aria-pressed', String(b.textContent === name));
  // Reduced motion: no playback, just the finished drawing.
  if (still) { for (const s of data.samples) tracker.feed(s); fed = data.samples.length; }
}

for (const name of names) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.addEventListener('click', () => { picked = true; load(name); });
  $('shapes').append(b);
}

// Drag to look at the drawing from another side; double-click to face it again.
let drag = null;
view.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.yaw += (e.clientX - drag.x) * 0.008;
  cam.pitch = Math.max(-1.4, Math.min(1.4, cam.pitch + (e.clientY - drag.y) * 0.008));
  drag = { x: e.clientX, y: e.clientY };
});
view.addEventListener('pointerup', () => { drag = null; });
view.addEventListener('pointercancel', () => { drag = null; });
view.addEventListener('dblclick', () => { cam.yaw = cam.pitch = 0; });

function size(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { w: r.width, h: r.height, dpr };
}

function drawView() {
  const { w, h, dpr } = size(view);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const tr = tracker, n = tr.length;

  // Keep the whole drawing in frame, easing as it grows.
  let lo = [0, 0, 0], hi = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const p = [tr.x[i], tr.y[i], tr.z[i]];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  const ease = still ? 1 : 0.06;
  cam.cx += ((lo[0] + hi[0]) / 2 - cam.cx) * ease;
  cam.cy += ((lo[1] + hi[1]) / 2 - cam.cy) * ease;
  cam.cz += ((lo[2] + hi[2]) / 2 - cam.cz) * ease;
  cam.span += (Math.max(0.3, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) - cam.span) * ease;
  const scale = (Math.min(w, h) * 0.72) / cam.span;
  const cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const project = (x, y, z) => {
    x -= cam.cx; y -= cam.cy; z -= cam.cz;
    const x1 = x * cyaw + z * syaw, z1 = -x * syaw + z * cyaw;
    return [w / 2 + x1 * scale, h / 2 - (y * cp - z1 * sp) * scale];
  };

  // Strokes: runs of samples with the pen the same way.
  const strokes = (len, at, pen, each) => {
    for (let i = 0; i < len;) {
      const down = pen(i);
      ctx.beginPath();
      // A stroke starts where the last one ended, so there are no gaps.
      const [x0, y0] = project(...at(Math.max(0, i - 1)));
      ctx.moveTo(x0, y0);
      for (; i < len && pen(i) === down; i++) { const [x, y] = project(...at(i)); ctx.lineTo(x, y); }
      each(down);
    }
  };
  ctx.lineJoin = ctx.lineCap = 'round';

  if ($('truth').checked) {
    const t = data.truth, upTo = fed;
    ctx.strokeStyle = COL.muted;
    strokes(upTo, (i) => [t[i].x, t[i].y, t[i].z], (i) => t[i].pen, (down) => {
      ctx.globalAlpha = down ? 0.55 : 0;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  strokes(n, (i) => [tr.x[i], tr.y[i], tr.z[i]], (i) => tr.pen[i], (down) => {
    ctx.strokeStyle = down ? COL.path : COL.muted;
    ctx.lineWidth = down ? 4 : 1.5;
    ctx.setLineDash(down ? [] : [2, 7]);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // The sensor itself: a dot where it is, and its three axes showing how it is turned.
  if (n) {
    const p = [tr.x[n - 1], tr.y[n - 1], tr.z[n - 1]], [px, py] = project(...p), arm = cam.span * 0.09;
    ctx.lineWidth = 3;
    [[1, 0, 0, COL.x], [0, 1, 0, COL.y], [0, 0, 1, COL.z]].forEach(([ax, ay, az, colour]) => {
      const d = qrot(tr.q, [ax, ay, az]), [ex, ey] = project(p[0] + d[0] * arm, p[1] + d[1] * arm, p[2] + d[2] * arm);
      ctx.strokeStyle = colour;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
    });
    ctx.fillStyle = COL.ink;
    ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill();
  }
}

// The last few seconds of one sensor, three lines on a shared scale.
function drawChart(canvas, fields, floor) {
  const c = canvas.getContext('2d'), { w, h, dpr } = size(canvas);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const WINDOW = 4, s = data.samples, to = fed, from = Math.max(0, to - WINDOW * 100);
  let peak = floor;
  for (let i = from; i < to; i++) for (const f of fields) peak = Math.max(peak, Math.abs(s[i][f]));
  c.fillStyle = COL.raised;
  c.fillRect(0, h / 2 - 1, w, 2);
  c.lineWidth = 2;
  c.lineJoin = 'round';
  fields.forEach((f, k) => {
    c.strokeStyle = [COL.x, COL.y, COL.z][k];
    c.beginPath();
    for (let i = from; i < to; i++) {
      const x = w - ((to - 1 - i) / (WINDOW * 100)) * w, y = h / 2 - (s[i][f] / peak) * (h / 2 - 3);
      if (i === from) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  });
}

// How far the recovered path is from the true one, on average so far.
function offBy() {
  const tr = tracker, off = fed - tr.length;
  if (!tr.length) return null;
  let sum = 0;
  for (let i = 0; i < tr.length; i++) { const p = data.truth[i + off]; sum += (tr.x[i] - p.x) ** 2 + (tr.y[i] - p.y) ** 2 + (tr.z[i] - p.z) ** 2; }
  return Math.sqrt(sum / tr.length);
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  // Nothing to play or draw while the other mode is showing.
  if (document.body.dataset.mode !== 'sensor') return requestAnimationFrame(frame);
  if (!still) {
    clock += dt;
    while (fed < data.samples.length && data.samples[fed].t <= clock) tracker.feed(data.samples[fed++]);
    if (fed >= data.samples.length) {
      endedAt ??= now;
      // Hold the finished drawing, then draw again (the next shape, until one is picked).
      if (now - endedAt > 2500) load(picked ? shape : names[(names.indexOf(shape) + 1) % names.length]);
    }
  }
  drawView();
  drawChart($('accel'), ['ax', 'ay', 'az'], 12);
  drawChart($('gyro'), ['gx', 'gy', 'gz'], 1);
  $('state').textContent = !tracker.ready ? 'Settling' : tracker.still ? 'At rest' : 'Moving';
  const e = offBy();
  $('error').textContent = e == null ? '–' : `${(e * 100).toFixed(1)} cm`;
  requestAnimationFrame(frame);
}

load(shape);
requestAnimationFrame(frame);
