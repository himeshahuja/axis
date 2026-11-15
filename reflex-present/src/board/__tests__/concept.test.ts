// The Vexo Board engine on simulated sessions: the numbers /board shows must hold.

import { describe, expect, it } from 'vitest'
import { play, score } from '../engine/concept/replay.js'
import { conceptSession } from '../engine/concept/simulate.js'

describe('Vexo Board engine', () => {
  it('tracks the marker tip to millimetres on a 1.2 m board, with blocked pucks and talking', () => {
    const s = conceptSession('reach')
    const vb = play(s)
    const r = score(s, vb)
    expect(vb.ready).toBe(true)
    expect(r.tip[0]).toBeLessThan(0.005)
    expect(r.tip[1]).toBeLessThan(0.015)
    expect(r.precision).toBeGreaterThan(0.97)
    expect(r.recall).toBeGreaterThan(0.95)
    expect(r.pinches).toEqual({ found: 2, of: 2, extra: 0 })
    const ink = vb.ink()
    expect(ink.strokes.length).toBe(r.strokes)
  })

  it('keeps under 1 cm at the 95th percentile when walking a 2.4 m board', () => {
    const s = conceptSession('walk')
    const r = score(s, play(s))
    expect(r.tip[0]).toBeLessThan(0.008)
    expect(r.tip[1]).toBeLessThan(0.02)
  })

  it('still hears the writing in a loud room only with EMG', () => {
    const s = conceptSession('reach', { noisy: true })
    expect(score(s, play(s, { emg: false })).recall).toBeLessThan(0.2)
    const s2 = conceptSession('reach', { noisy: true })
    expect(score(s2, play(s2)).recall).toBeGreaterThan(0.9)
  })
})
