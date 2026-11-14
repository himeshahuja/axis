import type { SpatialObject } from '../../types'
import type { RadialAction, RadialMenuState, SelectionSource } from '../types'
import { ACTION_LABEL } from '../types'

// Fixed layout: Explain at the top, Remember lower-right, Voice lower-left.
// Angles are SVG degrees (0 = right, clockwise, y down).
const SECTORS: { action: RadialAction; mid: number }[] = [
  { action: 'explain', mid: -90 },
  { action: 'remember', mid: 30 },
  { action: 'voice', mid: 150 },
]
const SPAN = 120
const GAP = 4

const SOURCE_LABEL: Record<SelectionSource, string> = {
  vexo: `Vexo band · wrist rotation`,
  camera: 'Camera · hand tilt (approx.)',
  simulator: 'Simulator (not real input)',
  keyboard: 'Keyboard',
  wheel: 'Mouse wheel',
  click: 'Click',
  none: 'Keys / wheel only',
}

const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, d: number) => [r * Math.cos(rad(d)), r * Math.sin(rad(d))]

function sectorPath(rIn: number, rOut: number, a0: number, a1: number) {
  const [x0, y0] = pt(rOut, a0)
  const [x1, y1] = pt(rOut, a1)
  const [x2, y2] = pt(rIn, a1)
  const [x3, y3] = pt(rIn, a0)
  return `M${x0},${y0} A${rOut},${rOut} 0 0 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 0 0 ${x3},${y3} Z`
}

function Icon({ action }: { action: RadialAction }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (action === 'explain')
    return (
      <g {...s}>
        <path d="M-6,-3 a6,6 0 1 1 9,5 c-2,1 -3,2 -3,4" />
        <circle cx="0" cy="11" r="0.6" fill="currentColor" />
      </g>
    )
  if (action === 'remember')
    return (
      <g {...s}>
        <path d="M-7,-10 h14 v20 l-7,-5 l-7,5 Z" />
      </g>
    )
  return (
    <g {...s}>
      <rect x="-4" y="-11" width="8" height="14" rx="4" />
      <path d="M-8,0 a8,8 0 0 0 16,0 M0,8 v4" />
    </g>
  )
}

export interface RadialMenuProps {
  state: RadialMenuState
  object: SpatialObject
  /** Canvas size in px, for positioning and bounds. */
  canvas: { w: number; h: number }
  thresholdDeg: number
  maxDeg: number
  closing: boolean
  bandLost: boolean
  /** The band is the kit's pretend band: its gyro data is simulated. */
  bandPretend: boolean
  onChoose: (a: RadialAction) => void
}

