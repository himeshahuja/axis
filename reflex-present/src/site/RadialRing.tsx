// The site's drawing of the Reflex Actions radial menu. Same geometry as the
// app's RadialActionMenu: Explain at the top, Remember lower-right, Voice
// lower-left — so wrist rotation clockwise moves toward Remember.

import type { Ref } from 'react'
import { ACTION_LABEL, type RadialAction } from '../spatial/radial/types'

export const SECTORS: { action: RadialAction; mid: number; key: string }[] = [
  { action: 'explain', mid: -90, key: 'E' },
  { action: 'remember', mid: 30, key: 'R' },
  { action: 'voice', mid: 150, key: 'V' },
]
const SPAN = 120
const GAP = 3

const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, d: number) => [r * Math.cos(rad(d)), r * Math.sin(rad(d))] as const

export function sectorPath(rIn: number, rOut: number, a0: number, a1: number) {
  const [x0, y0] = pt(rOut, a0)
  const [x1, y1] = pt(rOut, a1)
  const [x2, y2] = pt(rIn, a1)
  const [x3, y3] = pt(rIn, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`
}

/** Rotation (deg, clockwise +) → needle angle in SVG degrees. Sector centres sit at ±40°. */
export const needleAngle = (rotDeg: number) => -90 + Math.max(-150, Math.min(150, rotDeg * 3))

export function ActionGlyph({ action }: { action: RadialAction }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'square' as const }
  if (action === 'explain')
    return (
      <g {...s}>
        <path d="M-7,-7 H7 M-7,-2 H7 M-7,3 H3" />
        <path d="M-7,8 H-1" />
      </g>
    )
  if (action === 'remember')
    return (
      <g {...s}>
        <path d="M-6,-8 H6 V8 L0,4 L-6,8 Z" />
      </g>
    )
  return (
    <g {...s}>
      <path d="M-7,0 V0 M-3.5,-5 V5 M0,-8 V8 M3.5,-4 V4 M7,-1 V1" />
    </g>
  )
}

export function RadialRing({
  active,
  size = 300,
  rIn = 96,
  rOut = 140,
  open = true,
  onChoose,
  needleRef,
  labels = true,
}: {
  active: RadialAction | null
  size?: number
  rIn?: number
  rOut?: number
  open?: boolean
  onChoose?: (a: RadialAction) => void
  needleRef?: Ref<SVGGElement>
  labels?: boolean
}) {
  const h = size / 2
  return (
    <svg className={`radial ${open ? 'open' : ''}`} viewBox={`${-h} ${-h} ${size} ${size}`} width={size} height={size}>
      <circle r={rOut + 8} className="radial-halo" />
      {SECTORS.map(({ action, mid }, i) => {
        const on = action === active
        const [lx, ly] = pt((rIn + rOut) / 2, mid)
        const [tx, ty] = pt(rOut + 22, mid)
        return (
          <g
            key={action}
            className={`radial-sector ${on ? 'on' : ''}`}
            style={{ transitionDelay: `${i * 40}ms` }}
            onPointerDown={
              onChoose
                ? (e) => {
                    e.stopPropagation()
                    onChoose(action)
                  }
                : undefined
            }
            role={onChoose ? 'button' : undefined}
            aria-label={onChoose ? ACTION_LABEL[action] : undefined}
          >
            <path d={sectorPath(rIn, rOut, mid - SPAN / 2 + GAP / 2, mid + SPAN / 2 - GAP / 2)} />
            <g transform={`translate(${lx},${ly})`} className="radial-glyph">
              <ActionGlyph action={action} />
            </g>
            {labels && (
              <text x={tx} y={ty} textAnchor={Math.abs(Math.cos(rad(mid))) < 0.2 ? 'middle' : Math.cos(rad(mid)) > 0 ? 'start' : 'end'} dominantBaseline="middle" className="radial-label">
                {ACTION_LABEL[action]}
              </text>
            )}
          </g>
        )
      })}
      <g ref={needleRef} className="radial-needle">
        <line x1={rIn - 26} x2={rIn - 6} y1="0" y2="0" />
        <circle cx={rIn - 6} cy="0" r="2.5" />
      </g>
    </svg>
  )
}
