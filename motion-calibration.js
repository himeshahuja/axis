import { Band } from './vexo-open-kit/js/src/index.js';

const $ = (id) => document.getElementById(id);
const axes = ['ax', 'ay', 'az'];
const canvas = $('graph');
const ctx = canvas.getContext('2d');
let band = null;
let baseline = null;
let calibrationSamples = null;
let latestRaw = null;
let latest = null;
let cursor = { x: 0.5, y: 0.5 };
let trail = [];
let sensitivity = 1;
let attitude = null;
let neutralAttitude = null;
let lastMotionTime = null;
let angleWindow = [];
let supervisedModel = null;
let trainingPoints = null;
let trainingIndex = 0;
let flipX = false;
let flipY = false;
const radians = Math.PI / 180;
const targetPoints = [
  { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.12 }, { x: 0.88, y: 0.12 },
  { x: 0.88, y: 0.5 }, { x: 0.88, y: 0.88 }, { x: 0.5, y: 0.88 },
  { x: 0.12, y: 0.88 }, { x: 0.12, y: 0.5 }, { x: 0.12, y: 0.12 },
];

function setStatus(message) { $('status').textContent = message; }
function calibrated(sample) {
  return Object.fromEntries(axes.map((axis) => [axis, sample[axis] - (baseline?.[axis] ?? 0)]));
}

$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  setStatus('Choose your connected Vexo band in the USB port picker…');
  try {
    band = await Band.connect(75, { transport: 'serial' });
    if (band.number !== 75) {
      await band.disconnect();
      band = null;
      throw new Error('The connected band is not Vexo band 75.');
    }
    band.on('motion', (sample) => {
      if (calibrationSamples) calibrationSamples.push(sample);
      latestRaw = sample;
      latest = calibrated(sample);
      updateNumbers(latest);
      if (baseline) updateAttitude(sample);
    });
    band.on('disconnect', () => disconnectUi('USB disconnected.'));
    await band.configure({ motion: 50 });
    $('disconnect').disabled = false;
    $('calibrate').disabled = false;
    $('clear').disabled = false;
    $('center').disabled = false;
    $('guided').disabled = !baseline;
    setStatus(`Connected to ${band.name} over USB. Hold still, then calibrate.`);
    requestAnimationFrame(draw);
  } catch (error) {
    $('connect').disabled = false;
    setStatus(error.message || 'Could not connect over USB. Use Chrome or Edge and check the cable.');
  }
});

$('disconnect').addEventListener('click', async () => {
  const current = band;
  band = null;
  if (current) await current.disconnect();
  disconnectUi('Disconnected.');
});

$('calibrate').addEventListener('click', async () => {
  if (!band) return;
  $('calibrate').disabled = true;
  calibrationSamples = [];
  setStatus('Calibrating… keep the band still.');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const samples = calibrationSamples;
  calibrationSamples = null;
  if (!samples.length) {
    setStatus('No motion samples arrived. Reconnect and try again.');
  } else {
    baseline = Object.fromEntries(axes.map((axis) => [axis, samples.reduce((sum, s) => sum + s[axis], 0) / samples.length]));
    $('baseline').textContent = axes.map((axis) => baseline[axis].toFixed(3)).join(', ') + ' g';
    neutralAttitude = anglesFromAccel(baseline);
    attitude = { ...neutralAttitude };
    lastMotionTime = latestRaw?.t ?? null;
    angleWindow = [];
    supervisedModel = null;
    cursor = { x: 0.5, y: 0.5 };
    trail = [];
    if (latestRaw) { latest = calibrated(latestRaw); updateNumbers(latest); }
    $('guided').disabled = false;
    setStatus(`Calibration set from ${samples.length} still samples. Move your hand and watch the zeroed readings.`);
  }
  $('calibrate').disabled = !band;
});

$('clear').addEventListener('click', () => {
  baseline = null;
  supervisedModel = null;
  trainingPoints = null;
  $('baseline').textContent = 'not calibrated';
  $('guided').disabled = true;
  $('guided').hidden = false;
  $('record-point').hidden = true;
  $('cancel-training').hidden = true;
  $('training-status').hidden = true;
  setFlipDisabled(false);
  cursor = { x: 0.5, y: 0.5 };
  trail = [];
  setStatus('Calibration cleared. Raw acceleration includes gravity.');
});

$('sensitivity').addEventListener('input', (event) => {
  sensitivity = Number(event.target.value) / 100;
  $('sensitivity-value').textContent = `${event.target.value}%`;
});

$('flip-x').addEventListener('change', (event) => { flipX = event.target.checked; });
$('flip-y').addEventListener('change', (event) => { flipY = event.target.checked; });

$('center').addEventListener('click', () => {
  if (!attitude) return;
  neutralAttitude = { ...attitude };
  supervisedModel = null;
  $('training-status').hidden = true;
  cursor = { x: 0.5, y: 0.5 };
  trail = [];
});

