import { describe, expect, it } from 'vitest'
import { GestureDetector } from '../camera/gestureDetector'
import { computeHandFeatures } from '../camera/handGeometry'
import { makeHand, W, H } from './handFixtures'

const fist = computeHandFeatures(makeHand({ index: 'curled', middle: 'curled', ring: 'curled', pinky: 'curled' }), W, H)!
const palm = computeHandFeatures(makeHand(), W, H)!
const detector = () => { const d = new GestureDetector(); d.mode = 'grasp'; return d }
const hold = (d: GestureDetector, pose: typeof fist, start = 0, confidence = .9) => [0, 33, 66, 99, 132, 165].flatMap((t) => d.update(pose, start + t, confidence).map((g) => g.kind))

describe('full hand grasp', () => {
  it('grabs once after a stable fist and releases once when reopened', () => {
    const d = detector()
    expect(hold(d, fist)).toEqual(['grasp_start'])
    expect(hold(d, fist, 200)).toEqual([])
    expect(hold(d, palm, 400)).toEqual(['grasp_end'])
    expect(d.grasped).toBe(false)
  })
  it('does not interpret pinching or pointing as a full grasp', () => {
    const d = detector()
    const pinch = computeHandFeatures(makeHand({ pinchRatio: .1 }), W, H)!
    const pointing = computeHandFeatures(makeHand({ middle: 'curled', ring: 'curled', pinky: 'curled' }), W, H)!
    expect(hold(d, pinch)).toEqual([])
    expect(hold(d, pointing, 200)).toEqual([])
  })
  it('holds through ambiguous poses and tracking loss rather than dropping', () => {
    const d = detector()
    hold(d, fist)
    expect(d.update(null, 200, 0)).toEqual([])
    const ambiguous = { ...palm, fingers: { ...fist.fingers, index: 'ambiguous' as const } }
    expect(hold(d, ambiguous, 300)).toEqual([])
    expect(d.grasped).toBe(true)
    expect(hold(d, palm, 600)).toEqual(['grasp_end'])
  })
  it('rejects low confidence and isolated fist frames', () => {
    const d = detector()
    expect(hold(d, fist, 0, .3)).toEqual([])
    expect(d.update(fist, 300, .9)).toEqual([])
    expect(d.update(palm, 333, .9)).toEqual([])
    expect(d.update(fist, 500, .9)).toEqual([])
    expect(d.update(fist, 1000, .9)).toEqual([])
  })
})
