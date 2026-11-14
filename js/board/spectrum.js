// How a signal's power spreads over frequency, so the band's noise, a hand's
// tremor and its real motion can be told apart: writing lives below about 5 Hz,
// tremor at 6 to 12 Hz, sensor noise everywhere. A plain radix-2 FFT, and
// Welch's method: the signal is cut into half-overlapping pieces, each tapered at
// both ends (a Hann window), and their spectra averaged. No DOM, so the tests run it.

export const BANDS = { writing: [0, 5], tremor: [6, 12], above: [12, Infinity] };

/** The discrete Fourier transform of re + i im, in place. The length must be a power of two. */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1, angle = (-2 * Math.PI) / len, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const p = i + k, q = p + half;
        const br = re[q] * cr - im[q] * ci, bi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - br;
        im[q] = im[p] - bi;
        re[p] += br;
        im[p] += bi;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/**
 * The power spectrum of `values`, taken `rate` times a second: { freqs, power }, the
 * power in (units)^2 per Hz at each frequency from 0 to rate/2. Pieces of `segment`
 * samples (a power of two; fewer if the signal is short), each with its mean taken out.
 */
export function spectrum(values, rate, segment = 256) {
  const n = Math.min(segment, 2 ** Math.floor(Math.log2(Math.max(1, values.length))));
  if (n < 16) return { freqs: [], power: [] };
  const window = Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const scale = rate * window.reduce((sum, w) => sum + w * w, 0);
  const power = new Float64Array(n / 2 + 1);
  let pieces = 0;
  for (let start = 0; start + n <= values.length; start += n / 2) {
    let mean = 0;
    for (let k = 0; k < n; k++) mean += values[start + k];
    mean /= n;
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < n; k++) re[k] = (values[start + k] - mean) * window[k];
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) power[k] += ((re[k] ** 2 + im[k] ** 2) / scale) * (k === 0 || k === n / 2 ? 1 : 2);
    pieces++;
  }
  for (let k = 0; k < power.length; k++) power[k] /= pieces;
  return { freqs: Float64Array.from({ length: n / 2 + 1 }, (_, k) => (k * rate) / n), power };
}

/** The `count` strongest peaks at or above `from` Hz, strongest first: [{ hz, power }]. */
export function peaks({ freqs, power }, count = 3, from = 0.5) {
  const found = [];
  for (let k = 1; k < power.length - 1; k++) {
    if (freqs[k] >= from && power[k] > power[k - 1] && power[k] >= power[k + 1]) found.push({ hz: freqs[k], power: power[k] });
  }
  return found.sort((a, b) => b.power - a.power).slice(0, count);
}

/** How strong the signal is in each band of frequencies, as a root mean square: { writing, tremor, above }. */
export function bands({ freqs, power }, edges = BANDS) {
  const step = freqs.length > 1 ? freqs[1] - freqs[0] : 0;
  return Object.fromEntries(Object.entries(edges).map(([name, [lo, hi]]) => {
    let sum = 0;
    for (let k = 0; k < power.length; k++) if (freqs[k] >= lo && freqs[k] < hi) sum += power[k] * step;
    return [name, Math.sqrt(sum)];
  }));
}
