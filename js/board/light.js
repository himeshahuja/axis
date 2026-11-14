// Finding the band in a camera frame: by its light, or by the colour of the band
// itself, taught by clicking on it (findColour, below). While the board is tracked by
// camera the band's light is full-brightness green: a colour a white board, its
// ink and most rooms rarely have. A pixel counts when its green stands well
// above its red and blue and it is bright; touching pixels make blobs; the blob
// chosen is the strongest, weighed against its distance from where the light was
// expected (a glossy board shows a dimmer reflection of the light beside it). The
// centre is weighted by how green each pixel is, so it lands between pixels.
// No DOM: `image` is any { data (RGBA bytes), width, height }, so the tests run it.

export const GREEN = 1;            // which channel the light is: 0 red, 1 green, 2 blue
const STANDOUT = 60;               // the light's channel above the other two by at least this
const BRIGHT = 150;                // and itself at least this bright: green marker ink (about 40, 140, 70) is not
const NEAR_PX = 40;                // a blob this far from the expected place counts half as strong
const LARGEST = 0.01;              // a blob over this share of the picture is a green thing, not a small light

/**
 * The light in `image`: { u, v, size, strength, confidence } in pixels of the image, or
 * null. `near` is where it is expected ([u, v], or null for anywhere); `within`, if given,
 * is how far from `near` to look (pixels), so most of the frame need not be read.
 */
export function findLight(image, { channel = GREEN, near = null, within = null } = {}) {
  const others = [0, 1, 2].filter((c) => c !== channel);
  return findBlob(image, (data, p) => {
    const c = data[p + channel], lead = c - Math.max(data[p + others[0]], data[p + others[1]]);
    return c >= BRIGHT && lead >= STANDOUT ? lead : 0;
  }, { near, within, largest: LARGEST, smallest: 1 });
}

// ------------------------------------------------ the band itself, by its colour

/**
 * A colour as the camera tells colours apart whatever the light: its chroma (r, g, b each
 * divided by their sum) and its brightness (the sum). Shadows and glare change the
 * brightness much more than the chroma.
 */
export function chroma([r, g, b]) {
  const sum = r + g + b || 1;
  return { c: [r / sum, g / sum, b / sum], bright: sum };
}

/**
 * How well a colour can be told from a whiteboard, its ink, skin and shadows: 0 for grey,
 * black or white (useless), rising with how coloured it is. Below about 0.12 it will be
 * confused with other things.
 */
export function vivid(rgb) {
  const { c } = chroma(rgb);
  return Math.hypot(c[0] - 1 / 3, c[1] - 1 / 3, c[2] - 1 / 3);
}
export const VIVID_ENOUGH = 0.12;

/** The average colour of the patch of `image` around (u, v), `r` pixels either way: [r, g, b]. */
export function sample(image, u, v, r = 3) {
  const { data, width, height } = image, sum = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, Math.round(v) - r); y <= Math.min(height - 1, Math.round(v) + r); y++) {
    for (let x = Math.max(0, Math.round(u) - r); x <= Math.min(width - 1, Math.round(u) + r); x++) {
      const p = (y * width + x) * 4;
      sum[0] += data[p]; sum[1] += data[p + 1]; sum[2] += data[p + 2];
      n++;
    }
  }
  return sum.map((v) => v / Math.max(1, n));
}

/**
 * The band in `image`, found by the colour taught from it (`colour`, [r, g, b]): the blob
 * of pixels whose chroma is close to it and whose brightness is not too far off, nearest
 * where it was expected. Same answer as findLight.
 */
export function findColour(image, colour, { near = null, within = null, tolerance = 0.05 } = {}) {
  const want = chroma(colour);
  return findBlob(image, (data, p) => {
    const sum = data[p] + data[p + 1] + data[p + 2];
    if (sum < want.bright * 0.35 || sum > want.bright * 2.2) return 0;
    const d = Math.hypot(data[p] / sum - want.c[0], data[p + 1] / sum - want.c[1], data[p + 2] / sum - want.c[2]);
    return d < tolerance ? 1 - d / tolerance : 0;
  }, { near, within, largest: 0.06, smallest: 4 });
}

/**
 * The best blob of pixels that `score` gives more than 0 (touching pixels, 4-neighbour),
 * weighed against its distance from `near`; its centre weighted by the scores.
 */
function findBlob(image, score, { near, within, largest, smallest }) {
  const { data, width, height } = image;
  const x0 = near && within ? Math.max(0, Math.floor(near[0] - within)) : 0;
  const x1 = near && within ? Math.min(width, Math.ceil(near[0] + within)) : width;
  const y0 = near && within ? Math.max(0, Math.floor(near[1] - within)) : 0;
  const y1 = near && within ? Math.min(height, Math.ceil(near[1] + within)) : height;
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const scores = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) scores[y * w + x] = score(data, ((y + y0) * width + (x + x0)) * 4);
  const seen = new Uint8Array(w * h), stack = [];
  let best = null;
  for (let start = 0; start < w * h; start++) {
    if (!scores[start] || seen[start]) continue;
    let sum = 0, su = 0, sv = 0, size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w, s = scores[i];
      sum += s;
      su += s * (x + x0 + 0.5);
      sv += s * (y + y0 + 0.5);
      size++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && scores[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size > largest * width * height || size < smallest) continue;
    const u = su / sum, v = sv / sum;
    const weight = near ? sum / (1 + Math.hypot(u - near[0], v - near[1]) / NEAR_PX) : sum;
    if (!best || weight > best.weight) best = { u, v, size, strength: sum, weight };
  }
  if (!best) return null;
  return { u: best.u, v: best.v, size: best.size, strength: best.strength, confidence: Math.min(1, best.size / 12) };
}
