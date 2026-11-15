// Types for replay.js: a simulated session played into the tracker, and scored.

import type { ConceptSession } from './simulate.js'
import type { VexoBoard } from './tracker.js'

export interface Arrival {
  at: number
  kind: 'motion' | 'ping' | 'emg' | 'audio'
  data: unknown
}

export interface PlayOptions {
  emg?: boolean
}

export interface Score {
  /** Metres: median and 95th percentile while the marker is on the board. */
  tip: [number, number]
  band: [number, number]
  precision: number
  recall: number
  strokes: number
  written: number
  pinches: { found: number; of: number; extra: number }
  clicks: { pings: number; used: number; partial: number; echoes: number; missing: number; regained: number }
}

export function arrivals(s: ConceptSession, options?: PlayOptions): Arrival[]
export function tracker(s: ConceptSession, options?: PlayOptions): VexoBoard
export function deliver(vb: VexoBoard, a: Arrival): void
export function play(s: ConceptSession, options?: PlayOptions): VexoBoard
export function score(s: ConceptSession, vb: VexoBoard): Score
