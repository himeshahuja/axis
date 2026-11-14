// Write mode: draw a character with the cursor (or a finger), pause, and the
// network's reading of it joins the text. Also switches between the modes.

import './app.js';
import { loadNet } from './net.js';
import { SIZE, rasterize } from './raster.js';

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

const pad = $('pad'), ctx = pad.getContext('2d'), seen = $('seen').getContext('2d');
let net = null;
let strokes = [];      // the character being drawn
let fading = null;     // the one just read, fading out: { strokes, at }
let timer = 0;
let text = '';
let lastRead = null;   // the guesses for the character most recently added

loadNet().then((n) => { net = n; show(null); }, () => { $('guesses').innerHTML = '<li class="none">The network could not be loaded.</li>'; });

const point = (e) => { const r = pad.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

pad.addEventListener('pointerdown', (e) => {
  clearTimeout(timer);
  pad.setPointerCapture(e.pointerId);
  strokes.push([point(e)]);
  draw();
});
pad.addEventListener('pointermove', (e) => {
  if (!(e.buttons & 1) && e.pointerType === 'mouse') return;
  const s = strokes[strokes.length - 1];
  if (!s || !pad.hasPointerCapture(e.pointerId)) return;
  // Coalesced events keep fast strokes smooth.
  for (const ev of e.getCoalescedEvents?.() ?? [e]) s.push(point(ev));
  draw();
});
const lift = (e) => {
  if (!pad.hasPointerCapture(e.pointerId)) return;
  pad.releasePointerCapture(e.pointerId);
  read(false);
  timer = setTimeout(() => read(true), PAUSE);
};
pad.addEventListener('pointerup', lift);
pad.addEventListener('pointercancel', lift);

// Read what is on the pad. `commit` adds the best guess to the text and clears the pad.
function read(commit) {
  if (!net || !strokes.length) return;
  const pixels = rasterize(strokes), guesses = net.read(pixels).slice(0, 5);
  const img = seen.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) { const v = Math.round(pixels[i] * 255); img.data.set([v, v, v, 255], i * 4); }
  seen.putImageData(img, 0, 0);
  if (commit) {
    text += guesses[0].label;
    lastRead = guesses;
    fading = { strokes, at: performance.now() };
    strokes = [];
    $('text').textContent = text;
    requestAnimationFrame(draw);
  }
  show(guesses, commit);
}

// The guesses, surest first. Once a character is in the text, picking another
// guess swaps it in.
function show(guesses, committed = false) {
  const list = $('guesses');
  $('guess-title').textContent = committed ? 'Read as (pick another to correct it)' : 'Reads as';
  if (!guesses) { list.innerHTML = '<li class="none">Draw a character on the pad.</li>'; return; }
  list.replaceChildren(...guesses.map((g, i) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `${g.label}, ${Math.round(g.p * 100)} percent`);
    b.innerHTML = `<b>${g.label}</b><span class="bar-track"><span class="bar-fill" style="transform: scaleX(${g.p.toFixed(3)})"></span></span><span>${Math.round(g.p * 100)}%</span>`;
    b.addEventListener('click', () => {
      if (!committed || guesses !== lastRead) return;
      text = text.slice(0, -1) + g.label;
      $('text').textContent = text;
      // The pick goes to the top.
      lastRead = [g, ...guesses.filter((x) => x !== g)];
      show(lastRead, true);
    });
    if (i === 0 && committed) b.setAttribute('aria-current', 'true');
    li.append(b);
    return li;
  }));
}

function edit(change) {
  clearTimeout(timer);
  strokes = []; lastRead = null;
  text = change(text);
  $('text').textContent = text;
  show(null);
  draw();
}
$('space').addEventListener('click', () => edit((t) => (t && !t.endsWith(' ') ? `${t} ` : t)));
$('delete').addEventListener('click', () => edit((t) => t.slice(0, -1)));
$('clear').addEventListener('click', () => edit(() => ''));
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
