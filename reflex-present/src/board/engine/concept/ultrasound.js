// Vexo Board, a concept: where the band is on the board, from ultrasound.
//
// The band sends a short 40 kHz click about 50 times a second, with an infrared
// flash at the same instant. Three small pucks stuck to the board's corners (bottom
// left, top left, top right) see the flash at once and hear the click a little
// later: the delay is the distance divided by the speed of sound. Three distances
// put the band at one point. This is how marker-tracking bars (Mimio, eBeam) find a
// pen, turned round: here the band sends and the board listens.
//
// Board coordinates, as everywhere in js/board: metres, x along the board from its
// left edge, y up from its bottom edge, z out of the board toward the writer. The
// bottom left puck is at the origin. No DOM: the tests run it.

/** The speed of sound in air, m/s, at `celsius` degrees. */
export function speedOfSound(celsius = 20) {
  return 331.3 * Math.sqrt(1 + celsius / 273.15);
}

/**
 * Where the pucks are, from the distances between them, which the pucks measure
 * themselves (each clicks in turn while the others listen): `across` from top left to
 * top right, `up` from bottom left to top left, and `diagonal` from bottom left to top
 * right, a check. Returns { width, height, pucks: { bottomLeft, topLeft, topRight },
 * square } with `square` how far (m) the three are from a right angle, which should be
 * a centimetre or so for pucks stuck on by hand.
 */
export function survey({ across, up, diagonal }) {
  const width = across, height = up;
  return {
    width, height,
    pucks: { bottomLeft: [0, 0, 0], topLeft: [0, height, 0], topRight: [width, height, 0] },
    square: Math.abs(Math.hypot(width, height) - diagonal),
  };
}

/**
 * The band's place from its distance to each puck (metres; null for a puck that heard
 * nothing). With all three the answer is exact and needs no guess; with two, `z` (the
 * band's distance out from the board, which hardly changes) fills in. Returns
 * { x, y, z, used } or null.
 *
 * With the pucks at (0, 0), (0, H) and (W, H) the circles' differences are straight
 * lines, so x and y come out directly, and do not depend on z at all: the distance
 * out from the board is badly measured from pucks that all lie on it, but it is not
 * needed for where on the board the band is.
 */
export function locate(r, layout, z = 0.07) {
  const { width: W, height: H } = layout, [bl, tl, tr] = r;
  const sq = (v) => v * v;
  if (bl != null && tl != null && tr != null) {
    const y = (sq(bl) - sq(tl) + sq(H)) / (2 * H);
    const x = (sq(tl) - sq(tr) + sq(W)) / (2 * W);
    return { x, y, z: Math.sqrt(Math.max(0, sq(bl) - sq(x) - sq(y))), used: 3 };
  }
  // Two distances and the band's distance out from the board.
  if (tl != null && tr != null) {
    const x = (sq(tl) - sq(tr) + sq(W)) / (2 * W), dy = Math.sqrt(Math.max(0, sq(tl) - sq(x) - sq(z)));
    return { x, y: H - dy, z, used: 2 };
  }
  if (bl != null && tl != null) {
    const y = (sq(bl) - sq(tl) + sq(H)) / (2 * H), x = Math.sqrt(Math.max(0, sq(bl) - sq(y) - sq(z)));
    return { x, y, z, used: 2 };
  }
  return null;
}

/**
 * Turns the pucks' timings into places, leaving out the ones that cannot be right. A
 * click can reach a puck the long way round, off the board or a wall, when the hand
 * or the body is in the straight path: an echo, and an echo is always late. So each
 * distance is checked against the distance the band's own motion predicts: one much
 * longer than that is an echo and is left out (two good distances still place the
 * band). One much shorter means the prediction is what is wrong; two full clicks in a
 * row that agree with each other then win it back.
 */
