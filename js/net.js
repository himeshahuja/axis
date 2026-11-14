// The character reader: a small network trained by train/train.py that reads
// a character from wrist sensor readings, run here in plain JavaScript. No DOM, so the tests run it
// under Node.

// A convolution along time, padded so the length stays the same, then ReLU.
// `input` is channels x length, one channel after another.
function conv(input, channels, length, weight, bias, outChannels, width) {
  const out = new Float32Array(outChannels * length), pad = width >> 1;
  for (let o = 0; o < outChannels; o++) {
    const base = o * length;
    out.fill(bias[o], base, base + length);
    for (let c = 0; c < channels; c++) {
      const w = (o * channels + c) * width, src = c * length;
      for (let k = 0; k < width; k++) {
        const v = weight[w + k], shift = k - pad;
        const from = Math.max(0, -shift), to = Math.min(length, length - shift);
        for (let t = from; t < to; t++) out[base + t] += v * input[src + t + shift];
      }
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
  return out;
}

// Halve the length, keeping the larger of each pair.
function pool(input, channels, length) {
  const half = length >> 1, out = new Float32Array(channels * half);
  for (let c = 0; c < channels; c++) for (let t = 0; t < half; t++) out[c * half + t] = Math.max(input[c * length + 2 * t], input[c * length + 2 * t + 1]);
  return out;
}

// Each channel's largest value, then each channel's average.
function gather(input, channels, length) {
  const out = new Float32Array(channels * 2);
  for (let c = 0; c < channels; c++) {
    let max = -Infinity, sum = 0;
    for (let t = 0; t < length; t++) { const v = input[c * length + t]; if (v > max) max = v; sum += v; }
    out[c] = max; out[channels + c] = sum / length;
  }
  return out;
}

function dense(input, weight, bias, relu) {
  const n = bias.length, m = input.length, out = new Float32Array(n);
  for (let o = 0; o < n; o++) {
    let sum = bias[o];
    for (let i = 0, w = o * m; i < m; i++) sum += weight[w + i] * input[i];
    out[o] = relu && sum < 0 ? 0 : sum;
  }
  return out;
}

// Half-precision floats (how the weights are stored) as ordinary ones.
function fromFloat16(buffer) {
  const h = new Uint16Array(buffer), out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const sign = h[i] & 0x8000 ? -1 : 1, exp = (h[i] >> 10) & 31, frac = h[i] & 1023;
    out[i] = sign * (exp === 0 ? frac * 2 ** -24 : exp === 31 ? (frac ? NaN : Infinity) : (1 + frac / 1024) * 2 ** (exp - 15));
  }
  return out;
}

export class Net {
  // `meta` is model/model.json; `buffer` is model/weights.bin as an ArrayBuffer.
  constructor(meta, buffer) {
    this.labels = meta.labels;
    this.accuracy = meta.accuracy;
    this.plan = meta.plan;
    this.input = meta.input;
    const all = meta.format === 'float16' ? fromFloat16(buffer) : new Float32Array(buffer);
    this.w = {};
    let at = 0;
    for (const { name, shape } of meta.layers) {
      const n = shape.reduce((a, b) => a * b, 1);
      this.w[name] = all.subarray(at, at + n);
      at += n;
    }
  }

  // The raw score for each label. `x` is the 6 x 96 array from features().
  scores(x) {
    let [channels, length] = this.input;
    this.plan.forEach((step, i) => {
      if (step.type === 'conv') { x = conv(x, channels, length, this.w[`${i}.weight`], this.w[`${i}.bias`], step.out, step.width); channels = step.out; }
      else if (step.type === 'pool') { x = pool(x, channels, length); length >>= 1; }
      else if (step.type === 'gather') { x = gather(x, channels, length); channels *= 2; length = 1; }
      else x = dense(x, this.w[`${i}.weight`], this.w[`${i}.bias`], false);
    });
    return x;
  }

  // Every label with how sure the network is of it (adding up to 1), surest first.
  read(x) {
    const s = this.scores(x), top = Math.max(...s);
    const e = Array.from(s, (v) => Math.exp(v - top)), sum = e.reduce((a, b) => a + b, 0);
    return e.map((v, i) => ({ label: this.labels[i], p: v / sum })).sort((a, b) => b.p - a.p);
  }
}

export async function loadNet(base = 'model/') {
  const [meta, buffer] = await Promise.all([fetch(`${base}model.json`).then((r) => r.json()), fetch(`${base}weights.bin`).then((r) => r.arrayBuffer())]);
  return new Net(meta, buffer);
}
