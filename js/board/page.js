// The board page. It connects to the band with the kit's shared helper, sets up
// the board with two taps (its left edge, then its far right edge), shows where
// the band hand is on it, and acts on the Take and Put gestures the wearer
// teaches it. Serve this repository's folder
//   python3 -m http.server 8000 --bind 127.0.0.1
// and open http://localhost:8000/board.html. "Pretend band" plays a made-up session.

import { $, attempt, onConnect, say } from '../../vexo-open-kit/projects/shared/page.js';
import { BAND } from './config.js';
import { CameraPanel } from './camera.js';
import { alongBoard, Fused } from './fuse.js';
import { Gestures, LABELS, loadFromBand, saveToBand } from './gestures.js';
import { Recorder } from './recording.js';
import { examples, session } from './simulate.js';
import { BoardTracker } from './tracker.js';

document.body.dataset.ready = 'yes';         // for boot.js: the program started, so the kit is there
if (!$('#number').value) $('#number').value = String(BAND);

const query = new URLSearchParams(location.search);
const RATE = [100, 208, 416].includes(Number(query.get('rate'))) ? Number(query.get('rate')) : 208;
const LOWPASS = Number(query.get('lowpass')) || null;   // ?lowpass=8: filter the band's readings (see bench.html)
const BOX = { w: 0.3, h: 0.12 };             // metres: the writing Take lifts, around the hand
const NAMES = { take: 'Take', put: 'Put', none: 'Not a gesture' };
const LIGHT = { take: '#f5a524', put: '#2f6fed', learn: '#ffffff', board: '#00c853' };
const ENOUGH = 5;                            // examples of each gesture before recording stops by itself
const SAVED = 'air-draw.board.gestures';     // the browser's copy of the examples
const style = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const cmText = (m) => `${(m * 100).toFixed(1)} cm`;

// The board tracker asks for the board's two edges by itself whenever there is no board.
const fresh = () => new BoardTracker({ rate: RATE, auto: true, lowpass: LOWPASS });
let band = null, pretend = null;
let board = fresh();
const book = new Gestures(RATE);
let held = null;            // the writing Take lifted: { strokes, at }
let lastT = 0;              // the band's time of the latest sample, ms
let measuring = false;
let marks = [];             // the band's times of the taps on measured dots
let recording = null;       // a Recorder while a session is being recorded
let fused = null;           // the camera and the band together, once the camera knows the board
let clock = null;           // the band's real time minus its own counter, ms: turns camera times into band times

// What the board shows: the camera and band together when there is a camera, else the band alone.
const track = () => (fused && fused.length && board.frame ? fused : board);

const led = (colour, options) => { if (band) attempt(band.setLed(colour, options)); };
const dark = () => { if (band) attempt(band.ledOff()); };

/** The band's velocity now, for the camera to tell which wrist wears it: [speed along the ground, speed up] m/s. */
function bandVelocity() {
  const tr = board.tracker;
  if (!band || !tr.ready) return null;
  return tr.still ? [0, 0] : [Math.hypot(tr.v[0], tr.v[2]), tr.v[1]];
}

// ---------------------------------------------------------------- the band

onConnect(async (theBand, thePretend) => {
  band = theBand;
  pretend = thePretend;
  board = fresh();
  joinCamera();
  book.reset();
  held = null;
  band.on('motion', onMotion);
  band.on('tap', (e) => onTap(e.t, 'tap'));
  band.on('double-tap', (e) => onTap(e.t, 'double-tap'));
  band.on('reconnecting', () => book.reset());   // the board tracker sees the gap in the samples itself
  band.on('disconnect', () => {
    band = null;
    pretend = null;
    book.recording = null;
    refresh(true);
  });
  if (pretend) pretend.playMotion([{}]);         // the pretend band lies still until a session is played
  await band.setMotion({ accelRange: 16 });      // a knock on the board must not be cut off at the 2 g default
  await band.setEvents({ kinds: ['tap', 'double-tap'] });
  await band.configure({ motion: RATE, events: true });
  say(`Connected to ${band.name}. Hold it still for a moment; then knock the board's left edge, and its far right edge.`);
  refresh(true);
  const kept = await loadFromBand(band).catch(() => null);
  if (kept && kept.take.length + kept.put.length > 0) {
    book.examples = kept;
    keep();
    $('#gesture-status').textContent = `Loaded ${count(kept)} gesture examples kept on ${band.name}.`;
  }
});

