import { describe, expect, it } from 'vitest'
import { SensorFusion, type CalibratedCameraPointer } from '../fusion'
import type { WearableObservation } from '../types'

// minCutoff very high ≈ no smoothing, so tests see the fusion policy itself.
const noSmoothing = { smoothing: { minCutoff: 1e6, beta: 0 } }

const cam = (tMs: number, x: number, y: number, confidence = 0.9): CalibratedCameraPointer => ({ tMs, x, y, trackingValid: true, confidence })
const wear = (tMs: number, x: number, y: number, extra: Partial<WearableObservation> = {}): WearableObservation => ({
  tMs,
  connected: true,
  sensorConfidence: 0.8,
  pointer: { x, y, frame: 'canvas' },
  ...extra,
})

describe('staleness and fallback', () => {
  it('camera-only mode ignores the wearable entirely', () => {
    const f = new SensorFusion('CAMERA_FALLBACK', noSmoothing)
    const e = f.update(100, cam(90, 0.2, 0.3), wear(95, 0.9, 0.9))
    expect(e.source).toBe('camera')
    expect(e.x).toBeCloseTo(0.2)
  })

  it('rejects stale camera observations', () => {
    const f = new SensorFusion('CAMERA_FALLBACK', noSmoothing)
    const e = f.update(1000, cam(500, 0.2, 0.3), null)
    expect(e.valid).toBe(false)
    expect(f.diagnostics.cameraStatus).toBe('stale')
  })

  it('never fuses an uncalibrated (device-frame) wearable pointer', () => {
    const f = new SensorFusion('FUSED', noSmoothing)
    const e = f.update(100, cam(95, 0.2, 0.2), wear(95, 0.9, 0.9, { pointer: { x: 0.9, y: 0.9, frame: 'device' } }))
    expect(e.source).toBe('camera')
    expect(f.diagnostics.wearableStatus).toBe('uncalibrated')
  })

  it('falls back to the camera when the wearable disconnects, without a jump', () => {
    const f = new SensorFusion('WEARABLE_PRIMARY', noSmoothing)
    let t = 0
    let last = f.update(t, cam(t, 0.3, 0.5), wear(t, 0.7, 0.5))
    for (; t <= 300; t += 16) last = f.update(t, cam(t, 0.3, 0.5), wear(t, 0.7, 0.5))
    expect(last.source).toBe('wearable')

    t += 16
    const switched = f.update(t, cam(t, 0.3, 0.5), wear(t, 0.7, 0.5, { connected: false }))
    expect(switched.source).toBe('camera')
    // first frame after the switch stays where the cursor was…
    expect(Math.abs(switched.x - last.x)).toBeLessThan(0.01)
    // …then converges to the camera position within ~handoff time
    for (let i = 0; i < 30; i++) {
      t += 16
      last = f.update(t, cam(t, 0.3, 0.5), wear(t, 0.7, 0.5, { connected: false }))
    }
    expect(last.x).toBeCloseTo(0.3, 2)
  })

  it('max per-frame step during a source switch stays small', () => {
    const f = new SensorFusion('WEARABLE_PRIMARY', noSmoothing)
    let prev = f.update(0, cam(0, 0.1, 0.5), wear(0, 0.9, 0.5))
    let maxStep = 0
    for (let t = 16; t < 800; t += 16) {
      const w = t < 300 ? wear(t, 0.9, 0.5) : null
      const e = f.update(t, cam(t, 0.1, 0.5), w)
      if (t > 16) maxStep = Math.max(maxStep, Math.abs(e.x - prev.x))
      prev = e
    }
    // a raw switch would be a 0.8 jump; the blend spreads it over many frames
    expect(maxStep).toBeLessThan(0.2)
  })
})

describe('fusion policy', () => {
  it('does not add render-rate drift or double filtering to a stabilized camera sample', () => {
    const f = new SensorFusion()
    f.update(0, { ...cam(0, .5, .5), smoothed: true }, null)
    const sample = { ...cam(30, .55, .52), smoothed: true }
    expect(f.update(30, sample, null).x).toBe(.55)
    expect(f.update(46, sample, null).x).toBe(.55)
    expect(f.update(62, sample, null).x).toBe(.55)
  })
  it('weights sources by sensor confidence in FUSED mode', () => {
    const f = new SensorFusion('FUSED', noSmoothing)
    const e = f.update(10, cam(10, 0.0, 0.0, 0.75), wear(10, 1.0, 1.0, { sensorConfidence: 0.25 }))
    expect(e.source).toBe('fused')
    expect(e.x).toBeCloseTo(0.25)
    expect(f.diagnostics.weights.camera).toBeCloseTo(0.75)
  })

  it('pulls a drifting integrated wearable pointer back toward camera evidence', () => {
    const f = new SensorFusion('WEARABLE_PRIMARY', noSmoothing)
    let e = f.update(0, cam(0, 0.5, 0.5), wear(0, 0.6, 0.5, { pointerIsIntegrated: true }))
    for (let t = 16; t < 5000; t += 16) e = f.update(t, cam(t, 0.5, 0.5), wear(t, 0.6, 0.5, { pointerIsIntegrated: true }))
    expect(e.source).toBe('wearable')
    expect(e.x).toBeCloseTo(0.5, 2)
    expect(f.diagnostics.wearableBias.x).toBeCloseTo(-0.1, 2)
  })
})
