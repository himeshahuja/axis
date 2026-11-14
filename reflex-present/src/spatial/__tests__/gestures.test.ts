import { describe, expect, it } from 'vitest'
import { GestureDetector } from '../camera/gestureDetector'
import { computeHandFeatures } from '../camera/handGeometry'
import { H, makeHand, mirror, W } from './handFixtures'

const feat = (spec: Parameters<typeof makeHand>[0]) => computeHandFeatures(makeHand(spec), W, H)

function run(det: GestureDetector, ratios: number[], startT = 0) {
  return ratios.flatMap((r, i) => det.update(feat({ pinchRatio: r }), startT + i * 33, 0.9).map((e) => e.kind))
}

describe('hand geometry', () => {
  it('measures the pinch ratio it was built with', () => {
    expect(feat({ pinchRatio: 0.2 })!.pinchRatio).toBeCloseTo(0.2, 5)
  })

  it('classifies pointing vs open palm vs fist', () => {
    const point = feat({ middle: 'curled', ring: 'curled', pinky: 'curled', thumb: 'curled' })!
    expect(point.pointing).toBe(true)
    expect(point.openPalm).toBe(false)

    const palm = feat({})!
    expect(palm.openPalm).toBe(true)
    expect(palm.pointing).toBe(false)

    const fist = feat({ index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled', thumb: 'curled' })!
    expect(fist.pointing).toBe(false)
    expect(fist.openPalm).toBe(false)
  })

  it('is invariant to mirroring the camera image', () => {
    const a = computeHandFeatures(makeHand({ pinchRatio: 0.3 }), W, H)!
    const b = computeHandFeatures(mirror(makeHand({ pinchRatio: 0.3 })), W, H)!
    expect(b.pinchRatio).toBeCloseTo(a.pinchRatio, 6)
    expect(b.fingers).toEqual(a.fingers)
    expect(b.palm.x).toBeCloseTo(1 - a.palm.x, 6)
  })

  it('flags key landmarks leaving the image', () => {
    expect(feat({ shift: { x: 0, y: 0.25 } })!.keyInFrame).toBe(false)
    expect(feat({})!.keyInFrame).toBe(true)
  })
})

describe('pinch hysteresis and debounce', () => {
  it('engages only after minFrames below pinchOn', () => {
    const det = new GestureDetector()
    expect(run(det, [0.2])).toEqual([])
    expect(run(det, [0.2])).toEqual(['pinch_start'])
    expect(det.pinched).toBe(true)
  })

  it('ignores a single-frame dip (debounce)', () => {
    const det = new GestureDetector()
    expect(run(det, [0.9, 0.2, 0.9, 0.9])).toEqual([])
  })

  it('holds the pinch inside the hysteresis band', () => {
    const det = new GestureDetector()
    run(det, [0.2, 0.2])
    // 0.45 is above pinchOn (0.35) but below pinchOff (0.55): must stay pinched
    expect(run(det, [0.45, 0.45, 0.45, 0.45, 0.5])).toEqual([])
    expect(det.pinched).toBe(true)
    expect(run(det, [0.7, 0.7])).toEqual(['pinch_end'])
  })

  it('never releases on tracking loss', () => {
    const det = new GestureDetector()
    run(det, [0.2, 0.2])
    for (let i = 0; i < 30; i++) expect(det.update(null, 1000 + i * 33, 0)).toEqual([])
    expect(det.pinched).toBe(true)
  })

  it('emits no transitions while key landmarks are out of frame', () => {
    const det = new GestureDetector()
    const out = [0, 1, 2, 3].flatMap((i) => det.update(feat({ pinchRatio: 0.1, shift: { x: 0, y: 0.25 } }), i * 33, 0.9))
    expect(out).toEqual([])
  })

  it('separates sensor confidence from classification confidence', () => {
    const det = new GestureDetector()
    det.update(feat({ pinchRatio: 0.05 }), 0, 0.42)
    const [ev] = det.update(feat({ pinchRatio: 0.05 }), 33, 0.42)
    expect(ev.sensorConfidence).toBe(0.42)
    expect(ev.classificationConfidence).toBeGreaterThan(0.5)
  })
})

describe('pointing and open palm', () => {
  it('emits point_start after stable frames', () => {
    const det = new GestureDetector()
    const spec = { middle: 'curled', ring: 'curled', pinky: 'curled', thumb: 'curled' } as const
    const kinds = [0, 1, 2, 3].flatMap((i) => det.update(feat(spec), i * 33, 0.9).map((e) => e.kind))
    expect(kinds).toEqual(['point_start'])
  })

  it('fires open_palm once after the hold time, and not while pinched', () => {
    const det = new GestureDetector()
    const kinds: string[] = []
    for (let t = 0; t <= 1000; t += 33) kinds.push(...det.update(feat({}), t, 0.9).map((e) => e.kind))
    expect(kinds.filter((k) => k === 'open_palm')).toHaveLength(1)

    const pinched = new GestureDetector()
    run(pinched, [0.2, 0.2])
    pinched.pinched = true
    // an open palm has pinchRatio > pinchOff, so it releases first; no cancel while still engaged
    const first = pinched.update(feat({}), 2000, 0.9).map((e) => e.kind)
    expect(first).not.toContain('open_palm')
  })
})
