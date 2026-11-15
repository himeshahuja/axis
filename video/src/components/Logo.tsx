// The Axis logo, redrawn as vectors from the supplied artwork (measured in its own pixel
// grid): a square of four corner brackets around an "A" built from rounded scan-line
// pills, the orange crossbar as its fifth row, then the wordmark "XIS".
//
// Every part can be animated on its own so the logo can assemble on screen.

import { C, F } from '../theme'

// Artwork coordinates (source PNG pixels). The logo's bounding box starts at (69, 58).
const OX = 69
const OY = 58
export const LOGO_W = 633
export const LOGO_H = 186

/** Pills: [x0, x1, centreY]. Height 10, fully rounded. Row 5 is the orange crossbar. */
const PILLS: { x0: number; x1: number; y: number; row: number; hot?: boolean }[] = [
  { x0: 156, x1: 179, y: 100.5, row: 0 },
  { x0: 147, x1: 172, y: 117.5, row: 1 },
  { x0: 138, x1: 182, y: 134.5, row: 2 },
  { x0: 129, x1: 156, y: 151.5, row: 3 },
  { x0: 120, x1: 199, y: 168.5, row: 4, hot: true },
  { x0: 110, x1: 140, y: 185.5, row: 5 },
  { x0: 181, x1: 208, y: 185.5, row: 5 },
  { x0: 100, x1: 143, y: 202.5, row: 6 },
  { x0: 176, x1: 219, y: 202.5, row: 6 },
]
/** Where the crossbar's centre sits inside the logo box (artwork units). */
export const CROSSBAR = { x: 159.5 - OX, y: 168.5 - OY, w: 79 }

const BOX = { x0: 69, y0: 61, x1: 250, y1: 242 }
const ARM = 35
const STROKE = 7

/** Letter centres and baseline of "XIS" in artwork units (ink extents 292–702, cap height 187). */
const LETTERS = [
  { ch: 'X', cx: 362 },
  { ch: 'I', cx: 502.5 },
  { ch: 'S', cx: 638 },
]
const BASELINE = 242
const WORD_SIZE = 256
const WORD_WEIGHT = 500

export interface LogoProps {
  /** Rendered height in px; width follows (633:186). */
  height: number
  x: number
  y: number
  /** 0..1 per part; omit for a static, complete logo. */
  brackets?: number
  pills?: number
  crossbar?: number
  word?: number
  /** Extra scale on the brackets as they lock on (1 = resting). */
  bracketScale?: number
  opacity?: number
  markOnly?: boolean
  hot?: string
}

export function Logo({ height, x, y, brackets = 1, pills = 1, crossbar = 1, word = 1, bracketScale = 1, opacity = 1, markOnly = false, hot = C.hot }: LogoProps) {
  const s = height / LOGO_H
  const w = (markOnly ? 250 - OX + 2 : LOGO_W) * s
  const cx = (BOX.x0 + BOX.x1) / 2
  const cy = (BOX.y0 + BOX.y1) / 2
  const b = Math.max(0, Math.min(1, brackets))
  const corner = (px: number, py: number, dx: number, dy: number) => {
    // The corner's own corner at (px, py); arms run along +dx and +dy.
    const d = `M${px + dx * ARM},${py + (dy * STROKE) / 2} H${px + (dx * STROKE) / 2} V${py + dy * ARM}`
    return <path d={d} fill="none" stroke={C.ink} strokeWidth={STROKE} strokeLinecap="butt" strokeLinejoin="miter" />
  }
  return (
    <svg width={w} height={height} viewBox={`${OX} ${OY} ${markOnly ? 250 - OX + 2 : LOGO_W} ${LOGO_H}`} style={{ position: 'absolute', left: x, top: y, opacity, overflow: 'visible' }}>
      <g opacity={b} transform={`translate(${cx},${cy}) scale(${bracketScale + (1 - b) * 0.25}) translate(${-cx},${-cy})`}>
        {corner(BOX.x0, BOX.y0, 1, 1)}
        {corner(BOX.x1, BOX.y0, -1, 1)}
        {corner(BOX.x0, BOX.y1, 1, -1)}
        {corner(BOX.x1, BOX.y1, -1, -1)}
      </g>
      {PILLS.map((p, i) => {
        if (p.hot) {
          const k = Math.max(0, Math.min(1, crossbar))
          const mid = (p.x0 + p.x1) / 2
          const half = ((p.x1 - p.x0) / 2) * k
          return k > 0 ? <rect key={i} x={mid - Math.max(half, 5)} y={p.y - 5} width={Math.max(half * 2, 10)} height={10} rx={5} fill={hot} /> : null
        }
        // Rows slide in from the side they lean toward, top row first.
        const k = Math.max(0, Math.min(1, pills * 1.8 - p.row * 0.13))
        const side = (p.x0 + p.x1) / 2 < 160 ? -1 : 1
        return <rect key={i} x={p.x0 + side * (1 - k) * 40} y={p.y - 5} width={p.x1 - p.x0} height={10} rx={5} fill={C.ink} opacity={k} />
      })}
      {!markOnly &&
        LETTERS.map((l, i) => {
          const k = Math.max(0, Math.min(1, word * 1.6 - i * 0.3))
          return (
            <text key={l.ch} x={l.cx} y={BASELINE + (1 - k) * 40} textAnchor="middle" fill={C.ink} opacity={k} style={{ fontFamily: F.sans, fontWeight: WORD_WEIGHT, fontSize: WORD_SIZE, letterSpacing: 0 }}>
              {l.ch}
            </text>
          )
        })}
    </svg>
  )
}
