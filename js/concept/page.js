// concept.html: a simulated session played through the Vexo Board tracking code, in
// (a multiple of) real time, drawn on the board as it happens.

import { conceptSession } from './simulate.js';
import { arrivals, deliver, score, tracker } from './replay.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#board');
let run = null;          // { s, vb, queue, next, clock, end, rings, pinchAt }

function start() {
  const s = conceptSession($('#scene').value, { blocked: $('#blocked').checked, talk: $('#talk').checked, noisy: $('#noisy').checked });
  const emg = $('#emg').checked;
  run = { s, vb: tracker(s, { emg }), queue: arrivals(s, { emg }), next: 0, clock: s.samples[0].t, end: s.samples.at(-1).t, rings: [], pinchAt: -Infinity, last: null, emg };
  $('#play').textContent = 'Restart';
  $('#export').disabled = true;
  $('#scores').replaceChildren();
}

function tick(now) {
  requestAnimationFrame(tick);
  if (!run) return draw();
  const dt = run.last === null ? 0 : Math.min(100, now - run.last);
  run.last = now;
  if (run.clock < run.end) {
    run.clock += dt * Number($('#speed').value);
    while (run.next < run.queue.length && run.queue[run.next].at <= run.clock) {
      const a = run.queue[run.next++];
      deliver(run.vb, a);
      if (a.kind === 'ping') run.rings.push({ t: a.data.t, delays: a.data.delays });
    }
    for (const n of run.vb.news) if (n.type === 'pinch' && n.t > run.pinchAt) run.pinchAt = n.t;
    if (run.clock >= run.end) finish();
  }
  draw();
}

function finish() {
  const r = score(run.s, run.vb), cm = (m) => `${(m * 100).toFixed(1)} cm`;
  const cells = [
    ['Tip, half the time within', cm(r.tip[0])],
    ['Tip, 95% within', cm(r.tip[1])],
    ['Marker on board: right when it said so', `${Math.round(r.precision * 100)}%`],
    ['Marker on board: writing caught', `${Math.round(r.recall * 100)}%`],
    ['Strokes of ink', `${r.strokes} (${r.written} written)`],
    ['Pinches', `${r.pinches.found} of ${r.pinches.of}${r.pinches.extra ? `, ${r.pinches.extra} extra` : ''}`],
    ['Echoes thrown out', String(r.clicks.echoes)],
  ];
  $('#scores').replaceChildren(...cells.map(([k, v]) => {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = k;
    dd.textContent = v;
    div.append(dt, dd);
    return div;
  }));
  $('#export').disabled = !run.vb.ready;
}

function draw() {
  const width = canvas.clientWidth || 800, dpr = devicePixelRatio || 1;
  const s = run?.s, W = s ? s.layout.width : 1.2, H = 1.2;
  const pad = 30, scale = Math.min((width - 2 * pad) / W, 380 / H), height = Math.round(H * scale + 2 * pad + 40);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d'), css = getComputedStyle(document.documentElement), v = (n) => css.getPropertyValue(n).trim();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const ox = (width - W * scale) / 2, oy = pad, X = (x) => ox + x * scale, Y = (y) => oy + (H - y) * scale;

  ctx.fillStyle = v('--board');
  ctx.strokeStyle = v('--line');
  ctx.lineWidth = 2;
  ctx.fillRect(X(0), Y(H), W * scale, H * scale);
  ctx.strokeRect(X(0), Y(H), W * scale, H * scale);
  const pucks = [[0, 0], [0, H], [W, H]];

  if (run) {
    const { vb, clock } = run, f = vb.fused;
    // Clicks reaching the pucks: a ring from the band, growing for a moment.
    run.rings = run.rings.filter((r) => clock - r.t < 120);
    if (f.length) {
      const b = [f.x[f.length - 1], f.y[f.length - 1]];
      for (const r of run.rings) {
        const age = (clock - r.t) / 120;
        ctx.strokeStyle = v('--band');
        ctx.globalAlpha = 0.35 * (1 - age);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(X(b[0]), Y(b[1]), 6 + age * 60, 0, 2 * Math.PI);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // The true path of the tip, for comparison.
    if ($('#truth').checked) {
      ctx.strokeStyle = v('--truth');
      ctx.lineWidth = 1;
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < s.samples.length && s.samples[i].t <= clock; i += 2) {
        const p = s.tip[i];
        if (!s.touching[i]) { first = true; continue; }
        if (first) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1]));
        first = false;
      }
      ctx.stroke();
    }
    // The ink.
    ctx.strokeStyle = v('--ink-pen');
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const stroke of vb.strokes()) {
      ctx.beginPath();
      stroke.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
    }
    // The band and the tip now.
    if (f.length) {
      const i = f.length - 1, tip = vb.tipAt(i);
      ctx.fillStyle = v('--band');
      ctx.beginPath();
      ctx.arc(X(f.x[i]), Y(f.y[i]), 6, 0, 2 * Math.PI);
      ctx.fill();
      if (vb.tipBody) {
        ctx.strokeStyle = v('--band');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(f.x[i]), Y(f.y[i]));
        ctx.lineTo(X(tip[0]), Y(tip[1]));
        ctx.stroke();
        ctx.fillStyle = v('--tip');
        ctx.beginPath();
        ctx.arc(X(tip[0]), Y(tip[1]), 4, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    $('#status').textContent = vb.status();
    $('#m-mic').classList.toggle('on', vb.contact.on);
    $('#m-emg').classList.toggle('on', Boolean(run.emg && vb.muscles.last?.pressing));
    $('#m-pinch').classList.toggle('on', clock - run.pinchAt < 600);
  }
  for (const [x, y] of pucks) {
    ctx.fillStyle = v('--puck');
    ctx.beginPath();
    ctx.arc(X(x), Y(y), 8, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = v('--soft');
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${(W * 100).toFixed(0)} × ${(H * 100).toFixed(0)} cm`, X(0), Y(0) + 22);
}

$('#play').onclick = start;
$('#export').onclick = () => {
  if (!run) return;
  const blob = new Blob([JSON.stringify(run.vb.ink(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vexo-board-ink.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
requestAnimationFrame(tick);
