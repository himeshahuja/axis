import { describe, expect, it } from 'vitest'
import { askAction, cleanAnswer, describeObject, localAnswer, parseAskAction } from '../radial/actions/explain'
import { LocalMemoryStore } from '../radial/actions/memory'
import { previewVoiceCommand } from '../radial/actions/voiceCommand'
import { RadialActionExecutor } from '../radial/RadialActionExecutor'
import { RadialMenuController, type RadialContext, type RadialOutput } from '../radial/RadialMenuController'
import type { RotationSourceKind } from '../radial/types'
import type { SpatialObject } from '../types'

const ctx = (tMs: number, over: Partial<RadialContext> = {}): RadialContext => ({
  tMs,
  aspect: 16 / 9,
  pointer: { x: 0.3, y: 0.3, valid: true },
  grabbedId: 'chart',
  rotation: { angle: 0, source: 'simulator' },
  ...over,
})

const rot = (angle: number, source: RotationSourceKind = 'simulator') => ({ rotation: { angle, source } })

/** Pinch held still from t=0 until the menu opens. */
function openMenu(c = new RadialMenuController({}, { smoothingMs: 0 })) {
  for (let t = 0; t <= 600; t += 16) c.update(ctx(t))
  c.update(ctx(616))
  return c
}

const confirmed = (outs: (RadialOutput | null)[]) => outs.filter((o): o is Extract<RadialOutput, { kind: 'confirmed' }> => o?.kind === 'confirmed')

describe('hold to open', () => {
  it('opens only after the hold duration', () => {
    const c = new RadialMenuController()
    const kinds: string[] = []
    for (let t = 0; t < 600; t += 16) c.update(ctx(t)).forEach((o) => kinds.push(o.kind))
    expect(kinds).toEqual([])
    expect(c.state.status).toBe('HOLDING')
    expect(c.state.holdProgress).toBeGreaterThan(0.9)
    expect(c.update(ctx(600)).map((o) => o.kind)).toEqual(['opened'])
    expect(c.state.objectId).toBe('chart')
  })

  it('a pinch that moves is a drag, and never opens the menu', () => {
    const c = new RadialMenuController()
    c.update(ctx(0))
    c.update(ctx(100, { pointer: { x: 0.35, y: 0.3, valid: true } }))
    for (let t = 116; t <= 1500; t += 16) expect(c.update(ctx(t, { pointer: { x: 0.35, y: 0.3, valid: true } }))).toEqual([])
    expect(c.isOpen).toBe(false)
  })

  it('releasing before the hold completes leaves normal selection alone', () => {
    const c = new RadialMenuController()
    c.update(ctx(0))
    c.update(ctx(300))
    c.update(ctx(316, { grabbedId: null }))
    expect(c.state.status).toBe('IDLE')
  })

  it('does not open while tracking is lost during the hold', () => {
    const c = new RadialMenuController()
    c.update(ctx(0))
    for (let t = 16; t <= 800; t += 16) c.update(ctx(t, { pointer: { x: 0.3, y: 0.3, valid: false } }))
    expect(c.isOpen).toBe(false)
  })
})

