// 7 · Close. The pieces assemble into one row, fold into the orange point, the point
// goes out. Black. "THE INTERFACE IS YOU." held, then the name, smaller.

import type { ReactNode } from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeIn, easeInOut, lerp, prog, springy } from '../anim'
import { LineChart, Note, Waveform } from '../components/Viz'
import { Card, mono } from '../components/UI'
import { Logo, LOGO_H, LOGO_W } from '../components/Logo'
import { C, F, H, W } from '../theme'

export const S7_START = 1350

export const ASSEMBLE = 0
export const FOLD = 52
export const GONE = 88
export const LINE = 94
/** The product reveal (logo + impact). */
export const NAME = 200
const LOGO_FINAL_H = 170

function Glyph({ kind }: { kind: 'hand' | 'ring' | 'memory' }) {
  const s = { fill: 'none', stroke: C.ink, strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  if (kind === 'ring')
    return (
      <svg viewBox="-32 -32 64 64" style={{ width: '70%', height: '100%' }}>
        <path d="M-10,-22 A24,24 0 0 1 10,-22" {...s} stroke={C.hot} strokeWidth={6} />
        <path d="M17,-14 A24,24 0 0 1 22,8" {...s} strokeWidth={6} strokeOpacity={0.5} />
        <path d="M-17,-14 A24,24 0 0 0 -22,8" {...s} strokeWidth={6} strokeOpacity={0.5} />
        <circle r="3" fill={C.ink} />
      </svg>
    )
  if (kind === 'memory')
    return (
      <svg viewBox="-16 -16 32 32" style={{ width: '60%', height: '100%' }}>
        <path d="M-7,-10 h14 v20 l-7,-5 l-7,5 Z" {...s} stroke={C.hot} strokeWidth={1.6} />
      </svg>
    )
  return (
    <svg viewBox="-40 -48 80 64" style={{ width: '70%', height: '100%' }}>
      <circle cx="-10" cy="-26" r="13" fill="none" stroke={C.hot} strokeWidth={2.5} />
      <path d="M-10,-26 L8,6 M-10,-26 L-28,8" {...s} strokeOpacity={0.5} />
    </svg>
  )
}

interface Piece {
  tag: string
  label: string
  w: number
  from: [number, number, number]
  node: ReactNode
}

export function S7Close() {
  const frame = useCurrentFrame()
  const pieces: Piece[] = [
    { tag: 'CHART', label: 'Revenue', w: 380, from: [-300, 80, -8], node: <LineChart /> },
    { tag: 'NOTE', label: 'Notes', w: 300, from: [320, 1100, 6], node: <Note lines={['Ship pricing page', 'Onboarding day 2', 'Support load']} size={15} /> },
    { tag: 'GESTURE', label: 'Pinch', w: 190, from: [900, -320, -5], node: <Glyph kind="hand" /> },
    { tag: 'ACTIONS', label: 'Radial', w: 190, from: [1300, 1150, 9], node: <Glyph kind="ring" /> },
    { tag: 'VOICE', label: 'Voice', w: 190, from: [2100, 200, -7], node: <Waveform frame={frame + S7_START} width={150} height={60} bars={18} /> },
    { tag: 'MEMORY', label: 'Remember', w: 190, from: [2150, 900, 5], node: <Glyph kind="memory" /> },
  ]
  // Lay the row out centred.
  const gap = 24
  const total = pieces.reduce((a, p) => a + p.w, 0) + gap * (pieces.length - 1)
  let x = (W - total) / 2
  const slots = pieces.map((p) => {
    const s = x
    x += p.w + gap
    return s
  })
  const fold = prog(frame, FOLD, 26, easeIn)
  const cx = W / 2
  const cy = H / 2
  const pointR = lerp(0, 16, prog(frame, FOLD - 10, 12)) * (1 + 0.5 * fold) * (1 - prog(frame, GONE - 10, 12, easeInOut))
  const lineIn = prog(frame, LINE, 26)
  const lineOut = prog(frame, NAME - 24, 14, easeInOut)

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {fold < 1 &&
        pieces.map((p, i) => {
          const k = Math.min(1, springy(frame, ASSEMBLE + i * 3, 30, 120, 17))
          const sx = lerp(p.from[0], slots[i], k)
          const sy = lerp(p.from[1], cy - 150, k)
          const rot = lerp(p.from[2], 0, k)
          const fx = lerp(sx, cx - p.w / 2, fold)
          const fy = lerp(sy, cy - 120, fold)
          return (
            <Card key={p.tag} x={fx} y={fy} w={p.w} tag={p.tag} label={p.label} rot={rot} scale={1 - fold * 0.95} opacity={1 - prog(fold, 0.6, 0.4)} bodyPad={12}>
              {p.node}
            </Card>
          )
        })}
      {pointR > 0.2 && <div style={{ position: 'absolute', left: cx - pointR, top: cy - pointR, width: pointR * 2, height: pointR * 2, borderRadius: '50%', background: C.hot, boxShadow: `0 0 ${30 + 60 * fold}px rgba(255,90,31,0.6)` }} />}

      <div style={{ position: 'absolute', left: 0, right: 0, top: cy - 70, textAlign: 'center', fontFamily: F.display, fontSize: 96, lineHeight: 1.4, color: C.ink, opacity: lineIn * (1 - lineOut), transform: `translateY(${(1 - lineIn) * 24 - lineOut * 12}px)`, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>
        THE INTERFACE IS YOU.
      </div>
      {/* the product reveal: the logo lands with the impact */}
      {frame >= NAME && (
        <>
          <div style={{ position: 'absolute', left: cx - 700, top: cy - 420, width: 1400, height: 840, background: `radial-gradient(ellipse 50% 50% at 50% 50%, rgba(255,90,31,${0.16 * (1 - prog(frame, NAME, 50))}) 0%, rgba(255,90,31,0) 70%)` }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${1.035 - 0.035 * prog(frame, NAME, 60)})`, transformOrigin: `${cx}px ${cy}px` }}>
            <Logo height={LOGO_FINAL_H} x={cx - (LOGO_W * LOGO_FINAL_H) / LOGO_H / 2} y={cy - LOGO_FINAL_H / 2 - 40} brackets={prog(frame, NAME - 4, 4, easeIn)} bracketScale={1 + 0.06 * (1 - prog(frame, NAME, 10))} pills={prog(frame, NAME, 8)} crossbar={prog(frame, NAME - 1, 6)} word={prog(frame, NAME, 10)} />
          </div>
          <div style={{ ...mono, position: 'absolute', left: 0, right: 0, top: cy + LOGO_FINAL_H / 2 + 20, textAlign: 'center', fontSize: 24, letterSpacing: '0.26em', color: C.mute, opacity: prog(frame, NAME + 30, 24) }}>Built at VexoHacks 2026</div>
        </>
      )}
    </AbsoluteFill>
  )
}
