// The three-minute pitch as data. Every object here is a real SpatialObject:
// the live spatial engine hit-tests, grabs and drags it, and the radial
// actions read its `content`. Coordinates are the normalized 16:9 stage.
//
// Dragging always does a job: it clears the old interface (01), assembles the
// system (02), and pulls the information you are talking about into the
// spotlight (03). Nothing is draggable only for show.

import type { RadialAction } from '../spatial/radial/types'
import type { SpatialObject } from '../spatial/types'
import { BRAND_NAME } from '../site/brand'

export const PRODUCT = BRAND_NAME
export const EVENT = 'VexoHacks 2026'

/** How a piece of the scene is drawn (the engine only knows the rectangle). */
export type VisualKind =
  | 'window'
  | 'cursor'
  | 'toolbar'
  | 'pillar'
  | 'chart'
  | 'metric'
  | 'diagram'
  | 'note'
  | 'contrast'
  | 'glyph-hand'
  | 'glyph-ring'
  | 'glyph-memory'
  | 'glyph-voice'
  | 'lamp'
  | 'robot'
  | 'agent'

export interface PitchObject extends SpatialObject {
  visual: VisualKind
  /** Small editorial index shown on the object. */
  index?: string
  /** Static tilt for composition (degrees). Visual only. */
  tilt?: number
  /** Extra lines some visuals render (bullets, captions). */
  lines?: string[]
  /** Not on the canvas until this beat is done. */
  revealedBy?: string
  /** Future-directions cards: this beat turns the object into its result. */
  transformedBy?: string
  /** What the result would open in (shown as "Next: …"). */
  destination?: string
}

/** A place on the stage where an object can be put down. */
export interface DropZone {
  /** Whatever is dropped in takes the zone's size; the piece already there goes back. */
  snap?: boolean
  id: string
  label: string
  index?: string
  x: number
  y: number
  w: number
  h: number
}

export type BeatTrigger =
  | { kind: 'object_drop'; objectId: string; minMove: number }
  /** The object ('*' = any) is let go with its centre inside the zone. */
  | { kind: 'drop_in_zone'; objectId: string; zoneId: string }
  | { kind: 'any_drop' }
  | { kind: 'action_complete'; action: RadialAction }
  /** A request spoken into Voice while holding the object (any object if omitted). */
  | { kind: 'voice_reply'; objectId?: string }
  /** Grab empty space in the right quarter and pull it across (see PitchStage). */
  | { kind: 'swipe' }
  /** Only reached through the beat before it (a timed follow-up). */
  | { kind: 'follow_up' }

export interface SceneBeat {
  id: string
  /** What the presenter does; shown in rehearsal and the console. */
  step: string
  trigger: BeatTrigger
  /** The presenter's "next" key may complete this beat as a deterministic fallback. */
  fallback: boolean
  /** Where objects move when the beat completes (merged by id). */
  layout?: Record<string, Partial<Pick<PitchObject, 'x' | 'y' | 'w' | 'h' | 'tilt'>>>
  then?: { kind: 'advance_scene' | 'complete_next_beat'; delayMs: number }
}

export interface PitchScene {
  id: 'problem' | 'product' | 'demo' | 'compare' | 'future' | 'vision'
  number: string
  kicker: string
  /** Console title. */
  title: string
  targetSeconds: number
  notes: string[]
  objects: PitchObject[]
  zones?: DropZone[]
  /** Scenes in one group share the live canvas: moving between them keeps object positions. */
  canvasGroup?: string
  /** Hold-to-open radial actions are available in this scene. */
  radial: boolean
  beats: SceneBeat[]
}

// ---- data the demo canvas is built from --------------------------------------------------
export const REVENUE = [
  { label: 'Q1', value: 120 },
  { label: 'Q2', value: 150 },
  { label: 'Q3', value: 180 },
  { label: 'Q4', value: 210 },
]
const last = REVENUE[REVENUE.length - 1].value
const prev = REVENUE[REVENUE.length - 2].value
/** Derived from REVENUE, never typed in by hand. */
export const QOQ_GROWTH = (last - prev) / prev

