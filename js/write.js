// Write mode: draw a character with the cursor (or a finger) and pause. The
// drawing is turned into what a sensor on the wrist would have felt, and the
// network reads the character from those readings alone. Also switches
// between the modes.

import './app.js';
import { loadNet } from './net.js';
import { airPath, wrist, features } from './wrist.js';
import { settle } from './context.js';

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PAUSE = 750; // ms without drawing before a character is taken as finished

// Modes. The choice is remembered for the next visit.
function setMode(mode) {
  document.body.dataset.mode = mode;
  for (const b of $('modes').children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  try { localStorage.setItem('mode', mode); } catch { /* private window: not remembered */ }
}
for (const b of $('modes').children) b.addEventListener('click', () => setMode(b.dataset.mode));
let saved = null;
try { saved = localStorage.getItem('mode'); } catch { /* as above */ }
setMode(location.hash === '#write' || saved === 'write' ? 'write' : location.hash === '#sensor' ? 'sensor' : saved || 'sensor');

const pad = $('pad'), ctx = pad.getContext('2d');
let net = null;
let strokes = [];      // the character being drawn
let trail = [];        // every cursor position since it was begun, as [x, y, ms], pen down or not
let liftAt = 0;        // how much of the trail there was at the last lift
let fading = null;     // the one just read, fading out: { strokes, at }
let timer = 0;
// The text so far: a space, or a character as { guesses, fixed }. `guesses`
// is every label with how sure the network was; `fixed` is the writer's own pick.
let entries = [];
let latest = null;     // the character most recently added, while it can still be corrected

// What the entries spell. Each word is settled as a whole, so an O among
// letters is not read as a zero. Returns the label shown for each entry.
function spell() {
  const out = [];
  let word = [];
  const flush = () => { out.push(...settle(word)); word = []; };
  for (const e of entries) {
    if (e === ' ') { flush(); out.push(' '); } else word.push(e);
  }
  flush();
  $('text').textContent = out.join('');
  return out;
}

loadNet().then((n) => { net = n; show(null); }, () => { $('guesses').innerHTML = '<li class="none">The network could not be loaded.</li>'; });

const point = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
let down = false;

pad.addEventListener('pointerdown', (e) => {
  clearTimeout(timer);
  pad.setPointerCapture(e.pointerId);
  down = true;
  const p = point(e);
  strokes.push([p]);
  trail.push([...p, e.timeStamp]);
  draw();
});
pad.addEventListener('pointermove', (e) => {
  if (!strokes.length) return;
  // Coalesced events keep fast strokes smooth. With the pen up, the cursor's
  // way to the next stroke is still part of how the hand moved.
  for (const ev of e.getCoalescedEvents?.() ?? [e]) {
    const p = point(ev);
    if (down) strokes[strokes.length - 1].push(p);
    trail.push([...p, ev.timeStamp || e.timeStamp]);
  }
  if (down) draw();
});
const lift = (e) => {
  if (!down) return;
  down = false;
  if (pad.hasPointerCapture(e.pointerId)) pad.releasePointerCapture(e.pointerId);
  liftAt = trail.length;
  read(false);
  timer = setTimeout(() => read(true), PAUSE);
};
pad.addEventListener('pointerup', lift);
pad.addEventListener('pointercancel', lift);

// The wrists the drawing is tried on: a small, a middling and a large hand
// movement, each worn a little differently. Averaging over them is steadier
// than one. Each is [size in metres, [roll, pitch, yaw], arm length, twist].
const WRISTS = [[0.15, [0.2, -0.15, 0.1], 0.5, 0.15], [0.2, [0, 0, 0], 0.6, 0], [0.26, [-0.2, 0.15, -0.1], 0.75, -0.15]];
const hiss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // about one unit of noise

// What a wrist sensor would have felt for the drawing so far, and how the
// network reads it. Returns { guesses, imu }.
function readTrail() {
  const used = trail.slice(0, liftAt).sort((a, b) => a[2] - b[2]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const st of strokes) for (const [x, y] of st) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const sum = new Map();
  let shown = null;
  WRISTS.forEach(([size, pose, arm, twist], k) => {
    const imu = wrist(airPath(used, { w: x1 - x0, h: y1 - y0 }, size), pose, arm, twist);
    // Real sensors hiss; the network was trained expecting it.
    for (const r of imu) for (let i = 0; i < 6; i++) r[i] += hiss() * (i < 3 ? 0.04 : 0.005);
    if (k === 1) shown = imu;
    for (const g of net.read(features(imu))) sum.set(g.label, (sum.get(g.label) || 0) + g.p / WRISTS.length);
  });
  return { guesses: [...sum].map(([label, p]) => ({ label, p })).sort((a, b) => b.p - a.p), imu: shown };
}

// One sensor's three lines for the character just drawn.
function chart(canvas, imu, from, floor) {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2), c = canvas.getContext('2d');
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = css('--raised');
  c.fillRect(0, r.height / 2 - 1, r.width, 2);
  let peak = floor;
  for (const s of imu) for (let k = from; k < from + 3; k++) peak = Math.max(peak, Math.abs(s[k]));
  c.lineWidth = 2; c.lineJoin = 'round';
  ['--x', '--y', '--z'].forEach((name, k) => {
    c.strokeStyle = css(name);
    c.beginPath();
    imu.forEach((s, i) => { const x = (i / (imu.length - 1)) * r.width, y = r.height / 2 - (s[from + k] / peak) * (r.height / 2 - 3); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.stroke();
  });
}

// Read what is on the pad. `commit` adds it to the text and clears the pad.
function read(commit) {
  if (!net || !strokes.length || trail.length < 2) return;
  const { guesses, imu } = readTrail();
  chart($('w-accel'), imu, 0, 12);
  chart($('w-gyro'), imu, 3, 1);
  if (!commit) return show(guesses, null);
  latest = { guesses, fixed: null };
  entries.push(latest);
  fading = { strokes, at: performance.now() };
  strokes = []; trail = []; liftAt = 0;
  requestAnimationFrame(draw);
  show(guesses, spell()[entries.length - 1]);
}

// The five surest guesses. Once the character is in the text, `chosen` is the
// one that went in (its neighbours may have settled it), and picking another
// swaps it.
function show(guesses, chosen) {
  const list = $('guesses');
  $('guess-title').textContent = chosen ? 'Read as (pick another to correct it)' : 'Reads as';
  if (!guesses) { list.innerHTML = '<li class="none">Draw a character on the pad.</li>'; return; }
  const top = guesses.slice(0, 5);
  if (chosen && !top.some((g) => g.label === chosen)) top[4] = guesses.find((g) => g.label === chosen);
  list.replaceChildren(...top.map((g) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `${g.label}, ${Math.round(g.p * 100)} percent`);
    b.innerHTML = `<b>${g.label}</b><span class="bar-track"><span class="bar-fill" style="transform: scaleX(${g.p.toFixed(3)})"></span></span><span>${Math.round(g.p * 100)}%</span>`;
    if (g.label === chosen) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => {
      if (!chosen || entries[entries.length - 1] !== latest) return;
      latest.fixed = g.label;
      spell();
      show(guesses, g.label);
    });
    li.append(b);
    return li;
  }));
}

