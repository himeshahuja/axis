import { describe, expect, it } from 'vitest'
import { InteractionEngine } from '../interaction'
import type { PointerEstimate, SpatialObject } from '../types'

const objects: SpatialObject[] = [
  { id: 'a', label: 'A', color: '#f00', shape: 'card', x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
  { id: 'b', label: 'B', color: '#0f0', shape: 'card', x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
]

const ptr = (tMs: number, x: number, y: number, valid = true): PointerEstimate => ({
  tMs,
  x,
  y,
  valid,
  source: 'camera',
  confidence: 0.9,
  observationAgeMs: 10,
})

const setup = () => new InteractionEngine(objects)
const pos = (e: InteractionEngine, id: string) => {
  const o = e.objects.find((o) => o.id === id)!
  return { x: o.x, y: o.y }
}

describe('hit testing', () => {
  it('hits inside, magnetises nearby, misses far away', () => {
    const e = setup()
    expect(e.hitTest({ x: 0.2, y: 0.2 })?.id).toBe('a')
    expect(e.hitTest({ x: 0.2, y: 0.33 })?.id).toBe('a') // 0.03 below the edge, inside the magnet halo
    expect(e.hitTest({ x: 0.45, y: 0.45 })).toBeNull()
  })

  it('corrects horizontal distances for display aspect', () => {
    const e = setup()
    const p = { x: 0.33, y: 0.2 } // 0.03 canvas-widths right of A
    e.aspect = 16 / 9 // 0.053 height units: outside the 0.05 halo
    expect(e.hitTest(p)).toBeNull()
    e.aspect = 4 / 3 // 0.04 height units: inside
    expect(e.hitTest(p)?.id).toBe('a')
  })
})

describe('grab / drag / release', () => {
  it('runs the full state sequence and moves the object', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    expect(e.state).toBe('HOVER')
    e.handle({ type: 'grab', tMs: 10, source: 'camera' })
    expect(e.state).toBe('GRABBED')
    e.handle({ type: 'pointer', pointer: ptr(20, 0.3, 0.25) })
    expect(e.state).toBe('DRAGGING')
    e.handle({ type: 'release', tMs: 30, source: 'camera' })
    expect(e.state).toBe('RELEASED')
    expect(pos(e, 'a').x).toBeCloseTo(0.2)
    expect(pos(e, 'a').y).toBeCloseTo(0.15)
  })

  it('ignores a grab with nothing under the pointer', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.45, 0.45) })
    e.handle({ type: 'grab', tMs: 10, source: 'camera' })
    expect(e.state).toBe('IDLE')
    expect(e.grabbedId).toBeNull()
  })

  it('keeps objects inside the canvas', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'mouse' })
    e.handle({ type: 'pointer', pointer: ptr(2, -5, 9) })
    expect(pos(e, 'a')).toEqual({ x: 0, y: 0.8 })
  })

  it('undo restores the previous position', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.5, 0.2) })
    e.handle({ type: 'release', tMs: 3, source: 'camera' })
    e.handle({ type: 'undo', tMs: 4 })
    expect(pos(e, 'a')).toEqual({ x: 0.1, y: 0.1 })
  })
})

describe('safety', () => {
  it('cancel restores the grabbed object', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.5, 0.5) })
    e.handle({ type: 'cancel', tMs: 3, source: 'camera' })
    expect(e.state).toBe('CANCELLED')
    expect(pos(e, 'a')).toEqual({ x: 0.1, y: 0.1 })
    expect(e.undoStack).toHaveLength(0)
  })

  it('freezes, rather than drops, a dragged object when tracking is lost', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.3, 0.2) })
    const frozen = pos(e, 'a')
    e.handle({ type: 'pointer', pointer: ptr(100, 0.9, 0.9, false) })
    expect(e.state).toBe('TRACKING_LOST')
    expect(e.grabbedId).toBe('a')
    expect(pos(e, 'a')).toEqual(frozen)

    // hand reappears somewhere else: object must not leap there
    e.handle({ type: 'pointer', pointer: ptr(500, 0.8, 0.7) })
    expect(e.state).toBe('DRAGGING')
    expect(pos(e, 'a')).toEqual(frozen)
    e.handle({ type: 'pointer', pointer: ptr(520, 0.85, 0.7) })
    expect(pos(e, 'a').x).toBeCloseTo(frozen.x + 0.05)
  })

  it('cancels a frozen grab (restoring the object) after the loss timeout', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.4, 0.2) })
    e.handle({ type: 'pointer', pointer: ptr(10, 0, 0, false) })
    e.tick(3000)
    expect(e.state).toBe('TRACKING_LOST')
    e.tick(4100)
    expect(e.state).toBe('CANCELLED')
    expect(pos(e, 'a')).toEqual({ x: 0.1, y: 0.1 })
  })
})

describe('trash', () => {
  const trash = { x: 0.85, y: 0.8, w: 0.1, h: 0.15 }
  const dragAToTrash = (e: InteractionEngine) => {
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.9, 0.88) })
  }

  it('deletes an object let go over the trash, and undo brings it back where it was', () => {
    const e = setup()
    e.trash = trash
    const trashed: string[] = []
    e.onTrashed = (o) => trashed.push(o.id)
    dragAToTrash(e)
    expect(e.overTrash).toBe(true)
    e.handle({ type: 'release', tMs: 3, source: 'camera' })
    expect(e.objects.map((o) => o.id)).toEqual(['b'])
    expect(trashed).toEqual(['a'])
    expect(e.grabbedId).toBeNull()
    expect(e.hoverId).toBeNull()

    e.handle({ type: 'undo', tMs: 4 })
    expect(pos(e, 'a')).toEqual({ x: 0.1, y: 0.1 })
  })

  it('keeps objects dropped outside the trash, and does nothing without one', () => {
    const e = setup()
    e.trash = trash
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.handle({ type: 'pointer', pointer: ptr(2, 0.5, 0.5) })
    expect(e.overTrash).toBe(false)
    e.handle({ type: 'release', tMs: 3, source: 'camera' })
    expect(e.objects).toHaveLength(2)

    const plain = setup()
    dragAToTrash(plain)
    plain.handle({ type: 'release', tMs: 3, source: 'camera' })
    expect(plain.objects).toHaveLength(2)
  })

  it('adds objects on top', () => {
    const e = setup()
    e.add({ id: 'note', label: 'Hello', color: '#000', shape: 'card', x: 0.15, y: 0.15, w: 0.1, h: 0.1 })
    expect(e.objects.at(-1)?.id).toBe('note')
    expect(e.hitTest({ x: 0.2, y: 0.2 })?.id).toBe('note')
  })

  it('removes objects, but not one that is being held', () => {
    const e = setup()
    e.handle({ type: 'pointer', pointer: ptr(0, 0.2, 0.2) })
    expect(e.hoverId).toBe('a')
    e.remove('b')
    expect(e.objects.map((o) => o.id)).toEqual(['a'])
    e.handle({ type: 'grab', tMs: 1, source: 'camera' })
    e.remove('a')
    expect(e.objects.map((o) => o.id)).toEqual(['a'])
    e.handle({ type: 'release', tMs: 2, source: 'camera' })
    e.remove('a')
    expect(e.objects).toHaveLength(0)
    expect(e.hoverId).toBeNull()
  })
})
