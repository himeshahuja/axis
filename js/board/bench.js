// The bench: what the band sends, and what the board tracker makes of it.
//
// The input comes from the band (through the kit's connect bar), from a recording
// (made here or on the board page), or from a simulated session. All of it goes
// through the same intake and board tracker as board.html, so what shows here is
// what the board page does with the same input.

import { $, onConnect, say } from '../../vexo-open-kit/projects/shared/page.js';
import { CameraPanel } from './camera.js';
import { BAND } from './config.js';
import { alongBoard, Fused } from './fuse.js';
import { apply, homography } from './homography.js';
import { Recorder, fromSession, readRecording } from './recording.js';
import { session } from './simulate.js';
import { bands, peaks, spectrum } from './spectrum.js';
import { BoardTracker } from './tracker.js';

document.body.dataset.ready = 'yes';          // for boot.js: the program started, so the kit is there
if (!$('#number').value) $('#number').value = String(BAND);

const query = new URLSearchParams(location.search);
const RATE = [100, 208, 416].includes(Number(query.get('rate'))) ? Number(query.get('rate')) : 208;
const SHOW_MS = 5000;                         // signal on screen, and the spectrum's window
const STEPS = [
  { label: 'still', s: 5, text: 'Hold the band still against the board.' },
  { label: 'left', s: 5, text: 'Knock the board\'s left edge with your band hand, then hold still.' },
  { label: 'right', s: 7, text: 'Knock the board\'s far right edge, then hold still.' },
  { label: 'write', s: 12, text: 'Write two words on the board, with a pause between them.' },
  { label: 'still', s: 4, text: 'Hold still.' },
];
const SIMULATED = {
  reach: ['reach', {}],
  walk: ['walk', {}],
  steady: ['steady', {}],
  chip: ['reach', { chip: { offset: [0.3, -0.25, 0.3], scale: [1.02, 0.99, 1.01] } }],
  tremor: ['reach', { tremor: 0.2 }],
  lost: ['reach', { drop: [[9.6, 50], [12.2, 30], [15.1, 120], [21.4, 50]] }],
  camera: ['reach', { camera: { hide: [[16, 1.5]] } }],
};
const LINKS = { ble: 'Bluetooth', serial: 'the USB cable', sim: 'the pretend link' };
const style = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fixed = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '–');
const percent = (part, all) => (all ? `${Math.round((100 * part) / all)}%` : '–');

let band = null, about = {};                  // the band, and what it said about itself
let rate = RATE;                              // samples a second of what is coming in
let lowpass = null;
let board = null;                             // the board tracker on the input
let view = [];                                // the last SHOW_MS of samples, with what the tracker made of each
let marks = { taps: [], lost: [] };           // taps and lost samples in that time, for the plots
let lastT = null;                             // the band's time of the latest sample, ms
let counted = { rests: 0, still: false, lost: 0, lastRest: null };
let recorder = null, capture = null, stillness = null, player = null, frozen = null;
let fused = null, clock = null, replayed = null;   // camera + band; band time minus real time; a recording's camera
let fixes = [];                                    // the last 2 s of camera fixes, board metres, for the jitter
let gap = [];                                      // [time, cm] the band alone against the camera, last 10 s

function newBoard() {
  board = new BoardTracker({ rate, auto: true, lowpass });
  counted = { rests: 0, still: false, lost: 0, lastRest: null };
  joinCamera();
}

// What the camera (live, or a recording's) says about the board: { size, toBoard, tip } or null.
function cameraView() {
  if (replayed) return replayed;
  const s = camera?.size;
  return camera?.ready && s ? { size: s, toBoard: camera.toBoard, tip: camera.tip } : null;
}

function joinCamera() {
  const view = cameraView();
  fused = view ? new Fused({ width: view.size.width, height: view.size.height, tip: view.tip }) : null;
  board.onSample = fused ? (t, acc, still) => fused?.step(t, board.frame ? alongBoard(acc, board.frame.ux) : null, still) : null;
  fixes = [];
  gap = [];
}

/** A camera fix at the band's time t, at board metres (x, y). */
function seen(t, x, y) {
  if (!fused) return;
  fused.fix(t, x, y);
  // The jitter is measured over the present stillness only: any movement starts it again.
  if (!board.still) fixes = [];
  else fixes.push({ t, x, y, still: true });
  while (fixes.length && t - fixes[0].t > 2000) fixes.shift();
}

