// Types for tracker.js: the marker's tip on the board from clicks, motion, sound and EMG.

import type { Layout, Ping, AudioFrame, EmgBlock, MotionSample, Vec3 } from './simulate.js'

export interface InkPoint {
  x: number
  y: number
  t: number
}

export interface Fix {
  x: number
  y: number
  z: number
  used: number
  regained?: boolean
}

export interface News {
  type: string
  t?: number
  [key: string]: unknown
}

export interface Ink {
  kind: 'vexo-board ink'
  unit: 'cm'
  board: { width: number; height: number }
  strokes: { x: number[]; y: number[]; t: number[] }[]
}

export class VexoBoard {
  constructor(layout: Layout, options?: { rate?: number; celsius?: number })
  layout: Layout
  /** The fused trail of the band: times (ms) and board metres. */
  fused: { length: number; t: number[]; x: number[]; y: number[] }
  contact: { on: boolean; at(t: number): boolean }
  muscles: { last: { t: number; flex: number; thumb: number; pressing: boolean } | null }
  pings: { stats: { pings: number; used: number; partial: number; echoes: number; missing: number; regained: number } }
  tipBody: Vec3 | null
  news: News[]
  readonly ready: boolean
  feed(m: MotionSample): void
  ping(p: Ping): Fix | null
  audio(a: AudioFrame): boolean
  emg(e: EmgBlock): { pressing: boolean; pinch: boolean }
  calibrateEmg(relaxed: Float32Array[][], hard: Float32Array[][], holding: Float32Array[][]): void
  tipAt(i: number): [number, number]
  status(): string
  strokes(): InkPoint[][]
  ink(): Ink
}
