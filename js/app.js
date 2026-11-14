// The page: plays sensor samples into the tracker at the speed they were
// recorded, and draws the path it recovers.
//
// Can play synthetic preset shapes (Circle, Star, Heart, etc.) or connect
// directly to a real Vexo Open band over USB-C or Bluetooth!

import { Tracker, Calibrator, qrot } from './fusion.js';
import { SHAPES, synth } from './fake.js';
import { Band } from '../vexo-open-kit/js/src/index.js';

const $ = (id) => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COL = { path: css('--path'), muted: css('--muted'), raised: css('--raised'), ink: css('--ink'), accent: css('--accent'), x: css('--x'), y: css('--y'), z: css('--z') };
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

const btnUsb = $('btn-usb');
const btnBle = $('btn-ble');
const btnPen = $('btn-pen');
const btnClear = $('btn-clear');
const btnRecal = $('btn-recal');
const btnDisconnect = $('btn-disconnect');
const bandNumInput = $('band-num');
const bandBanner = $('band-banner');
const bandStatusText = $('band-status-text');
const bandBattery = $('band-battery');
const batteryStat = $('battery-stat');
const truthToggle = $('truth-toggle');
const showHandToggle = $('show-hand');
const metricLabel = $('metric-label');

let activeBand = null;
let liveMode = false;
let isPenDown = true;
let isCalibrating = false;
let calibMessage = '';
let batteryInterval = null;
const calibrator = new Calibrator({ samples: 60 });
const liveSamples = [];

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('band') && bandNumInput) {
  bandNumInput.value = urlParams.get('band');
}

const names = Object.keys(SHAPES);
let shape = names[0], picked = false, run = 0;
let data, tracker, fed, clock, endedAt, last = 0;
const cam = { yaw: 0, pitch: 0, cx: 0, cy: 0, cz: 0, span: 0.3 };

// Add a "Live Band" button to the shape pills
const liveButton = document.createElement('button');
liveButton.type = 'button';
liveButton.textContent = 'Live Band';
liveButton.dataset.shape = 'live';
liveButton.hidden = true;
liveButton.addEventListener('click', () => {
  if (activeBand) {
    liveMode = true;
    for (const b of $('shapes').children) b.setAttribute('aria-pressed', String(b === liveButton));
    if (truthToggle) truthToggle.style.display = 'none';
    if (metricLabel) metricLabel.textContent = 'Trajectory span';
  }
});
$('shapes').append(liveButton);

function load(name) {
  liveMode = false;
  shape = name;
  data = synth(name, { seed: ++run });
  tracker = new Tracker();
  fed = 0; clock = 0; endedAt = null;
  for (const b of $('shapes').children) b.setAttribute('aria-pressed', String(b.textContent === name));
  if (truthToggle) truthToggle.style.display = '';
  if (metricLabel) metricLabel.textContent = 'Off the true path';
  // Reduced motion: no playback, just the finished drawing.
  if (still) { for (const s of data.samples) tracker.feed(s); fed = data.samples.length; }
}

