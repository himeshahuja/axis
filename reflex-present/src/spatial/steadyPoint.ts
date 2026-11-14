import type { Point2 } from './types'

/** Collect a continuous, still hand pose; gaps and motion restart the hold. */
export class SteadyPoint {
  private samples: { p: Point2; t: number }[] = []
  progress = 0
  reset() { this.samples = []; this.progress = 0 }
  update(p: Point2 | null, t: number): Point2 | null {
    if (!p) { this.reset(); return null }
    const first = this.samples[0]
    const last = this.samples.at(-1)
    if (first && (Math.hypot(p.x - first.p.x, p.y - first.p.y) > 0.012 || t - last!.t > 180)) this.reset()
    this.samples.push({ p: { ...p }, t })
    this.progress = Math.min(1, (t - this.samples[0].t) / 900)
    if (this.progress < 1 || this.samples.length < 10) return null
    const mean = { x: 0, y: 0 }
    for (const s of this.samples) { mean.x += s.p.x / this.samples.length; mean.y += s.p.y / this.samples.length }
    this.reset()
    return mean
  }
}
