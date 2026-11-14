import type { Landmark3, Point2 } from '../types'

// MediaPipe hand landmark indices.
export const WRIST = 0
export const THUMB_TIP = 4
export const INDEX = { mcp: 5, pip: 6, tip: 8 }
export const MIDDLE = { mcp: 9, pip: 10, tip: 12 }
export const RING = { mcp: 13, pip: 14, tip: 16 }
export const PINKY = { mcp: 17, pip: 18, tip: 20 }
const FINGERS = [INDEX, MIDDLE, RING, PINKY]
const KEY_LANDMARKS = [WRIST, THUMB_TIP, INDEX.mcp, INDEX.tip, PINKY.mcp]

export type FingerState = 'extended' | 'curled' | 'ambiguous'

export interface HandFeatures {
  palm: Point2
  indexTip: Point2
  palmWidthPx: number
  pinchRatio: number
  fingers: { index: FingerState; middle: FingerState; ring: FingerState; pinky: FingerState }
  thumbExtended: boolean
  pointing: boolean
  openPalm: boolean
  /** All landmarks gestures depend on are inside the image. */
  keyInFrame: boolean
  inFrameFraction: number
}

const inFrame = (l: Landmark3) => l.x >= 0 && l.x <= 1 && l.y >= 0 && l.y <= 1

/** Distances are measured in pixels so non-square images don't skew ratios. */
export function computeHandFeatures(lm: Landmark3[], imageWidth: number, imageHeight: number): HandFeatures | null {
  if (lm.length !== 21) return null
  const d = (a: number, b: number) => Math.hypot((lm[a].x - lm[b].x) * imageWidth, (lm[a].y - lm[b].y) * imageHeight)

  const palmWidthPx = d(INDEX.mcp, PINKY.mcp)
  if (palmWidthPx < 1e-6) return null

  const finger = (f: { pip: number; tip: number }): FingerState => {
    const tip = d(WRIST, f.tip)
    const pip = d(WRIST, f.pip)
    if (tip > pip * 1.2) return 'extended'
    if (tip < pip * 1.05) return 'curled'
    return 'ambiguous'
  }
  const [index, middle, ring, pinky] = FINGERS.map(finger)
  const thumbExtended = d(THUMB_TIP, MIDDLE.mcp) > palmWidthPx * 1.1
  const pinchRatio = d(THUMB_TIP, INDEX.tip) / palmWidthPx

  const palmIdx = [WRIST, INDEX.mcp, MIDDLE.mcp, RING.mcp, PINKY.mcp]
  const palm = {
    x: palmIdx.reduce((s, i) => s + lm[i].x, 0) / palmIdx.length,
    y: palmIdx.reduce((s, i) => s + lm[i].y, 0) / palmIdx.length,
  }

  return {
    palm,
    indexTip: { x: lm[INDEX.tip].x, y: lm[INDEX.tip].y },
    palmWidthPx,
    pinchRatio,
    fingers: { index, middle, ring, pinky },
    thumbExtended,
    pointing: index === 'extended' && middle === 'curled' && ring === 'curled' && pinky === 'curled',
    openPalm:
      index === 'extended' && middle === 'extended' && ring === 'extended' && pinky === 'extended' && thumbExtended && pinchRatio > 0.8,
    keyInFrame: KEY_LANDMARKS.every((i) => inFrame(lm[i])),
    inFrameFraction: lm.filter(inFrame).length / lm.length,
  }
}
