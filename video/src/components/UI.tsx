// Shared Axis UI pieces at film scale: the object card (site `.floater`), selection
// brackets (`.select-bracket`), the spatial pointer (`.sp-pointer`), a schematic hand
// (MediaPipe's 21-landmark topology), the radial ring (site RadialRing) and headlines.

import type { CSSProperties, ReactNode } from 'react'
import { ease, lerp, prog } from '../anim'
import { C, F } from '../theme'

export const mono: CSSProperties = {
  fontFamily: F.sans,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
}

// ---- card ------------------------------------------------------------------------------

export interface CardProps {
  x: number
  y: number
  w: number
  tag: string
  index?: string
  label: string
  children: ReactNode
  rot?: number
  scale?: number
  /** 0..1: orange border, as the site does on hover/selection. */
  hot?: number
  /** 0..1: lifted off the canvas (bigger shadow). */
  lift?: number
  opacity?: number
  blur?: number
  bodyPad?: number
  origin?: string
}

export function Card({ x, y, w, tag, index, label, children, rot = 0, scale = 1, hot = 0, lift = 0, opacity = 1, blur = 0, bodyPad = 16, origin = '50% 50%' }: CardProps) {
  const border = hot > 0 ? `color-mix(in srgb, ${C.hot} ${Math.round(hot * 100)}%, ${C.line2})` : C.line2
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        background: C.card,
        border: `1.5px solid ${border}`,
        color: C.ink,
        transform: `rotate(${rot}deg) scale(${scale})`,
        transformOrigin: origin,
        opacity,
        filter: blur > 0 ? `blur(${blur}px)` : undefined,
        boxShadow: `0 ${30 + lift * 40}px ${60 + lift * 60}px -${30 - lift * 6}px rgba(0,0,0,${0.9})`,
      }}
    >
      <div style={{ ...mono, display: 'flex', justifyContent: 'space-between', fontSize: 16, color: hot > 0.5 ? C.hot : C.mute, padding: '13px 15px', borderBottom: `1px solid ${C.line}` }}>
        <span>{tag}</span>
        {index && <span>{index}</span>}
      </div>
      <div style={{ padding: bodyPad, aspectRatio: '100 / 64', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>
      <div style={{ fontFamily: F.sans, fontSize: 20, padding: '11px 15px', borderTop: `1px solid ${C.line}`, color: C.ink }}>{label}</div>
    </div>
  )
}

/** Card height for a given width (head + body aspect + foot), to place brackets and panels. */
export const cardHeight = (w: number, bodyPad = 16) => 42 + (w - bodyPad * 2) * 0.64 + bodyPad * 2 + 47

// ---- selection brackets --------------------------------------------------------------