describe('menu selection and confirmation', () => {
  it('rotation highlights; a mouse release confirms the highlighted action once', () => {
    const c = openMenu()
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, rot(35)))
    expect(c.state.activeAction).toBe('remember')
    const first = c.release(900, false)
    const again = c.release(910, false)
    expect(confirmed([first])[0].event).toMatchObject({ action: 'remember', objectId: 'chart' })
    expect(again).toBeNull()
  })

  it('binds to the object frozen at open, whatever the pointer passes over after', () => {
    const c = openMenu()
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, { grabbedId: 'other', pointer: { x: 0.36, y: 0.34, valid: true } }))
    expect(confirmed([c.release(900, false)])[0].event.objectId).toBe('chart')
  })

  it('moving the hand off the menu and letting go cancels; moving back disarms it', () => {
    const c = openMenu()
    c.update(ctx(632, { pointer: { x: 0.3, y: 0.58, valid: true } }))
    expect(c.state.cancelArmed).toBe(true)
    c.update(ctx(648, { pointer: { x: 0.31, y: 0.33, valid: true } }))
    expect(c.state.cancelArmed).toBe(false)
    c.update(ctx(664, { pointer: { x: 0.3, y: 0.58, valid: true } }))
    expect(c.release(700, false)).toMatchObject({ kind: 'cancelled', reason: 'released off the menu' })
    expect(confirmed(c.update(ctx(800)))).toHaveLength(0)
  })

  it('a camera release off the menu cancels too, without waiting for the open-palm window', () => {
    const c = openMenu()
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, { pointer: { x: 0.62, y: 0.3, valid: true } }))
    expect(c.release(900, true)?.kind).toBe('cancelled')
    expect(confirmed(c.update(ctx(1200)))).toHaveLength(0)
  })

  it('a force-opened menu (key) has no "off the menu" to move to', () => {
    const c = new RadialMenuController({}, { smoothingMs: 0 })
    c.forceOpen('chart', ctx(0))
    c.update(ctx(16, { pointer: { x: 0.9, y: 0.9, valid: true } }))
    expect(c.state.cancelArmed).toBeFalsy()
  })

  it('a camera release waits out the open-palm window, then confirms', () => {
    const c = openMenu()
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, rot(-35)))
    expect(c.release(900, true)).toBeNull()
    expect(c.state.status).toBe('CONFIRMING')
    expect(confirmed(c.update(ctx(1000, rot(-35))))).toHaveLength(0)
    const out = confirmed(c.update(ctx(1090, rot(-35))))
    expect(out[0].event.action).toBe('voice')
  })

  it('an open palm right after the release cancels instead of confirming', () => {
    const c = openMenu()
    c.release(700, true)
    const out = c.update(ctx(750, { openPalm: true }))
    expect(out.map((o) => o.kind)).toEqual(['cancelled'])
    expect(confirmed(c.update(ctx(900)))).toHaveLength(0)
  })

  it('cancel (open palm / Escape) closes without an action', () => {
    const c = openMenu()
    expect(c.cancel(700, 'escape')?.kind).toBe('cancelled')
    expect(c.release(710, false)).toBeNull()
  })

  it('arrow keys step one sector and rotation continues from there without a jump', () => {
    const c = openMenu()
    c.step(1, 'keyboard', 0)
    expect(c.state.activeAction).toBe('remember')
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, rot(0)))
    expect(c.state.activeAction).toBe('remember')
    expect(c.state.inputSource).toBe('keyboard')
  })

  it('clicking a sector chooses and confirms it', () => {
    const c = openMenu()
    expect(c.choose('voice', 700, 'click')).toMatchObject({ kind: 'confirmed', event: { action: 'voice', selectionSource: 'click' } })
  })
})

describe('tracking loss and device disconnect', () => {
  it('tracking loss holds the menu and never confirms', () => {
    const c = openMenu()
    c.update(ctx(700, { pointer: { x: 0, y: 0, valid: false } }))
    expect(c.state.status).toBe('TRACKING_LOST')
    expect(c.release(710, true)?.kind).toBe('cancelled')
  })

  it('a camera release just after tracking returns is not trusted', () => {
    const c = openMenu()
    c.update(ctx(700, { pointer: { x: 0, y: 0, valid: false } }))
    c.update(ctx(900))
    expect(c.state.status).toBe('ACTION_HIGHLIGHTED')
    expect(c.release(950, true)?.kind).toBe('cancelled')
  })

  it('cancels after a long tracking loss', () => {
    const c = openMenu()
    c.update(ctx(700, { pointer: { x: 0, y: 0, valid: false } }))
    expect(c.update(ctx(2800, { pointer: { x: 0, y: 0, valid: false } })).map((o) => o.kind)).toEqual(['cancelled'])
  })

  it('a band disconnect keeps the selection and falls back', () => {
    const c = new RadialMenuController({}, { smoothingMs: 0 })
    for (let t = 0; t <= 616; t += 16) c.update(ctx(t, rot(0, 'vexo')))
    for (let t = 632; t < 900; t += 16) c.update(ctx(t, rot(35, 'vexo')))
    expect(c.state.activeAction).toBe('remember')
    c.update(ctx(916, { rotation: { angle: 123, source: 'camera' } }))
    expect(c.state.status).toBe('DEVICE_DISCONNECTED')
    for (let t = 932; t < 1200; t += 16) c.update(ctx(t, { rotation: { angle: 123, source: 'camera' } }))
    expect(c.state.activeAction).toBe('remember') // rebased, no jump
    expect(confirmed([c.release(1200, false)])[0].event.action).toBe('remember')
  })

  it('a force-opened menu (key / debug) has no pointer to lose', () => {
    const c = new RadialMenuController()
    c.forceOpen('chart', ctx(0, { pointer: { x: 0, y: 0, valid: false } }))
    c.update(ctx(3000, { pointer: { x: 0, y: 0, valid: false } }))
    expect(c.isOpen).toBe(true)
    expect(confirmed([c.release(3010, false)])[0].event.objectId).toBe('chart')
  })

  it('keeps working with no continuous rotation source at all (keys only)', () => {
    const c = new RadialMenuController()
    for (let t = 0; t <= 616; t += 16) c.update(ctx(t, { rotation: null }))
    expect(c.isOpen).toBe(true)
    c.step(-1, 'keyboard', null)
    expect(confirmed([c.release(700, false)])[0].event.action).toBe('voice')
  })
})

