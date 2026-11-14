// A session from the band kept in a file, the same way for the bench, the board
// page and tests/board.mjs:
//
//   samples  [t, n, ax, ay, az, gx, gy, gz, arrived]: the band's time (ms), its sample
//            number, acceleration (g), turning (degrees/second), and when the sample
//            arrived on the computer (ms, the page's clock)
//   events   { t, kind, ... }: taps, notices, steps of a guided capture, what was pressed
//   fixes    [t, u, v, size, confidence]: where the camera saw the band's light (pixels) in a
//            picture taken at the band's time t; with `camera` in the header: the board's
//            corners in the picture, its width and height (m) and the marker tip's offset
//
// Version 1 (board.html before the bench) kept samples as [t, ax, ay, az, gx, gy, gz].

export const KIND = 'air-draw band recording';

export class Recorder {
  /** `about`: what to keep with it (rate, band, settings, ...). */
  constructor(about = {}) {
    this.about = about;
    this.samples = [];
    this.events = [];
    this.fixes = [];
    this.started = new Date();
  }

  fix(f) {
    this.fixes.push([f.t, f.u, f.v, f.size ?? null, f.confidence ?? null]);
  }

  motion(m, arrived = null) {
    this.samples.push([m.t, m.n ?? null, m.ax, m.ay, m.az, m.gx, m.gy, m.gz, arrived]);
  }

  event(t, kind, extra = {}) {
    this.events.push({ t, kind, ...extra });
  }

  get seconds() {
    const s = this.samples;
    return s.length > 1 ? (s[s.length - 1][0] - s[0][0]) / 1000 : 0;
  }

  get name() {
    return `band-${this.about.band ?? 'session'}-${this.started.toISOString().replace(/[:.]/g, '-')}.json`.replace(/[^\w.-]/g, '-');
  }

  toJSON() {
    return { kind: KIND, version: 3, recorded: this.started.toISOString(), ...this.about, samples: this.samples, events: this.events, fixes: this.fixes };
  }
}

/**
 * A recording read back, version 1, 2 or 3: { rate, band, ..., samples: [{ t, n, ax..gz, arrived }],
 * events (by time), fixes: [{ t, u, v, size, confidence }], camera (or null) }. A file is whatever someone saved, so anything that is not a recording
 * throws an Error that says so.
 */
export function readRecording(data) {
  const rec = typeof data === 'string' ? JSON.parse(data) : data;
  if (!rec || !Array.isArray(rec.samples) || !(rec.kind === KIND || rec.kind === 'air-draw board session')) {
    throw new Error('That is not a recording from the bench or the board page.');
  }
  const v1 = rec.kind === 'air-draw board session';
  const samples = [];
  for (const r of rec.samples) {
    if (!Array.isArray(r)) continue;
    const s = v1
      ? { t: r[0], n: null, ax: r[1], ay: r[2], az: r[3], gx: r[4], gy: r[5], gz: r[6], arrived: null }
      : { t: r[0], n: r[1], ax: r[2], ay: r[3], az: r[4], gx: r[5], gy: r[6], gz: r[7], arrived: r[8] };
    if ([s.t, s.ax, s.ay, s.az, s.gx, s.gy, s.gz].every(Number.isFinite)) samples.push(s);
  }
  if (!samples.length) throw new Error('That recording has no samples in it.');
  const events = (Array.isArray(rec.events) ? rec.events : []).filter((e) => e && Number.isFinite(e.t) && typeof e.kind === 'string');
  const fixes = (Array.isArray(rec.fixes) ? rec.fixes : [])
    .filter((f) => Array.isArray(f) && [f[0], f[1], f[2]].every(Number.isFinite))
    .map(([t, u, v, size, confidence]) => ({ t, u, v, size, confidence }));
  const cam = rec.camera;
  const camera = cam && Array.isArray(cam.corners) && cam.corners.length === 4 && cam.width > 0 && cam.height > 0 ? cam : null;
  return { ...rec, rate: Number(rec.rate) || 208, version: v1 ? 1 : rec.version === 3 ? 3 : 2, samples, events: events.sort((a, b) => a.t - b.t), fixes, camera };
}

/** A pretend session (js/board/simulate.js) as a recording, with its truth, so it plays back like a real one. */
export function fromSession(s) {
  const rec = new Recorder({ rate: s.rate, band: 'simulated', session: s.name, board: s.board, words: s.words });
  for (const m of s.samples) rec.motion(m, null);
  for (const t of s.taps) rec.event(t, 'tap');
  if (s.camera) {
    rec.about.camera = { corners: s.camera.corners, width: s.camera.board.width, height: s.camera.board.height, tip: [0, 0] };
    for (const f of s.camera.fixes) rec.fix(f);
  }
  return { ...rec.toJSON(), truth: s.truth, cameraBottom: s.camera?.board.bottom ?? null };
}
