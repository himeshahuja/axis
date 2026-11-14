// The character reader: a small convolutional network trained by
// train/train.py, run here in plain JavaScript. No DOM, so the tests run it
// under Node.

function conv3(input, channels, size, weight, bias, outChannels) {
  // 3 x 3, padded so the picture keeps its size, then ReLU.
  const out = new Float32Array(outChannels * size * size);
  for (let o = 0; o < outChannels; o++) {
    const base = o * size * size;
    out.fill(bias[o], base, base + size * size);
    for (let c = 0; c < channels; c++) {
      const w = (o * channels + c) * 9, src = c * size * size;
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const k = weight[w + ky * 3 + kx];
        if (k === 0) continue;
        const yFrom = Math.max(0, 1 - ky), yTo = Math.min(size, size + 1 - ky);
        const xFrom = Math.max(0, 1 - kx), xTo = Math.min(size, size + 1 - kx);
        for (let y = yFrom; y < yTo; y++) {
          const row = base + y * size, from = src + (y + ky - 1) * size + kx - 1;
          for (let x = xFrom; x < xTo; x++) out[row + x] += k * input[from + x];
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
  return out;
}

function pool2(input, channels, size) {
  const half = size >> 1, out = new Float32Array(channels * half * half);
  for (let c = 0; c < channels; c++) for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
    const i = c * size * size + 2 * y * size + 2 * x;
    out[c * half * half + y * half + x] = Math.max(input[i], input[i + 1], input[i + size], input[i + size + 1]);
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

export class Net {
  // `meta` is model/model.json; `buffer` is model/weights.bin as an ArrayBuffer.
  constructor(meta, buffer) {
    this.labels = meta.labels;
    this.accuracy = meta.accuracy;
    this.w = {};
    let at = 0;
    for (const { name, shape } of meta.layers) {
      const n = shape.reduce((a, b) => a * b, 1);
      this.w[name] = new Float32Array(buffer, at, n);
      at += n * 4;
    }
  }

  // The raw score for each label, for a 28 x 28 picture with values 0 to 1.
  scores(pixels) {
    const w = this.w;
    let x = pool2(conv3(pixels, 1, 28, w['conv1.weight'], w['conv1.bias'], 24), 24, 28);
    x = pool2(conv3(x, 24, 14, w['conv2.weight'], w['conv2.bias'], 48), 48, 14);
    x = pool2(conv3(x, 48, 7, w['conv3.weight'], w['conv3.bias'], 64), 64, 7);
    x = dense(x, w['fc1.weight'], w['fc1.bias'], true);
    return dense(x, w['fc2.weight'], w['fc2.bias'], false);
  }

  // Every label with how sure the network is of it (adding up to 1), surest first.
  read(pixels) {
    const s = this.scores(pixels), top = Math.max(...s);
    const e = Array.from(s, (v) => Math.exp(v - top)), sum = e.reduce((a, b) => a + b, 0);
    return e.map((v, i) => ({ label: this.labels[i], p: v / sum })).sort((a, b) => b.p - a.p);
  }
}

export async function loadNet(base = 'model/') {
  const [meta, buffer] = await Promise.all([fetch(`${base}model.json`).then((r) => r.json()), fetch(`${base}weights.bin`).then((r) => r.arrayBuffer())]);
  return new Net(meta, buffer);
}