$('guided').addEventListener('click', () => {
  if (!baseline || !attitude) return;
  trainingPoints = [];
  trainingIndex = 0;
  angleWindow = [];
  supervisedModel = null;
  cursor = { x: 0.5, y: 0.5 };
  trail = [];
  $('guided').hidden = true;
  $('record-point').hidden = false;
  $('record-point').disabled = true;
  $('cancel-training').hidden = false;
  setFlipDisabled(true);
  $('training-status').hidden = false;
  showTrainingStep();
});

$('record-point').addEventListener('click', () => {
  if (!trainingPoints || angleWindow.length < 8) return;
  const target = targetPoints[trainingIndex];
  const feature = angleWindow.reduce((sum, item) => ({ roll: sum.roll + item.roll / angleWindow.length, pitch: sum.pitch + item.pitch / angleWindow.length }), { roll: 0, pitch: 0 });
  // The visible target is mirrored for display; fit the underlying mapping to the
  // inverse-mirrored coordinate so flipping remains correct after training.
  trainingPoints.push({
    ...feature,
    x: flipX ? 1 - target.x : target.x,
    y: flipY ? 1 - target.y : target.y,
  });
  trainingIndex++;
  angleWindow = [];
  if (trainingIndex === targetPoints.length) {
    try {
      supervisedModel = fitAffine(trainingPoints);
      trainingPoints = null;
      $('record-point').hidden = true;
      $('cancel-training').hidden = true;
      $('guided').hidden = false;
      setFlipDisabled(false);
      $('training-status').textContent = 'Calibration learned from 9 points. Move around the pad to try it.';
      cursor = { x: 0.5, y: 0.5 };
      trail = [];
    } catch (error) {
      setTrainingError(error.message);
    }
  } else {
    showTrainingStep();
  }
});

$('cancel-training').addEventListener('click', stopTraining);

