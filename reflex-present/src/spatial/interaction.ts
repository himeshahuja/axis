// Source-agnostic interaction state machine:
//   IDLE → HOVER → GRABBED → DRAGGING → RELEASED, plus CANCELLED and TRACKING_LOST.
// It only ever sees InteractionEvents, so camera pinch, wearable "select",
// mouse buttons and keyboard all drive it identically.

import type { InteractionEvent, InteractionStateName, Point2, PointerEstimate, SpatialObject } from './types'

export interface InteractionConfig {
  /** Acquisition halo around objects, in canvas-height units. */
  magnetRadius: number
  /** Extra distance before an existing hover target lets go (hysteresis). */
  hoverStickiness: number
  /** Movement after grab before GRABBED becomes DRAGGING. */
  dragStartDistance: number
  /** A grab frozen by tracking loss is cancelled (object restored) after this. */
  lostCancelMs: number
  /** How long RELEASED / CANCELLED stay visible before settling. */
  transientMs: number
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  magnetRadius: 0.05,
  hoverStickiness: 0.03,
  dragStartDistance: 0.008,
  lostCancelMs: 4000,
  transientMs: 150,
}

interface Move {
  id: string
  from: Point2
  to: Point2
}

export interface TransitionRecord {
  tMs: number
  from: InteractionStateName
  to: InteractionStateName
  reason: string
}

export class InteractionEngine {
  objects: SpatialObject[]
  state: InteractionStateName = 'IDLE'
  hoverId: string | null = null
  grabbedId: string | null = null
  pointer: PointerEstimate | null = null
  config: InteractionConfig
  /** Canvas width / height, so distances are isotropic on any display. */
  aspect = 16 / 9
  undoStack: Move[] = []
  transitions: TransitionRecord[] = []
  private grabOffset: Point2 = { x: 0, y: 0 }
  private grabStart: Point2 = { x: 0, y: 0 }
  private lostSince: number | null = null
  private transientSince: number | null = null
  private listeners = new Set<() => void>()

  constructor(objects: SpatialObject[], config: Partial<InteractionConfig> = {}) {
    this.objects = objects.map((o) => ({ ...o }))
    this.config = { ...DEFAULT_INTERACTION_CONFIG, ...config }
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private changed() {
    for (const fn of this.listeners) fn()
  }

  private go(to: InteractionStateName, tMs: number, reason: string) {
    if (to === this.state) return
    this.transitions.push({ tMs, from: this.state, to, reason })
    if (this.transitions.length > 200) this.transitions.shift()
    this.state = to
    this.transientSince = to === 'RELEASED' || to === 'CANCELLED' ? tMs : null
  }

  private obj(id: string | null) {
    return id ? this.objects.find((o) => o.id === id) : undefined
  }

  /** Aspect-corrected distance from a point to an object's rectangle (0 inside). */
  distanceTo(p: Point2, o: SpatialObject) {
    const dx = Math.max(o.x - p.x, 0, p.x - (o.x + o.w)) * this.aspect
    const dy = Math.max(o.y - p.y, 0, p.y - (o.y + o.h))
    return Math.hypot(dx, dy)
  }

  /** Topmost object under the point, else nearest within the magnet radius. */
  hitTest(p: Point2): SpatialObject | null {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      if (this.distanceTo(p, this.objects[i]) === 0) return this.objects[i]
    }
    let best: SpatialObject | null = null
    let bestD = this.config.magnetRadius
    for (const o of this.objects) {
      const d = this.distanceTo(p, o)
      if (d <= bestD) [best, bestD] = [o, d]
    }
    return best
  }

  private updateHover(p: Point2, tMs: number) {
    const current = this.obj(this.hoverId)
    const hit = this.hitTest(p)
    const inside = hit && this.distanceTo(p, hit) === 0
    if (current && !inside && this.distanceTo(p, current) <= this.config.magnetRadius + this.config.hoverStickiness) {
      // keep the current target: stickiness stops flicker between neighbours
    } else {
      this.hoverId = hit?.id ?? null
    }
    this.go(this.hoverId ? 'HOVER' : 'IDLE', tMs, this.hoverId ? `hover ${this.hoverId}` : 'no target')
  }