const camera = new CameraPanel(
  { canvas: $('#cam'), status: $('#cam-status'), start: $('#cam-start'), corners: $('#cam-corners'), tip: $('#cam-tip'), hand: $('#cam-hand'), width: $('#cam-width'), height: $('#cam-height') },
  {
    band() {
      const tr = board.tracker;
      if (!band || !tr.ready) return null;
      return tr.still ? [0, 0] : [Math.hypot(tr.v[0], tr.v[2]), tr.v[1]];
    },
    onFix(fix) {
      if (fix.x === null || clock === null || player) return;
      const t = fix.time - clock;
      seen(t, fix.x, fix.y);
      recorder?.fix({ ...fix, t });
    },
    onChange() {
      if (!player) joinCamera();
    },
  },
);
newBoard();

function clear() {
  view = [];
  marks = { taps: [], lost: [] };
  lastT = null;
  frozen = null;
  $('#freeze').textContent = 'Freeze';
  $('#log').replaceChildren();
}

function note(text) {
  const item = document.createElement('li'), log = $('#log');
  item.textContent = `${lastT === null ? '' : `${(lastT / 1000).toFixed(1)} s  `}${text}`;
  log.append(item);
  while (log.childElementCount > 300) log.firstElementChild.remove();
  log.scrollTop = log.scrollHeight;
}

function describe(n) {
  if (n.type === 'left') return 'left edge placed';
  if (n.type === 'board') return `board set up: ${fixed(n.width * 100)} cm wide`;
  if (n.type === 'too-close') return `the two knocks were only ${fixed(n.width * 100)} cm apart: left edge again`;
  if (n.type === 'anchor') return `re-anchored on the ${n.edge ? 'right' : 'left'} edge, moved ${fixed(n.moved * 100)} cm`;
  if (n.type === 'lost') return `lost track: ${Math.round(n.gap)} ms of samples missing`;
  return JSON.stringify(n);
}

// ---------------------------------------------------------------- the input, wherever it comes from

function ingest(m, arrived = null) {
  lastT = m.t;
  if (Number.isFinite(m.time)) clock = m.time - m.t;
  board.feed(m, arrived);
  for (const n of board.news.splice(0)) {
    note(describe(n));
    if (fused && (n.type === 'left' || n.type === 'board')) {
      const k = fused.knockAt(n.t, n.type === 'left' ? 'left' : 'right');
      if (k.across !== null) note(`the camera saw that knock ${Math.round(k.across * 100)}% of the way across${k.ok ? '' : ': the wrong edge'}`);
      if (n.type === 'left') {
        const i = fused.indexAt(n.t);
        if (i >= 0) fused.y0 = fused.y[i] + fused.tip[1];
      }
    }
  }
  // The band alone against the camera: both measured from the left knock, in cm.
  if (fused?.length && board.frame && fused.blindFor(m.t) < 200) {
    const a = board.cursor, b = fused.cursor, W = board.frame.width, V = fused.size.width;
    gap.push([m.t, 100 * Math.hypot(a.x * W - b.x * V, a.y * W - b.y * V)]);
    while (gap.length && m.t - gap[0][0] > 10000) gap.shift();
  }
  const lost = board.intake.stats.lost;
  if (lost > counted.lost) {
    marks.lost.push({ t: m.t });
    counted.lost = lost;
  }
  if (board.still && !counted.still) counted.rests++;
  if (board.still) counted.lastRest = m.t;
  counted.still = board.still;
  view.push({ t: m.t, ax: m.ax, ay: m.ay, az: m.az, gx: m.gx, gy: m.gy, gz: m.gz, still: board.still, ready: board.ready, why: board.why && { ...board.why } });
  while (view.length && m.t - view[0].t > SHOW_MS) view.shift();
  for (const list of [marks.taps, marks.lost]) while (list.length && m.t - list[0].t > SHOW_MS) list.shift();
  if (recorder) recorder.motion(m, arrived);
  if (stillness) {
    stillness.samples.push(m);
    if (board.why && board.ready) stillness.why.push({ ...board.why });
    if (m.t >= stillness.until) finishStillness();
  }
}

function heard(t, kind) {
  marks.taps.push({ t, kind });
  if (recorder) recorder.event(t, kind);
  if (kind === 'double-tap') {
    note('double-tap');
    if (board.frame) board.reanchor();
    return;
  }
  const use = board.tap(t);
  note(use ? `tap: taken as the ${use === 'anchor' ? 're-anchor' : `${use} edge`}` : `tap, not used (${board.status().text.toLowerCase()})`);
}

