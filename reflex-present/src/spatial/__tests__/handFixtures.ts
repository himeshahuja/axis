import type { Landmark3 } from '../types'

export const W = 640
export const H = 480

type Pose = 'extended' | 'curled'

export interface HandSpec {
  index?: Pose
  middle?: Pose
  ring?: Pose
  pinky?: Pose
  thumb?: Pose
  /** If set, the thumb tip is placed this many palm-widths from the index tip. */
  pinchRatio?: number
  /** Shift every landmark (e.g. to push the hand out of frame). */
  shift?: { x: number; y: number }
}

const WRIST = { x: 0.5, y: 0.8 }
const MCPS = [
  { x: 0.45, y: 0.6 },
  { x: 0.49, y: 0.58 },
  { x: 0.53, y: 0.59 },
  { x: 0.57, y: 0.62 },
]

/** A plausible, upright right hand in MediaPipe's normalized image coords. */
export function makeHand(spec: HandSpec = {}): Landmark3[] {
  const poses: Pose[] = [spec.index, spec.middle, spec.ring, spec.pinky].map((p) => p ?? 'extended')
  const lm: Landmark3[] = new Array(21)
  lm[0] = { ...WRIST, z: 0 }
  const thumbExt = (spec.thumb ?? 'extended') === 'extended'
  lm[1] = { x: 0.44, y: 0.76, z: 0 }
  lm[2] = { x: 0.4, y: 0.72, z: 0 }
  lm[3] = { x: 0.37, y: 0.68, z: 0 }
  lm[4] = thumbExt ? { x: 0.34, y: 0.64, z: 0 } : { x: 0.46, y: 0.66, z: 0 }
  MCPS.forEach((mcp, f) => {
    const base = 5 + f * 4
    const ext = poses[f] === 'extended'
    lm[base] = { ...mcp, z: 0 }
    lm[base + 1] = { x: mcp.x, y: mcp.y - 0.04, z: 0 }
    lm[base + 2] = { x: mcp.x, y: ext ? mcp.y - 0.1 : mcp.y - 0.01, z: 0 }
    lm[base + 3] = { x: mcp.x, y: ext ? mcp.y - 0.14 : mcp.y + 0.03, z: 0 }
  })
  if (spec.pinchRatio !== undefined) {
    const palmWidthPx = Math.hypot((lm[5].x - lm[17].x) * W, (lm[5].y - lm[17].y) * H)
    lm[4] = { x: lm[8].x - (spec.pinchRatio * palmWidthPx) / W, y: lm[8].y, z: 0 }
  }
  if (spec.shift) for (const l of lm) [l.x, l.y] = [l.x + spec.shift.x, l.y + spec.shift.y]
  return lm
}

export const mirror = (lm: Landmark3[]) => lm.map((l) => ({ ...l, x: 1 - l.x }))