function onMotion(m) {
  const arrived = performance.now();
  lastT = m.t;
  if (Number.isFinite(m.time)) clock = m.time - m.t;
  board.feed(m, arrived);
  const piece = book.feed(m);
  if (piece) onPiece(piece);
  if (recording) recording.motion(m, arrived);
}

function onTap(t, kind) {
  note(kind, { t });
  if (kind === 'double-tap') {
    if (board.frame) {
      board.reanchor();
      note('reanchor');
    }
    return;
  }
  if (board.tap(t) === null && measuring && board.frame) marks.push(t);
}

/** Something that happened, into the session being recorded: replayed by tests/board.mjs --bench. */
function note(kind, extra = {}) {
  if (recording) recording.event(lastT, kind, extra);
}

// ---------------------------------------------------------------- the camera

const camera = new CameraPanel(
  { canvas: $('#cam'), status: $('#cam-status'), start: $('#cam-start'), corners: $('#cam-corners'), tip: $('#cam-tip'), hand: $('#cam-hand'), width: $('#cam-width'), height: $('#cam-height') },
  {
    band: bandVelocity,
    onFix(fix) {
      if (fix.x === null || clock === null) return;
      const t = fix.time - clock;                   // the band's time of the picture
      fused?.fix(t, fix.x, fix.y);
      recording?.fix({ ...fix, t });
    },
    onChange() {
      joinCamera();
    },
  },
);

const cameraSetup = () => (camera.toBoard ? { corners: camera.corners, ...camera.size, tip: camera.tip } : null);

/** Put the camera and the band together, now that one of them changed. */
function joinCamera() {
  const s = camera.size;
  fused = camera.ready && s ? new Fused({ width: s.width, height: s.height, tip: camera.tip }) : null;
  board.onSample = fused ? (t, acc, still) => fused?.step(t, board.frame ? alongBoard(acc, board.frame.ux) : null, still) : null;
}

// ---------------------------------------------------------------- the board

$('#set-up').onclick = () => {
  board.setUp();
  note('set-up');
  held = null;
  say('Knock the board\'s left edge with your band hand, then hold still.');
};
$('#reanchor').onclick = () => {
  board.reanchor();
  note('reanchor');
};
$('#clear').onclick = () => {
  board.clearTrail();
  fused?.clearTrail();
  Object.assign(view, VIEW);
  held = null;
};

function news() {
  for (const n of board.news.splice(0)) {
    if ((n.type === 'left' || n.type === 'board') && fused) {
      // The camera saw where the knock was: it must be the edge asked for.
      const edge = n.type === 'left' ? 'left' : 'right', k = fused.knockAt(n.t, edge);
      if (!k.ok) {
        say(`That knock was ${Math.round(k.across * 100)}% of the way across, not on the ${edge} edge. Knock the left edge first, then the far right edge.`);
        board.setUp();
        continue;
      }
      if (n.type === 'left') {
        const i = fused.indexAt(n.t);
        if (i >= 0) fused.y0 = fused.y[i] + fused.tip[1];
      }
    }
    if (n.type === 'left') {
      say('Left edge set. Now knock the far right edge, then hold still.');
    } else if (n.type === 'board') {
      say(`Board set up: ${cmText(n.width)} wide. Write on it; pause a moment now and then.`);
      if (band) {
        led(LIGHT.board);
        setTimeout(dark, 800);
      }
    } else if (n.type === 'too-close') {
      say(`Those two knocks were only ${cmText(n.width)} apart. Knock the left edge again, then the far right edge.`);
    } else if (n.type === 'anchor') {
      say(`Re-anchored on the ${n.edge ? 'right' : 'left'} edge: the cursor moved ${cmText(n.moved)}.`);
    } else if (n.type === 'lost') {
      say(`Lost track: ${Math.round(n.gap)} ms of samples went missing. Hold still; then knock the left edge, and the far right edge.`);
    }
  }
}