export function RadialActionMenu({ state, object, canvas, thresholdDeg, maxDeg, closing, bandLost, bandPretend, onChoose }: RadialMenuProps) {
  const sourceLabel = state.inputSource === 'vexo' && bandPretend ? 'Vexo PRETEND band · simulated gyro' : SOURCE_LABEL[state.inputSource]
  const R = Math.round(Math.max(130, Math.min(220, Math.min(canvas.w, canvas.h) * 0.2)))
  const rIn = R * 0.42
  const pad = 16
  const cx = Math.max(R + pad, Math.min(canvas.w - R - pad, (object.x + object.w / 2) * canvas.w))
  const cy = Math.max(R + pad, Math.min(canvas.h - R - pad - 44, (object.y + object.h / 2) * canvas.h))
  const lost = state.status === 'TRACKING_LOST'
  const confirming = state.status === 'CONFIRMING' || state.status === 'CONFIRMED'
  // Needle: 0° at the top; rotation degrees map 1:1 up to the clamp.
  const needle = -90 + Math.max(-maxDeg, Math.min(maxDeg, state.rotationDegrees))
  const fontSize = Math.round(R * 0.125)

  return (
    <div className={`rm-root ${closing ? 'rm-closing' : ''} ${lost ? 'rm-lost' : ''}`} style={{ left: cx - R, top: cy - R, width: R * 2, height: R * 2 + 48 }}>
      <svg width={R * 2} height={R * 2} viewBox={`${-R} ${-R} ${R * 2} ${R * 2}`} className="rm-svg">
        <defs>
          <radialGradient id="rm-bg">
            <stop offset="40%" stopColor="rgba(14,22,40,0.88)" />
            <stop offset="100%" stopColor="rgba(10,16,30,0.95)" />
          </radialGradient>
          <filter id="rm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle r={R - 1} fill="url(#rm-bg)" stroke="rgba(120,200,255,0.18)" />
        {SECTORS.map(({ action, mid }) => {
          const active = state.activeAction === action
          const [lx, ly] = pt((rIn + R) / 2, mid)
          return (
            <g
              key={action}
              className={`rm-sector ${active ? 'rm-active' : ''} ${active && confirming ? 'rm-confirm' : ''}`}
              onPointerDown={(e) => {
                e.stopPropagation()
                onChoose(action)
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <path d={sectorPath(rIn + 4, R - 6, mid - SPAN / 2 + GAP / 2, mid + SPAN / 2 - GAP / 2)} filter={active ? 'url(#rm-glow)' : undefined} />
              <g transform={`translate(${lx},${ly - fontSize * 0.55}) scale(${R / 150})`} className="rm-icon">
                <Icon action={action} />
              </g>
              <text x={lx} y={ly + fontSize * 1.05} textAnchor="middle" fontSize={fontSize} className="rm-label">
                {ACTION_LABEL[action]}
              </text>
            </g>
          )
        })}
        {/* threshold ticks and wrist-orientation needle on the inner ring */}
        <circle r={rIn - 6} fill="rgba(6,10,20,0.92)" stroke="rgba(120,200,255,0.25)" />
        {[-thresholdDeg, thresholdDeg].map((d) => {
          const [x0, y0] = pt(rIn - 6, -90 + d)
          const [x1, y1] = pt(rIn - 16, -90 + d)
          return <line key={d} x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(120,200,255,0.45)" strokeWidth={2} />
        })}
        <g className="rm-needle" style={{ transform: `rotate(${needle + 90}deg)` }}>
          <line x1={0} y1={-(rIn - 10)} x2={0} y2={-(rIn - 24)} stroke="#7fe3ff" strokeWidth={4} strokeLinecap="round" />
        </g>
        <circle r={rIn * 0.36} fill={object.color} opacity={0.9} />
        <text y={rIn * 0.62} textAnchor="middle" fontSize={Math.round(fontSize * 0.62)} className="rm-center-label">
          {object.label.length > 18 ? `${object.label.slice(0, 17)}…` : object.label}
        </text>
      </svg>
      <div className="rm-hint" style={{ fontSize: Math.round(fontSize * 0.62) }}>
        {lost ? (
          <span className="rm-warn">Hand lost — menu held, nothing will run</span>
        ) : bandLost ? (
          <span className="rm-warn">Band disconnected — rotate by hand tilt, ← → keys or wheel</span>
        ) : (
          <>
            Rotate wrist · release to {ACTION_LABEL[state.activeAction].toLowerCase()} · open palm to cancel
          </>
        )}
        <div className="rm-source">{sourceLabel}</div>
      </div>
    </div>
  )
}

/** Hold progress ring drawn around the object while a pinch is held still. */
export function HoldRing({ object, canvas, progress }: { object: SpatialObject; canvas: { w: number; h: number }; progress: number }) {
  const cx = (object.x + object.w / 2) * canvas.w
  const cy = (object.y + object.h / 2) * canvas.h
  const r = Math.max(object.w * canvas.w, object.h * canvas.h) * 0.62
  const c = 2 * Math.PI * r
  return (
    <svg className="rm-hold" style={{ left: cx - r - 6, top: cy - r - 6 }} width={r * 2 + 12} height={r * 2 + 12} viewBox={`${-r - 6} ${-r - 6} ${r * 2 + 12} ${r * 2 + 12}`}>
      <circle r={r} fill="none" stroke="rgba(127,227,255,0.15)" strokeWidth={5} />
      <circle r={r} fill="none" stroke="#7fe3ff" strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, progress))} transform="rotate(-90)" />
    </svg>
  )
}
