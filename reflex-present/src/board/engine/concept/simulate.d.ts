// Types for simulate.js: a pretend session with the Vexo Board hardware.

export type Vec3 = [number, number, number]

export interface MotionSample {
  t: number
  n: number
  ax: number
  ay: number
  az: number
  gx: number
  gy: number
  gz: number
}

export interface Ping {
  t: number
  arrives: number
  /** Seconds to the bottom left, top left and top right pucks; null when not heard. */
  delays: (number | null)[]
}

export interface AudioFrame {
  t: number
  samples: Float32Array
  touching: boolean
}

export interface EmgBlock {
  t: number
  block: Float32Array[]
}

export interface Layout {
  width: number
  height: number
  pucks: { bottomLeft: Vec3; topLeft: Vec3; topRight: Vec3 }
  square: number
}

export interface ConceptSession {
  name: string
  rate: number
  samples: MotionSample[]
  layout: Layout
  pings: Ping[]
  audio: AudioFrame[]
  emg: EmgBlock[]
  emgCalibration: { relaxed: Float32Array[][]; hard: Float32Array[][]; holding: Float32Array[][] } | null
  pinches: [number, number][]
  /** True places, board metres, one per motion sample. */
  tip: Vec3[]
  band: Vec3[]
  touching: boolean[]
  tipBody: Vec3
  celsius: number
  board: { width: number }
}

export type SceneName = 'reach' | 'walk' | 'steady'

export interface SessionOptions {
  seed?: number
  pingHz?: number
  jitter?: number
  delay?: number
  blocked?: boolean
  talk?: boolean
  celsius?: number
  rate?: number
  noisy?: boolean
  emg?: boolean
}

export function conceptSession(name?: SceneName, options?: SessionOptions): ConceptSession