onConnect(async (theBand, pretend) => {
  stopPlaying();
  band = theBand;
  rate = RATE;
  newBoard();
  clear();
  band.on('motion', (m) => ingest(m, performance.now()));
  band.on('tap', (e) => heard(e.t, 'tap'));
  band.on('double-tap', (e) => heard(e.t, 'double-tap'));
  band.on('notice', (e) => {
    note(`notice from the band: ${e.kind}${e.arg == null ? '' : ` (${e.arg})`}`);
    if (recorder) recorder.event(lastT ?? 0, 'notice', { notice: e.kind, arg: e.arg ?? null });
  });
  band.on('reconnecting', (e) => note(`link lost: trying to get it back for ${e.seconds} s`));
  band.on('reconnected', (e) => note(`link back after ${fixed(e.seconds)} s`));
  band.on('stream-taken', (e) => note(e.message));
  band.on('disconnect', (e) => {
    note(`disconnected (${e.reason})`);
    band = null;
  });
  if (pretend) pretend.playMotion([{}]);        // the pretend band lies still
  await band.setMotion({ accelRange: 16 });
  await band.setEvents({ kinds: ['tap', 'double-tap'] });
  await band.configure({ motion: RATE, events: true });
  const motion = await band.getMotion().catch(() => null);
  about = { band: band.name, link: band.transportKind, firmware: band.info?.firmware ?? null, features: band.info?.features ?? [], motion, streams: band.streams };
  note(`connected to ${band.name} over ${LINKS[band.transportKind] ?? band.transportKind}, firmware ${about.firmware ?? '?'} (${about.features.join(', ') || 'no extra features'})`);
  if (motion) note(`motion as the band set it: ${band.streams?.motion ?? motion.rate} a second, ${motion.sensors}, ±${motion.accelRange} g, ±${motion.gyroRange} °/s`);
  say(`Connected to ${band.name}. Everything it sends is shown below.`);
});

// A recording or a simulated session, played into the same intake and tracker.
function play(rec, label) {
  if (band) {
    say('Disconnect the band first; then a recording or a simulated session can play.');
    return;
  }
  stopPlaying();
  rate = rec.rate;
  newBoard();
  clear();
  about = { band: rec.band ?? 'a recording', link: rec.link ?? null, firmware: rec.firmware ?? null, motion: rec.motion ?? null };
  const cam = rec.camera;
  replayed = cam ? { size: { width: cam.width, height: cam.height }, tip: cam.tip ?? [0, 0], toBoard: homography(cam.corners, [[0, cam.height], [cam.width, cam.height], [cam.width, 0], [0, 0]]) } : null;
  joinCamera();
  player = { rec, label, i: 0, e: 0, f: 0, until: rec.samples[0].t, wall: null, paused: false, done: false };
  $('#play').disabled = false;
  $('#play').textContent = 'Pause';
  note(`playing ${label}: ${rec.samples.length} samples, ${fixed((rec.samples.at(-1).t - rec.samples[0].t) / 1000)} s at ${rec.rate} a second`);
  say(`Playing ${label}.`);
}

function stopPlaying() {
  player = null;
  replayed = null;
  $('#play').disabled = true;
}

function advance(now) {
  const p = player;
  if (!p || p.paused || p.done) return;
  const s = p.rec.samples, events = p.rec.events, speed = Number($('#speed').value);
  if (p.wall === null) p.wall = now;
  if (speed > 0) {
    if (!Number.isFinite(p.until)) p.until = s[p.i]?.t ?? Infinity;
    p.until += (now - p.wall) * speed;
  } else {
    p.until = Infinity;
  }
  p.wall = now;
  let budget = speed > 0 ? Infinity : 8000;     // all at once: a slice a frame, so the page keeps drawing
  while (p.i < s.length && s[p.i].t <= p.until && budget-- > 0) {
    while (p.e < events.length && events[p.e].t <= s[p.i].t) replay(events[p.e++]);
    while (replayed && p.f < p.rec.fixes.length && p.rec.fixes[p.f].t <= s[p.i].t) {
      const f = p.rec.fixes[p.f++], [x, y] = apply(replayed.toBoard, [f.u, f.v]);
      seen(f.t, x, y);
    }
    ingest(s[p.i], s[p.i].arrived);
    p.i++;
  }
  if (p.i >= s.length) {
    while (p.e < events.length) replay(events[p.e++]);
    p.done = true;
    $('#play').textContent = 'Play again';
    note('end of the recording');
  }
}

