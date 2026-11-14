// Which wrist in the camera's picture wears the band.
//
// A pose model finds every person in the picture and both of their wrists, but it
// cannot see the band. The band says how it moves, though: its motion sensors give
// its speed across the board and up and down. So each wrist the camera sees is
// followed from frame to frame as a short track, and scored by how well its
// movement agrees with the band's; the band is on the wrist that agrees best,
// clearly better than the rest. Before anything has moved, the hand the band is
// worn on (a setting) decides. No DOM: the tests run it.

export const LANDMARK = { left: 15, right: 16 };   // the pose model's left and right wrist
const LINK_M = 0.25;          // a wrist this close to where a track was last frame is the same wrist
const FORGET_MS = 600;        // a track not seen for this long is dropped
const SPEED_SPREAD = 0.25;    // m/s: how far apart two speeds may be and still "agree"
const MOVING = 0.12;          // m/s: below this neither is moving, and nothing is learned
const LEARN = 0.08;           // how fast a track's score follows each new frame
const WINDOW_MS = 300;        // speeds are measured over this long: a pose model's wrist jumps a centimetre or two
                              // from frame to frame, so a one-frame speed would be mostly noise
const CLEAR = 0.15;           // the chosen track must beat the next by this much to take over

export class WristTrack {
  /** `hand`: the hand the band is on, 'left' or 'right' (the person's own). */
  constructor({ hand = 'right' } = {}) {
    this.hand = hand;
    this.tracks = [];          // { id, side, x, y, t, past: [[t, x, y]], score, seen }
    this.bandPast = [];        // [t, speed along the ground, speed up]: the band's own motion, for WINDOW_MS
    this.chosen = null;        // the id of the track wearing the band
    this.next = 1;
  }

  /**
   * One camera frame at the band's time `t` (ms): `wrists`, every wrist seen, as
   * { side, x, y, visibility } in board metres; `band`, the band's own velocity right
   * then as [speed across the board (or along the ground, any direction), speed up]
   * in m/s, or null if not known. Returns the wrist wearing the band ({ x, y, side }),
   * or null if it is not in this frame.
   */
  frame(t, wrists, band) {
    const seen = wrists.filter((w) => w.visibility >= 0.5);
    if (band) this.bandPast.push([t, ...band]);
    while (this.bandPast.length && t - this.bandPast[0][0] > WINDOW_MS) this.bandPast.shift();
    const free = new Set(this.tracks);
    for (const w of seen) {
      let best = null, gap = LINK_M;
      for (const track of free) {
        const d = Math.hypot(w.x - track.x, w.y - track.y);
        if (track.side === w.side && d < gap) { best = track; gap = d; }
      }
      if (best) {
        free.delete(best);
        Object.assign(best, { x: w.x, y: w.y, t, seen: true });
        best.past.push([t, w.x, w.y]);
        while (best.past.length && t - best.past[0][0] > WINDOW_MS) best.past.shift();
        this.score(best);
      } else {
        const prior = w.side === this.hand ? 0.55 : 0.45;
        this.tracks.push({ id: this.next++, side: w.side, x: w.x, y: w.y, t, past: [[t, w.x, w.y]], score: prior, seen: true });
      }
    }
    for (const track of free) track.seen = false;
    this.tracks = this.tracks.filter((track) => t - track.t <= FORGET_MS);
    this.choose();
    const chosen = this.tracks.find((track) => track.id === this.chosen && track.seen);
    return chosen ? { x: chosen.x, y: chosen.y, side: chosen.side } : null;
  }

  // How well this track's movement over the last WINDOW_MS agrees with the band's, followed over time.
  score(track) {
    const past = track.past, band = this.bandPast;
    if (past.length < 3 || !band.length || past[past.length - 1][0] - past[0][0] < WINDOW_MS * 0.7) return;
    const [t0, x0, y0] = past[0], [t1, x1, y1] = past[past.length - 1], dt = (t1 - t0) / 1000;
    const across = Math.abs(x1 - x0) / dt, up = (y1 - y0) / dt;
    const bandAcross = band.reduce((a, b) => a + b[1], 0) / band.length, bandUp = band.reduce((a, b) => a + b[2], 0) / band.length;
    if (Math.hypot(across, up) < MOVING && Math.hypot(bandAcross, bandUp) < MOVING) return;
    const miss = Math.hypot(across - Math.abs(bandAcross), up - bandUp);
    track.score += (Math.exp(-((miss / SPEED_SPREAD) ** 2)) - track.score) * LEARN;
  }

  choose() {
    const ranked = [...this.tracks].sort((a, b) => b.score - a.score);
    if (!ranked.length) return;
    const current = this.tracks.find((track) => track.id === this.chosen);
    if (!current) this.chosen = ranked[0].id;
    else if (ranked[0].id !== current.id && ranked[0].score > current.score + CLEAR) this.chosen = ranked[0].id;
  }

  /** How sure the choice is: the chosen track's score less the next best's (0 to 1). */
  get sureness() {
    const ranked = [...this.tracks].sort((a, b) => b.score - a.score), chosen = this.tracks.find((t) => t.id === this.chosen);
    if (!chosen) return 0;
    const other = ranked.find((t) => t.id !== chosen.id);
    return Math.max(0, chosen.score - (other?.score ?? 0));
  }
}