describe('actions', () => {
  const chart: SpatialObject = {
    id: 'revenue',
    label: 'Quarterly Revenue',
    color: '#5b8dee',
    shape: 'card',
    x: 0.1,
    y: 0.1,
    w: 0.2,
    h: 0.2,
    content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }, { label: 'Q3', value: 180 }, { label: 'Q4', value: 210 }] },
  }
  const prev: SpatialObject = { ...chart, id: 'revenue_prev_year', label: 'Revenue (Prior Year)', content: { kind: 'chart', series: [{ label: 'Q1', value: 90 }] } }
  const objects = [chart, prev]

  it('explains a chart with numbers computed from its data only', () => {
    const { facts } = describeObject(chart)
    expect(facts.join(' ')).toContain('+90 $k (+75.0%)')
    expect(facts).toContain('Rises at every step.')
    expect(facts.join(' ')).toContain('Highest Q4 (210 $k)')
  })

  it('dispatches all three actions, each event at most once', async () => {
    const ex = new RadialActionExecutor(new LocalMemoryStore('', false), () => {})
    expect(ex.execute({ id: 1, action: 'explain', objectId: 'revenue', tMs: 0, selectionSource: 'vexo' }, objects)).toBe('explain')
    expect(ex.execute({ id: 1, action: 'explain', objectId: 'revenue', tMs: 0, selectionSource: 'vexo' }, objects)).toBeNull()
    await Promise.resolve()
    await Promise.resolve()
    expect(ex.explainCards.get('revenue')?.status).toBe('done')

    expect(ex.execute({ id: 2, action: 'remember', objectId: 'revenue', tMs: 0, selectionSource: 'vexo' }, objects)).toBe('remember')
    expect(ex.memory.list()[0]).toMatchObject({ objectId: 'revenue', title: 'Quarterly Revenue', type: 'chart', store: 'local' })
    expect(ex.memory.list()[0].canvas.neighbours).toEqual(['Revenue (Prior Year)'])

    expect(ex.execute({ id: 3, action: 'voice', objectId: 'revenue', tMs: 0, selectionSource: 'vexo' }, objects)).toBe('voice')
    expect(ex.voice?.objectId).toBe('revenue')
    expect(ex.execute({ id: 4, action: 'voice', objectId: 'missing', tMs: 0, selectionSource: 'vexo' }, objects)).toBeNull()
  })

  it('Voice closes an open Explain card, and Explain closes an open Voice', async () => {
    const ex = new RadialActionExecutor(new LocalMemoryStore('', false), () => {})
    ex.execute({ id: 1, action: 'explain', objectId: 'revenue', tMs: 0, selectionSource: 'click' }, objects)
    ex.execute({ id: 2, action: 'voice', objectId: 'revenue', tMs: 0, selectionSource: 'click' }, objects)
    expect(ex.explainCards.size).toBe(0)
    expect(ex.voice?.objectId).toBe('revenue')
    // the explanation that was still loading does not bring the card back
    await Promise.resolve()
    await Promise.resolve()
    expect(ex.explainCards.size).toBe(0)
    ex.execute({ id: 3, action: 'explain', objectId: 'revenue', tMs: 0, selectionSource: 'click' }, objects)
    expect(ex.voice).toBeNull()
    expect(ex.explainCards.size).toBe(1)
  })

  it('asks an open Explain card by voice without closing it, and closing the card ends that recording', () => {
    const ex = new RadialActionExecutor(new LocalMemoryStore('', false), () => {})
    ex.askByVoice('revenue', objects)
    expect(ex.voice).toBeNull() // no card open: nothing to ask
    ex.execute({ id: 1, action: 'explain', objectId: 'revenue', tMs: 0, selectionSource: 'click' }, objects)
    ex.askByVoice('revenue', objects)
    expect(ex.voice).toMatchObject({ objectId: 'revenue', ask: true })
    expect(ex.voice!.id).toBeLessThan(0) // never collides with a radial event id
    expect(ex.explainCards.has('revenue')).toBe(true)
    ex.closeExplain('revenue')
    expect(ex.voice).toBeNull()
  })

  it('answers questions from the data when no AI is connected', () => {
    expect(localAnswer(chart, 'What is the trend?')).toBe('From Q1 to Q4 it went from 120 $k to 210 $k, +90 $k (+75.0%), rising in 3 of 3 steps.')
    expect(localAnswer(chart, 'Where is the peak?')).toBe('The highest point is Q4 at 210 $k.')
    expect(localAnswer(chart, 'Which quarter was lowest?')).toBe('The lowest point is Q1 at 120 $k.')
    const note: SpatialObject = { ...chart, id: 'n', label: 'Pick me up', content: { kind: 'note', text: 'Pick me up\nA camera turns your hand into a cursor.' } }
    expect(localAnswer(note, 'Summarize this')).toBe('“Pick me up”: A camera turns your hand into a cursor.')
    expect(localAnswer(note, 'What’s the key point?')).toBe('The key point is “Pick me up”.')
  })

  it('cleans markdown out of model answers', () => {
    expect(cleanAnswer('**Revenue** rose.\n- Q4 is the *peak*.\n## Done')).toBe('Revenue rose. Q4 is the peak. Done')
  })

  it('encodes suggested questions as air actions, ids with colons included', () => {
    expect(parseAskAction(askAction('slide:1', 2))).toEqual({ objectId: 'slide:1', index: 2 })
    expect(parseAskAction('close-explain:x')).toBeNull()
  })

  it('keeps the last three questions per card and replaces one still waiting', async () => {
    const ex = new RadialActionExecutor(new LocalMemoryStore('', false), () => {})
    ex.answer = async (question) => ({ question, text: `About ${question}.`, source: 'local', label: 'local' })
    const settle = () => new Promise((r) => setTimeout(r))
    ex.ask('revenue', 'first', objects)
    ex.ask('revenue', 'second', objects) // replaces "first" before it is answered
    await settle()
    expect(ex.explainThreads.get('revenue')).toMatchObject([{ question: 'second', status: 'done', answer: { text: 'About second.' } }])

    for (const q of ['a', 'b', 'c']) {
      ex.ask('revenue', q, objects)
      await settle()
    }
    expect(ex.explainThreads.get('revenue')?.map((q) => q.question)).toEqual(['a', 'b', 'c'])
    ex.askSuggested('revenue', 0, objects)
    expect(ex.explainThreads.get('revenue')?.at(-1)?.question).toBe('What’s the trend?')
    ex.closeExplain('revenue')
    expect(ex.explainThreads.has('revenue')).toBe(false)
  })

  it('binds "this" in a voice request to the selected object', () => {
    const p = previewVoiceCommand('Compare this with last quarter.', chart, objects)
    expect(p.bound).toContain('the Quarterly Revenue')
    expect(p.intent).toBe('compare')
    expect(p.objectTitles[0]).toBe('Quarterly Revenue')
    expect(p.parameters.comparisonPeriod).toBe('previous_quarter')
    expect(p.computed).toBe('Q4 210 vs Q3 180: +30 (+16.7%)')
  })
})