function replay(e) {
  if (e.kind === 'tap' || e.kind === 'double-tap') heard(e.t, e.kind);
  else if (e.kind === 'set-up') board.setUp();
  else if (e.kind === 'reanchor') board.reanchor();
  else if (e.kind === 'restart') newBoard();
  else if (e.kind === 'step') note(`capture step ${e.step + 1}: ${e.label}`);
  else if (e.kind === 'notice') note(`notice from the band: ${e.notice}`);
}

$('#play').onclick = () => {
  if (!player) return;
  if (player.done) return play(player.rec, player.label);
  player.paused = !player.paused;
  player.wall = null;
  $('#play').textContent = player.paused ? 'Play' : 'Pause';
};

$('#sim').onchange = () => {
  const pick = SIMULATED[$('#sim').value];
  if (!pick) return;
  const [name, options] = pick;
  play(readRecording(fromSession(session(name, { rate: RATE, ...options }))), `a simulated session (${$('#sim').selectedOptions[0].textContent})`);
};

async function openFile(file) {
  try {
    play(readRecording(await file.text()), file.name);
  } catch (e) {
    say(`Could not play ${file.name}: ${e.message}`);
  }
}
$('#file').onchange = (e) => e.target.files[0] && openFile(e.target.files[0]);
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
});

$('#lowpass').onchange = () => {
  lowpass = Number($('#lowpass').value) || null;
  if (player) play(player.rec, player.label);
  else newBoard();
  note(lowpass ? `low-pass at ${lowpass} Hz; the tracker starts again` : 'low-pass off; the tracker starts again');
};

$('#t-setup').onclick = () => {
  board.setUp();
  if (recorder) recorder.event(lastT ?? 0, 'set-up');
  note('set up again: left edge first');
};

$('#freeze').onclick = () => {
  frozen = frozen ? null : view.slice();
  $('#freeze').textContent = frozen ? 'Unfreeze' : 'Freeze';
};

// ---------------------------------------------------------------- stillness check

$('#still').onclick = () => {
  if (lastT === null) return;
  stillness = { until: lastT + 5000, samples: [], why: [] };
  $('#still-note').textContent = 'Measuring: hold still for 5 seconds...';
};

function finishStillness() {
  const { samples, why } = stillness, o = board.options;
  stillness = null;
  $('#still-note').textContent = `Measured over ${fixed((samples.at(-1).t - samples[0].t) / 1000)} s.`;
  const stats = (values) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return { mean, sd: Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) };
  };
  const p95 = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)] ?? NaN;
  const size = stats(samples.map((m) => Math.hypot(m.ax, m.ay, m.az)));
  const spin = stats(samples.map((m) => Math.hypot(m.gx, m.gy, m.gz)));
  const sampleRate = (samples.length - 1) / ((samples.at(-1).t - samples[0].t) / 1000);
  const shake = (keys) => {
    let tremor = 0, peak = null;
    for (const key of keys) {
      const sp = spectrum(samples.map((m) => m[key]), sampleRate);
      tremor += bands(sp).tremor ** 2;
      const top = peaks(sp, 1, 1)[0];
      if (top && (!peak || top.power > peak.power)) peak = top;
    }
    return { tremor: Math.sqrt(tremor), peak };
  };
  const accel = shake(['ax', 'ay', 'az']), gyro = shake(['gx', 'gy', 'gz']);
  const calm = why.filter((w) => w.calm).length;
  const turning = p95(why.map((w) => w.turning)), off = p95(why.map((w) => Math.abs(w.size))), push = p95(why.map((w) => Math.min(w.push, 99)));
  const rows = [
    ['', 'Measured', 'Tracker\'s limit', ''],
    ['Reads for 1 g', `${size.mean.toFixed(3)} g ± ${(size.sd * 1000).toFixed(1)} mg`, '', board.intake.oneG ? `learned ${board.intake.oneG.toFixed(3)} g` : 'not learned yet'],
    ['Turning (gyro bias in)', `${spin.mean.toFixed(2)} ± ${spin.sd.toFixed(2)} °/s`, '', ''],
    ['Tremor, acceleration', `${(accel.tremor * 1000).toFixed(1)} mg${accel.peak ? ` (peak ${fixed(accel.peak.hz)} Hz)` : ''}`, '', ''],
    ['Tremor, turning', `${gyro.tremor.toFixed(2)} °/s${gyro.peak ? ` (peak ${fixed(gyro.peak.hz)} Hz)` : ''}`, '', ''],
  ];
  if (why.length) {
    rows.push(
      ['Turning, bias out (95%)', `${turning.toFixed(3)} rad/s`, `${o.stillGyro} rad/s`, turning < o.stillGyro ? 'ok' : 'too much'],
      ['Reading − 1 g (95%)', `${off.toFixed(3)} m/s²`, `${o.stillAccel} m/s²`, off < o.stillAccel ? 'ok' : 'too much'],
      ['Hand\'s own push (95%)', `${push.toFixed(3)} m/s²`, `${o.stillWorld} m/s²`, push < o.stillWorld ? 'ok' : 'too much'],
      ['Calm', percent(calm, why.length), 'needs 0.1 s in a row', calm / why.length > 0.8 ? 'rests will be found' : 'rests may not be found'],
    );
  } else {
    rows.push(['Tracker', 'still starting up', '', 'hold still longer']);
  }
  $('#still-result').replaceChildren(...rows.map((cells, r) => {
    const tr = document.createElement('tr');
    cells.forEach((text, c) => {
      const cell = document.createElement(r ? 'td' : 'th');
      cell.textContent = text;
      if (r && c === 3) cell.className = /too much|may not/.test(text) ? 'bad' : /ok|will be/.test(text) ? 'good' : '';
      tr.append(cell);
    });
    return tr;
  }));
  if (recorder) recorder.event(lastT ?? 0, 'stillness', { calm: why.length ? calm / why.length : null });
}