function stepText() {
  if (!band) return 'Not connected';
  if (book.recording && board.frame) return `Show me "${NAMES[book.recording]}"`;
  const { text } = board.status();
  return text === 'Tracking' && held ? 'Holding writing: Put drops it' : text;
}

// ---------------------------------------------------------------- drawing

const canvas = $('#board'), pen = canvas.getContext('2d');
const VIEW = { lo: -0.3, hi: 0.12 };   // the board's height on screen at first, in board widths
const view = { ...VIEW, frame: null }; // grows with the trail, and starts again with each new board
let cache = null;                      // the settled part of the trail, drawn once

function layout() {
  const width = canvas.clientWidth || 600, xr = [-0.05, 1.05], yr = [view.lo - 0.03, view.hi + 0.03];
  const scale = Math.min(width / (xr[1] - xr[0]), Math.max(240, innerHeight * 0.62) / (yr[1] - yr[0]));
  const height = Math.max(180, Math.round((yr[1] - yr[0]) * scale)), left = (width - (xr[1] - xr[0]) * scale) / 2;
  return { width, height, X: (x) => left + (x - xr[0]) * scale, Y: (y) => (yr[1] - y) * scale };
}

/**
 * Let the view take in height y (board widths), a tenth at a time. Not beyond one board
 * width up or down: a hand that far off is lost, and one stray point would shrink the board.
 */
function grow(y) {
  if (Math.abs(y) > 1) return;
  if (y < view.lo) view.lo = Math.floor((y - 0.02) * 10) / 10;
  if (y > view.hi) view.hi = Math.ceil((y + 0.02) * 10) / 10;
}

// Samples [from, to) of the trail as one path, leaving out points less than a
// pixel from the last one drawn. Returns where it ended, for the next call.
function trace(ctx, L, from, to, last, src) {
  ctx.beginPath();
  if (last) ctx.moveTo(last[0], last[1]);
  for (let i = from; i < to; i++) {
    if (!src.shown(i)) { last = null; continue; }
    const b = src.boardAt(i), x = L.X(b.x), y = L.Y(b.y);
    grow(b.y);
    if (last && Math.abs(x - last[0]) + Math.abs(y - last[1]) < 0.8) continue;
    if (last) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    last = [x, y];
  }
  ctx.stroke();
  return last;
}

function inkStyle(ctx, colour) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = ctx.lineCap = 'round';
}