export class Pings {
  constructor(layout, { celsius = 20, late = 0.03 } = {}) {
    this.layout = layout;
    this.c = speedOfSound(celsius);
    this.late = late;                  // m: a distance this much longer than predicted is an echo
    this.z = 0.07;                     // the band's distance out from the board, followed
    this.lastUsed = null;              // band time (ms) of the last fix used
    this.doubt = null;                 // full fixes in a row that disagreed with the prediction but agreed with each other: { t, x, y, n }
    this.stats = { pings: 0, used: 0, partial: 0, echoes: 0, missing: 0, regained: 0 };
  }

  /**
   * One click at band time `t` (ms): `delays` [bottom left, top left, top right] in
   * seconds (null: not heard). `expect` [x, y] where the band should be now, or null.
   * Returns { x, y, z, used } in board metres (and `regained` with a speed `v` when it
   * overrules a prediction that had gone wrong), or null when the click is not to be used.
   */
  fix(t, delays, expect = null) {
    this.stats.pings++;
    const { width: W, height: H } = this.layout, pucks = [[0, 0], [0, H], [W, H]];
    const r = delays.map((d) => (d == null ? null : d * this.c));
    this.stats.missing += r.filter((v) => v == null).length;
    // Two distances to two pucks can differ by at most the pucks' own distance apart.
    for (const [a, b, d] of [[0, 1, H], [1, 2, W], [0, 2, Math.hypot(W, H)]]) {
      if (r[a] != null && r[b] != null && Math.abs(r[a] - r[b]) > d + 0.01) {
        r[r[a] > r[b] ? a : b] = null;
        this.stats.echoes++;
      }
    }
    // The prediction grows less sure while no click is used: a hand moves 1 m/s at most
    // while writing, so the allowance widens at that pace, up to 15 cm.
    const blind = this.lastUsed === null ? 0 : Math.max(0, (t - this.lastUsed) / 1000 - 0.04);
    const allow = Math.min(0.15, this.late + 1.0 * blind);
    const full = locate(r, this.layout, this.z);
    // Three full clicks in a row that agree with each other are believed, whatever the
    // prediction says: the prediction was what went wrong.
    const follows = full && full.used === 3 && this.doubt && t - this.doubt.t < 60 && Math.hypot(full.x - this.doubt.x, full.y - this.doubt.y) < 0.02;
    const agree = follows && this.doubt.n >= 2;
    let at = full;
    if (expect && full && !agree) {
      const guess = pucks.map(([px, py]) => Math.hypot(expect[0] - px, expect[1] - py, this.z));
      const kept = r.map((v, k) => (v != null && v - guess[k] > allow ? null : v));
      const echoes = r.filter((v, k) => v != null && kept[k] == null).length;
      this.stats.echoes += echoes;
      at = locate(kept, this.layout, this.z);
      // Too little left, or still far off with what is left: every distance is an echo, or
      // the prediction is what went wrong.
      if (!at || Math.hypot(at.x - expect[0], at.y - expect[1]) > allow + 0.03) {
        // A full click that disagrees: remembered, and believed once two more agree with it
        // (an echo's extra path changes as the hand moves, so echoes rarely agree for long).
        if (full.used === 3) this.doubt = { t, x: full.x, y: full.y, n: follows ? this.doubt.n + 1 : 1 };
        return null;
      }
    }
    if (!at) return null;
    if (agree) {
      // Back on track: the speed from the two clicks that agreed, for the filter to start again.
      this.stats.regained++;
      const dt = (t - this.doubt.t) / 1000;
      at = { ...at, regained: true, v: dt > 0 ? [(at.x - this.doubt.x) / dt, (at.y - this.doubt.y) / dt] : [0, 0] };
    }
    this.doubt = null;
    this.lastUsed = t;
    if (at.used === 3 && at.z > 0.01) this.z += (at.z - this.z) * 0.05;   // follow it slowly: it is noisy
    this.stats.used++;
    if (at.used < 3) this.stats.partial++;
    return at;
  }
}
