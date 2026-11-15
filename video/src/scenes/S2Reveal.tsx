// 2 · Reveal. Black. One orange point. The site's orientation field unfolds from it,
// then the point travels into place and stretches into the logo's crossbar: the scan
// lines slide in around it, the brackets lock on, the wordmark rises. "POINT. HOLD. ACT."

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeIn, easeInOut, lerp, prog, springy } from '../anim'
import { Field } from '../components/Field'
import { CROSSBAR, Logo, LOGO_H, LOGO_W } from '../components/Logo'
import { mono } from '../components/UI'
import { C, H, W } from '../theme'

export const S2_START = 195

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const POINT_AT = 8
export const FIELD_AT = 26
export const TRAVEL_AT = 52
export const CROSSBAR_AT = 72
export const PILLS_AT = 76
export const LOCK_AT = 96 // brackets land
export const WORD_AT = 92
export const WORDS_AT = [112, 121, 130]
export const S2_OUT = 178

const LOGO_HEIGHT = 270
const S = LOGO_HEIGHT / LOGO_H
const LOGO_X = (W - LOGO_W * S) / 2
const LOGO_Y = 470 - LOGO_HEIGHT / 2

export function S2Reveal() {
  const frame = useCurrentFrame()
  const g = frame + S2_START
  const pop = springy(frame, POINT_AT, 30, 200, 14)
  const reach = lerp(0, 2300, prog(frame, FIELD_AT, 70, easeInOut))
  // The point travels to where the crossbar will be, shrinking to the bar's thickness.
  const travel = prog(frame, TRAVEL_AT, CROSSBAR_AT - TRAVEL_AT, easeInOut)
  const barX = LOGO_X + CROSSBAR.x * S
  const barY = LOGO_Y + CROSSBAR.y * S
  const px = lerp(W / 2, barX, travel)
  const py = lerp(H / 2, barY, travel)
  const pr = lerp(10 * pop, 5 * S, travel)
  const asBar = frame >= CROSSBAR_AT
  const out = prog(frame, S2_OUT, 17, easeInOut)
  const words = ['POINT.', 'HOLD.', 'ACT.']
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: 1 - out * 0.6 }}>
        <Field frame={g} origin={[W / 2, H / 2]} reach={reach} hand={[px, py]} radius={lerp(320, 230, travel)} opacity={lerp(1, 0.5, prog(frame, 80, 40))} />
      </AbsoluteFill>
      {/* halo pulses on arrival */}
      {[0, 1].map((i) => {
        const p = prog(frame, 10 + i * 9, 34)
        return p > 0 && p < 1 ? <div key={i} style={{ position: 'absolute', left: px - 20 - p * 120, top: py - 20 - p * 120, width: 40 + p * 240, height: 40 + p * 240, borderRadius: '50%', border: `2px solid ${C.hot}`, opacity: (1 - p) * 0.6 }} /> : null
      })}
      <Logo
        height={LOGO_HEIGHT}
        x={LOGO_X}
        y={LOGO_Y}
        crossbar={asBar ? prog(frame, CROSSBAR_AT, 10) : 0}
        pills={prog(frame, PILLS_AT, 20)}
        brackets={prog(frame, LOCK_AT - 6, 6, easeIn)}
        bracketScale={1 + 0.05 * (1 - prog(frame, LOCK_AT, 8))}
        word={prog(frame, WORD_AT, 20)}
        opacity={1 - out}
      />
      {!asBar && <div style={{ position: 'absolute', left: px - pr, top: py - pr, width: pr * 2, height: pr * 2, borderRadius: '50%', background: C.hot, boxShadow: `0 0 ${40 * (1 - travel) + 14}px rgba(255,90,31,0.55)` }} />}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', justifyContent: 'center', gap: 64, opacity: 1 - out }}>
        {words.map((w, i) => {
          const p = prog(frame, WORDS_AT[i], 18)
          return (
            <span key={w} style={{ ...mono, fontSize: 40, letterSpacing: '0.3em', color: i === 2 ? C.hot : C.ink, opacity: p, transform: `translateY(${(1 - p) * 18}px)` }}>
              {w}
            </span>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
