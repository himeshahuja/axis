// The webcam watching the board, shared by board.html and bench.html.
//
// It follows the band: by its green light, or (once taught, by clicking on the band
// in the picture) by the band's own colour. It shows the camera's picture with the
// board's outline and the band marked, lets you click the board's four corners (and, once, where the marker's
// tip is while you hold it on the board), and for every frame finds the light
// (light.js) and hands a fix to `onFix`: where it is in board metres, and when the
// picture was taken (ms since 1970, the clock the band's samples also carry).

import { apply, homography } from './homography.js';
import { findColour, findLight, sample, vivid, VIVID_ENOUGH } from './light.js';

const SAVED = 'air-draw.board.camera';     // corners, board size and tip offset, kept in the browser
const CORNERS = ['top left', 'top right', 'bottom right', 'bottom left'];

export class CameraPanel {
  /**
   * `el`: { canvas, status, start, corners, tip, colour, width, height } elements.
   * `onFix(fix)`: fix = { time, u, v, x, y, size, confidence } with x, y in board metres
   * from the board's bottom left corner (null until corners and size are set).
   */
  constructor(el, { onFix = () => {}, onChange = () => {} } = {}) {
    this.el = el;
    this.onFix = onFix;
    this.onChange = onChange;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.work = document.createElement('canvas');          // half size, for finding the light
    this.stream = null;
    this.corners = null;                                    // [[u, v] x 4] in camera pixels
    this.tip = [0, 0];                                      // metres from the light to the marker's tip
    this.clicking = null;                                   // { kind: 'corners' | 'tip', points }
    this.light = null;                                      // where the band was last found, camera pixels
    this.colour = null;                                     // the band's colour [r, g, b], once taught; else its light
    this.image = null;                                      // the last frame, half size, for teaching the colour
    this.toBoard = null;
    this.stats = { frames: 0, found: 0, recent: [], delay: null };
    this.restore();
    for (const input of [el.width, el.height]) input.addEventListener('change', () => this.changed());
    el.start.onclick = () => (this.stream ? this.stop() : this.start());
    el.corners.onclick = () => this.ask('corners');
    el.tip.onclick = () => this.ask('tip');
    el.colour.onclick = () => (this.colour ? this.forget() : this.ask('colour'));
    el.canvas.addEventListener('click', (e) => this.clicked(e));
    this.show('Camera off.');
  }

