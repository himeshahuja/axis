import { OneEuro2D } from './filters'
import type { Point2 } from './types'

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

/** Separate palm deformation during a grasp from actual translation of the hand.
 * Runs once per camera observation, in calibrated canvas coordinates.
 */
export class GraspCursor {
  private filter = new OneEuro2D(0.9, 3)
  private history: Point2[] = []
  private offset: Point2 = { x: 0, y: 0 }
  private last: { wrist: Point2; target: Point2; closed: boolean; t: number } | null = null
  private settleUntil = 0
  private transitionStarted: number | null = null
  private output: Point2 | null = null

  reset() {
    this.filter.reset()
    this.history = []
    this.offset = { x: 0, y: 0 }
    this.last = null
    this.output = null
    this.settleUntil = 0
    this.transitionStarted = null
  }

  update(palm: Point2, wrist: Point2, t: number, closed: boolean, changingPose: boolean, canvas: { w: number; h: number }): Point2 {
    if (this.last && (t - this.last.t > 180 || t <= this.last.t)) this.reset()
    if (this.last && closed !== this.last.closed) this.settleUntil = t + 90
    if (changingPose) this.transitionStarted ??= t
    else this.transitionStarted = null
    // Bound the transition window so an ambiguous hand cannot keep translation
    // tied to the wrist indefinitely.
    const morphing = changingPose && t - this.transitionStarted! < 280
    let target = { x: palm.x + this.offset.x, y: palm.y + this.offset.y }
    if (this.last && (morphing || t < this.settleUntil)) {
      target = {
        x: this.last.target.x + wrist.x - this.last.wrist.x,
        y: this.last.target.y + wrist.y - this.last.wrist.y,
      }
      // Retain this correction after closing/opening, so there is no delayed snap.
      this.offset = { x: target.x - palm.x, y: target.y - palm.y }
    }
    this.last = { wrist: { ...wrist }, target, closed, t }
    this.history.push(target)
    if (this.history.length > 3) this.history.shift()
    const smooth = this.filter.filter(median(this.history.map((p) => p.x)), median(this.history.map((p) => p.y)), t)
    if (!this.output) this.output = smooth
    const dx = (smooth.x - this.output.x) * canvas.w
    const dy = (smooth.y - this.output.y) * canvas.h
    const distance = Math.hypot(dx, dy)
    // Soft 1.8px steadiness zone: tiny sensor tremors do not move the cursor.
    // Excess movement passes through continuously, rather than jumping at a threshold.
    if (distance > 1.8) {
      const k = (distance - 1.8) / distance
      this.output = { x: this.output.x + (smooth.x - this.output.x) * k, y: this.output.y + (smooth.y - this.output.y) * k }
    }
    return { ...this.output }
  }
}
