// One Euro filter (Casiez et al. 2012): heavy smoothing when the pointer is
// still, little lag when it moves fast. Two parameters, easy to tune live.

class LowPass {
  private y: number | null = null
  filter(x: number, alpha: number) {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y
    return this.y
  }
  last() {
    return this.y
  }
  reset() {
    this.y = null
  }
}

const alphaFor = (cutoffHz: number, dtS: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dtS)
}

export class OneEuro {
  minCutoff: number
  beta: number
  private dCutoff = 1
  private x = new LowPass()
  private dx = new LowPass()
  private lastT: number | null = null

  constructor(minCutoff = 1.2, beta = 8) {
    this.minCutoff = minCutoff
    this.beta = beta
  }

  filter(value: number, tMs: number) {
    const prev = this.x.last()
    if (this.lastT === null || prev === null) {
      this.lastT = tMs
      return this.x.filter(value, 1)
    }
    const dt = Math.max(1e-3, (tMs - this.lastT) / 1000)
    this.lastT = tMs
    const edx = this.dx.filter((value - prev) / dt, alphaFor(this.dCutoff, dt))
    const cutoff = this.minCutoff + this.beta * Math.abs(edx)
    return this.x.filter(value, alphaFor(cutoff, dt))
  }

  reset() {
    this.x.reset()
    this.dx.reset()
    this.lastT = null
  }
}

export class OneEuro2D {
  private fx: OneEuro
  private fy: OneEuro
  constructor(minCutoff?: number, beta?: number) {
    this.fx = new OneEuro(minCutoff, beta)
    this.fy = new OneEuro(minCutoff, beta)
  }
  filter(x: number, y: number, tMs: number) {
    return { x: this.fx.filter(x, tMs), y: this.fy.filter(y, tMs) }
  }
  setParams(minCutoff: number, beta: number) {
    for (const f of [this.fx, this.fy]) {
      f.minCutoff = minCutoff
      f.beta = beta
    }
  }
  reset() {
    this.fx.reset()
    this.fy.reset()
  }
}