function edit(change) {
  clearTimeout(timer);
  strokes = []; trail = []; liftAt = 0; latest = null;
  change();
  spell();
  show(null);
  draw();
}
$('space').addEventListener('click', () => edit(() => { if (entries.length && entries[entries.length - 1] !== ' ') entries.push(' '); }));
$('delete').addEventListener('click', () => edit(() => entries.pop()));
$('clear').addEventListener('click', () => edit(() => { entries = []; }));
addEventListener('keydown', (e) => {
  if (document.body.dataset.mode !== 'write' || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('button, input')) return;
  if (e.key === 'Backspace') $('delete').click();
  else if (e.key === ' ') $('space').click();
  else return;
  e.preventDefault();
});

function draw() {
  const r = pad.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (pad.width !== w || pad.height !== h) { pad.width = w; pad.height = h; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.lineWidth = 7;
  ctx.strokeStyle = ctx.fillStyle = css('--path');
  const ink = (list) => {
    for (const s of list) {
      ctx.beginPath();
      if (s.length === 1) { ctx.arc(s[0][0], s[0][1], 3.5, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.moveTo(s[0][0], s[0][1]);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
      ctx.stroke();
    }
  };
  // The character just read fades away as the next one begins.
  if (fading) {
    const left = still ? 0 : 1 - (performance.now() - fading.at) / 350;
    if (left <= 0) fading = null;
    else { ctx.globalAlpha = left; ink(fading.strokes); ctx.globalAlpha = 1; requestAnimationFrame(draw); }
  }
  ink(strokes);
}
new ResizeObserver(draw).observe(pad);
