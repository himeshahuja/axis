import { describe, expect, it } from 'vitest'
import { SteadyPoint } from '../steadyPoint'

describe('hand range capture', () => {
  it('averages a continuous stable hold instead of a single pinch frame', () => {
    const hold = new SteadyPoint()
    let capture = null
    for (let t = 0; t <= 900; t += 30) capture = hold.update({ x: 0.4 + (t % 60 ? .002 : -.002), y: .3 }, t)
    expect(capture?.x).toBeCloseTo(.4, 2)
    expect(capture?.y).toBeCloseTo(.3)
    expect(hold.progress).toBe(0)
  })
  it('does not capture while moving', () => {
    const hold = new SteadyPoint()
    for (let t = 0; t < 3000; t += 30) expect(hold.update({ x: t / 10000, y: .4 }, t)).toBeNull()
  })
  it('requires a fresh hold after tracking loss or a frame gap', () => {
    const hold = new SteadyPoint()
    for (let t = 0; t < 800; t += 30) hold.update({ x: .4, y: .3 }, t)
    hold.update(null, 800)
    expect(hold.update({ x: .4, y: .3 }, 900)).toBeNull()
    expect(hold.update({ x: .4, y: .3 }, 1500)).toBeNull()
    expect(hold.progress).toBe(0)
  })
})