for (const name of names) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = name;
  b.addEventListener('click', () => {
    picked = true;
    load(name);
  });
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

  if (!liveMode && $('truth') && $('truth').checked) {
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

  // Render the hand motion simulation or the classic sensor dot & axes
  if (n) {
    const p = [tr.x[n - 1], tr.y[n - 1], tr.z[n - 1]];
    const penDown = liveMode ? isPenDown : (tr.pen[n - 1] === 1);
    let ledColor = isCalibrating ? '#ffaa00' : (penDown ? '#00ff88' : '#ffaa00');

    if (showHandToggle && showHandToggle.checked) {
      drawHandSimulation(ctx, project, p, tr.q, penDown, ledColor);
    } else {
      const [px, py] = project(...p), arm = cam.span * 0.09;
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
}

// 3D Hand Motion Simulator: converts the 3D trajectory [x, y, z] and attitude quaternion [q]
// into a live simulated human hand, forearm, Vexo wristband with active RGB LED, and drawing stylus.
function drawHandSimulation(ctx, project, p, q, penDown, ledColor) {
  const loc = (dx, dy, dz) => {
    const r = qrot(q, [dx, dy, dz]);
    return [p[0] + r[0], p[1] + r[1], p[2] + r[2]];
  };
  const pr = (dx, dy, dz) => project(...loc(dx, dy, dz));

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1. Forearm segment (extending backward from wrist along +Z)
  const armPts = [
    pr(-0.024, -0.016, 0.02),
    pr(0.024, -0.016, 0.02),
    pr(0.032, -0.024, 0.22),
    pr(-0.032, -0.024, 0.22),
  ];
  ctx.fillStyle = 'rgba(51, 65, 85, 0.85)';
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(armPts[0][0], armPts[0][1]);
  for (let i = 1; i < armPts.length; i++) ctx.lineTo(armPts[i][0], armPts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 2. Wristband strap circling the wrist
  const strapPts = [
    pr(-0.025, 0.007, 0.008),
    pr(0.025, 0.007, 0.008),
    pr(0.023, -0.026, 0.008),
    pr(-0.023, -0.026, 0.008),
  ];
  ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(strapPts[0][0], strapPts[0][1]);
  for (let i = 1; i < strapPts.length; i++) ctx.lineTo(strapPts[i][0], strapPts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 3. Vexo Band module housing on top of the wrist
  const moduleTop = [
    pr(-0.016, 0.016, -0.014),
    pr(0.016, 0.016, -0.014),
    pr(0.016, 0.016, 0.014),
    pr(-0.016, 0.016, 0.014),
  ];
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(moduleTop[0][0], moduleTop[0][1]);
  for (let i = 1; i < moduleTop.length; i++) ctx.lineTo(moduleTop[i][0], moduleTop[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 4. Band RGB status LED
  const [lx, ly] = pr(0, 0.017, 0);
  const grad = ctx.createRadialGradient(lx, ly, 1, lx, ly, 10);
  grad.addColorStop(0, ledColor || '#00ff88');
  grad.addColorStop(0.4, ledColor || '#00ff88');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(lx, ly, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // 5. Hand / Palm geometry extending forward (-Z)
  const palmPts = [
    pr(-0.022, -0.014, -0.01),
    pr(0.022, -0.014, -0.01),
    pr(0.026, -0.012, -0.06),
    pr(0.010, -0.010, -0.085), // knuckle area
    pr(-0.020, -0.010, -0.075),
    pr(-0.028, -0.012, -0.045), // thumb base
  ];
  ctx.fillStyle = 'rgba(217, 163, 126, 0.88)'; // hand tone
  ctx.strokeStyle = 'rgba(180, 120, 85, 0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(palmPts[0][0], palmPts[0][1]);
  for (let i = 1; i < palmPts.length; i++) ctx.lineTo(palmPts[i][0], palmPts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 6. Fingers & Stylus / Pen
  const tipZ = -0.11;
  const tipY = penDown ? -0.038 : -0.012;
  const penTip = pr(0, tipY, tipZ);
  const penTop = pr(0.018, 0.038, -0.025);
  const penGrip = pr(0.006, -0.005, -0.07);

  // Stylus body
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(penTop[0], penTop[1]);
  ctx.lineTo(penTip[0], penTip[1]);
  ctx.stroke();

  // Stylus nib
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(penGrip[0], penGrip[1]);
  ctx.lineTo(penTip[0], penTip[1]);
  ctx.stroke();

  // Curled gripping fingers
  ctx.strokeStyle = 'rgba(200, 140, 105, 0.95)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  const f1 = pr(0.008, -0.005, -0.068);
  const f2 = pr(0.012, 0.005, -0.072);
  ctx.moveTo(f1[0], f1[1]);
  ctx.lineTo(f2[0], f2[1]);
  ctx.stroke();

  // Pen tip ink contact / cursor glow
  if (penDown) {
    const pGrad = ctx.createRadialGradient(penTip[0], penTip[1], 0, penTip[0], penTip[1], 8);
    pGrad.addColorStop(0, '#5fe0a0');
    pGrad.addColorStop(0.5, 'rgba(95, 224, 160, 0.6)');
    pGrad.addColorStop(1, 'rgba(95, 224, 160, 0)');
    ctx.fillStyle = pGrad;
    ctx.beginPath();
    ctx.arc(penTip[0], penTip[1], 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(penTip[0], penTip[1], 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(penTip[0], penTip[1], 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Orientation coordinate axes at wrist module
  const armLen = 0.035;
  [[1, 0, 0, COL.x], [0, 1, 0, COL.y], [0, 0, 1, COL.z]].forEach(([ax, ay, az, colour]) => {
    const end = pr(ax * armLen, ay * armLen + 0.017, az * armLen);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(end[0], end[1]);
    ctx.stroke();
  });

  ctx.restore();
}

// The last few seconds of one sensor, three lines on a shared scale.
function drawChart(canvas, fields, floor) {
  const c = canvas.getContext('2d'), { w, h, dpr } = size(canvas);
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  const s = liveMode ? liveSamples : data.samples;
  const to = liveMode ? liveSamples.length : fed;
  const rate = liveMode ? 50 : 100;
  const WINDOW = 4, from = Math.max(0, to - WINDOW * rate);
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
      const x = w - ((to - 1 - i) / (WINDOW * rate)) * w, y = h / 2 - (s[i][f] / peak) * (h / 2 - 3);
      if (i === from) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
  });
}

// How far the recovered path is from the true one, on average so far.
function offBy() {
  if (liveMode) return null;
  const tr = tracker, off = fed - tr.length;
  if (!tr.length) return null;
  let sum = 0;
  for (let i = 0; i < tr.length; i++) { const p = data.truth[i + off]; sum += (tr.x[i] - p.x) ** 2 + (tr.y[i] - p.y) ** 2 + (tr.z[i] - p.z) ** 2; }
  return Math.sqrt(sum / tr.length);
}

// --- Vexo Band Live Integration ---

function startCalibration() {
  if (!liveMode) return;
  isCalibrating = true;
  calibrator.reset();
  liveSamples.length = 0;
  calibMessage = 'Calibrating: hold wrist still...';
  $('state').textContent = calibMessage;
  if (activeBand) {
    activeBand.setLed('#ffaa00', { pattern: 'breathe', period: 1000 }).catch(() => {});
  }
}

function handleLiveMotion(m) {
  if (!liveMode) return;
  // Convert Vexo units:
  // ax, ay, az: g -> m/s^2 (1 g = 9.80665 m/s^2)
  // gx, gy, gz: deg/s -> rad/s
  const s = {
    t: m.t / 1000,
    ax: m.ax * 9.80665,
    ay: m.ay * 9.80665,
    az: m.az * 9.80665,
    gx: m.gx * (Math.PI / 180),
    gy: m.gy * (Math.PI / 180),
    gz: m.gz * (Math.PI / 180),
    pen: isPenDown ? 1 : 0,
  };
  liveSamples.push(s);
  if (liveSamples.length > 500) liveSamples.shift();

  if (isCalibrating) {
    const res = calibrator.feed(s);
    calibMessage = res.message;
    if (res.done) {
      isCalibrating = false;
      const adaptiveGyro = Math.max(0.10, 3.5 * res.stdGyro);
      const adaptiveAccel = Math.max(0.35, 3.5 * res.stdAccel);
      tracker.setCalibration(res.bias, res.q, {
        stillGyro: adaptiveGyro,
        stillAccel: adaptiveAccel,
        stillFor: 20,
      });
      calibMessage = 'Calibrated! Ready to draw.';
      if (activeBand) {
        activeBand.setLed(isPenDown ? '#00ff88' : '#ffaa00').catch(() => {});
        activeBand.identify(1).catch(() => {});
      }
    }
    return;
  }

  tracker.feed(s);
}

function togglePen(force) {
  isPenDown = force !== undefined ? force : !isPenDown;
  if (btnPen) {
    btnPen.setAttribute('aria-pressed', String(isPenDown));
    btnPen.textContent = isPenDown ? '🖊️ Pen Down' : '🖐️ Pen Up';
  }
  if (activeBand && !isCalibrating) {
    activeBand.setLed(isPenDown ? '#00ff88' : '#ffaa00').catch(() => {});
  }
}

function clearDrawing() {
  if (liveMode) {
    tracker.clear();
    if (activeBand) activeBand.identify(1).catch(() => {});
  }
}

function recalibrate() {
  if (liveMode) {
    startCalibration();
    if (activeBand) activeBand.identify(1).catch(() => {});
  }
}

function updateBattery(data) {
  if (!data || data.percent == null) return;
  const pct = data.percent;
  const mV = data.millivolts;
  const state = data.state;
  const isCharging = data.charging || state === 'charging';

  const icon = isCharging ? '⚡' : pct > 50 ? '🔋' : pct > 20 ? '🪫' : '⚠️';
  let text = `${pct}%`;
  if (isCharging) text += ' (charging)';
  else if (state === 'charged') text += ' (charged)';
  else if (mV) text += ` (${(mV / 1000).toFixed(2)} V)`;

  if (batteryStat) batteryStat.textContent = `${icon} ${text}`;
  if (bandBattery) {
    bandBattery.hidden = false;
    bandBattery.textContent = `${icon} ${pct}%${isCharging ? ' ⚡' : ''}`;
    bandBattery.title = `Battery: ${pct}%, state: ${state}, ${mV ? mV + ' mV' : ''}`;
  }
}

async function connectBand(transportKind) {
  try {
    if (btnUsb) btnUsb.disabled = true;
    if (btnBle) btnBle.disabled = true;
    if (transportKind === 'serial' && btnUsb) btnUsb.textContent = 'Connecting USB...';
    if (transportKind === 'ble' && btnBle) btnBle.textContent = 'Connecting BLE...';

    const inputNum = bandNumInput?.value?.trim();
    const params = new URLSearchParams(location.search);
    const bandNum = inputNum
      ? Number(inputNum)
      : params.get('band')
        ? Number(params.get('band'))
        : (transportKind === 'ble' ? 68 : null);

    const b = await Band.connect(bandNum, { transport: transportKind });
    activeBand = b;
    liveMode = true;
    isPenDown = true;

    // Update UI controls
    if (btnUsb) btnUsb.hidden = true;
    if (btnBle) btnBle.hidden = true;
    if (bandNumInput) bandNumInput.hidden = true;
    if (btnPen) { btnPen.hidden = false; btnPen.textContent = '🖊️ Pen Down'; btnPen.setAttribute('aria-pressed', 'true'); }
    if (btnClear) btnClear.hidden = false;
    if (btnRecal) btnRecal.hidden = false;
    if (btnDisconnect) btnDisconnect.hidden = false;
    if (bandBanner) bandBanner.hidden = false;
    if (bandStatusText) bandStatusText.textContent = `${b.name} connected (${transportKind === 'serial' ? 'USB' : 'Bluetooth'})`;
    if (liveButton) { liveButton.hidden = false; liveButton.click(); }
    if (truthToggle) truthToggle.style.display = 'none';
    if (metricLabel) metricLabel.textContent = 'Trajectory span';

    // Start motion, events, and battery stream (per contract v1.1 stream bit 4)
    await b.configure({ motion: 50, events: true, battery: true });

    // Explicit BATTERY_GET query to fetch initial battery state immediately
    try {
      const batt = await b.getBattery();
      updateBattery(batt);
    } catch (e) {
      console.warn('BATTERY_GET query failed:', e);
    }

    b.on('motion', (m) => handleLiveMotion(m));
    b.on('tap', () => togglePen());
    b.on('double-tap', () => clearDrawing());
    b.on('battery', (batt) => updateBattery(batt));
    b.on('disconnect', () => onBandDisconnected());

    // Refresh battery periodically every 30 seconds
    if (batteryInterval) clearInterval(batteryInterval);
    batteryInterval = setInterval(async () => {
      if (activeBand) {
        try {
          const batt = await activeBand.getBattery();
          updateBattery(batt);
        } catch { /* ignore */ }
      }
    }, 30000);

    // Initialize tracker tuned for human wrist movement
    tracker = new Tracker({
      stillGyro: 0.12,
      stillAccel: 0.35,
      stillFor: 20,
      settleOver: 15,
    });
    startCalibration();
  } catch (err) {
    console.error('Band connection failed:', err);
    alert('Could not connect to band: ' + (err.message || err));
    onBandDisconnected();
  }
}

async function disconnectBand() {
  if (activeBand) {
    try { await activeBand.ledOff(); } catch { /* ignore */ }
    try { await activeBand.disconnect(); } catch { /* ignore */ }
    activeBand = null;
  }
  onBandDisconnected();
}

function onBandDisconnected() {
  liveMode = false;
  isCalibrating = false;
  activeBand = null;
  if (batteryInterval) {
    clearInterval(batteryInterval);
    batteryInterval = null;
  }
  if (batteryStat) batteryStat.textContent = '–';
  if (bandBattery) bandBattery.hidden = true;
  if (btnUsb) { btnUsb.hidden = false; btnUsb.disabled = false; btnUsb.textContent = 'Connect Band (USB)'; }
  if (btnBle) { btnBle.hidden = false; btnBle.disabled = false; btnBle.textContent = 'Connect Band (BLE)'; }
  if (bandNumInput) bandNumInput.hidden = false;
  if (btnPen) btnPen.hidden = true;
  if (btnClear) btnClear.hidden = true;
  if (btnRecal) btnRecal.hidden = true;
  if (btnDisconnect) btnDisconnect.hidden = true;
  if (bandBanner) bandBanner.hidden = true;
  if (liveButton) liveButton.hidden = true;
  if (truthToggle) truthToggle.style.display = '';
  if (metricLabel) metricLabel.textContent = 'Off the true path';
  load(shape);
}

if (btnUsb) btnUsb.addEventListener('click', () => connectBand('serial'));
if (btnBle) btnBle.addEventListener('click', () => connectBand('ble'));
if (btnPen) btnPen.addEventListener('click', () => togglePen());
if (btnClear) btnClear.addEventListener('click', () => clearDrawing());
if (btnRecal) btnRecal.addEventListener('click', () => recalibrate());
if (btnDisconnect) btnDisconnect.addEventListener('click', () => disconnectBand());

window.addEventListener('keydown', (e) => {
  if (!liveMode) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePen();
  } else if (e.key === 'c' || e.key === 'C') {
    clearDrawing();
  } else if (e.key === 'r' || e.key === 'R') {
    recalibrate();
  }
});

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0);
  last = now;
  // Nothing to play or draw while the other mode is showing.
  if (document.body.dataset.mode !== 'sensor') return requestAnimationFrame(frame);

  if (liveMode) {
    // Live mode: data comes in via event handlers in real time
    drawView();
    drawChart($('accel'), ['ax', 'ay', 'az'], 12);
    drawChart($('gyro'), ['gx', 'gy', 'gz'], 1);

    if (isCalibrating) {
      $('state').textContent = calibMessage;
    } else if (!tracker.ready) {
      $('state').textContent = 'Calibrating (hold wrist still...)';
    } else {
      const motionState = tracker.still ? 'Still' : 'Moving';
      $('state').textContent = isPenDown ? `🖊️ Drawing (${motionState})` : `🖐️ Pen Up (${motionState})`;
    }

    if (tracker.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < tracker.length; i++) {
        minX = Math.min(minX, tracker.x[i]); maxX = Math.max(maxX, tracker.x[i]);
        minY = Math.min(minY, tracker.y[i]); maxY = Math.max(maxY, tracker.y[i]);
        minZ = Math.min(minZ, tracker.z[i]); maxZ = Math.max(maxZ, tracker.z[i]);
      }
      const span = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 100;
      $('error').textContent = `${span.toFixed(1)} cm`;
    } else {
      $('error').textContent = '0.0 cm';
    }
  } else {
    // Synthetic playback mode
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
  }

  requestAnimationFrame(frame);
}

load(shape);
requestAnimationFrame(frame);
