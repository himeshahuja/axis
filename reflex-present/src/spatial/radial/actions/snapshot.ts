// A screenshot of the selected object, so the agent sees what the audience sees: the object as
// drawn, with any annotations on it, even when it carries no data of its own.
//
// It renders the stage the object lives on (html-to-image), without the overlays (cards, menus,
// cursors, camera video), then crops to the object's box. Objects are placed in normalized
// stage coordinates, so the box is just x/y/w/h times the stage's size.

import type { SpatialObject } from '../../types'

/** The element objects are positioned in. A host can mark its own with data-snapshot-stage. */
const STAGE = '[data-snapshot-stage], .pitch-stage, .presentation-stage, .sp-canvas'
/** Never in the picture: the action overlays, cursors and the camera. */
const SKIP = '.presenter-actions, .ap-card, .ap-memory, .ap-saved, .pitch-voice, .presentation-cursor, .pitch-cursor, .rm-hold, video, [data-snapshot-skip]'
const PAD = 0.015
const MAX_SIDE = 1024

export interface Snapshot {
  mimeType: 'image/jpeg'
  /** Base64, without the data: prefix. */
  data: string
}

function stageFor(objectId: string): HTMLElement | null {
  const card = document.querySelector(`[data-explain-card="${CSS.escape(objectId)}"]`)
  return (card?.closest(STAGE) as HTMLElement | null) ?? document.querySelector<HTMLElement>(STAGE)
}

/** The first non-transparent background at or above `el`, so the JPEG is not black behind text. */
function backgroundOf(el: HTMLElement | null): string {
  for (let e = el; e; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor
    if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) return bg
  }
  return '#16171a'
}

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('snapshot timed out')), ms))])

/** The selected object as a JPEG, or null when there is no stage to capture (never throws). */
export async function snapshotObject(obj: SpatialObject, timeoutMs = 2500): Promise<Snapshot | null> {
  try {
    const stage = typeof document === 'undefined' ? null : stageFor(obj.id)
    if (!stage) return null
    const box = stage.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) return null
    const { toCanvas } = await import('html-to-image')
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    const full = await timeout(
      toCanvas(stage, {
        pixelRatio: ratio,
        backgroundColor: backgroundOf(stage),
        skipFonts: true,
        cacheBust: false,
        filter: (n) => !(n instanceof Element && n.matches(SKIP)),
      }),
      timeoutMs,
    )
    const x0 = Math.max(0, obj.x - PAD)
    const y0 = Math.max(0, obj.y - PAD)
    const x1 = Math.min(1, obj.x + obj.w + PAD)
    const y1 = Math.min(1, obj.y + obj.h + PAD)
    const sx = x0 * full.width
    const sy = y0 * full.height
    const sw = Math.max(1, (x1 - x0) * full.width)
    const sh = Math.max(1, (y1 - y0) * full.height)
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh))
    const out = document.createElement('canvas')
    out.width = Math.round(sw * scale)
    out.height = Math.round(sh * scale)
    const g = out.getContext('2d')
    if (!g) return null
    g.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
    const data = out.toDataURL('image/jpeg', 0.85).split(',')[1]
    return data ? { mimeType: 'image/jpeg', data } : null
  } catch {
    return null
  }
}