// ---------------------------------------------------------------- recording

function save(rec, prefix = '') {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(rec)], { type: 'application/json' }));
  link.download = rec.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  $('#rec-note').textContent = `${prefix}Saved ${rec.samples.length} samples (${fixed(rec.seconds)} s) as ${rec.name}. Check it with: node tests/board.mjs --bench ${rec.name}`;
}

function startRecording(extra = {}) {
  // A recording starts from a fresh tracker, so that it plays back exactly as it went.
  newBoard();
  const view = cameraView();
  recorder = new Recorder({ rate, ...about, lowpass, ...extra, camera: view && !replayed ? { corners: camera.corners, ...view.size, tip: view.tip } : null });
}

$('#capture').onclick = () => {
  if (capture) {
    capture = null;
    save(recorder, 'Stopped early. ');
    recorder = null;
    return;
  }
  startRecording({ capture: STEPS.map((s) => s.label) });
  capture = { step: -1, until: 0 };
  nextStep(performance.now());
};

function nextStep(now) {
  capture.step++;
  if (capture.step >= STEPS.length) {
    capture = null;
    save(recorder, 'Capture done. ');
    recorder = null;
    say('Capture done.');
    return;
  }
  const step = STEPS[capture.step];
  capture.until = now + step.s * 1000;
  recorder.event(lastT ?? 0, 'step', { step: capture.step, label: step.label });
  say(step.text);
}

$('#record').onclick = () => {
  if (recorder && !capture) {
    save(recorder);
    recorder = null;
    return;
  }
  startRecording();
  $('#rec-note').textContent = 'Recording, from a fresh tracker: hold still, then knock the left and right edges.';
};

function showSteps(now) {
  $('#steps').replaceChildren(...STEPS.map((step, i) => {
    const item = document.createElement('li');
    const left = capture && capture.step === i ? ` (${Math.max(0, Math.ceil((capture.until - now) / 1000))} s)` : '';
    item.textContent = `${step.text}${left}`;
    item.className = !capture ? '' : i === capture.step ? 'now' : i < capture.step ? 'done' : '';
    return item;
  }));
}

// ---------------------------------------------------------------- drawing

function surface(canvas, height) {
  const dpr = devicePixelRatio || 1, width = canvas.clientWidth || 600;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.font = '11px system-ui, sans-serif';
  return { ctx, width, height };
}

