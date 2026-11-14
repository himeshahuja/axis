import { describe, expect, it, vi } from 'vitest'
vi.mock('../camera/handTracker', () => ({ HandTracker: class { status = 'off'; deviceKey = 'test' } }))
import { SpatialRuntime } from '../runtime'
import { computeHandFeatures } from '../camera/handGeometry'
import { makeHand, W, H } from './handFixtures'

describe('presenter input priority', () => {
  it('keeps a held mouse drag active even while a camera is tracked', () => {
    const rt = new SpatialRuntime([])
    vi.spyOn(rt.fusion, 'update').mockReturnValue({ x: .25, y: .35, tMs: 100, valid: true, confidence: 1, observationAgeMs: 0, source: 'camera' })
    rt.onMouseButton(true, .8, .8)
    rt.tick(performance.now() + 3000)
    expect(rt.pointer.source).toBe('mouse')
    rt.onMouseReleasedElsewhere()
    rt.tick(performance.now() + 3100)
    expect(rt.pointer.source).toBe('camera')
  })
  it('keeps a tracked camera in control when the physical mouse moves', () => {
    const rt = new SpatialRuntime([])
    vi.spyOn(rt.fusion, 'update').mockReturnValue({ x: .25, y: .35, tMs: 100, valid: true, confidence: 1, observationAgeMs: 0, source: 'camera' })
    rt.onMouseMove(.9, .9)
    rt.tick(performance.now())
    expect(rt.pointer.source).toBe('camera')
    expect(rt.pointer.x).toBe(.25)
  })
  it('still supports the mouse when no camera hand is tracked', () => {
    const rt = new SpatialRuntime([])
    rt.onMouseMove(.9, .9)
    rt.tick(performance.now())
    expect(rt.pointer.source).toBe('mouse')
  })
  it('does not substitute the mouse for camera feedback during calibration', () => {
    const rt = new SpatialRuntime([])
    rt.startCalibration('region')
    rt.onMouseMove(.9, .9)
    rt.tick(performance.now())
    expect(rt.pointer.source).toBe('none')
    expect(rt.calibrationPointer).toBeNull()
  })
})

describe('grasp and merged actions', () => {
  it('confirms Explain on opening the hand instead of treating it as a palm cancel', async () => {
    const rt = new SpatialRuntime([{ id: 'note', label: 'Demo', shape: 'card', color: '#fff', x: .4, y: .4, w: .2, h: .2, content: { kind: 'note', text: 'Authored demo content' } }])
    const base = performance.now()
    const context = { pointer: { tMs: base, x: .5, y: .5, valid: true, source: 'camera' as const, confidence: 1, observationAgeMs: 0 }, grabbedId: null, aspect: 16 / 9, features: computeHandFeatures(makeHand(), W, H), mirrored: true, graspMode: true }
    rt.radial.tick(base, context)
    rt.radial.forceOpen('note')
    rt.radial.tick(base + 400, context)
    rt.radial.onGesture({ kind: 'grasp_end', source: 'camera', tMs: base + 450, classificationConfidence: .9, sensorConfidence: .9 })
    rt.radial.tick(base + 700, context)
    expect(rt.radial.state.status).toBe('CONFIRMED')
    await Promise.resolve()
    expect(rt.radial.executor.explainCards.get('note')?.status).toBe('done')
  })
})
