import { ClockAligner } from '../clock'
import type { Point2, WearableGestureKind, WearableObservation } from '../types'
import type { WearableAdapter } from './adapter'

export type MockPattern = 'mouse' | 'orbit'

export interface MockWearableOptions {
  pattern: MockPattern
  rateHz: number
  /** Per-sample position noise (canvas units). */
  noise: number
  /** Random-walk drift per second, mimicking integrated-motion error. */
  driftPerS: number
  /** Simulated transport delay range (ms). */
  latencyMs: [number, number]
}

/**
 * Stand-in for the Vexo stream so the fusion and interaction layers can be
 * exercised end to end. Every number it emits is synthetic; replace it with
 * the real adapter without touching anything downstream.
 */
export class MockWearableAdapter implements WearableAdapter {
  readonly name = 'mock-wearable'
  options: MockWearableOptions
  connected = true
  private target: Point2 = { x: 0.5, y: 0.5 }
  private drift: Point2 = { x: 0, y: 0 }
  private timer: ReturnType<typeof setInterval> | null = null
  private subs = new Set<(o: WearableObservation) => void>()
  private last: WearableObservation | null = null
  private clock = new ClockAligner()
  private deviceEpoch = performance.now() - 123_456 // pretend firmware clock started earlier
  private pendingGesture: WearableGestureKind | null = null
  private t0 = performance.now()

  constructor(options: Partial<MockWearableOptions> = {}) {
    this.options = { pattern: 'orbit', rateHz: 100, noise: 0.002, driftPerS: 0.01, latencyMs: [5, 25], ...options }
  }

  setTarget(p: Point2) {
    this.target = p
  }

  setConnected(c: boolean) {
    this.connected = c
  }

  emitGesture(kind: WearableGestureKind) {
    this.pendingGesture = kind
  }

  resetDrift() {
    this.drift = { x: 0, y: 0 }
  }

  start() {
    if (this.timer) return
    this.t0 = performance.now()
    this.timer = setInterval(() => this.sample(), 1000 / this.options.rateHz)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.last = null
  }

  subscribe(cb: (o: WearableObservation) => void) {
    this.subs.add(cb)
    return () => {
      this.subs.delete(cb)
    }
  }

  latest() {
    return this.last
  }

  private sample() {
    if (!this.connected) return // a dropped link simply goes silent; fusion sees it go stale
    const { noise, driftPerS, latencyMs, pattern, rateHz } = this.options
    const now = performance.now()
    const dt = 1 / rateHz
    const step = driftPerS * Math.sqrt(dt)
    this.drift.x += (Math.random() - 0.5) * 2 * step
    this.drift.y += (Math.random() - 0.5) * 2 * step

    let p = this.target
    if (pattern === 'orbit') {
      const s = (now - this.t0) / 1000
      p = { x: 0.5 + 0.3 * Math.sin(s * 0.7), y: 0.5 + 0.25 * Math.sin(s * 1.1) }
    }
    const x = p.x + this.drift.x + (Math.random() - 0.5) * 2 * noise
    const y = p.y + this.drift.y + (Math.random() - 0.5) * 2 * noise

    // Simulate a device clock + transport delay, then align it the way a real adapter must.
    const delay = latencyMs[0] + Math.random() * (latencyMs[1] - latencyMs[0])
    const deviceMs = now - this.deviceEpoch
    const tMs = this.clock.toLocal(deviceMs, now + delay)

    const obs: WearableObservation = {
      tMs,
      connected: true,
      sensorConfidence: 0.7,
      pointer: { x, y, frame: 'canvas' },
      pointerIsIntegrated: true,
      orientation: { yaw: (x - 0.5) * 60, pitch: (0.5 - y) * 40, roll: 0, units: 'deg' },
      gesture: this.pendingGesture ? { kind: this.pendingGesture, confidence: 0.9 } : undefined,
    }
    this.pendingGesture = null
    this.last = obs
    for (const s of this.subs) s(obs)
  }
}
