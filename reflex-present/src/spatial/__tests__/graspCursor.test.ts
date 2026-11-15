import { describe, expect, it } from 'vitest'
import { GraspCursor } from '../graspCursor'

const canvas = { w: 1280, h: 720 }
const palm = { x: .5, y: .5 }
const wrist = { x: .5, y: .65 }
function settled() {
  const cursor = new GraspCursor()
  for (let t = 0; t <= 600; t += 30) cursor.update(palm, wrist, t, false, false, canvas)
  return cursor
}

describe('grasp cursor stabilization', () => {
  it('keeps the cursor on target when closing changes the estimated palm position', () => {
    const cursor = settled()
    let out = palm
    // A stationary wrist with a palm estimate shifted by the scrunching fingers.
    for (let t = 630; t <= 1200; t += 30) out = cursor.update({ x: .54, y: .47 }, wrist, t, t >= 750, t < 750, canvas)
    expect(Math.hypot((out.x - .5) * canvas.w, (out.y - .5) * canvas.h)).toBeLessThan(1)
  })

  it('keeps real wrist translation while the hand is closing', () => {
    const cursor = settled()
    let out = palm
    for (let i = 1; i <= 30; i++) {
      const moved = Math.min(i, 10) * .006
      out = cursor.update({ x: .54 + moved, y: .47 }, { x: .5 + moved, y: .65 }, 600 + i * 30, i >= 5, i < 5, canvas)
    }
    expect(out.x).toBeCloseTo(.56, 2)
    expect(out.y).toBeCloseTo(.5, 2)
  })

  it('allows intentional dragging and opening without a release jump', () => {
    const cursor = settled()
    let out = palm
    for (let i = 1; i <= 10; i++) out = cursor.update({ x: .54, y: .47 }, wrist, 600 + i * 30, i >= 5, i < 5, canvas)
    for (let i = 1; i <= 30; i++) {
      const moved = Math.min(i, 15) / 15 * .15
      out = cursor.update({ x: .54 + moved, y: .47 }, { x: .5 + moved, y: .65 }, 900 + i * 30, true, false, canvas)
    }
    expect(out.x).toBeCloseTo(.65, 2)
    const before = { ...out }
    for (let i = 1; i <= 15; i++) out = cursor.update({ x: .65, y: .5 }, { x: .65, y: .65 }, 1800 + i * 30, i < 5, i < 5, canvas)
    expect(Math.hypot((out.x - before.x) * canvas.w, (out.y - before.y) * canvas.h)).toBeLessThan(3)
  })

  it('rejects an isolated landmark spike and suppresses resting tremor', () => {
    const cursor = settled()
    let maxError = 0
    for (let i = 1; i <= 60; i++) {
      const noise = i === 15 ? .08 : Math.sin(i * 1.7) * .002
      const out = cursor.update({ x: .5 + noise, y: .5 - noise }, wrist, 600 + i * 30, false, false, canvas)
      maxError = Math.max(maxError, Math.hypot((out.x - .5) * canvas.w, (out.y - .5) * canvas.h))
    }
    expect(maxError).toBeLessThan(2)
  })

  it('resets old pose offsets after tracking loss or recalibration', () => {
    const cursor = settled()
    for (let i = 1; i <= 10; i++) cursor.update({ x: .54, y: .47 }, wrist, 600 + i * 30, i >= 5, i < 5, canvas)
    expect(cursor.update({ x: .7, y: .6 }, { x: .7, y: .7 }, 2000, false, false, canvas)).toEqual({ x: .7, y: .6 })
    cursor.reset()
    expect(cursor.update(palm, wrist, 2100, false, false, canvas)).toEqual(palm)
  })
})
