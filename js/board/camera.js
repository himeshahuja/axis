// The webcam watching the board, shared by board.html and bench.html.
//
// It finds the band by finding the wrist that wears it. A pose model (Google's
// MediaPipe Pose Landmarker, downloaded by tools/get-vision.mjs) finds every person
// in the picture and both of their wrists; wrists.js then picks the one whose
// movement agrees with the band's own motion sensors. It shows the camera's picture
// with the board's outline, the forearms, and the band's wrist ringed, and walks
// through setting it up as five steps that tick themselves off: camera on, the
// board's size, its four corners clicked in the picture, someone seen with the band's
// wrist found, and (once) the marker's tip. Each fix of the band's wrist goes to `onFix`: where it is in board
// metres, and when the picture was taken (ms since 1970, the clock the band's samples
// also carry).

import { apply, homography } from './homography.js';
import { LANDMARK, WristTrack } from './wrists.js';

const SAVED = 'air-draw.board.camera';     // corners, board size, tip offset and hand, kept in the browser
const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'];
const ARMS = [[11, 13], [13, 15], [12, 14], [14, 16]];   // shoulder to elbow to wrist, left and right
const VENDOR = new URL('../../vendor/mediapipe/', import.meta.url);
const STEPS = ['camera', 'size', 'corners', 'seen', 'tip'];   // the corners while the board is clear, then step in

export class CameraPanel {
  /**
   * `el`: { canvas, status, steps, start, corners, tip, hand, width, height } elements.
   * `onFix(fix)`: fix = { time, u, v, x, y, visibility, side } with x, y in board metres
   * from the board's bottom left corner.
   * `band()`: the band's velocity now, [speed along the ground, speed up] in m/s, or null.
   */
  constructor(el, { onFix = () => {}, onChange = () => {}, band = () => null } = {}) {
    this.el = el;
    this.onFix = onFix;
    this.onChange = onChange;
    this.band = band;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.stream = null;
    this.model = null;
    this.loading = false;
    this.problem = null;                                    // why the camera or the model could not start
    this.corners = null;                                    // [[u, v] x 4] in camera pixels
    this.tip = [0, 0];                                      // metres from the wrist to the marker's tip
    this.clicking = null;                                   // { kind: 'corners' | 'tip', points }
    this.people = [];                                       // the last frame's poses, camera pixels
    this.wrist = null;                                      // the band's wrist in the last frame, camera pixels
    this.track = new WristTrack({ hand: el.hand.value });
    this.toBoard = null;
    this.lastTime = -1;
    this.stats = { recent: [], delay: null };
    this.shownSteps = '';
    this.restore();
    for (const input of [el.width, el.height]) input.addEventListener('input', () => this.changed());
    el.hand.addEventListener('change', () => {
      this.track = new WristTrack({ hand: el.hand.value });
      this.changed();
    });
    el.start.onclick = () => (this.stream ? this.stop() : this.start());
    el.corners.onclick = () => (this.clicking?.kind === 'corners' ? this.cancel() : this.ask('corners'));
    el.tip.onclick = () => (this.clicking?.kind === 'tip' ? this.cancel() : this.ask('tip'));
    el.canvas.addEventListener('click', (e) => this.clicked(e));
    addEventListener('keydown', (e) => {
      if (!this.clicking) return;
      if (e.key === 'Escape') this.cancel();
      if (e.key === 'Backspace' && this.clicking.points.length) {
        e.preventDefault();
        this.clicking.points.pop();
        this.redraw();
      }
    });
    addEventListener('resize', () => this.redraw());
    this.redraw();
  }

  get running() { return Boolean(this.stream); }
  /** The board's size in metres, from the two boxes (cm), or null. */
  get size() {
    const w = parseFloat(this.el.width.value) / 100, h = parseFloat(this.el.height.value) / 100;
    return w > 0.2 && h > 0.1 ? { width: w, height: h } : null;
  }
  get ready() { return Boolean(this.running && this.model && this.toBoard); }
  get tipSet() { return this.tip[0] !== 0 || this.tip[1] !== 0; }

  async start() {
    this.problem = null;
    if (!this.model) {
      this.loading = true;
      this.redraw();
      try {
        this.model = await loadModel();
      } catch (e) {
        this.problem = `The pose model did not load (${e.message}). In the repository's folder run: node tools/get-vision.mjs, then reload.`;
        return;
      } finally {
        this.loading = false;
        this.redraw();
      }
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      this.problem = e.name === 'NotAllowedError'
        ? 'The browser was not allowed to use the camera. Allow it (the camera icon in the address bar) and press Start camera again.'
        : `No camera: ${e.message}`;
      this.redraw();
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    this.el.start.textContent = 'Stop camera';
    this.next();
    this.changed();
  }

  stop() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.people = [];
    this.wrist = null;
    this.stats.recent = [];
    this.cancel();
    this.el.start.textContent = 'Start camera';
    this.changed();
  }