/** Scene 03: the big frame you drag the information into to present it. */
export const SPOTLIGHT: DropZone = { id: 'spotlight', label: 'Spotlight — put what you’re talking about here', x: 0.055, y: 0.27, w: 0.52, h: 0.56, snap: true }

// Scene 03 starts with everything small, "on the desk" at the right.
const workspace: PitchObject[] = [
  {
    id: 'revenue',
    label: 'Quarterly Revenue',
    visual: 'chart',
    color: '#f2f0eb',
    shape: 'card',
    index: 'A',
    x: 0.61,
    y: 0.27,
    w: 0.165,
    h: 0.24,
    content: { kind: 'chart', unit: '$k', series: REVENUE },
  },
  {
    id: 'growth',
    label: 'Q4 growth, quarter on quarter',
    visual: 'metric',
    color: '#ff5a1f',
    shape: 'card',
    index: 'B',
    x: 0.79,
    y: 0.27,
    w: 0.155,
    h: 0.24,
    content: { kind: 'metric', value: QOQ_GROWTH, format: 'percent', note: 'Computed from the revenue chart: Q4 against Q3.' },
  },
  {
    id: 'notes',
    label: 'Launch notes',
    visual: 'note',
    color: '#f2f0eb',
    shape: 'card',
    index: 'C',
    x: 0.61,
    y: 0.54,
    w: 0.165,
    h: 0.29,
    content: { kind: 'note', text: 'Ship pricing before Q1 close\nOnboarding email on day 2\nRisk: support load' },
  },
  {
    id: 'system',
    label: 'How Axis works',
    visual: 'diagram',
    color: '#f2f0eb',
    shape: 'card',
    index: 'D',
    x: 0.79,
    y: 0.54,
    w: 0.155,
    h: 0.29,
    lines: ['Camera', 'Perception', 'Intent', 'Action'],
    content: { kind: 'note', text: 'Camera: 21 hand landmarks per frame, in the browser\nPerception: palm cursor, grasp and release\nIntent: hold an object to open Explain, Remember, Voice\nAction: computed from the object’s own data' },
  },
]

// Scene 02: the three pieces start as a loose pile; each has a slot in the pipeline.
const SLOT_Y = 0.55
const SLOT_H = 0.32
const SLOTS: DropZone[] = [
  { id: 'slot-perception', label: 'Perception', index: '01', x: 0.055, y: SLOT_Y, w: 0.2, h: SLOT_H },
  { id: 'slot-intent', label: 'Intent', index: '02', x: 0.275, y: SLOT_Y, w: 0.2, h: SLOT_H },
  { id: 'slot-action', label: 'Action', index: '03', x: 0.495, y: SLOT_Y, w: 0.2, h: SLOT_H },
]
const slotRect = (id: string) => {
  const s = SLOTS.find((z) => z.id === id)!
  return { x: s.x, y: s.y, w: s.w, h: s.h, tilt: 0 }
}
const pillar = (id: string, index: string, label: string, line: string, x: number, y: number, tilt: number): PitchObject => ({
  id,
  label,
  visual: 'pillar',
  color: '#f2f0eb',
  shape: 'card',
  index,
  x,
  y,
  w: 0.2,
  h: SLOT_H,
  tilt,
  lines: [line],
})

