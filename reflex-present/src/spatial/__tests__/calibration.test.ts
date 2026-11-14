import { describe, expect, it } from 'vitest'
import { CALIBRATION_TARGETS, cameraToCanvas, defaultProfile, fitAffine, orient, recenter } from '../calibration'
import type { CalibrationSample } from '../types'

describe('region mapping', () => {
  it('doubles sensitivity when the calibrated movement range halves', () => {
    const wide = { ...defaultProfile(), mirrorX: false }
    const narrow = { ...wide, region: { x0: .375, x1: .625, y0: .3375, y1: .6125 } }
    const delta = (profile: typeof wide) => cameraToCanvas({ x: .55, y: .5 }, profile).x - cameraToCanvas({ x: .5, y: .5 }, profile).x
    expect(delta(narrow)).toBeCloseTo(delta(wide) * 2)
  })
  it('maps the active region corners onto the canvas corners', () => {
    const p = { ...defaultProfile(), mirrorX: false }
    expect(cameraToCanvas({ x: 0.25, y: 0.2 }, p)).toEqual({ x: 0, y: 0 })
    const c = cameraToCanvas({ x: 0.75, y: 0.75 }, p)
    expect(c.x).toBeCloseTo(1)
    expect(c.y).toBeCloseTo(1)
  })

  it('mirroring flips horizontal direction only', () => {
    const mirrored = defaultProfile()
    const plain = { ...mirrored, mirrorX: false }
    const raw = { x: 0.3, y: 0.4 }
    expect(cameraToCanvas(raw, mirrored).x).toBeCloseTo(1 - cameraToCanvas(raw, plain).x)
    expect(cameraToCanvas(raw, mirrored).y).toBeCloseTo(cameraToCanvas(raw, plain).y)
  })

  it('flipY inverts vertical direction', () => {
    const p = { ...defaultProfile(), flipY: true }
    expect(orient({ x: 0.2, y: 0.1 }, p)).toEqual({ x: 0.8, y: 0.9 })
  })
})

describe('multi-point affine calibration', () => {
  const truth = [1.8, 0.1, -0.4, -0.05, 2.1, -0.3] as const
  const inverseSample = (target: { x: number; y: number }, noise = 0): CalibrationSample => {
    // invert the 2x2 part to find which camera point maps to the target
    const [a, b, c, d, e, f] = truth
    const det = a * e - b * d
    const tx = target.x - c
    const ty = target.y - f
    return {
      tMs: 0,
      target: { ...target, frame: 'canvas' },
      camera: { x: (e * tx - b * ty) / det + noise, y: (-d * tx + a * ty) / det - noise, frame: 'camera' },
    }
  }

  it('recovers a known transform exactly', () => {
    const fit = fitAffine(CALIBRATION_TARGETS.map((t) => inverseSample(t)))!
    fit.affine!.forEach((v, i) => expect(v).toBeCloseTo(truth[i], 6))
    expect(fit.rms).toBeLessThan(1e-9)
  })

  it('reports a non-zero residual for noisy samples', () => {
    const noisy = CALIBRATION_TARGETS.map((t, i) => inverseSample(t, i % 2 ? 0.004 : -0.004))
    const fit = fitAffine(noisy)!
    expect(fit.rms).toBeGreaterThan(0)
    expect(fit.rms).toBeLessThan(0.03)
  })

  it('rejects too few or collinear samples', () => {
    expect(fitAffine(CALIBRATION_TARGETS.slice(0, 2).map((t) => inverseSample(t)))).toBeNull()
    const collinear: CalibrationSample[] = [0.1, 0.5, 0.9].map((v) => ({
      tMs: 0,
      target: { x: v, y: v, frame: 'canvas' },
      camera: { x: v, y: v, frame: 'camera' },
    }))
    expect(fitAffine(collinear)).toBeNull()
  })
})

describe('recentering', () => {
  it('puts the current hand position at the canvas centre', () => {
    const raw = { x: 0.62, y: 0.33 }
    const c = cameraToCanvas(raw, recenter(defaultProfile(), raw))
    expect(c.x).toBeCloseTo(0.5)
    expect(c.y).toBeCloseTo(0.5)
  })
})