function drawSignals() {
  const plots = [['#accel', ['ax', 'ay', 'az'], 'g', 2], ['#gyro', ['gx', 'gy', 'gz'], '°/s', 0]];
  for (const [id, keys, unit, digits] of plots) {
    const { ctx, width, height } = surface($(id), 150);
    if (view.length < 2) continue;
    const t1 = view[view.length - 1].t, t0 = t1 - SHOW_MS, X = (t) => ((t - t0) / SHOW_MS) * width;
    const sized = unit === 'g', size = (s) => Math.hypot(s.ax, s.ay, s.az);
    let lo = Infinity, hi = -Infinity;
    for (const s of view) {
      for (const k of keys) { lo = Math.min(lo, s[k]); hi = Math.max(hi, s[k]); }
      if (sized) { lo = Math.min(lo, size(s)); hi = Math.max(hi, size(s)); }
    }
    const pad = Math.max((hi - lo) * 0.08, sized ? 0.02 : 2);
    lo -= pad;
    hi += pad;
    const Y = (v) => height - ((v - lo) / (hi - lo)) * height;
    ctx.fillStyle = style('--rest');
    let from = null;
    view.forEach((s, i) => {
      if (s.still && from === null) from = s.t;
      if ((!s.still || i === view.length - 1) && from !== null) {
        ctx.fillRect(X(from), 0, Math.max(1, X(s.t) - X(from)), height);
        from = null;
      }
    });
    const line = (colour, value, width = 1.4) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      view.forEach((s, j) => (j ? ctx.lineTo(X(s.t), Y(value(s))) : ctx.moveTo(X(s.t), Y(value(s)))));
      ctx.stroke();
    };
    if (sized) line(style('--size'), size, 1.2);
    keys.forEach((k, i) => line(style(['--x', '--y', '--z'][i]), (s) => s[k]));
    ctx.lineWidth = 2;
    ctx.strokeStyle = style('--tap');
    for (const tap of marks.taps) {
      ctx.beginPath();
      ctx.moveTo(X(tap.t), 0);
      ctx.lineTo(X(tap.t), height);
      ctx.stroke();
    }
    ctx.fillStyle = style('--lost');
    for (const l of marks.lost) ctx.fillRect(X(l.t) - 1.5, 0, 3, 10);
    ctx.fillStyle = '#aab3c0';
    ctx.fillText(`${hi.toFixed(digits)} ${unit}`, 4, 12);
    ctx.fillText(`${lo.toFixed(digits)} ${unit}`, 4, height - 4);
  }
}

let spectra = null, spectraAt = -Infinity;
function drawSpectrum(now) {
  const source = frozen ?? view;
  if (now - spectraAt > 500 && source.length > 64) {
    spectraAt = now;
    const span = (source.at(-1).t - source[0].t) / 1000, sampleRate = (source.length - 1) / span;
    spectra = Object.fromEntries(['ax', 'ay', 'az', 'gx', 'gy', 'gz'].map((k) => [k, spectrum(source.map((s) => s[k]), sampleRate)]));
    const summary = (keys, unit, scale, digits) => {
      let best = null, tremor = 0, above = 0;
      for (const k of keys) {
        const top = peaks(spectra[k], 1, 1)[0];
        if (top && (!best || top.power > best.power)) best = top;
        const b = bands(spectra[k]);
        tremor += b.tremor ** 2;
        above += b.above ** 2;
      }
      return `${best ? `peak ${fixed(best.hz)} Hz, ` : ''}tremor ${(Math.sqrt(tremor) * scale).toFixed(digits)} ${unit}, above 12 Hz ${(Math.sqrt(above) * scale).toFixed(digits)} ${unit}`;
    };
    $('#peaks').textContent = `Acceleration: ${summary(['ax', 'ay', 'az'], 'mg', 1000, 1)}. Turning: ${summary(['gx', 'gy', 'gz'], '°/s', 1, 2)}.`;
  }
  const { ctx, width, height } = surface($('#spectrum'), 280);
  if (!spectra) return;
  const top = spectra.ax.freqs.at(-1) ?? 0, maxHz = Math.min(50, top);
  if (!maxHz) return;
  const X = (f) => (f / maxHz) * width, half = (height - 18) / 2;
  [['ax', 'ay', 'az'], ['gx', 'gy', 'gz']].forEach((keys, panel) => {
    const y0 = panel * half;
    let hi = -Infinity;
    for (const k of keys) for (let i = 1; i < spectra[k].power.length; i++) if (spectra[k].freqs[i] <= maxHz) hi = Math.max(hi, 10 * Math.log10(spectra[k].power[i] || 1e-30));
    const lo = hi - 60, Y = (db) => y0 + half - ((Math.max(lo, db) - lo) / (hi + 3 - lo)) * half;
    ctx.fillStyle = style('--rest');
    ctx.fillRect(X(6), y0, X(12) - X(6), half);
    keys.forEach((k, i) => {
      ctx.strokeStyle = style(['--x', '--y', '--z'][i]);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      const { freqs, power } = spectra[k];
      let started = false;
      for (let j = 1; j < power.length && freqs[j] <= maxHz; j++) {
        const x = X(freqs[j]), y = Y(10 * Math.log10(power[j] || 1e-30));
        if (started) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        started = true;
      }
      ctx.stroke();
    });
    ctx.fillStyle = '#aab3c0';
    ctx.fillText(panel ? 'turning' : 'acceleration', 4, y0 + 12);
  });
  ctx.fillStyle = '#aab3c0';
  for (const f of [0, 5, 10, 20, 30, 40, 50].filter((f) => f <= maxHz)) ctx.fillText(`${f} Hz`, Math.min(width - 34, X(f) + 2), height - 4);
}