export const SCENES: PitchScene[] = [
  {
    id: 'problem',
    number: '01',
    kicker: 'The problem',
    title: 'We think with our hands',
    targetSeconds: 28,
    radial: false,
    notes: [
      'When we present, teach or collaborate, we already talk with our hands.',
      'But the computer can’t see any of it. So we walk back to the laptop, find the mouse, dig through menus.',
      'Watch — I’ll just move this window out of the way.',
    ],
    objects: [
      {
        id: 'p-window',
        label: 'Q3 Review — Final(2).key',
        visual: 'window',
        color: '#f2f0eb',
        shape: 'card',
        x: 0.545,
        y: 0.17,
        w: 0.39,
        h: 0.5,
        content: { kind: 'note', text: 'A conventional application window' },
      },
      { id: 'p-cursor', label: 'Cursor', visual: 'cursor', color: '#f2f0eb', shape: 'card', x: 0.5, y: 0.53, w: 0.055, h: 0.11, tilt: -8 },
      { id: 'p-toolbar', label: 'File  Edit  Insert  Format  Arrange  View', visual: 'toolbar', color: '#f2f0eb', shape: 'card', x: 0.575, y: 0.72, w: 0.36, h: 0.085 },
    ],
    beats: [
      {
        id: 'clear',
        step: 'Grab the window and move it aside',
        trigger: { kind: 'object_drop', objectId: 'p-window', minMove: 0.12 },
        fallback: true,
        then: { kind: 'advance_scene', delayMs: 1300 },
      },
    ],
  },
  {
    id: 'product',
    number: '02',
    kicker: 'Introducing',
    title: `${PRODUCT}: point, hold, act`,
    targetSeconds: 22,
    radial: false,
    notes: [
      `So we built ${PRODUCT}: a spatial workspace that understands what you point at and what you want to do with it.`,
      'Let me build it for you. Perception: the camera follows your hand.',
      'Intent: hold an object and choose what to do with it.',
      'Action: it works on the object’s real data. That’s the whole system.',
    ],
    zones: SLOTS,
    objects: [
      // The pile, back to front: the presenter picks them up in order 01, 02, 03.
      pillar('action', '03', 'Action', 'Computed from the object’s own data.', 0.765, 0.555, 6),
      pillar('intent', '02', 'Intent', 'Hold an object. Choose Explain, Remember or Voice.', 0.75, 0.535, -3),
      pillar('perception', '01', 'Perception', 'The camera follows your hand — 21 landmarks, in the browser.', 0.735, 0.515, -7),
    ],
    beats: [
      {
        id: 'placed-perception',
        step: 'Drag 01 Perception into the first slot',
        trigger: { kind: 'drop_in_zone', objectId: 'perception', zoneId: 'slot-perception' },
        fallback: true,
        layout: { perception: slotRect('slot-perception') },
      },
      {
        id: 'placed-intent',
        step: 'Drag 02 Intent into the second slot',
        trigger: { kind: 'drop_in_zone', objectId: 'intent', zoneId: 'slot-intent' },
        fallback: true,
        layout: { intent: slotRect('slot-intent') },
      },
      {
        id: 'placed-action',
        step: 'Drag 03 Action into the third slot',
        trigger: { kind: 'drop_in_zone', objectId: 'action', zoneId: 'slot-action' },
        fallback: true,
        layout: { action: slotRect('slot-action') },
        then: { kind: 'complete_next_beat', delayMs: 500 },
      },
      {
        id: 'converge',
        step: 'The pipeline connects',
        trigger: { kind: 'follow_up' },
        fallback: true,
        layout: {
          perception: { x: 0.145, y: SLOT_Y, w: 0.21, h: SLOT_H },
          intent: { x: 0.395, y: SLOT_Y, w: 0.21, h: SLOT_H },
          action: { x: 0.645, y: SLOT_Y, w: 0.21, h: SLOT_H },
        },
      },
    ],
  },
  {
    id: 'demo',
    number: '03',
    kicker: 'Live',
    title: 'Point at the information',
    targetSeconds: 45,
    radial: true,
    canvasGroup: 'workspace',
    zones: [SPOTLIGHT],
    notes: [
      'Instead of describing what you want to change, you point at it.',
      'I want to talk about revenue — so I pull it off the desk, into the spotlight. Any card goes in; the one there steps back.',
      'Close your hand on it and hold — the actions open around it. Explain. Open your hand.',
      'Every number in that card is computed from the chart itself. No model is guessing.',
      'Hold it again — Remember. It’s saved onto the Vexo band on my wrist. Open Memory to show it.',
    ],
    objects: workspace,
    beats: [
      {
        id: 'spotlit',
        step: 'Drag any card into the spotlight (the revenue chart for Explain)',
        trigger: { kind: 'drop_in_zone', objectId: '*', zoneId: 'spotlight' },
        fallback: true,
      },
      {
        id: 'explained',
        step: 'Hold the chart, choose Explain, open your hand',
        trigger: { kind: 'action_complete', action: 'explain' },
        fallback: false,
      },
      { id: 'remembered', step: 'Hold the chart, choose Remember, then open Memory', trigger: { kind: 'action_complete', action: 'remember' }, fallback: false },
    ],
  },
  {
    id: 'compare',
    number: '04',
    kicker: 'Trade-offs',
    title: 'Two ways to say what you mean',
    targetSeconds: 30,
    radial: true,
    notes: [
      'Conventional interfaces make you operate the controls: menus, tools, one element at a time.',
      'Hold the card, Voice, and ask the band: “What is the difference between this and conventional interfaces?”',
      'Honestly: a mouse is more precise at a desk. This is for when you’re standing up, teaching, sharing a room.',
    ],
    objects: [
      {
        id: 'c-conventional',
        label: 'Conventional interfaces',
        visual: 'contrast',
        color: '#5a5a5a',
        shape: 'card',
        index: 'A',
        x: 0.055,
        y: 0.3,
        w: 0.4,
        h: 0.55,
        lines: ['Navigate menus', 'Select tools', 'Manipulate individual controls', 'Often return to the screen'],
        content: { kind: 'note', text: 'Navigate menus\nSelect tools\nManipulate individual controls\nOften return to the screen' },
      },
      {
        id: 'c-axis',
        label: `${PRODUCT}`,
        visual: 'contrast',
        color: '#ff5a1f',
        shape: 'card',
        index: 'B',
        x: 0.545,
        y: 0.3,
        w: 0.4,
        h: 0.55,
        revealedBy: 'asked',
        lines: ['Point at information', 'Choose a contextual action', 'Speak the details', 'Stay with the room'],
        content: { kind: 'note', text: 'Point at information\nChoose a contextual action\nSpeak the details\nStay with the room' },
      },
    ],
    beats: [
      {
        id: 'asked',
        step: 'Hold Conventional interfaces → Voice → into the band: “What is the difference between this and conventional interfaces?”',
        trigger: { kind: 'voice_reply' },
        fallback: true,
        layout: {},
      },
    ],
  },
  {
    id: 'future',
    number: '05',
    kicker: 'What’s next',
    title: 'Point at the world. It acts.',
    targetSeconds: 30,
    radial: true,
    notes: [
      'Today it’s a screen. Next, the same gesture works on the world around you.',
      'Point at a lamp, “dim this”. Point at a package, a robot brings it. Point at a plan on the whiteboard, and an agent makes it happen — asking you before anything is sent.',
      'Hold any card, Voice, ask: all three show what’s next. These are concepts, not shipped features.',
    ],
    objects: [
      {
        id: 'f-lamp',
        label: 'The physical world',
        visual: 'lamp',
        color: '#f2f0eb',
        shape: 'card',
        index: 'A',
        x: 0.055,
        y: 0.29,
        w: 0.27,
        h: 0.54,
        transformedBy: 't-all',
        destination: 'smart-home devices (Matter)',
        lines: ['Desk lamp', '“Dim this.”'],
        content: { kind: 'note', text: 'Desk lamp, on at 100%' },
      },
      {
        id: 'f-robot',
        label: 'Robots',
        visual: 'robot',
        color: '#f2f0eb',
        shape: 'card',
        index: 'B',
        x: 0.365,
        y: 0.29,
        w: 0.27,
        h: 0.54,
        transformedBy: 't-all',
        destination: 'robot fleets',
        lines: ['Package on the floor', '“Bring this to me.”'],
        content: { kind: 'note', text: 'A package across the room' },
      },
      {
        id: 'f-agent',
        label: 'Agents',
        visual: 'agent',
        color: '#f2f0eb',
        shape: 'card',
        index: 'C',
        x: 0.675,
        y: 0.29,
        w: 0.27,
        h: 0.54,
        transformedBy: 't-all',
        destination: 'AI agents, with your approval',
        lines: ['Whiteboard: team offsite, Mar 12', '“Make it happen.”'],
        content: { kind: 'note', text: 'Team offsite Mar 12\nBook a room\nInvite the team\nOrder lunch' },
      },
    ],
    beats: [{ id: 't-all', step: 'Hold any card → Voice → ask it: all three show what’s next', trigger: { kind: 'voice_reply' }, fallback: true }],
  },
  {
    id: 'vision',
    number: '06',
    kicker: 'Where this goes',
    title: 'The interface is you',
    targetSeconds: 26,
    radial: false,
    notes: [
      'We’re building interfaces that adapt to how people already communicate.',
      'Charts, notes, memory, voice — pull one in, and it all comes together.',
      'Then, on its own: Axis. The interface is you.',
    ],
    objects: [
      { id: 'v-chart', label: 'Revenue', visual: 'chart', color: '#f2f0eb', shape: 'card', x: 0.07, y: 0.12, w: 0.2, h: 0.26, tilt: -6, content: { kind: 'chart', unit: '$k', series: REVENUE } },
      { id: 'v-hand', label: 'Gesture', visual: 'glyph-hand', color: '#ff5a1f', shape: 'card', x: 0.74, y: 0.1, w: 0.16, h: 0.28, tilt: 7 },
      { id: 'v-note', label: 'Notes', visual: 'note', color: '#f2f0eb', shape: 'card', x: 0.12, y: 0.62, w: 0.18, h: 0.22, tilt: 4, content: { kind: 'note', text: 'Ship pricing page\nOnboarding day 2\nSupport load' } },
      { id: 'v-ring', label: 'Actions', visual: 'glyph-ring', color: '#f2f0eb', shape: 'card', x: 0.42, y: 0.64, w: 0.15, h: 0.25, tilt: -3 },
      { id: 'v-memory', label: 'Memory', visual: 'glyph-memory', color: '#f2f0eb', shape: 'card', x: 0.7, y: 0.62, w: 0.17, h: 0.24, tilt: -9 },
      { id: 'v-voice', label: 'Voice', visual: 'glyph-voice', color: '#f2f0eb', shape: 'card', x: 0.44, y: 0.1, w: 0.13, h: 0.22, tilt: 5 },
    ],
    beats: [
      {
        id: 'assemble',
        step: 'Grab any piece and let go — the canvas organises itself',
        trigger: { kind: 'any_drop' },
        fallback: true,
        then: { kind: 'complete_next_beat', delayMs: 2600 },
        layout: {
          'v-chart': { x: 0.055, y: 0.35, w: 0.225, h: 0.3 },
          'v-note': { x: 0.295, y: 0.35, w: 0.17, h: 0.3 },
          'v-hand': { x: 0.48, y: 0.35, w: 0.105, h: 0.3 },
          'v-ring': { x: 0.6, y: 0.35, w: 0.105, h: 0.3 },
          'v-voice': { x: 0.72, y: 0.35, w: 0.105, h: 0.3 },
          'v-memory': { x: 0.84, y: 0.35, w: 0.105, h: 0.3 },
        },
      },
      { id: 'statement', step: 'The closing screen follows on its own', trigger: { kind: 'follow_up' }, fallback: true },
    ],
  },
]

/** Objects for a scene, positioned as the scene's completed beats have arranged them. */
export function objectsFor(scene: PitchScene, done: ReadonlySet<string> | string[]): PitchObject[] {
  const doneSet = new Set(done)
  const layout: Record<string, Partial<PitchObject>> = {}
  for (const b of scene.beats.filter((x) => doneSet.has(x.id))) for (const [id, l] of Object.entries(b.layout ?? {})) layout[id] = { ...layout[id], ...l }
  return scene.objects.filter((o) => !o.revealedBy || doneSet.has(o.revealedBy)).map((o) => ({ ...o, ...layout[o.id] }))
}