function draw() {
  const L = layout(), dpr = devicePixelRatio || 1;
  const w = Math.round(L.width * dpr), h = Math.round(L.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.height = `${L.height}px`;
  }
  pen.setTransform(dpr, 0, 0, dpr, 0, 0);
  pen.clearRect(0, 0, L.width, L.height);
  pen.fillStyle = style('--board');
  pen.fillRect(L.X(0), 0, L.X(1) - L.X(0), L.height);
  pen.strokeStyle = style('--board-edge');
  pen.lineWidth = 3;
  pen.beginPath();
  pen.moveTo(L.X(0), 0); pen.lineTo(L.X(0), L.height);
  pen.moveTo(L.X(1), 0); pen.lineTo(L.X(1), L.height);
  pen.stroke();

  const f = board.frame;
  if (f !== view.frame) Object.assign(view, VIEW, { frame: f });   // a new board: the view starts again
  pen.fillStyle = style('--soft');
  pen.font = '13px system-ui, sans-serif';
  if (!f) {
    // No board yet: light up the edge it is waiting for, and say what it needs.
    const edge = board.want === 'left' ? 0 : board.want === 'right' || board.pending.length ? 1 : null;
    if (edge !== null) {
      pen.strokeStyle = style('--held');
      pen.lineWidth = 6 + 2 * Math.sin(performance.now() / 180);
      pen.beginPath();
      pen.moveTo(L.X(edge), 0);
      pen.lineTo(L.X(edge), L.height);
      pen.stroke();
    }
    const { text, detail } = band ? board.status() : { text: 'Connect the band', detail: '' };
    pen.textAlign = 'center';
    pen.font = '600 15px system-ui, sans-serif';
    pen.fillText(text, L.width / 2, L.height / 2 - 8);
    pen.font = '13px system-ui, sans-serif';
    if (detail) pen.fillText(detail, L.width / 2, L.height / 2 + 14);
    pen.textAlign = 'start';
    cache = null;
    return;
  }
  // The height of the left tap, and 10 cm to judge sizes by.
  pen.setLineDash([4, 6]);
  pen.lineWidth = 1;
  pen.beginPath();
  pen.moveTo(L.X(0), L.Y(0)); pen.lineTo(L.X(1), L.Y(0));
  pen.stroke();
  pen.setLineDash([]);
  const bar = 0.1 / f.width, x0 = L.X(0) + 10, y0 = L.height - 12;
  pen.lineWidth = 3;
  pen.beginPath();
  pen.moveTo(x0, y0); pen.lineTo(x0 + (L.X(bar) - L.X(0)), y0);
  pen.stroke();
  pen.fillText('10 cm', x0, y0 - 7);

  // The trail: what will not change any more is drawn once and kept.
  const src = track();
  const key = [L.width, L.height, dpr, f.origin.join(), f.width, src.hidden, src.skips.length, view.lo, view.hi, src === fused].join('|');
  if (!cache || cache.key !== key || cache.tracker !== board.tracker || cache.src !== src) {
    const image = document.createElement('canvas');
    image.width = w;
    image.height = h;
    const ctx = image.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    inkStyle(ctx, style('--ink-pen'));
    cache = { key, tracker: board.tracker, src, image, ctx, upTo: src.hidden, last: null };
  }
  const settled = src.settled;
  if (settled > cache.upTo) {
    cache.last = trace(cache.ctx, L, cache.upTo, settled, cache.last, src);
    cache.upTo = settled;
  }
  pen.drawImage(cache.image, 0, 0, L.width, L.height);
  inkStyle(pen, style('--ink-pen'));
  trace(pen, L, cache.upTo, src.length, cache.last, src);

  // What Take is holding.
  if (held) {
    inkStyle(pen, style('--held'));
    for (const stroke of held.strokes) {
      pen.beginPath();
      stroke.forEach((p, i) => (i ? pen.lineTo(L.X(p.x), L.Y(p.y)) : pen.moveTo(L.X(p.x), L.Y(p.y))));
      pen.stroke();
    }
    const hw = BOX.w / 2 / f.width, hh = BOX.h / 2 / f.width;
    pen.setLineDash([5, 5]);
    pen.lineWidth = 1.5;
    pen.strokeRect(L.X(held.at.x - hw), L.Y(held.at.y + hh), L.X(2 * hw) - L.X(0), L.Y(0) - L.Y(2 * hh));
    pen.setLineDash([]);
  }

  // Taps on measured dots.
  pen.fillStyle = pen.strokeStyle = style('--put');
  pen.lineWidth = 2;
  marks.forEach((t, i) => {
    const b = src.at(t);
    if (!b) return;
    const x = L.X(b.x), y = L.Y(b.y);
    pen.beginPath();
    pen.moveTo(x - 6, y - 6); pen.lineTo(x + 6, y + 6); pen.moveTo(x + 6, y - 6); pen.lineTo(x - 6, y + 6);
    pen.stroke();
    pen.fillText(String(i + 1), x + 8, y - 8);
  });

  // The hand: a filled dot on the board, a ring when it is away from it.
  const c = src.cursor;
  if (c) {
    const on = Math.abs(c.d) < 0.03;
    pen.beginPath();
    pen.arc(L.X(c.x), L.Y(c.y), on ? 6 : 8, 0, 2 * Math.PI);
    pen.fillStyle = pen.strokeStyle = style('--accent');
    pen.lineWidth = 2.5;
    if (on) pen.fill(); else pen.stroke();
  }
}

