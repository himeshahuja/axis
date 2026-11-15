// The audio event map. Every cue is pinned to a frame the picture exports, so if an
// animation moves, its sound moves with it. `frame` is the frame of the sound's
// *hit* (the transient you should feel); each designed sound declares where its hit
// sits inside the file (src/audio/sfx-manifest.json), and the Soundtrack starts the
// file early by exactly that much.
//
// Export to JSON for the audio build and review scripts: `npm run cues`.

import * as S1 from '../scenes/S1Problem'
import * as S2 from '../scenes/S2Reveal'
import * as S3 from '../scenes/S3Grab'
import * as S4 from '../scenes/S4Radial'
import * as S5 from '../scenes/S5Act'
import * as S6 from '../scenes/S6Next'
import * as S7 from '../scenes/S7Close'
import { DURATION, FPS } from '../theme'

export type SoundId =
  | 'mouse-click-a'
  | 'mouse-click-b'
  | 'freeze-hit'
  | 'point-in'
  | 'field-swell'
  | 'crossbar'
  | 'scanlines'
  | 'lock'
  | 'tone-explain'
  | 'tone-remember'
  | 'tone-voice'
  | 'ui-click'
  | 'drag'
  | 'snap'
  | 'hold'
  | 'radial-open'
  | 'radial-open-short'
  | 'confirm'
  | 'panel'
  | 'memory'
  | 'voice-on'
  | 'voice-texture'
  | 'transition'
  | 'card-tap'
  | 'assemble'
  | 'fold'
  | 'point-out'
  | 'reveal-impact'

export interface Cue {
  frame: number
  sound: SoundId
  /** Linear gain into the mix (before mastering). */
  gain: number
  note: string
  /** Shape the cue's level over time (frames relative to the cue's hit). */
  envelope?: 'drag' | 'voice'
}

const s2 = S2.S2_START
const s3 = S3.S3_START
const s4 = S4.S4_START
const s5 = S5.S5_START
const s6 = S6.S6_START
const s7 = S7.S7_START

const TONE = { explain: 'tone-explain', remember: 'tone-remember', voice: 'tone-voice' } as const