function updateNumbers(sample) {
  if (!sample) return;
  for (const axis of axes) $(axis).textContent = sample[axis].toFixed(3);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { width, height } = canvas;
  const left = 30, right = width - 30, top = 30, bottom = height - 30;
  ctx.strokeStyle = '#2c3b35'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const x = left + (right - left) * i / 4;
    const y = top + (bottom - top) * i / 4;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  ctx.strokeStyle = '#697970'; ctx.setLineDash([5, 6]);
  ctx.beginPath(); ctx.moveTo(width / 2, top); ctx.lineTo(width / 2, bottom); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(left, height / 2); ctx.lineTo(right, height / 2); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#90a097'; ctx.font = '12px system-ui';
  ctx.fillText('LEFT', left, height - 8); ctx.fillText('RIGHT', right - 36, height - 8);
  ctx.fillText('UP', 7, top + 4); ctx.fillText('DOWN', 7, bottom);
  if (trainingPoints) {
    const target = targetPoints[trainingIndex];
    const tx = left + target.x * (right - left), ty = top + target.y * (bottom - top);
    ctx.beginPath(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.arc(tx, ty, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.fillStyle = '#edca7c'; ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (trail.length > 1) {
    ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = '#edca7c80';
    trail.forEach((point, index) => {
      const x = left + point.x * (right - left), y = top + point.y * (bottom - top);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  const px = left + cursor.x * (right - left), py = top + cursor.y * (bottom - top);
  ctx.beginPath(); ctx.fillStyle = baseline ? '#edca7c' : '#8d9892'; ctx.arc(px, py, 10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.arc(px, py, 13, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#d3ddd7'; ctx.fillText(baseline ? `x ${(cursor.x * 100).toFixed(0)}% · y ${(cursor.y * 100).toFixed(0)}%` : 'Calibrate to move the cursor', left, 18);
  if (band) requestAnimationFrame(draw);
}

function updateCursor() {
  const roll = wrapAngle(attitude.roll - neutralAttitude.roll);
  const pitch = wrapAngle(attitude.pitch - neutralAttitude.pitch);
  angleWindow.push({ roll, pitch });
  if (angleWindow.length > 20) angleWindow.shift();
  let target;
  if (supervisedModel) {
    const x = supervisedModel.x[0] + supervisedModel.x[1] * roll + supervisedModel.x[2] * pitch;
    const y = supervisedModel.y[0] + supervisedModel.y[1] * roll + supervisedModel.y[2] * pitch;
    target = { x: 0.5 + (x - 0.5) * sensitivity, y: 0.5 + (y - 0.5) * sensitivity };
  } else {
    // A 60-degree tilt spans the full pad at 100%; suppress tiny angle changes.
    const stableRoll = applyDeadZone(roll, 1.2 * radians);
    const stablePitch = applyDeadZone(pitch, 1.2 * radians);
    target = {
      x: 0.5 + stableRoll * sensitivity / (60 * radians),
      y: 0.5 - stablePitch * sensitivity / (60 * radians),
    };
  }
  if (flipX) target.x = 1 - target.x;
  if (flipY) target.y = 1 - target.y;
  target.x = Math.max(0, Math.min(1, target.x));
  target.y = Math.max(0, Math.min(1, target.y));
  cursor = { x: cursor.x + (target.x - cursor.x) * 0.28, y: cursor.y + (target.y - cursor.y) * 0.28 };
  trail.push({ ...cursor });
  if (trail.length > 90) trail.shift();
  if (trainingPoints) {
    const wanted = targetPoints[trainingIndex];
    const onTarget = Math.hypot(cursor.x - wanted.x, cursor.y - wanted.y) < 0.085;
    $('record-point').disabled = !onTarget || angleWindow.length < 8;
  }
}

function updateAttitude(sample) {
  const time = sample.t;
  const elapsed = lastMotionTime == null ? 0.02 : (time - lastMotionTime) / 1000;
  const dt = Math.max(0.001, Math.min(0.1, elapsed > 0 ? elapsed : 0.02));
  lastMotionTime = time;

  // Gyro predicts quick wrist rotation. Gravity provides a slow, drift-correcting reference.
  const predicted = {
    roll: attitude.roll + sample.gx * radians * dt,
    pitch: attitude.pitch + sample.gy * radians * dt,
  };
  const accel = anglesFromAccel(sample);
  const magnitude = Math.hypot(sample.ax, sample.ay, sample.az);
  const gravityConfidence = Math.max(0, Math.min(1, 1 - Math.abs(magnitude - 1) / 0.45));
  const correction = (1 - Math.exp(-dt / 0.8)) * gravityConfidence;
  attitude = {
    roll: predicted.roll + wrapAngle(accel.roll - predicted.roll) * correction,
    pitch: predicted.pitch + wrapAngle(accel.pitch - predicted.pitch) * correction,
  };
  updateCursor();
}

function anglesFromAccel(sample) {
  return {
    roll: Math.atan2(sample.ay, sample.az),
    pitch: Math.atan2(-sample.ax, Math.hypot(sample.ay, sample.az)),
  };
}

function wrapAngle(angle) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }
function applyDeadZone(value, zone) {
  const magnitude = Math.abs(value);
  return magnitude <= zone ? 0 : Math.sign(value) * (magnitude - zone);
}

function showTrainingStep() {
  const n = trainingIndex + 1;
  $('training-status').textContent = `Target ${n} of ${targetPoints.length}: tilt until the cursor is inside the ring, hold steady, then record.`;
  $('record-point').disabled = true;
}

function stopTraining() {
  trainingPoints = null;
  angleWindow = [];
  $('record-point').hidden = true;
  $('cancel-training').hidden = true;
  $('guided').hidden = false;
  setFlipDisabled(false);
  $('training-status').textContent = 'Guided calibration cancelled. The default tilt mapping is active.';
}

function setTrainingError(message) {
  trainingPoints = null;
  $('record-point').hidden = true;
  $('cancel-training').hidden = true;
  $('guided').hidden = false;
  setFlipDisabled(false);
  $('training-status').textContent = `Could not fit the calibration: ${message}`;
}

function setFlipDisabled(disabled) {
  $('flip-x').disabled = disabled;
  $('flip-y').disabled = disabled;
}

function fitAffine(points) {
  // Least-squares fit: screen coordinate = intercept + roll coefficient + pitch coefficient.
  const normal = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rhsX = [0, 0, 0], rhsY = [0, 0, 0];
  for (const point of points) {
    const row = [1, point.roll, point.pitch];
    for (let i = 0; i < 3; i++) {
      rhsX[i] += row[i] * point.x;
      rhsY[i] += row[i] * point.y;
      for (let j = 0; j < 3; j++) normal[i][j] += row[i] * row[j];
    }
  }
  const x = solve3(normal, rhsX), y = solve3(normal, rhsY);
  return { x, y };
}

function solve3(matrix, values) {
  const a = matrix.map((row, i) => [...row, values[i]]);
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-8) throw new Error('The points did not include enough wrist movement in both directions.');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j < 4; j++) a[col][j] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j < 4; j++) a[row][j] -= factor * a[col][j];
    }
  }
  return [a[0][3], a[1][3], a[2][3]];
}

function disconnectUi(message) {
  band = null;
  trainingPoints = null;
  $('connect').disabled = false;
  $('disconnect').disabled = true;
  $('calibrate').disabled = true;
  $('clear').disabled = true;
  $('center').disabled = true;
  $('guided').disabled = true;
  $('guided').hidden = false;
  $('record-point').hidden = true;
  $('cancel-training').hidden = true;
  setStatus(message);
}