// ---------------------------------------------------------------- what the page says

const tape = () => {
  const v = parseFloat($('#tape').value);
  return v > 0 ? v : null;
};
/** Across or up on the board, as cm (by tape if given, otherwise from the taps). */
const cmOn = (v) => `${Math.round(v * (tape() ?? board.frame.width * 100))} cm`;
const count = (ex) => LABELS.reduce((n, label) => n + ex[label].length, 0);

let refreshedAt = 0;
function refresh(now = false) {
  const time = performance.now();
  if (!now && time - refreshedAt < 250) return;          // four times a second: numbers that can be read
  refreshedAt = time;
  const on = Boolean(band);
  $('#step').textContent = stepText();
  $('#set-up').disabled = !on;
  $('#reanchor').disabled = !on || !board.frame;
  $('#clear').disabled = !on || !board.frame;
  $('#demo').disabled = !pretend || pretend.moving;
  $('#record-session').disabled = !on && !recording;
  for (const row of document.querySelectorAll('#gestures tr[data-label]')) {
    const label = row.dataset.label, button = row.querySelector('.record');
    row.querySelector('.count').textContent = String(book.examples[label].length);
    button.disabled = !on || Boolean(book.recording && book.recording !== label);
    button.textContent = book.recording === label ? 'Stop' : 'Record';
    button.classList.toggle('on', book.recording === label);
  }
  $('#save-band').disabled = !on || !book.trained;
  $('#load-band').disabled = !on;
  $('#forget').disabled = count(book.examples) === 0;
  $('#demo-examples').disabled = !pretend;

  const f = board.frame, c = f && track().cursor;
  $('#at-x').textContent = c ? `${cmOn(c.x)} (${Math.round(c.x * 100)}%)` : '–';
  $('#at-y').textContent = c ? cmOn(c.y) : '–';
  $('#hand').textContent = !band ? '–' : !board.ready ? 'starting' : board.still ? 'still' : 'moving';
  $('#width').textContent = f ? cmText(f.width) : '–';
  const blind = fused && board.frame ? fused.blindFor(lastT) : 0;
  $('#hint').textContent = !band ? '' : blind > 500 && blind < Infinity
    ? 'The camera cannot see the band\'s wrist: following the band\'s own motion until it can.'
    : board.status().detail;
  showMarks();
}

function showMarks() {
  const table = $('#marks');
  if (!marks.length || !board.frame) {
    if (table.childElementCount) table.replaceChildren();
    return;
  }
  const dots = $('#dots').value.split('\n').map((line) => line.split(/[,\s]+/).filter(Boolean).map(Number))
    .filter((d) => d.length === 2 && d.every(Number.isFinite));
  const scale = tape() ?? board.frame.width * 100;
  const rows = [['Tap', 'x cm', 'y cm', 'dot', 'off']].concat(marks.map((t, i) => {
    const b = track().at(t), x = b.x * scale, y = b.y * scale, dot = dots[i];
    return [String(i + 1), x.toFixed(1), y.toFixed(1), dot ? `${dot[0]}, ${dot[1]}` : '', dot ? `${Math.hypot(x - dot[0], y - dot[1]).toFixed(1)} cm` : ''];
  }));
  table.replaceChildren(...rows.map((cells, r) => {
    const tr = document.createElement('tr');
    for (const text of cells) {
      const cell = document.createElement(r ? 'td' : 'th');
      cell.textContent = text;
      tr.append(cell);
    }
    return tr;
  }));
}

// ---------------------------------------------------------------- gestures