  get running() { return Boolean(this.stream); }
  /** The board's size in metres, from the two boxes (cm), or null. */
  get size() {
    const w = parseFloat(this.el.width.value) / 100, h = parseFloat(this.el.height.value) / 100;
    return w > 0.2 && h > 0.1 ? { width: w, height: h } : null;
  }
  get ready() { return Boolean(this.running && this.toBoard); }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false });
    } catch (e) {
      this.show(`No camera: ${e.message}`);
      return;
    }
    this.video.srcObject = this.stream;
    await this.video.play();
    // A bright light washes out to white in a normal exposure: ask for less, if the camera allows it.
    const track = this.stream.getVideoTracks()[0], caps = track.getCapabilities?.() ?? {};
    if (caps.exposureMode?.includes('manual') && caps.exposureTime) {
      track.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: Math.max(caps.exposureTime.min, caps.exposureTime.max / 8) }] }).catch(() => {});
    }
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
    if (!W) return this.next();
    const w = W >> 1, h = H >> 1, work = this.work;
    if (work.width !== w) { work.width = w; work.height = h; }
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);
    const image = ctx.getImageData(0, 0, w, h);
    this.image = image;
    const near = this.light ? [this.light.u / 2, this.light.v / 2] : null;
    const find = (options) => (this.colour ? findColour(image, this.colour, options) : findLight(image, options));
    let found = near ? find({ near, within: 40 }) : null;
    if (!found) found = find({ near });
    const taken = meta.captureTime ?? now - 2000 / 30;     // without the camera's own time, about two frames back
    this.stats.frames++;
    this.stats.delay = performance.now() - taken;
    this.stats.recent.push([now, Boolean(found)]);
    while (this.stats.recent.length && now - this.stats.recent[0][0] > 2000) this.stats.recent.shift();
    if (found) {
      this.stats.found++;
      this.light = { u: found.u * 2, v: found.v * 2 };
      const fix = { time: performance.timeOrigin + taken, u: this.light.u, v: this.light.v, size: found.size, confidence: found.confidence, x: null, y: null };
      if (this.toBoard) [fix.x, fix.y] = apply(this.toBoard, [fix.u, fix.v]);
      this.onFix(fix);
    } else {
      this.light = null;
    }
    this.draw();
    this.next();
  }

  /** Light found in what share of the last two seconds' frames, and frames a second. */
  get health() {
    const r = this.stats.recent;
    return { seen: r.length ? r.filter(([, f]) => f).length / r.length : 0, fps: r.length / 2, delay: this.stats.delay };
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
    if (this.light) {
      ctx.strokeStyle = '#ff2fd0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.light.u * k, this.light.v * k, 9, 0, 2 * Math.PI);
      ctx.stroke();
    }
    const hp = this.health, s = this.size, what = this.colour ? 'Band' : 'Light';
    this.show(this.clicking
      ? { corners: `Click the board's ${CORNERS[this.clicking.points.length]} corner.`, tip: 'Hold the marker\'s tip on the board, still, and click the tip in the picture.', colour: 'Click on the band in the picture (hold it still, in good light).' }[this.clicking.kind]
      : `${!s ? 'Type the board\'s width and height. ' : ''}${!this.corners ? 'Set the corners. ' : ''}${what} seen in ${Math.round(hp.seen * 100)}% of frames, ${hp.fps.toFixed(0)} a second, ${Math.round(hp.delay ?? 0)} ms behind.${this.warning ? ` ${this.warning}` : ''}`);
  }

  ask(kind) {
    if (!this.stream) return this.show('Start the camera first.');
    if (kind === 'tip' && (!this.light || !this.toBoard)) return this.show('The band must be seen, with the corners and size set, to measure the tip.');
    this.clicking = { kind, points: [] };
  }

  clicked(e) {
    if (!this.clicking || !this.video.videoWidth) return;
    const r = this.el.canvas.getBoundingClientRect(), k = this.video.videoWidth / r.width;
    const point = [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
    if (this.clicking.kind === 'colour') {
      if (!this.image) return;
      const rgb = sample(this.image, point[0] / 2, point[1] / 2, 3);
      this.clicking = null;
      this.colour = rgb;
      this.light = { u: point[0], v: point[1] };
      this.warning = vivid(rgb) < VIVID_ENOUGH
        ? 'That colour is close to grey, so ink, hair and shadows look like it: a strip of bright tape on the band works better.'
        : '';
      this.el.colour.textContent = 'Use light';
      this.changed();
      return;
    }
    if (this.clicking.kind === 'tip') {
      const at = apply(this.toBoard, point), light = apply(this.toBoard, [this.light.u, this.light.v]);
      this.tip = [at[0] - light[0], at[1] - light[1]];
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

  /** Back to following the band's light. */
  forget() {
    this.colour = null;
    this.warning = '';
    this.el.colour.textContent = 'Band colour';
    this.changed();
  }

  changed() {
    const s = this.size;
    this.toBoard = this.corners && s ? homography(this.corners, [[0, s.height], [s.width, s.height], [s.width, 0], [0, 0]]) : null;
    try {
      localStorage.setItem(SAVED, JSON.stringify({ corners: this.corners, tip: this.tip, colour: this.colour, width: this.el.width.value, height: this.el.height.value }));
    } catch { /* not kept: fine */ }
    this.onChange();
  }

  restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
      const point = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
      if (saved?.corners?.length === 4 && saved.corners.every(point)) this.corners = saved.corners;
      if (point(saved?.tip)) this.tip = saved.tip;
      if (Array.isArray(saved?.colour) && saved.colour.length === 3 && saved.colour.every(Number.isFinite)) {
        this.colour = saved.colour;
        this.el.colour.textContent = 'Use light';
      }
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
