import type { SpatialObject } from '../spatial/types'

export const demoIdentity = { name: 'Untitled demo', event: 'VexoAI Hackathon' }
export interface PresentationSlide {
  id: string
  eyebrow: string
  title: string
  subtitle: string
  accent: string
  note: string
  objects: SpatialObject[]
}

/** Editable script. Hand cursor and objects share normalized stage coordinates. */
const slides: PresentationSlide[] = [
  {
    id: 'intro', eyebrow: 'A more natural way to present', title: 'The room is\nyour canvas',
    subtitle: 'A camera turns your hand into a cursor on the mirrored screen.', accent: '#edca7c',
    note: 'Open with your hand visible. Close your hand over a card, move it, then open to release.',
    objects: [
      { id: 'idea', label: 'An idea\nworth moving', color: '#edca7c', shape: 'card', x: .64, y: .31, w: .25, h: .32 },
      { id: 'live', label: 'Pick me up', color: '#e5e0d6', shape: 'pill', x: .69, y: .69, w: .20, h: .09 },
    ],
  },
  {
    id: 'problem', eyebrow: 'The problem', title: 'The laptop keeps\npulling us back',
    subtitle: 'Presenters return to the keyboard to move content, breaking the flow of the conversation.', accent: '#e9a58e',
    note: 'Describe the moment you have to turn away from the audience to move something on a slide.',
    objects: [
      { id: 'attention', label: 'Audience\nattention', color: '#e9a58e', shape: 'card', x: .67, y: .31, w: .22, h: .22 },
      { id: 'control', label: 'Content\ncontrol', color: '#e5e0d6', shape: 'card', x: .64, y: .59, w: .22, h: .22 },
    ],
  },
  {
    id: 'interaction', eyebrow: 'The interaction', title: 'Close to grab.\nOpen to release.',
    subtitle: 'The palm steers the cursor. A steady closed hand grabs an object or activates a control.', accent: '#abc8bc',
    note: 'Demonstrate one clean grab and release. Tracking loss freezes the object instead of dropping it.',
    objects: [
      { id: 'grasp', label: 'Close your hand\nto grab', color: '#abc8bc', shape: 'card', x: .65, y: .30, w: .25, h: .23 },
      { id: 'release', label: 'Open your hand\nto release', color: '#e5e0d6', shape: 'card', x: .65, y: .59, w: .25, h: .23 },
    ],
  },
  {
    id: 'calibration', eyebrow: 'A range that fits you', title: 'Your movement.\nYour sensitivity.',
    subtitle: 'Hold two comfortable hand positions. That range maps to the full slide.', accent: '#edca7c',
    note: 'Use Calibrate. Hold upper-left, then lower-right. A smaller range gives faster movement. A larger range gives finer control.',
    objects: [
      { id: 'small', label: 'Smaller range\nFaster cursor', color: '#edca7c', shape: 'card', x: .65, y: .32, w: .25, h: .20 },
      { id: 'large', label: 'Larger range\nFiner control', color: '#e5e0d6', shape: 'card', x: .65, y: .59, w: .25, h: .20 },
    ],
  },
  {
    id: 'demo', eyebrow: 'Live demonstration', title: 'A whiteboard\nthat moves with you',
    subtitle: 'Arrange these ideas while facing the room. Grab a note, move it, and let go.', accent: '#abc8bc',
    note: 'Move Discover left and Prototype right. Then use the hand cursor to advance the slide. Mouse and Space remain available as fallback.',
    objects: [
      { id: 'discover', label: 'Discover', color: '#edca7c', shape: 'card', x: .64, y: .29, w: .24, h: .17 },
      { id: 'prototype', label: 'Prototype', color: '#abc8bc', shape: 'card', x: .68, y: .51, w: .24, h: .17 },
      { id: 'share', label: 'Share', color: '#e9a58e', shape: 'pill', x: .64, y: .73, w: .22, h: .09 },
    ],
  },
  {
    id: 'next', eyebrow: 'What comes next', title: 'Built for the\nnext conversation',
    subtitle: 'Today: a camera-driven prototype. Next: test with more presenters and explore Vexo wearable input.', accent: '#e9a58e',
    note: 'Wearable input is a future direction, not a demonstrated integration. Invite the judges to try a grasp.',
    objects: [
      { id: 'today', label: 'Today\nCamera + grasp', color: '#e5e0d6', shape: 'card', x: .65, y: .31, w: .25, h: .22 },
      { id: 'next', label: 'Next\nWearable input', color: '#e9a58e', shape: 'card', x: .65, y: .59, w: .25, h: .22 },
    ],
  },
]

// Action explanations and memory use authored slide content, never invented metrics.
export const presentationDeck: PresentationSlide[] = slides.map((slide) => ({
  ...slide,
  objects: slide.objects.map((object) => ({
    ...object,
    content: { kind: 'note', text: `${object.label.replace('\n', ' ')}\n${slide.subtitle}` },
  })),
}))