function onPiece(piece) {
  const status = $('#gesture-status');
  if (piece.taught) {
    const n = book.examples[piece.label].length;
    status.textContent = `${NAMES[piece.label]}: ${n} example${n === 1 ? '' : 's'}.`;
    keep();
    if (n >= ENOUGH) {
      book.recording = null;
      dark();
      status.textContent += ' That is enough.';
    }
    return;
  }
  if (piece.label !== 'take' && piece.label !== 'put') return;
  const src = track(), t0 = piece.samples[0].t, at = src.at(t0);
  src.skip(t0, piece.samples.at(-1).t);
  status.textContent = `${NAMES[piece.label]}, ${piece.distance.toFixed(2)} from its nearest example.`;
  if (piece.label === 'take') {
    if (!at) return;
    const strokes = src.near(at.x, at.y, BOX.w, BOX.h);
    held = strokes.length ? { strokes, at } : null;
    say(held ? 'Took the writing around your hand. Put drops it on the screen.' : 'Take: there is no writing there.');
    if (held) led(LIGHT.take);
  } else if (held) {
    putOut(held);
    held = null;
    if (band) {
      led(LIGHT.put);
      setTimeout(dark, 600);
    }
  } else {
    say('Put: take some writing off the board first.');
  }
}

for (const row of document.querySelectorAll('#gestures tr[data-label]')) {
  row.querySelector('.record').onclick = () => {
    const label = row.dataset.label;
    if (book.recording === label) {
      book.recording = null;
      dark();
    } else {
      book.recording = label;
      book.examples[label] = [];               // recording again replaces the examples
      book.reset();
      led(LIGHT.learn, { pattern: 'breathe', period: 1500 });
      $('#gesture-status').textContent = label === 'none'
        ? 'Write a few ordinary letters, pausing between them.'
        : `Hold still, make "${NAMES[label]}", hold still again. ${ENOUGH} times.`;
    }
    refresh(true);
  };
}

$('#save-band').onclick = async () => {
  $('#gesture-status').textContent = 'Keeping the examples on the band...';
  try {
    const n = await saveToBand(band, book.examples);
    $('#gesture-status').textContent = `Kept ${n} examples on ${band.name} (storage slots 900 to 929). Anyone who connects to it can read or wipe them.`;
  } catch (e) {
    $('#gesture-status').textContent = e.message;
  }
};
$('#load-band').onclick = async () => {
  try {
    const kept = await loadFromBand(band);
    if (!count(kept)) {
      $('#gesture-status').textContent = `No gesture examples are kept on ${band.name}.`;
      return;
    }
    book.examples = kept;
    keep();
    $('#gesture-status').textContent = `Loaded ${count(kept)} examples from ${band.name}.`;
  } catch (e) {
    $('#gesture-status').textContent = e.message;
  }
};
$('#forget').onclick = () => {
  for (const label of LABELS) book.examples[label] = [];
  book.recording = null;
  keep();
  $('#gesture-status').textContent = 'Forgotten here (not on the band).';
};

/** The browser's copy of the examples, so a reload keeps them. */
function keep() {
  try {
    localStorage.setItem(SAVED, JSON.stringify(book.examples));
  } catch { /* private window or storage blocked: they last until the page is closed */ }
}
try {
  const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
  const fine = (list) => Array.isArray(list) && list.every((s) => Array.isArray(s) && s.length === 144 && s.every(Number.isFinite));
  if (saved && LABELS.every((label) => fine(saved[label]))) for (const label of LABELS) book.examples[label] = saved[label];
} catch { /* nothing kept, or not readable: start empty */ }

// ---------------------------------------------------------------- Put: on the screen