  private place(o: SpatialObject, p: Point2) {
    o.x = Math.max(0, Math.min(1 - o.w, p.x))
    o.y = Math.max(0, Math.min(1 - o.h, p.y))
  }

  private restoreGrabbed(tMs: number, reason: string) {
    const o = this.obj(this.grabbedId)
    if (o) this.place(o, this.grabStart)
    this.grabbedId = null
    this.lostSince = null
    this.go('CANCELLED', tMs, reason)
  }

  handle(ev: InteractionEvent) {
    switch (ev.type) {
      case 'pointer':
        this.onPointer(ev.pointer)
        break
      case 'grab': {
        if (this.grabbedId || !this.pointer?.valid) break
        if (this.state === 'RELEASED' || this.state === 'CANCELLED') this.updateHover(this.pointer, ev.tMs)
        const o = this.obj(this.hoverId)
        if (!o) break
        this.grabbedId = o.id
        this.grabStart = { x: o.x, y: o.y }
        this.grabOffset = { x: this.pointer.x - o.x, y: this.pointer.y - o.y }
        this.objects = [...this.objects.filter((x) => x !== o), o]
        this.go('GRABBED', ev.tMs, `grab ${o.id} (${ev.source})`)
        break
      }
      case 'release': {
        const o = this.obj(this.grabbedId)
        if (!o) break
        if (Math.hypot(o.x - this.grabStart.x, o.y - this.grabStart.y) > 1e-6) {
          this.undoStack.push({ id: o.id, from: { ...this.grabStart }, to: { x: o.x, y: o.y } })
          if (this.undoStack.length > 50) this.undoStack.shift()
        }
        this.grabbedId = null
        this.lostSince = null
        this.go('RELEASED', ev.tMs, `release ${o.id} (${ev.source})`)
        break
      }
      case 'cancel':
        if (this.grabbedId) this.restoreGrabbed(ev.tMs, `cancel (${ev.source})`)
        else {
          this.hoverId = null
          this.go('CANCELLED', ev.tMs, `cancel (${ev.source})`)
        }
        break
      case 'undo': {
        if (this.grabbedId) break
        const m = this.undoStack.pop()
        const o = m && this.obj(m.id)
        if (o) this.place(o, m.from)
        break
      }
    }
    this.changed()
  }

  private onPointer(p: PointerEstimate) {
    this.pointer = p
    const t = p.tMs
    if (!p.valid) {
      if (this.state !== 'TRACKING_LOST') {
        this.lostSince = t
        if (!this.grabbedId) this.hoverId = null
        this.go('TRACKING_LOST', t, 'pointer invalid')
      }
      return
    }

    if (this.state === 'TRACKING_LOST') {
      this.lostSince = null
      const o = this.obj(this.grabbedId)
      if (o) {
        // Re-anchor so the frozen object stays put instead of leaping to wherever the hand reappeared.
        this.grabOffset = { x: p.x - o.x, y: p.y - o.y }
        this.go('DRAGGING', t, 'tracking restored')
        return
      }
    }

    const o = this.obj(this.grabbedId)
    if (o) {
      this.place(o, { x: p.x - this.grabOffset.x, y: p.y - this.grabOffset.y })
      const moved = Math.hypot((o.x - this.grabStart.x) * this.aspect, o.y - this.grabStart.y)
      if (this.state === 'GRABBED' && moved > this.config.dragStartDistance) this.go('DRAGGING', t, 'moved')
      return
    }

    if ((this.state === 'RELEASED' || this.state === 'CANCELLED') && this.transientSince !== null && t - this.transientSince < this.config.transientMs) return
    this.updateHover(p, t)
  }

  /** Time-based transitions; call once per frame. */
  tick(tMs: number) {
    if (this.state === 'TRACKING_LOST' && this.grabbedId && this.lostSince !== null && tMs - this.lostSince > this.config.lostCancelMs) {
      this.restoreGrabbed(tMs, `tracking lost > ${this.config.lostCancelMs}ms`)
      this.changed()
    }
  }
}