export const CUES: Cue[] = [
  // 1 · Problem: ordinary plastic clicks, then everything stops.
  ...S1.CURSOR_CLICKS.map((f, i) => ({ frame: f, sound: (i % 2 ? 'mouse-click-b' : 'mouse-click-a') as SoundId, gain: 0.75 + 0.1 * (i % 3), note: 'cursor click' })),
  { frame: S1.FREEZE_AT, sound: 'freeze-hit', gain: 0.9, note: '"OUR COMPUTERS DON\'T." — the pile freezes' },

  // 2 · Reveal: the point, the field, the logo assembling.
  { frame: s2 + S2.POINT_AT, sound: 'point-in', gain: 0.55, note: 'orange point appears' },
  { frame: s2 + S2.FIELD_AT + 40, sound: 'field-swell', gain: 0.55, note: 'field unfolds (swell peaks mid-unfold)' },
  { frame: s2 + S2.CROSSBAR_AT, sound: 'crossbar', gain: 0.6, note: 'point stretches into the crossbar' },
  { frame: s2 + S2.PILLS_AT + 4, sound: 'scanlines', gain: 0.45, note: 'scan lines slide in' },
  { frame: s2 + S2.LOCK_AT, sound: 'lock', gain: 0.85, note: 'brackets lock on' },
  { frame: s2 + S2.WORDS_AT[0], sound: 'tone-explain', gain: 0.45, note: 'POINT.' },
  { frame: s2 + S2.WORDS_AT[1], sound: 'tone-remember', gain: 0.45, note: 'HOLD.' },
  { frame: s2 + S2.WORDS_AT[2], sound: 'confirm', gain: 0.5, note: 'ACT.' },

  // 3 · Grab.
  { frame: s3, sound: 'transition', gain: 0.5, note: 'cut to the canvas' },
  { frame: s3 + S3.PINCH_AT - 1, sound: 'ui-click', gain: 0.9, note: 'pinch closes → grab' },
  { frame: s3 + S3.PINCH_AT + 2, sound: 'drag', gain: 0.5, note: 'carry (level follows hand speed)', envelope: 'drag' },
  { frame: s3 + S3.DROP_AT + 2, sound: 'snap', gain: 0.85, note: 'drop → magnetic lock-in' },

  // 4 · Radial.
  { frame: s4, sound: 'transition', gain: 0.45, note: 'cut' },
  { frame: s4 + S4.PINCH - 1, sound: 'ui-click', gain: 0.85, note: 'pinch' },
  { frame: s4 + S4.PINCH, sound: 'hold', gain: 0.5, note: 'hold ring fills (600 ms)' },
  { frame: s4 + S4.OPEN, sound: 'radial-open', gain: 0.9, note: 'menu opens: three sectors' },
  ...S4.sectorChanges().map((c) => ({ frame: s4 + c.frame, sound: TONE[c.action] as SoundId, gain: 0.7, note: `highlight → ${c.action}` })),
  { frame: s4 + S4.RELEASE, sound: 'confirm', gain: 0.85, note: 'release on Explain → confirm' },
  { frame: s4 + S4.PANEL_AT + 2, sound: 'panel', gain: 0.45, note: 'Explain card unfolds' },

  // 5 · Remember, then Voice.
  { frame: s5, sound: 'transition', gain: 0.4, note: 'cut' },
  { frame: s5 + S5.R_OPEN, sound: 'radial-open-short', gain: 0.7, note: 'menu (Remember)' },
  { frame: s5 + S5.R_RELEASE, sound: 'confirm', gain: 0.8, note: 'confirm Remember' },
  { frame: s5 + S5.STORED_AT, sound: 'memory', gain: 0.85, note: 'chart contracts into the collection (hit = lands)' },
  { frame: s5 + S5.V_OPEN, sound: 'radial-open-short', gain: 0.7, note: 'menu (Voice)' },
  { frame: s5 + S5.V_RELEASE, sound: 'confirm', gain: 0.8, note: 'confirm Voice' },
  { frame: s5 + S5.V_PANEL, sound: 'voice-on', gain: 0.7, note: 'band mic activates' },
  { frame: s5 + S5.SPEAK - 4, sound: 'voice-texture', gain: 0.4, note: 'waveform texture (follows the bars)', envelope: 'voice' },
  { frame: s5 + S5.COMPARE + 8, sound: 'snap', gain: 0.7, note: 'comparison docks on the same scale' },
  { frame: s5 + S5.GUIDES_AT, sound: 'tone-remember', gain: 0.35, note: 'guides align' },

  // 6 · What comes next.
  { frame: s6, sound: 'transition', gain: 0.5, note: 'cut' },
  ...S6.CARDS_AT.map((f, i) => ({ frame: s6 + f + 4, sound: 'card-tap' as SoundId, gain: 1.0, note: `card ${i + 1}` })),

  // 7 · Close.
  { frame: s7 + S7.ASSEMBLE + 22, sound: 'assemble', gain: 0.6, note: 'pieces gather (hit = they settle)' },
  { frame: s7 + S7.GONE, sound: 'fold', gain: 0.42, note: 'everything folds into the point (hit = point gone)' },
  { frame: s7 + S7.GONE, sound: 'point-out', gain: 0.6, note: 'point goes out → silence' },
  { frame: s7 + S7.NAME, sound: 'reveal-impact', gain: 1, note: 'logo reveal: impact, tail, then silence' },
]

/** Section markers the score is written against (global frames). */
export const MARKERS = {
  fps: FPS,
  duration: DURATION,
  freeze: S1.FREEZE_AT,
  reveal: s2,
  point: s2 + S2.POINT_AT,
  lock: s2 + S2.LOCK_AT,
  grab: s3,
  radial: s4,
  radialOpen: s4 + S4.OPEN,
  act: s5,
  voice: s5 + S5.VOICE_AT,
  next: s6,
  close: s7,
  fold: s7 + S7.FOLD,
  gone: s7 + S7.GONE,
  line: s7 + S7.LINE,
  reveal2: s7 + S7.NAME,
}

/** Frames of the drag path (scene 3) and the voice listening window, for the envelopes. */
export const ENVELOPES = {
  drag: { start: s3 + S3.PINCH_AT, end: s3 + S3.DROP_AT },
  voice: { start: s5 + S5.SPEAK, end: s5 + S5.SPEAK_END },
}