function putOut({ strokes, at }) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of strokes.flat()) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
  }
  const figure = document.createElement('figure'), picture = document.createElement('canvas');
  const W = 300, H = 110, dpr = devicePixelRatio || 1, pad = 10;
  const scale = Math.min((W - 2 * pad) / (x1 - x0 || 1), (H - 2 * pad) / (y1 - y0 || 1));
  picture.width = W * dpr;
  picture.height = H * dpr;
  picture.style.width = `${W}px`;
  const ctx = picture.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = style('--board');
  ctx.fillRect(0, 0, W, H);
  inkStyle(ctx, style('--ink-pen'));
  const ox = (W - (x1 - x0) * scale) / 2, oy = (H - (y1 - y0) * scale) / 2;
  for (const stroke of strokes) {
    ctx.beginPath();
    stroke.forEach((p, i) => {
      const x = ox + (p.x - x0) * scale, y = H - oy - (p.y - y0) * scale;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  const caption = document.createElement('figcaption'), text = document.createElement('span'), copy = document.createElement('button');
  text.textContent = `From ${cmOn(at.x)} across, ${cmOn(at.y)} up, ${new Date().toLocaleTimeString()}`;
  copy.textContent = 'Copy';
  copy.onclick = () => picture.toBlob((blob) => {
    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      .then(() => { copy.textContent = 'Copied'; }, (e) => say(`Could not copy: ${e.message}`));
  });
  caption.append(text, copy);
  figure.append(picture, caption);
  const output = $('#output');
  if (output.querySelector('p')) output.replaceChildren();
  output.prepend(figure);
  // For whatever turns the writing into text next.
  window.dispatchEvent(new CustomEvent('board:put', { detail: { strokes, at } }));
}

// ---------------------------------------------------------------- measuring and recording

$('#measure').onchange = (e) => {
  measuring = e.target.checked;
  note('measure', { on: measuring });
  if (measuring) marks = [];
};

$('#record-session').onclick = () => {
  if (!recording) {
    // A recording starts from scratch, so that it plays back exactly: the board is set up again.
    board = fresh();
    joinCamera();
    book.reset();
    held = null;
    marks = [];
    recording = new Recorder({ rate: RATE, band: band ? band.name : null, link: band ? band.transportKind : null, lowpass: LOWPASS, camera: cameraSetup() });
    if (measuring) note('measure', { on: true });
    $('#record-session').textContent = 'Stop and save';
    $('#record-note').textContent = 'Recording. Hold still, then knock the left edge and the far right edge.';
    refresh(true);
    return;
  }
  const record = recording;
  record.about.measure = { width: tape(), dots: $('#dots').value.split('\n').map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number)).filter((d) => d.length === 2) };
  recording = null;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(record)], { type: 'application/json' }));
  link.download = record.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  $('#record-session').textContent = 'Record session';
  $('#record-note').textContent = `Saved ${record.samples.length} samples. Check it with: node tests/board.mjs --bench ${link.download}`;
};

// ---------------------------------------------------------------- the pretend band

function teachPretend() {
  for (const label of LABELS) {
    book.examples[label] = [];
    book.teach(label, examples(label, 4, { rate: RATE, seed: 11 }));
  }
  keep();
  $('#gesture-status').textContent = 'Taught from a pretend hand: 4 examples of each.';
}
$('#demo-examples').onclick = () => {
  teachPretend();
  refresh(true);
};
$('#demo').onclick = () => {
  if (!pretend) return;
  if (!book.trained) teachPretend();
  // Above 100 a second the pretend band's chip runs 0.8 % slow (CHIP_CLOCK in the kit's sim.js), and it plays
  // one entry of the list for each sample it takes: the session is made at the rate it really samples.
  const s = session('reach', { rate: RATE > 100 ? RATE / 1.008 : RATE, gestures: true, seed: 1 + Math.floor(Math.random() * 1000) });
  // The pretend band's readings at rest are perfect, the session's have a gyro bias as a real band's do:
  // start the tracker afresh, so it learns the session's bias from the session's own first still second.
  board = fresh();
  joinCamera();
  note('restart');
  held = null;
  pretend.playMotion(s.samples.map(({ ax, ay, az, gx, gy, gz }) => ({ ax, ay, az, gx, gy, gz })));
  for (const t of s.taps) pretend.after((t - s.samples[0].t) / 1000, () => pretend.tap('tap'));
  say(`A pretend hand sets up a 1.2 m board, writes, takes its first word off the board and puts it on the screen (${Math.round(s.samples.length / RATE)} s).`);
  refresh(true);
};

// ---------------------------------------------------------------- every frame

function frame() {
  news();
  draw();
  refresh();
  requestAnimationFrame(frame);
}
refresh(true);
requestAnimationFrame(frame);