function drawMini() {
  const { ctx, width, height } = surface($('#mini'), 170);
  const f = board.frame, left = width * 0.06, right = width * 0.94, scale = right - left, base = height * 0.35;
  ctx.fillStyle = '#e9ebe6';
  ctx.fillRect(left, 0, scale, height);
  ctx.lineWidth = 3;
  for (const [x, edge] of [[left, 'left'], [right, 'right']]) {
    ctx.strokeStyle = !f && board.want === edge ? style('--tap') : '#9aa3b2';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  if (!f) {
    ctx.fillStyle = '#5b6676';
    ctx.textAlign = 'center';
    ctx.fillText(board.status().text, width / 2, height / 2);
    ctx.textAlign = 'start';
    return;
  }
  const X = (x) => left + x * scale, Y = (y) => base - y * scale;
  ctx.strokeStyle = '#1d2433';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const from = Math.max(board.hidden, board.length - 6000), every = Math.max(1, Math.floor((board.length - from) / 2000));
  let open = false;
  for (let i = from; i < board.length; i += every) {
    if (!board.shown(i)) { open = false; continue; }
    const b = board.boardAt(i);
    if (open) ctx.lineTo(X(b.x), Y(b.y)); else ctx.moveTo(X(b.x), Y(b.y));
    open = true;
  }
  ctx.stroke();
  const c = board.cursor;
  if (c) {
    ctx.fillStyle = style('--accent');
    ctx.beginPath();
    ctx.arc(X(c.x), Y(c.y), 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- what the page says

function cells(dl, entries) {
  dl.replaceChildren(...entries.map(([label, value]) => {
    const div = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = String(value);
    div.append(dt, dd);
    return div;
  }));
}

function showCamera() {
  const still = fixes.filter((f) => f.still), spread = (k) => {
    const m = still.reduce((a, f) => a + f[k], 0) / still.length;
    return Math.sqrt(still.reduce((a, f) => a + (f[k] - m) ** 2, 0) / still.length);
  };
  const sorted = gap.map(([, cm]) => cm).sort((a, b) => a - b), h = camera.health;
  cells($('#cam-stats'), [
    ['Band\'s wrist seen', camera.running ? `${Math.round(h.seen * 100)}% of frames, ${h.people} in view` : replayed ? 'from the recording' : '–'],
    ['Which wrist', camera.running ? (h.sure > 0.2 ? 'sure' : h.sure > 0.05 ? 'fairly sure' : 'not sure yet: move the band hand') : '–'],
    ['Frames', camera.running ? `${h.fps.toFixed(0)} a second, ${Math.round(h.delay ?? 0)} ms behind` : '–'],
    ['Still jitter', still.length > 10 ? `${(1000 * Math.hypot(spread('x'), spread('y'))).toFixed(1)} mm` : 'hold still to measure'],
    ['Band alone vs camera', sorted.length ? `${fixed(sorted[Math.floor(sorted.length / 2)])} cm (95%: ${fixed(sorted[Math.floor(sorted.length * 0.95)])} cm), last 10 s` : 'needs the board set up and the light seen'],
  ]);
}

function showHealth() {
  const h = board.intake.health(), m = about.motion;
  cells($('#health'), [
    ['Band', about.band ?? '–'],
    ['Link', LINKS[about.link] ?? about.link ?? '–'],
    ['Firmware', about.firmware ?? '–'],
    ['Motion as set', m ? `${about.streams?.motion ?? m.rate}/s, ±${m.accelRange} g, ±${m.gyroRange} °/s` : '–'],
    ['Samples', h.samples],
    ['Rate', Number.isFinite(h.rate) ? `${fixed(h.rate)} a second` : '–'],
    ['Timing jitter', Number.isFinite(h.jitter) ? `${fixed(h.jitter, 2)} ms` : '–'],
    ['Lost', `${h.lost} (${h.bridged} filled in, ${h.gaps} gap${h.gaps === 1 ? '' : 's'})`],
    ['Longest gap', h.longestGap ? `${Math.round(h.longestGap)} ms` : '–'],
    ['Cut off at range', h.clipped],
    ['Packets', h.packetsPerSecond ? `${fixed(h.packetsPerSecond)} a second, ${fixed(h.perPacket)} samples each` : '–'],
    ['1 g reads as', h.oneG ? `${h.oneG.toFixed(3)} g` : 'not yet: needs a still moment'],
  ]);
}

function showTracker() {
  const st = board.status(), o = board.options;
  $('#t-status').textContent = st.text;
  $('#t-detail').textContent = st.detail;
  const recent = view.filter((s) => s.why && s.ready), n = recent.length, w = board.why;
  const rows = [['', 'Now', 'Limit', 'Over it, last 5 s']];
  if (!board.ready || !w || w.startUp) {
    const v = w ?? { turning: NaN, size: NaN };
    rows.push(
      ['Turning (start-up)', `${fixed(v.turning, 3)} rad/s`, `${o.startStill[0] + 0.05} rad/s`, ''],
      ['Reading − 1 g (start-up)', `${fixed(v.size, 3)} m/s²`, `${o.startStill[1]} m/s²`, ''],
      ['Start-up', `${board.starts} restart${board.starts === 1 ? '' : 's'}`, 'still for 0.6 s', ''],
    );
  } else {
    const over = (test) => percent(recent.filter((s) => test(s.why)).length, n);
    rows.push(
      ['Turning, bias out', `${fixed(w.turning, 3)} rad/s`, `${o.stillGyro} rad/s`, over((x) => x.turning >= o.stillGyro)],
      ['Reading − 1 g', `${fixed(w.size, 3)} m/s²`, `±${o.stillAccel} m/s²`, over((x) => Math.abs(x.size) >= o.stillAccel)],
      ['Hand\'s own push', `${fixed(w.push, 3)} m/s²`, `${o.stillWorld} m/s², or steady`, over((x) => x.push >= o.stillWorld && x.steady >= o.stillSteady)],
      ['Calm', w.calm ? 'yes' : 'no', 'for 0.1 s in a row', `calm ${percent(recent.filter((s) => s.why.calm).length, n)}`],
    );
  }
  $('#why').replaceChildren(...rows.map((cellsOf, r) => {
    const tr = document.createElement('tr');
    for (const text of cellsOf) {
      const cell = document.createElement(r ? 'td' : 'th');
      cell.textContent = text;
      tr.append(cell);
    }
    return tr;
  }));
  const c = board.frame && board.cursor;
  cells($('#t-stats'), [
    ['Rests found', counted.rests],
    ['Last rest', counted.lastRest === null || lastT === null ? 'none yet' : `${fixed((lastT - counted.lastRest) / 1000)} s ago`],
    ['Taps heard', board.heard],
    ['Lost track', board.lost],
    ['Board', board.frame ? `${fixed(board.frame.width * 100)} cm wide` : 'not set up'],
    ['Hand at', c ? `${Math.round(c.x * board.frame.width * 100)} cm across, ${Math.round(c.y * board.frame.width * 100)} up` : '–'],
  ]);
}

function buttons() {
  const live = Boolean(band || player);
  $('#still').disabled = !live || Boolean(stillness);
  $('#capture').disabled = !live || Boolean(recorder && !capture);
  $('#capture').textContent = capture ? 'Stop capture' : 'Start capture';
  $('#record').disabled = !live || Boolean(capture);
  $('#record').textContent = recorder && !capture ? 'Stop and save' : 'Record freely';
  $('#t-setup').disabled = !live;
}

let shownAt = -Infinity;
function frame(now) {
  advance(now);
  if (capture && now >= capture.until) nextStep(now);
  drawSignals();
  drawSpectrum(now);
  drawMini();
  if (now - shownAt > 250) {
    shownAt = now;
    showHealth();
    showCamera();
    showTracker();
    showSteps(now);
    buttons();
  }
  requestAnimationFrame(frame);
}
showSteps(0);
requestAnimationFrame(frame);