  next() {
    if (!this.stream) return;
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback((now, meta) => this.frame(now, meta));
    else requestAnimationFrame((now) => this.frame(now, {}));
  }

  frame(now, meta) {
    if (!this.stream) return;
    const v = this.video, W = v.videoWidth, H = v.videoHeight;
    if (!W || now <= this.lastTime) return this.next();
    this.lastTime = now;
    const result = this.model.detectForVideo(v, now);
    const taken = meta.captureTime ?? now - 1000 / 30;      // without the camera's own time, about a frame back
    this.people = (result.landmarks ?? []).map((pose) => pose.map((p) => ({ u: p.x * W, v: p.y * H, visibility: p.visibility ?? 1 })));
    const wrists = [];
    for (const pose of this.people) {
      for (const [side, i] of Object.entries(LANDMARK)) {
        const p = pose[i], at = this.toBoard ? apply(this.toBoard, [p.u, p.v]) : [p.u / 1000, p.v / 1000];
        wrists.push({ side, x: at[0], y: this.toBoard ? at[1] : -at[1], visibility: p.visibility, u: p.u, v: p.v });
      }
    }
    // Which wrist wears the band: matched by movement, in board metres once the corners are known.
    const chosen = this.track.frame(performance.timeOrigin + taken, wrists, this.toBoard ? this.band() : null);
    const pick = chosen && wrists.find((w) => w.side === chosen.side && w.x === chosen.x && w.y === chosen.y);
    this.wrist = pick ? { u: pick.u, v: pick.v, side: pick.side } : null;
    this.stats.delay = performance.now() - taken;
    this.stats.recent.push([now, Boolean(pick), this.people.length]);
    while (this.stats.recent.length && now - this.stats.recent[0][0] > 2000) this.stats.recent.shift();
    if (pick && this.toBoard) {
      this.onFix({ time: performance.timeOrigin + taken, u: pick.u, v: pick.v, x: pick.x, y: pick.y, visibility: pick.visibility, side: pick.side });
    }
    this.redraw();
    this.next();
  }

  /** The band's wrist seen in what share of the last two seconds' frames; frames a second; people in view. */
  get health() {
    const r = this.stats.recent;
    return { seen: r.length ? r.filter(([, f]) => f).length / r.length : 0, fps: r.length / 2, delay: this.stats.delay, people: r.length ? r[r.length - 1][2] : 0, sure: this.track.sureness };
  }

  // ------------------------------------------------------------------ what the person sees

  redraw() {
    this.draw();
    this.showSteps();
  }

  draw() {
    const c = this.el.canvas, v = this.video, live = this.running && v.videoWidth;
    const width = c.clientWidth || 320, height = Math.round(live ? (width * v.videoHeight) / v.videoWidth : (width * 9) / 16);
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) {
      c.width = Math.round(width * dpr);
      c.height = Math.round(height * dpr);
      c.style.height = `${height}px`;
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!live) {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#c9d1dc';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.loading ? 'Loading the pose model…' : 'Camera off', width / 2, height / 2 - 4);
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillStyle = '#8b95a5';
      if (!this.loading) ctx.fillText('Press Start camera below', width / 2, height / 2 + 18);
      ctx.textAlign = 'start';
      return;
    }
    const k = width / v.videoWidth;
    ctx.drawImage(v, 0, 0, width, height);

    // The board: its outline, and the corners clicked so far, numbered.
    const points = this.clicking?.kind === 'corners' ? this.clicking.points : this.corners;
    if (points?.length) {
      ctx.strokeStyle = '#f5a524';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach(([u, vv], i) => (i ? ctx.lineTo(u * k, vv * k) : ctx.moveTo(u * k, vv * k)));
      if (points.length === 4) ctx.closePath();
      ctx.stroke();
      if (this.clicking?.kind === 'corners') {
        points.forEach(([u, vv], i) => dot(ctx, u * k, vv * k, '#f5a524', String(i + 1)));
      }
    }

    // Arms, and the band's wrist ringed and named.
    ctx.strokeStyle = 'rgba(124, 196, 255, 0.9)';
    ctx.lineWidth = 2;
    for (const pose of this.people) {
      for (const [a, b] of ARMS) {
        if (pose[a].visibility < 0.5 || pose[b].visibility < 0.5) continue;
        ctx.beginPath();
        ctx.moveTo(pose[a].u * k, pose[a].v * k);
        ctx.lineTo(pose[b].u * k, pose[b].v * k);
        ctx.stroke();
      }
    }
    if (this.wrist) {
      const x = this.wrist.u * k, y = this.wrist.v * k;
      ctx.strokeStyle = '#ff2fd0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, 2 * Math.PI);
      ctx.stroke();
      label(ctx, x + 16, y - 10, 'band', '#ff2fd0');
    }

