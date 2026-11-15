import { describe, expect, it } from 'vitest'
import { PitchController, TRANSITION_MS } from '../pitchController'
import { objectsFor, QOQ_GROWTH, REVENUE, SCENES, SPOTLIGHT } from '../scenes'

const settled = (c: PitchController, t: number) => {
  c.tick(t + TRANSITION_MS + 1)
  return t + TRANSITION_MS + 1
}
const at = (id: string) => SCENES.findIndex((s) => s.id === id)

describe('pitch progression', () => {
  it('has seven scenes, about three and a half minutes in total', () => {
    expect(SCENES.map((s) => s.id)).toEqual(['problem', 'product', 'demo', 'compare', 'board', 'future', 'vision'])
    expect(SCENES.map((s) => s.number)).toEqual(['01', '02', '03', '04', '05', '06', '07'])
    const total = SCENES.reduce((a, s) => a + s.targetSeconds, 0)
    expect(total).toBeGreaterThanOrEqual(160)
    expect(total).toBeLessThanOrEqual(220)
  })

  it('a small move of the window does not advance; a real move does, then the scene follows', () => {
    const c = new PitchController(SCENES, 0)
    const objs = objectsFor(SCENES[0], [])
    expect(c.onDrop('p-window', { x: 0.5, y: 0.2 }, { x: 0.53, y: 0.2 }, objs, 16 / 9, 100)).toBe(false)
    expect(c.sceneIndex).toBe(0)
    expect(c.onDrop('p-window', { x: 0.5, y: 0.2 }, { x: 0.3, y: 0.3 }, objs, 16 / 9, 200)).toBe(true)
    expect(c.sceneIndex).toBe(0)
    c.tick(200 + 1299)
    expect(c.sceneIndex).toBe(0)
    c.tick(200 + 1300)
    expect(c.sceneIndex).toBe(1)
  })

  it('dropping an object that is not the trigger never advances', () => {
    const c = new PitchController(SCENES, 0)
    expect(c.onDrop('p-toolbar', { x: 0.5, y: 0.7 }, { x: 0.1, y: 0.1 }, objectsFor(SCENES[0], []), 16 / 9, 100)).toBe(false)
    c.tick(5000)
    expect(c.sceneIndex).toBe(0)
  })

  it('“next” completes each fallback beat before moving on', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(2, 0)
    let t = settled(c, 0)
    expect(c.next(t)).toBe(true) // spotlight the chart
    expect(c.sceneIndex).toBe(2)
    expect(c.done.has('spotlit')).toBe(true)
    // Explain has no fallback: next goes on to the next scene
    expect(c.next(t + 10)).toBe(true)
    expect(c.sceneIndex).toBe(3)
    t = settled(c, t + 10)
    c.goto(1, t)
    t = settled(c, t)
    for (let i = 0; i < 4; i++) c.next(t + i)
    expect(c.beatsDone).toBe(4)
    expect(c.sceneIndex).toBe(1)
  })

  it('ignores advances while a transition plays (no double skips)', () => {
    const c = new PitchController(SCENES, 0)
    c.nextScene(0)
    expect(c.nextScene(100)).toBe(false)
    expect(c.next(200)).toBe(false)
    expect(c.sceneIndex).toBe(1)
  })

  it('fills the pipeline slots in any order, then connects them', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(1, 0)
    const t = settled(c, 0)
    const objs = objectsFor(SCENES[1], [])
    const into = (id: string, slot: { x: number; y: number; w: number; h: number }) => objs.map((o) => (o.id === id ? { ...o, x: slot.x, y: slot.y } : o))
    const slots = SCENES[1].zones!
    // the wrong slot does nothing
    expect(c.onDrop('action', { x: 0.7, y: 0.6 }, slots[0], into('action', slots[0]), 16 / 9, t)).toBe(false)
    expect(c.onDrop('intent', { x: 0.7, y: 0.6 }, slots[1], into('intent', slots[1]), 16 / 9, t)).toBe(true)
    expect(c.onDrop('perception', { x: 0.7, y: 0.6 }, slots[0], into('perception', slots[0]), 16 / 9, t)).toBe(true)
    expect(c.done.has('converge')).toBe(false)
    expect(c.onDrop('action', { x: 0.7, y: 0.6 }, slots[2], into('action', slots[2]), 16 / 9, t)).toBe(true)
    c.tick(t + 499)
    expect(c.done.has('converge')).toBe(false)
    c.tick(t + 500)
    expect(c.done.has('converge')).toBe(true)
    // once placed, a piece snaps to its slot, upright
    const placed = objectsFor(SCENES[1], c.done).find((o) => o.id === 'intent')!
    expect(placed.tilt).toBe(0)
  })

  it('any card goes into the spotlight, only when dropped inside it', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(2, 0)
    const t = settled(c, 0)
    const objs = objectsFor(SCENES[2], [])
    expect(c.onDrop('notes', { x: 0.61, y: 0.54 }, { x: 0.6, y: 0.54 }, objs, 16 / 9, t)).toBe(false)
    const inside = objs.map((o) => (o.id === 'notes' ? { ...o, x: SPOTLIGHT.x + 0.1, y: SPOTLIGHT.y + 0.1 } : o))
    expect(c.onDrop('notes', { x: 0.61, y: 0.54 }, { x: 0.2, y: 0.4 }, inside, 16 / 9, t)).toBe(true)
    expect(SPOTLIGHT.snap).toBe(true)
  })

  it('counts Explain and Remember in the live scene in any order', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(2, 0)
    const t = settled(c, 0)
    expect(c.onAction('remember', t)).toBe(true)
    expect(c.onAction('remember', t)).toBe(false)
    expect(c.onAction('explain', t)).toBe(true)
    expect(c.pendingBeat?.id).toBe('spotlit')
  })

  it('a spoken request in 04 reveals the Axis card as its reply', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(3, 0)
    const t = settled(c, 0)
    expect(objectsFor(SCENES[3], c.done).map((o) => o.id)).toEqual(['c-conventional'])
    expect(c.takesVoiceFor('c-conventional')).toBe(true)
    expect(c.onVoiceReply('c-conventional', '   ', t)).toBe(false)
    expect(c.onVoiceReply('c-conventional', 'What is the difference between this and conventional interfaces?', t)).toBe(true)
    expect(objectsFor(SCENES[3], c.done).map((o) => o.id)).toEqual(['c-conventional', 'c-axis'])
    expect(c.next(t + 1)).toBe(true)
    expect(c.sceneIndex).toBe(4)
  })

  it('whiteboard: each capability lights up when used, in any order; the clicker goes straight on', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(at('board'), 0)
    const t = settled(c, 0)
    expect(c.onArrow(t)).toBe(true)
    expect(c.onAction('remember', t)).toBe(true)
    expect(c.onDrop('b-teach', { x: 0.3, y: 0.4 }, { x: 0.32, y: 0.45 }, objectsFor(SCENES[at('board')], []), 16 / 9, t)).toBe(true)
    expect(c.onAction('voice', t)).toBe(true)
    expect([...c.done].sort()).toEqual(['b-arrow', 'b-grab', 'b-remember', 'b-voice'])
    expect(c.onArrow(t)).toBe(false) // already lit
    expect(c.takesVoiceFor('b-teach')).toBe(false) // Voice here is the normal Voice: words go on the board
    expect(c.next(t + 1)).toBe(true) // Explain not shown yet: no fallback, so the clicker moves on
    expect(c.scene.id).toBe('future')
  })

  it('use cases: one request flips all three cards at once', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(at('future'), 0)
    const t = settled(c, 0)
    expect(SCENES[at('future')].objects.every((o) => o.transformedBy === 't-all')).toBe(true)
    expect(c.onVoiceReply('f-team', 'how would a team use this?', t)).toBe(true)
    expect(c.done.has('t-all')).toBe(true)
    expect(c.onVoiceReply('f-now', 'and today?', t)).toBe(false)
    // in a scene without voice beats, speech is just a normal Voice request
    c.goto(2, t + 1000)
    expect(c.takesVoiceFor('revenue')).toBe(false)
  })

  it('after the pieces line up, the closing screen follows on its own', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(at('vision'), 0)
    const t = settled(c, 0)
    c.onDrop('v-note', { x: 0, y: 0 }, { x: 0.01, y: 0 }, [], 16 / 9, t)
    expect(c.pendingBeat?.id).toBe('statement')
    c.tick(t + 2599)
    expect(c.pendingBeat?.id).toBe('statement')
    c.tick(t + 2600)
    expect(c.pendingBeat).toBeNull()
  })

  it('every scene change re-lays out the canvas', () => {
    const c = new PitchController(SCENES, 0)
    const changes: unknown[] = []
    c.onChange((x) => changes.push(x))
    c.goto(2, 0)
    const v = c.layoutVersion
    c.goto(3, TRANSITION_MS + 1)
    expect(c.layoutVersion).toBe(v + 1)
    expect(changes.at(-1)).toMatchObject({ kind: 'scene', keepCanvas: false })
  })

  it('previous and reset go back cleanly', () => {
    const c = new PitchController(SCENES, 0)
    c.goto(2, 0)
    c.previous(TRANSITION_MS + 1)
    expect(c.sceneIndex).toBe(1)
    expect(c.beatsDone).toBe(0)
    c.reset(TRANSITION_MS + 5)
    expect(c.sceneIndex).toBe(0)
    expect(c.startedAt).toBeNull()
  })
})

describe('scene data', () => {
  it('derives the growth metric from the revenue data', () => {
    expect(QOQ_GROWTH).toBeCloseTo((REVENUE[3].value - REVENUE[2].value) / REVENUE[2].value, 10)
    const growth = SCENES[2].objects.find((o) => o.id === 'growth')!
    expect(growth.content).toMatchObject({ kind: 'metric', value: QOQ_GROWTH })
  })

  it('keeps every object inside the stage, before and after its beats', () => {
    for (const s of SCENES) {
      for (const done of [[], s.beats.map((b) => b.id)]) {
        for (const o of objectsFor(s, done)) {
          expect(o.x).toBeGreaterThanOrEqual(0)
          expect(o.y).toBeGreaterThanOrEqual(0)
          expect(o.x + o.w).toBeLessThanOrEqual(1)
          expect(o.y + o.h).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
