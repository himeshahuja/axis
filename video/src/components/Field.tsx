// The site's orientation field (reflex-present/src/site/FieldCanvas.tsx): a lattice of
// short strokes following a slow flow, swinging tangent around the hand. Here it is a
// pure function of the frame instead of a spring simulation, so renders are exact.

import { C, H, W } from '../theme'

interface Props {
  frame: number
  /** Where the field unfolds from, and how far it has reached (px). Omit for full. */
  origin?: [number, number]
  reach?: number
  /** The hand: strokes near it turn tangent and glow. */
  hand?: [number, number] | null
  radius?: number
  spacing?: number
  opacity?: number
  /** Extra brightness for the base strokes, 0..1. */
  boost?: number
}

export function Field({ frame, origin, reach = Infinity, hand = null, radius = 300, spacing = 40, opacity = 1, boost = 0 }: Props) {
  const t = frame * 33.3 // ms-ish, so the flow speed matches the site's constants
  const cols = Math.ceil(W / spacing) + 1
  const rows = Math.ceil(H / spacing) + 1
  const ox = (W - (cols - 1) * spacing) / 2
  const oy = (H - (rows - 1) * spacing) / 2
  let base = ''
  let near = ''
  let hot = ''
  const R2 = radius * radius
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const x = ox + i * spacing
      const y = oy + j * spacing
      let grow = 1
      if (origin) {
        const d = Math.hypot(x - origin[0], y - origin[1])
        if (d > reach) continue
        grow = Math.min(1, (reach - d) / 160)
      }
      const flow = Math.sin(x * 0.0042 + t * 0.00018) * 1.1 + Math.cos(y * 0.0051 - t * 0.00013) * 0.9 + Math.sin((x + y) * 0.0019 + t * 0.0001) * 0.6
      let a = flow
      let wt = 0
      let cx = x
      let cy = y
      if (hand) {
        const dx = x - hand[0]
        const dy = y - hand[1]
        const d2 = dx * dx + dy * dy
        if (d2 < R2) {
          const d = Math.sqrt(d2) || 1
          wt = (1 - d / radius) ** 2
          const tangent = Math.atan2(dy, dx) + Math.PI / 2
          let diff = tangent - flow
          diff = ((((diff + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2
          a = flow + diff * Math.min(1, wt * 1.6)
          cx += (dx / d) * wt * 20
          cy += (dy / d) * wt * 20
        }
      }
      const L = 15 * (0.55 + wt * 1.3) * 0.5 * grow
      const ux = Math.cos(a) * L
      const uy = Math.sin(a) * L
      const seg = `M${(cx - ux).toFixed(1)},${(cy - uy).toFixed(1)}L${(cx + ux).toFixed(1)},${(cy + uy).toFixed(1)}`
      if (wt > 0.38) hot += seg
      else if (wt > 0.06) near += seg
      else base += seg
    }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', inset: 0, opacity }}>
      <path d={base} stroke={`rgba(242,240,235,${0.16 + boost * 0.2})`} strokeWidth={1.3} strokeLinecap="round" fill="none" />
      <path d={near} stroke="rgba(242,240,235,0.42)" strokeWidth={1.6} strokeLinecap="round" fill="none" />
      <path d={hot} stroke={C.hot} strokeOpacity={0.9} strokeWidth={2} strokeLinecap="round" fill="none" />
    </svg>
  )
}