export function Bracket({ x, y, w, h, label, opacity }: { x: number; y: number; w: number; h: number; label?: string; opacity: number }) {
  const arm = 22
  const b = `2.5px solid ${C.hot}`
  const corner = (s: CSSProperties) => <i style={{ position: 'absolute', width: arm, height: arm, ...s }} />
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, opacity, pointerEvents: 'none' }}>
      {corner({ left: 0, top: 0, borderLeft: b, borderTop: b })}
      {corner({ right: 0, top: 0, borderRight: b, borderTop: b })}
      {corner({ left: 0, bottom: 0, borderLeft: b, borderBottom: b })}
      {corner({ right: 0, bottom: 0, borderRight: b, borderBottom: b })}
      {label && <span style={{ ...mono, position: 'absolute', left: 0, top: -30, fontSize: 15, color: C.hot, whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  )
}

// ---- pointer -----------------------------------------------------------------------------

/** `.sp-pointer`: an open ring that closes into a filled dot as the pinch closes. */
export function Pointer({ x, y, pinch = 0, hold = 0, opacity = 1, color = C.hot }: { x: number; y: number; pinch?: number; hold?: number; opacity?: number; color?: string }) {
  const r = lerp(22, 11, pinch)
  const holdR = 40
  const circ = 2 * Math.PI * holdR
  return (
    <svg width={120} height={120} viewBox="-60 -60 120 120" style={{ position: 'absolute', left: x - 60, top: y - 60, opacity, overflow: 'visible' }}>
      <circle r={r} fill={color} fillOpacity={pinch} stroke={color} strokeWidth={4.5} />
      {hold > 0 && (
        <>
          <circle r={holdR} fill="none" stroke={C.line2} strokeWidth={3} />
          <circle r={holdR} fill="none" stroke={color} strokeWidth={3.5} strokeDasharray={circ} strokeDashoffset={circ * (1 - hold)} transform="rotate(-90)" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}

// ---- hand ----------------------------------------------------------------------------

type P = [number, number]
// A right hand, palm to camera, as 21 landmarks (wrist, then thumb→pinky, base→tip).
const OPEN: P[] = [
  [0, 0], [-42, -24], [-80, -58], [-104, -94], [-124, -124],
  [-36, -122], [-46, -178], [-51, -214], [-54, -246],
  [0, -128], [1, -190], [2, -228], [2, -262],
  [33, -120], [42, -175], [46, -209], [49, -237],
  [62, -102], [78, -146], [86, -173], [92, -198],
]
// Thumb tip and index tip meet: the pinch.
const PINCH: P[] = [
  [0, 0], [-42, -24], [-76, -60], [-92, -98], [-96, -140],
  [-36, -122], [-58, -168], [-80, -168], [-96, -146],
  [0, -128], [-4, -186], [-8, -218], [-10, -244],
  [33, -120], [38, -170], [40, -200], [42, -226],
  [62, -102], [74, -142], [80, -166], [84, -188],
]
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

/** Where the pointer sits for a hand at the origin: midway between thumb and index tips. */
export function pinchPoint(pinch: number, scale = 1, tilt = 0): P {
  const pts = handPoints(pinch, scale, tilt)
  return [(pts[4][0] + pts[8][0]) / 2, (pts[4][1] + pts[8][1]) / 2]
}

function handPoints(pinch: number, scale: number, tilt: number): P[] {
  const c = Math.cos((tilt * Math.PI) / 180)
  const s = Math.sin((tilt * Math.PI) / 180)
  return OPEN.map((o, i) => {
    const x = lerp(o[0], PINCH[i][0], pinch) * scale
    const y = lerp(o[1], PINCH[i][1], pinch) * scale
    return [x * c - y * s, x * s + y * c]
  })
}

/**
 * A schematic hand drawn so its pinch point lands on (px, py). Stylised, not camera
 * footage: it stands for the hand the camera tracks.
 */
export function Hand({ px, py, pinch = 0, scale = 1.25, tilt = 0, opacity = 0.5 }: { px: number; py: number; pinch?: number; scale?: number; tilt?: number; opacity?: number }) {
  const pts = handPoints(pinch, scale, tilt)
  const [ox, oy] = pinchPoint(pinch, scale, tilt)
  const dx = px - ox
  const dy = py - oy
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0, opacity, overflow: 'visible', pointerEvents: 'none' }}>
      <g transform={`translate(${dx.toFixed(1)},${dy.toFixed(1)})`}>
        {BONES.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke={C.ink} strokeOpacity={0.55} strokeWidth={2} strokeLinecap="round" />
        ))}
        {pts.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i === 4 || i === 8 ? 5.5 : 3.6} fill={i === 4 || i === 8 ? C.hot : C.bg} stroke={i === 4 || i === 8 ? C.hot : C.ink} strokeOpacity={0.8} strokeWidth={1.6} />
        ))}
      </g>
    </svg>
  )
}

// ---- radial ring -----------------------------------------------------------------------

export type Action = 'explain' | 'remember' | 'voice'
const LABEL: Record<Action, string> = { explain: 'Explain', remember: 'Remember', voice: 'Voice' }
// Same geometry as the app: Explain on top, Remember lower-right (clockwise), Voice lower-left.
export const SECTORS: { action: Action; mid: number }[] = [
  { action: 'explain', mid: -90 },
  { action: 'remember', mid: 30 },
  { action: 'voice', mid: 150 },
]
const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, d: number): P => [r * Math.cos(rad(d)), r * Math.sin(rad(d))]

function sectorPath(rIn: number, rOut: number, a0: number, a1: number) {
  const [x0, y0] = pt(rOut, a0)
  const [x1, y1] = pt(rOut, a1)
  const [x2, y2] = pt(rIn, a1)
  const [x3, y3] = pt(rIn, a0)
  return `M${x0},${y0} A${rOut},${rOut} 0 0 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 0 0 ${x3},${y3} Z`
}

