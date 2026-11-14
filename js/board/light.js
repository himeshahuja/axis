// Finding the band's light in a camera frame. While the board is tracked by
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
  const { data, width, height } = image;
  const x0 = near && within ? Math.max(0, Math.floor(near[0] - within)) : 0;
  const x1 = near && within ? Math.min(width, Math.ceil(near[0] + within)) : width;
  const y0 = near && within ? Math.max(0, Math.floor(near[1] - within)) : 0;
  const y1 = near && within ? Math.min(height, Math.ceil(near[1] + within)) : height;
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const others = [0, 1, 2].filter((c) => c !== channel);
  const score = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = ((y + y0) * width + (x + x0)) * 4, c = data[p + channel];
      const lead = c - Math.max(data[p + others[0]], data[p + others[1]]);
      if (c >= BRIGHT && lead >= STANDOUT) score[y * w + x] = lead;
    }
  }
  // Blobs of touching pixels (4-neighbour flood fill).
  const seen = new Uint8Array(w * h), stack = [];
  let best = null;
  for (let start = 0; start < w * h; start++) {
    if (!score[start] || seen[start]) continue;
    let sum = 0, su = 0, sv = 0, size = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i - x) / w, s = score[i];
      sum += s;
      su += s * (x + x0 + 0.5);
      sv += s * (y + y0 + 0.5);
      size++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && score[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (size > LARGEST * width * height) continue;
    const u = su / sum, v = sv / sum;
    const weight = near ? sum / (1 + Math.hypot(u - near[0], v - near[1]) / NEAR_PX) : sum;
    if (!best || weight > best.weight) best = { u, v, size, strength: sum, weight };
  }
  if (!best) return null;
  return { u: best.u, v: best.v, size: best.size, strength: best.strength, confidence: Math.min(1, best.size / 12) };
}