    // What to do now, on the picture itself.
    const say = this.banner();
    if (say) banner(ctx, width, say.text, say.colour);
  }

  /** The line across the top of the picture: what to do, or what is wrong. */
  banner() {
    if (this.clicking?.kind === 'corners') {
      const n = this.clicking.points.length;
      return { text: `Click the board's ${CORNERS[n].toUpperCase()} corner (${n + 1} of 4) · Backspace: undo · Esc: cancel`, colour: '#f5a524' };
    }
    if (this.clicking?.kind === 'tip') {
      return { text: 'Hold the marker on the board, still, and click its TIP · Esc: cancel', colour: '#f5a524' };
    }
    const h = this.health;
    if (this.corners && this.stats.recent.length > 15 && !h.people) return { text: 'No one in view: step in, arm and shoulder showing', colour: '#ff6b6b' };
    if (h.people && !this.wrist) return { text: 'Band\'s wrist not found: move your band hand a little', colour: '#ffb84d' };
    return null;
  }

  /** Each step marked done, now (the first not done), or later, with a line saying how it stands. */
  showSteps() {
    const s = this.size, h = this.health, live = this.running && this.model;
    const done = {
      camera: Boolean(live),
      seen: Boolean(live && h.people && this.wrist),
      size: Boolean(s),
      corners: Boolean(this.corners),
      tip: this.tipSet,
    };
    const hand = this.el.hand.value;
    const detail = {
      camera: this.problem ?? (this.loading ? 'Loading the pose model…'
        : live ? `On: ${h.fps.toFixed(0)} frames a second.`
        : 'Point the laptop\'s camera, or a USB webcam, at the board from one side, so your body does not hide your writing hand.'),
      seen: !live ? 'Stand where you will write. Blue lines appear along your arms; a pink ring marks the wrist wearing the band.'
        : !h.people ? 'No one in view yet. Step into the picture, with your shoulder, elbow and wrist showing.'
        : !this.wrist ? 'Seen, but not the band\'s wrist yet: move your band hand a little.'
        : `Found: your ${this.wrist.side} wrist, in ${Math.round(h.seen * 100)}% of frames${h.people > 1 ? `, ${h.people} people in view` : ''}. Wrong hand? Change the setting.`,
      size: s ? `${fmt(s.width * 100)} × ${fmt(s.height * 100)} cm.` : 'Measure the writing area with a tape and type it here.',
      corners: this.clicking?.kind === 'corners' ? `Click the ${CORNERS[this.clicking.points.length]} corner in the picture.`
        : this.corners ? 'Done. The board\'s outline is drawn in orange: redo it if the camera moved.'
        : 'With nothing in front of the board, click its four corners in the picture: top left first, then clockwise. The picture opens large for it.',
      tip: this.tipSet ? `Done: the tip is ${fmt(Math.hypot(...this.tip) * 100)} cm from your wrist.`
        : 'Hold the marker on the board, press the button and click the tip, so the cursor follows the tip and not your wrist.',
    };
    const now = this.clicking?.kind ?? STEPS.find((k) => !done[k]) ?? null;   // while clicking, that step
    const key = JSON.stringify([done, now, detail, this.clicking?.kind ?? null]);
    if (key !== this.shownSteps) {
      this.shownSteps = key;
      for (const li of this.el.steps?.querySelectorAll('li[data-step]') ?? []) {
        const k = li.dataset.step;
        li.className = k === now ? 'now' : done[k] ? 'done' : 'later';
        const d = li.querySelector('.detail');
        if (d) d.textContent = detail[k];
      }
      this.el.corners.textContent = this.clicking?.kind === 'corners' ? 'Cancel' : this.corners ? 'Redo corners' : 'Mark corners';
      this.el.tip.textContent = this.clicking?.kind === 'tip' ? 'Cancel' : this.tipSet ? 'Redo tip' : 'Mark tip';
      this.el.corners.disabled = !this.running;
      this.el.tip.disabled = !this.running || !this.toBoard;
      this.el.canvas.closest('.card')?.classList.toggle('cam-focus', Boolean(this.clicking));
    }

    // The line under the steps: all set, or what is next.
    const ready = done.camera && done.size && done.corners;
    const text = this.problem ? this.problem
      : ready ? (this.wrist ? `Following your band's wrist: seen in ${Math.round(h.seen * 100)}% of frames, ${Math.round(h.delay ?? 0)} ms behind.${this.tipSet ? '' : ' Marking the tip makes it more exact.'}`
        : 'Set up. Waiting to see the band\'s wrist: the band\'s own motion carries the cursor meanwhile.')
      : now ? `Next, step ${STEPS.indexOf(now) + 1}: ${detail[now]}` : '';
    this.show(text, this.problem ? 'warn' : ready && this.wrist ? 'good' : ready ? 'warn' : '');
  }

  ask(kind) {
    if (!this.stream) return;
    if (kind === 'tip' && (!this.wrist || !this.toBoard)) {
      this.problem = null;
      this.show('To mark the tip the camera must see the band\'s wrist, with the size and corners set.', 'warn');
      return;
    }
    this.clicking = { kind, points: [] };
    this.redraw();
    requestAnimationFrame(() => this.el.canvas.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }

  cancel() {
    if (!this.clicking) return;
    this.clicking = null;
    this.redraw();
  }

  clicked(e) {
    if (!this.clicking || !this.video.videoWidth) return;
    const r = this.el.canvas.getBoundingClientRect(), k = this.video.videoWidth / r.width;
    const point = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    if (this.clicking.kind === 'tip') {
      if (!this.wrist) return this.show('The band\'s wrist went out of view: hold still with the marker on the board and click again.', 'warn');
      const at = apply(this.toBoard, point), wrist = apply(this.toBoard, [this.wrist.u, this.wrist.v]);
      this.tip = [at[0] - wrist[0], at[1] - wrist[1]];
      this.clicking = null;
      this.changed();
      return;
    }
    this.clicking.points.push(point);
    if (this.clicking.points.length === 4) {
      this.corners = this.clicking.points;
      this.clicking = null;
      this.changed();
    } else {
      this.redraw();
    }
  }

  changed() {
    const s = this.size;
    this.toBoard = this.corners && s ? homography(this.corners, [[0, s.height], [s.width, s.height], [s.width, 0], [0, 0]]) : null;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ corners: this.corners, tip: this.tip, hand: this.el.hand.value, width: this.el.width.value, height: this.el.height.value }));
    } catch { /* not kept: fine */ }
    this.redraw();
    this.onChange();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
      const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
      if (saved?.corners?.length === 4 && saved.corners.every(point)) this.corners = saved.corners;
      if (point(saved?.tip)) this.tip = saved.tip;
      if (saved?.hand === 'left' || saved?.hand === 'right') this.el.hand.value = saved.hand;
      if (saved?.width) this.el.width.value = String(parseFloat(saved.width) || '');
      if (saved?.height) this.el.height.value = String(parseFloat(saved.height) || '');
    } catch { /* nothing kept */ }
    const s = this.size;
    this.toBoard = this.corners && s ? homography(this.corners, [[0, s.height], [s.width, s.height], [s.width, 0], [0, 0]]) : null;
  }

  show(text, tone = '') {
    const el = this.el.status;
    if (el.textContent !== text) el.textContent = text;
    const cls = `cam-status${tone ? ` ${tone}` : ''}`;
    if (el.className !== cls) el.className = cls;
  }
}

