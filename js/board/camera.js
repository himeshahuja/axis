// The webcam watching the board, shared by board.html and bench.html.
//
// It finds the band by finding the wrist that wears it. A pose model (Google's
// MediaPipe Pose Landmarker, downloaded by tools/get-vision.mjs) finds every person
// in the picture and both of their wrists; wrists.js then picks the one whose
// movement agrees with the band's own motion sensors. It shows the camera's picture
// with the board's outline, the forearms, and the band's wrist ringed; lets you
// click the board's four corners (and, once, the marker's tip while you hold it on
// the board); and hands each fix of the band's wrist to `onFix`: where it is in
// board metres, and when the picture was taken (ms since 1970, the clock the band's
// samples also carry).

import { apply, homography } from './homography.js';
import { LANDMARK, WristTrack } from './wrists.js';

const SAVED = 'air-draw.board.camera';     // corners, board size, tip offset and hand, kept in the browser
const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'];
const ARMS = [[11, 13], [13, 15], [12, 14], [14, 16]];   // shoulder to elbow to wrist, left and right
const VENDOR = new URL('../../vendor/mediapipe/', import.meta.url);

export class CameraPanel {
  /**
   * `el`: { canvas, status, start, corners, tip, hand, width, height } elements.
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
    this.corners = null;                                    // [[u, v] x 4] in camera pixels
    this.tip = [0, 0];                                      // metres from the wrist to the marker's tip
    this.clicking = null;                                   // { kind: 'corners' | 'tip', points }
    this.people = [];                                       // the last frame's poses, camera pixels
    this.wrist = null;                                      // the band's wrist in the last frame, camera pixels
    this.track = new WristTrack({ hand: el.hand.value });
    this.toBoard = null;
    this.lastTime = -1;
    this.stats = { recent: [], delay: null };
    this.restore();
    for (const input of [el.width, el.height]) input.addEventListener('change', () => this.changed());
    el.hand.addEventListener('change', () => {
      this.track = new WristTrack({ hand: el.hand.value });
      this.changed();
    });
    el.start.onclick = () => (this.stream ? this.stop() : this.start());
    el.corners.onclick = () => this.ask('corners');
    el.tip.onclick = () => this.ask('tip');
    el.canvas.addEventListener('click', (e) => this.clicked(e));
    this.show('Camera off.');
  }

  get running() { return Boolean(this.stream); }
  /** The board's size in metres, from the two boxes (cm), or null. */
  get size() {
    const w = parseFloat(this.el.width.value) / 100, h = parseFloat(this.el.height.value) / 100;
    return w > 0.2 && h > 0.1 ? { width: w, height: h } : null;
  }
  get ready() { return Boolean(this.running && this.model && this.toBoard); }

  async start() {
    if (!this.model) {
      this.show('Loading the pose model...');
      try {
        this.model = await loadModel();
      } catch (e) {
        this.show(`The pose model could not load (${e.message}). In this repository's folder run: node tools/get-vision.mjs`);
        return;
      }
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      this.show(`No camera: ${e.message}`);
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
    this.el.start.textContent = 'Start camera';
    this.show('Camera off.');
    this.changed();
  }

  next() {
    if (!this.stream) return;
    if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback((now, meta) => this.frame(now, meta));
    else requestAnimationFrame((now) => this.frame(now, {}));
  }

  frame(now, meta) {
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
    this.wrist = pick ? { u: pick.u, v: pick.v } : null;
    this.stats.delay = performance.now() - taken;
    this.stats.recent.push([now, Boolean(pick), this.people.length]);
    while (this.stats.recent.length && now - this.stats.recent[0][0] > 2000) this.stats.recent.shift();
    if (pick && this.toBoard) {
      this.onFix({ time: performance.timeOrigin + taken, u: pick.u, v: pick.v, x: pick.x, y: pick.y, visibility: pick.visibility, side: pick.side });
    }
    this.draw();
    this.next();
  }

  /** The band's wrist seen in what share of the last two seconds' frames; frames a second; people in view. */
  get health() {
    const r = this.stats.recent;
    return { seen: r.length ? r.filter(([, f]) => f).length / r.length : 0, fps: r.length / 2, delay: this.stats.delay, people: r.length ? r[r.length - 1][2] : 0, sure: this.track.sureness };
  }

  draw() {
    const c = this.el.canvas, v = this.video, width = c.clientWidth || 320, height = Math.round((width * v.videoHeight) / v.videoWidth) || 180;
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); c.style.height = `${height}px`; }
    const ctx = c.getContext('2d'), k = width / v.videoWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(v, 0, 0, width, height);
    const points = this.clicking?.kind === 'corners' ? this.clicking.points : this.corners;
    if (points?.length) {
      ctx.strokeStyle = '#f5a524';
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach(([u, vv], i) => (i ? ctx.lineTo(u * k, vv * k) : ctx.moveTo(u * k, vv * k)));
      if (points.length === 4) ctx.closePath();
      ctx.stroke();
    }
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
      ctx.strokeStyle = '#ff2fd0';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.wrist.u * k, this.wrist.v * k, 11, 0, 2 * Math.PI);
      ctx.stroke();
    }
    const h = this.health, s = this.size;
    this.show(this.clicking
      ? (this.clicking.kind === 'corners' ? `Click the board's ${CORNERS[this.clicking.points.length]} corner.` : 'Hold the marker\'s tip on the board, still, and click the tip in the picture.')
      : `${!s ? 'Type the board\'s width and height. ' : ''}${!this.corners ? 'Set the corners. ' : ''}${h.people ? `${h.people} ${h.people === 1 ? 'person' : 'people'} in view; the band's wrist seen in ${Math.round(h.seen * 100)}% of frames` : 'No one in view'}, ${h.fps.toFixed(0)} frames a second, ${Math.round(h.delay ?? 0)} ms behind.`);
  }

  ask(kind) {
    if (!this.stream) return this.show('Start the camera first.');
    if (kind === 'tip' && (!this.wrist || !this.toBoard)) return this.show('The band\'s wrist must be seen, with the corners and size set, to measure the tip.');
    this.clicking = { kind, points: [] };
  }

  clicked(e) {
    if (!this.clicking || !this.video.videoWidth) return;
    const r = this.el.canvas.getBoundingClientRect(), k = this.video.videoWidth / r.width;
    const point = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    if (this.clicking.kind === 'tip') {
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
    }
  }

  changed() {
    const s = this.size;
    this.toBoard = this.corners && s ? homography(this.corners, [[0, s.height], [s.width, s.height], [s.width, 0], [0, 0]]) : null;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ corners: this.corners, tip: this.tip, hand: this.el.hand.value, width: this.el.width.value, height: this.el.height.value }));
    } catch { /* not kept: fine */ }
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

  show(text) {
    if (this.el.status.textContent !== text) this.el.status.textContent = text;
  }
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
