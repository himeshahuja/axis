// Maps camera-frame hand positions to a *virtual* canvas cursor. This is a
// 2D mapping of hand movement inside a chosen region of the camera image,
// not a reconstruction of where the user is physically pointing: we have no
// camera-to-display geometry, so no pointing ray is claimed.

import type { CalibrationSample, Point2 } from './types'

/** Rect in the (mirror/flip-adjusted) camera frame. */
export interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface CalibrationProfile {
  version: 1
  /** Flip camera x so moving the hand right moves the cursor right (selfie view). */
  mirrorX: boolean
  flipY: boolean
  region: Region
  /** Least-squares affine fit [a, b, c, d, e, f]: X = a·x + b·y + c, Y = d·x + e·y + f. */
  affine?: [number, number, number, number, number, number]
  /** RMS residual of the affine fit on its own samples, in canvas units. */
  fitRms?: number
  /** Added after mapping; set by recentering. */
  offset: Point2
  samples: CalibrationSample[]
  updatedAt: number
}

export const defaultProfile = (): CalibrationProfile => ({
  version: 1,
  mirrorX: true,
  flipY: false,
  region: { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.75 },
  offset: { x: 0, y: 0 },
  samples: [],
  updatedAt: Date.now(),
})

/** Raw MediaPipe camera coords → orientation-adjusted camera coords. */
export function orient(p: Point2, profile: Pick<CalibrationProfile, 'mirrorX' | 'flipY'>): Point2 {
  return { x: profile.mirrorX ? 1 - p.x : p.x, y: profile.flipY ? 1 - p.y : p.y }
}

function mapOriented(p: Point2, profile: CalibrationProfile): Point2 {
  if (profile.affine) {
    const [a, b, c, d, e, f] = profile.affine
    return { x: a * p.x + b * p.y + c, y: d * p.x + e * p.y + f }
  }
  const { x0, y0, x1, y1 } = profile.region
  return { x: (p.x - x0) / (x1 - x0), y: (p.y - y0) / (y1 - y0) }
}

/** Raw camera point → canvas point (unclamped; callers clamp). */
export function cameraToCanvas(raw: Point2, profile: CalibrationProfile): Point2 {
  const m = mapOriented(orient(raw, profile), profile)
  return { x: m.x + profile.offset.x, y: m.y + profile.offset.y }
}

/** Shift the mapping so the hand's current position lands on the canvas centre. */
export function recenter(profile: CalibrationProfile, rawNow: Point2): CalibrationProfile {
  const m = mapOriented(orient(rawNow, profile), profile)
  return { ...profile, offset: { x: 0.5 - m.x, y: 0.5 - m.y }, updatedAt: Date.now() }
}

/** Region from two opposite corners given in raw camera coords. */
export function regionFromCorners(rawA: Point2, rawB: Point2, profile: CalibrationProfile): Region {
  const a = orient(rawA, profile)
  const b = orient(rawB, profile)
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) }
}

function solve3(m: number[][], v: number[]): number[] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const D = det(m)
  if (Math.abs(D) < 1e-9) return null
  return [0, 1, 2].map((col) => det(m.map((row, r) => row.map((x, c) => (c === col ? v[r] : x)))) / D)
}

/**
 * Least-squares affine from samples whose `camera` point is already oriented
 * (mirror/flip applied). Returns null for < 3 or collinear samples.
 */
export function fitAffine(samples: CalibrationSample[]): { affine: CalibrationProfile['affine']; rms: number } | null {
  const pts = samples.filter((s) => s.camera)
  if (pts.length < 3) return null
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const atX = [0, 0, 0]
  const atY = [0, 0, 0]
  for (const s of pts) {
    const row = [s.camera!.x, s.camera!.y, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) ata[i][j] += row[i] * row[j]
      atX[i] += row[i] * s.target.x
      atY[i] += row[i] * s.target.y
    }
  }
  const px = solve3(ata, atX)
  const py = solve3(ata, atY)
  if (!px || !py) return null
  const affine = [...px, ...py] as [number, number, number, number, number, number]
  const sq = pts.reduce((acc, s) => {
    const X = affine[0] * s.camera!.x + affine[1] * s.camera!.y + affine[2]
    const Y = affine[3] * s.camera!.x + affine[4] * s.camera!.y + affine[5]
    return acc + (X - s.target.x) ** 2 + (Y - s.target.y) ** 2
  }, 0)
  return { affine, rms: Math.sqrt(sq / pts.length) }
}

/** Default multi-point targets, inset from the edges so they are reachable. */
export const CALIBRATION_TARGETS: Point2[] = [
  { x: 0.1, y: 0.12 },
  { x: 0.9, y: 0.12 },
  { x: 0.5, y: 0.5 },
  { x: 0.1, y: 0.88 },
  { x: 0.9, y: 0.88 },
]

const storageKey = (deviceKey: string) => `reflex.spatial.calibration.v1:${deviceKey}`

export function loadProfile(deviceKey: string): CalibrationProfile {
  try {
    const raw = localStorage.getItem(storageKey(deviceKey))
    if (raw) {
      const parsed = JSON.parse(raw) as CalibrationProfile
      if (parsed.version === 1) return parsed
    }
  } catch {
    // storage unavailable or corrupt: fall back to defaults
  }
  return defaultProfile()
}

export function saveProfile(deviceKey: string, profile: CalibrationProfile) {
  try {
    localStorage.setItem(storageKey(deviceKey), JSON.stringify(profile))
  } catch {
    // private window / blocked storage: calibration still works for this session
  }
}