const fmt = (x) => String(Math.round(x * 10) / 10);

function dot(ctx, x, y, colour, text) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = '700 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y + 4);
  ctx.textAlign = 'start';
}

function label(ctx, x, y, text, colour) {
  ctx.font = '700 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(x - 3, y - 12, w + 6, 16);
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
}

function banner(ctx, width, text, colour) {
  ctx.font = '600 13px system-ui, sans-serif';
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
    if (lines.length && ctx.measureText(last).width <= width - 16) lines[lines.length - 1] = last;
    else lines.push(word);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, 0, width, lines.length * 17 + 11);
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  lines.forEach((line, i) => ctx.fillText(line, width / 2, 19 + i * 17));
  ctx.textAlign = 'start';
}

/** MediaPipe's pose model, from vendor/ (tools/get-vision.mjs), on the graphics card if it can be. */
async function loadModel() {
  const { FilesetResolver, PoseLandmarker } = await import(new URL('vision_bundle.mjs', VENDOR).href);
  const files = await FilesetResolver.forVisionTasks(new URL('wasm', VENDOR).href);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: new URL('pose_landmarker_full.task', VENDOR).href, delegate },
    runningMode: 'VIDEO',
    numPoses: 3,
  });
  try {
    return await PoseLandmarker.createFromOptions(files, options('GPU'));
  } catch {
    return PoseLandmarker.createFromOptions(files, options('CPU'));
  }
}