function Glyph({ action }: { action: Action }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (action === 'explain')
    return (
      <g {...s}>
        <path d="M-6,-3 a6,6 0 1 1 9,5 c-2,1 -3,2 -3,4" />
        <circle cx="0" cy="11" r="0.8" fill="currentColor" />
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

/**
 * The radial menu. `open` 0..1 animates the sectors in (staggered, like the site);
 * `needle` is the indicator angle in SVG degrees (-90 = Explain).
 */
export function Radial({ cx, cy, open, active, needle = -90, confirm = 0, rIn = 120, rOut = 200 }: { cx: number; cy: number; open: number; active: Action | null; needle?: number; confirm?: number; rIn?: number; rOut?: number }) {
  const size = rOut * 2 + 220
  const h = size / 2
  return (
    <svg width={size} height={size} viewBox={`${-h} ${-h} ${size} ${size}`} style={{ position: 'absolute', left: cx - h, top: cy - h, overflow: 'visible', filter: 'drop-shadow(0 20px 50px rgba(0,0,0,0.55))' }}>
      <circle r={rOut + 14} fill="none" stroke={C.line2} strokeDasharray="3 9" strokeWidth={1.5} opacity={open} />
      {SECTORS.map(({ action, mid }, i) => {
        const o = Math.max(0, Math.min(1, open * 1.6 - i * 0.2))
        const k = ease(o)
        const on = action === active
        const [lx, ly] = pt((rIn + rOut) / 2, mid)
        const [tx, ty] = pt(rOut + 34, mid)
        const anchor = Math.abs(Math.cos(rad(mid))) < 0.2 ? 'middle' : Math.cos(rad(mid)) > 0 ? 'start' : 'end'
        return (
          <g key={action} opacity={k} transform={`scale(${0.82 + 0.18 * k})`} color={on ? C.bg : C.ink}>
            <path d={sectorPath(rIn, rOut, mid - 60 + 1.5, mid + 60 - 1.5)} fill={on ? C.hot : 'rgba(17,17,17,0.94)'} stroke={on ? C.hot : C.line2} strokeWidth={1.5} opacity={on && confirm > 0 ? 1 - 0.35 * Math.sin(confirm * Math.PI) : 1} />
            <g transform={`translate(${lx},${ly}) scale(1.9)`}>
              <Glyph action={action} />
            </g>
            <text x={tx} y={ty} textAnchor={anchor} dominantBaseline="middle" fill={on ? C.hot : C.mute} style={{ ...mono, fontSize: 22, letterSpacing: '0.12em' }}>
              {LABEL[action]}
            </text>
          </g>
        )
      })}
      <g opacity={open} transform={`rotate(${needle})`}>
        <line x1={rIn - 44} x2={rIn - 10} y1="0" y2="0" stroke={C.ink} strokeWidth={2.5} />
        <circle cx={rIn - 10} cy="0" r="4.5" fill={C.ink} />
      </g>
    </svg>
  )
}

// ---- type ------------------------------------------------------------------------------

/**
 * A headline in the site's display face, each line rising out of a mask (the site's
 * `[data-reveal]`), staggered. `out` 0..1 lifts it away.
 */
export function Headline({ lines, frame, start, size = 96, stagger = 5, out = 0, color = C.ink, align = 'left', style, hotWord }: { lines: string[]; frame: number; start: number; size?: number; stagger?: number; out?: number; color?: string; align?: 'left' | 'center'; style?: CSSProperties; hotWord?: string }) {
  return (
    <div style={{ position: 'absolute', fontFamily: F.display, fontSize: size, lineHeight: 1.02, color, textAlign: align, letterSpacing: '0.005em', ...style }}>
      {lines.map((l, i) => {
        const p = prog(frame, start + i * stagger, 22)
        const y = (1 - p) * size * 0.9 - out * size * 0.5
        return (
          <div key={i} style={{ overflow: 'hidden', paddingTop: size * 0.08, paddingBottom: size * 0.06 }}>
            <div style={{ transform: `translateY(${y}px)`, opacity: Math.min(p * 1.4, 1) * (1 - out), whiteSpace: 'nowrap' }}>
              {hotWord && l.includes(hotWord) ? (
                <>
                  {l.slice(0, l.indexOf(hotWord))}
                  <span style={{ color: C.hot }}>{hotWord}</span>
                  {l.slice(l.indexOf(hotWord) + hotWord.length)}
                </>
              ) : (
                l
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** A small uppercase label, the site's `.mono` style, with an optional orange index. */
export function Kicker({ index, text, x, y, opacity = 1, size = 20 }: { index?: string; text: string; x: number; y: number; opacity?: number; size?: number }) {
  return (
    <div style={{ ...mono, position: 'absolute', left: x, top: y, fontSize: size, color: C.mute, display: 'flex', gap: 18, opacity, whiteSpace: 'nowrap' }}>
      {index && <span style={{ color: C.hot }}>{index}</span>}
      <span>{text}</span>
    </div>
  )
}
