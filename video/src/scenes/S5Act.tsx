// 5 · Memory and Voice.
//   Remember: the chart contracts into a memory card in the saved collection (browser
//   storage on this device, as the app does; nothing is written to the band).
//   Voice: the band mic listens, "Compare this with last quarter." is transcribed, and a
//   previous-quarter comparison computed from the chart's own data docks beside it on
//   the same scale.

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ease, easeInOut, fade, lerp, prog, springy } from '../anim'
import { COMPARE_LINE, REVENUE, UTTERANCE } from '../data'
import { Field } from '../components/Field'
import { LineChart, Waveform } from '../components/Viz'
import { Card, cardHeight, Headline, Kicker, mono, Pointer, Radial } from '../components/UI'
import { C, F } from '../theme'

export const S5_START = 900

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const R_OPEN = 2
export const R_RELEASE = 26
export const SHRINK_AT = R_RELEASE + 6
export const STORED_AT = R_RELEASE + 30
export const VOICE_AT = 100 // part B starts
export const V_OPEN = VOICE_AT + 2
export const V_RELEASE = VOICE_AT + 22
export const V_PANEL = V_RELEASE + 4
export const SPEAK = V_RELEASE + 12
export const SPEAK_END = SPEAK + 38
export const COMPARE = SPEAK + 50
export const GUIDES_AT = COMPARE + 22
export const S5_OUT = 283

const MEM_W = 600
const MEM_H = 128

function MemoryCard({ x, y, title, detail, fresh = 0, opacity = 1, reveal = 1 }: { x: number; y: number; title: string; detail: string; fresh?: number; opacity?: number; reveal?: number }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: MEM_W, height: MEM_H, clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, background: C.card, border: `1.5px solid ${fresh > 0 ? `color-mix(in srgb, ${C.hot} ${Math.round(fresh * 100)}%, ${C.line2})` : C.line2}`, display: 'flex', opacity }}>
      <div style={{ width: 6, background: fresh > 0 ? C.hot : C.dim }} />
      <div style={{ padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontFamily: F.sans, fontSize: 30, color: C.ink }}>{title}</div>
        <div style={{ ...mono, fontSize: 17, color: C.mute }}>{detail}</div>
      </div>
      <svg width={34} height={42} viewBox="-8 -11 16 22" style={{ position: 'absolute', right: 26, top: 26 }}>
        <path d="M-7,-10 h14 v20 l-7,-5 l-7,5 Z" fill={fresh > 0 ? C.hot : 'none'} stroke={fresh > 0 ? C.hot : C.mute} strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </div>
  )
}

/** Q3 vs Q4 drawn in the chart's own coordinate system (viewBox 0 0 100 64, max = 231). */
function CompareBars({ grow }: { grow: number }) {
  const max = Math.max(...REVENUE.map((p) => p.value)) * 1.1
  const yOf = (v: number) => 52 - (v / max) * 44
  const q3 = REVENUE[2].value
  const q4 = REVENUE[3].value
  const bar = (x: number, v: number, hot: boolean, label: string) => {
    const top = lerp(56, yOf(v), grow)
    return (
      <g>
        <rect x={x} y={top} width={22} height={56 - top} fill={hot ? C.hot : 'rgba(242,240,235,0.75)'} />
        <text x={x + 11} y={top - 2.5} textAnchor="middle" fill={C.ink} style={{ font: `4.6px 'DM Sans'` }} opacity={grow}>
          {v}
        </text>
        <text x={x + 11} y="62" textAnchor="middle" fill={C.mute} style={{ font: `4.4px 'DM Sans'` }}>
          {label}
        </text>
      </g>
    )
  }
  return (
    <svg viewBox="0 0 100 64" style={{ width: '100%', height: '100%', overflow: 'visible', display: 'block' }}>
      {[12, 24, 36, 48].map((y) => (
        <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="rgba(242,240,235,0.1)" strokeWidth={0.4} />
      ))}
      {bar(20, q3, false, 'Q3')}
      {bar(58, q4, true, 'Q4')}
      <g opacity={prog(grow, 0.7, 0.3)}>
        <line x1="84" x2="84" y1={yOf(q4)} y2={yOf(q3)} stroke={C.hot} strokeWidth={0.6} />
        <line x1="82" x2="86" y1={yOf(q4)} y2={yOf(q4)} stroke={C.hot} strokeWidth={0.6} />
        <line x1="82" x2="86" y1={yOf(q3)} y2={yOf(q3)} stroke={C.hot} strokeWidth={0.6} />
        <text x="84" y={yOf(q4) - 3} textAnchor="middle" fill={C.hot} style={{ font: `4.4px 'DM Sans'` }}>
          +30
        </text>
      </g>
    </svg>
  )
}

export function S5Act() {
  const frame = useCurrentFrame()
  const g = frame + S5_START
  const partB = frame >= VOICE_AT - 6

  // ---- Part A: Remember ----
  const AW = 480
  const AH = cardHeight(AW)
  const a: [number, number] = [260, 250]
  const apx = a[0] + AW * 0.5
  const apy = a[1] + AH * 0.5
  const aOpen = prog(frame, R_OPEN, 9) * (1 - prog(frame, R_RELEASE + 2, 8))
  const shrink = prog(frame, SHRINK_AT, 26, easeInOut)
  const TRAY_X = 1080
  const TRAY_Y = 300
  const slot: [number, number] = [TRAY_X, TRAY_Y + 2 * (MEM_H + 22)]
  const memX = lerp(a[0], slot[0], shrink)
  const memY = lerp(a[1], slot[1], shrink) - Math.sin(shrink * Math.PI) * 90
  const memScale = lerp(1, MEM_H / AH, shrink)
  const settled = prog(frame, STORED_AT, 8)
  const tray = prog(frame, 8, 18) * (1 - prog(frame, VOICE_AT - 14, 10))
  const aFade = 1 - prog(frame, VOICE_AT - 14, 10)

  // ---- Part B: Voice ----
  const BW = 520
  const BH = cardHeight(BW)
  const b: [number, number] = [140, 230]
  const bIn = prog(frame, VOICE_AT - 6, 14)
  const bpx = b[0] + BW * 0.5
  const bpy = b[1] + BH * 0.5
  const bOpen = prog(frame, V_OPEN, 9) * (1 - prog(frame, V_RELEASE + 2, 8))
  const vp = prog(frame, V_PANEL, 14)
  const listen = prog(frame, SPEAK - 4, 8) * (1 - prog(frame, SPEAK_END, 10))
  const typed = Math.max(0, Math.min(UTTERANCE.length, Math.floor((frame - SPEAK) * 0.9)))
  const dock = springy(frame, COMPARE, 30, 150, 18)
  const grow = prog(frame, COMPARE + 8, 20)
  const guides = prog(frame, GUIDES_AT, 14)
  const out = prog(frame, S5_OUT, 17, easeInOut)

  const panelX = 1300
  const panelY = 230
  const dockX = lerp(panelX + 40, b[0] + BW + 28, ease(Math.min(1, dock)))
  // Chart coordinates → screen, to draw guides from the original's Q3/Q4 points across.
  const body = (x: number, y: number, ox: number, oy: number, w: number): [number, number] => [ox + 16 + (x / 100) * (w - 32), oy + 42 + 16 + (y / 64) * ((w - 32) * 0.64)]
  const max = 231
  const q3y = 52 - (180 / max) * 44
  const q4y = 52 - (210 / max) * 44
  const [g3x, g3y] = body(8 + (2 * 84) / 3, q3y, b[0], b[1], BW)
  const [g4x, g4y] = body(92, q4y, b[0], b[1], BW)

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Field frame={g} hand={partB ? [bpx, bpy] : [apx, apy]} radius={240} opacity={0.45} />

        {/* ---- Remember ---- */}
        {!partB && (
          <>
            <div style={{ ...mono, position: 'absolute', left: TRAY_X, top: TRAY_Y - 50, fontSize: 20, color: C.mute, opacity: tray }}>
              <span style={{ color: C.hot, marginRight: 18 }}>Remembered</span>Saved on this device
            </div>
            <MemoryCard x={TRAY_X} y={TRAY_Y} title="Launch notes" detail="Note · 3 lines" opacity={tray} />
            <MemoryCard x={TRAY_X} y={TRAY_Y + MEM_H + 22} title="Contour study" detail="Render · 10 bands" opacity={tray} />
            <div style={{ position: 'absolute', left: slot[0], top: slot[1], width: MEM_W, height: MEM_H, border: `1.5px dashed ${C.line2}`, opacity: tray * (1 - settled) }} />
            <MemoryCard x={slot[0]} y={slot[1]} title="Quarterly revenue" detail="Chart · Q1–Q4 · 120 → 210 $k" fresh={1 - prog(frame, R_RELEASE + 60, 30)} opacity={aFade} reveal={settled} />
            <div style={{ opacity: (1 - settled) * aFade }}>
              <Card x={memX} y={memY} w={AW} tag="CHART · $K" index="02" label="Quarterly revenue" hot={1} lift={1 - shrink} scale={memScale} origin="0 0" opacity={1 - prog(shrink, 0.75, 0.25)}>
                <LineChart />
              </Card>
            </div>
            <div style={{ position: 'absolute', left: a[0], top: a[1], width: AW, height: AH, background: C.bg, opacity: aOpen * 0.45 }} />
            <Radial cx={apx} cy={apy} open={aOpen} active="remember" needle={30} confirm={prog(frame, R_RELEASE, 8)} rIn={100} rOut={168} />
            <Pointer x={apx} y={apy} pinch={1 - prog(frame, R_RELEASE, 5)} opacity={1 - shrink} />
          </>
        )}

        {/* ---- Voice ---- */}
        {partB && (
          <>
            <Card x={b[0]} y={b[1]} w={BW} tag="CHART · $K" index="02" label="Quarterly revenue" hot={1} opacity={bIn}>
              <LineChart highlight={guides > 0 ? [2, 3] : []} />
            </Card>
            <Radial cx={bpx} cy={bpy} open={bOpen} active="voice" needle={150} confirm={prog(frame, V_RELEASE, 8)} rIn={100} rOut={168} />
            <Pointer x={bpx} y={bpy} pinch={1 - prog(frame, V_RELEASE, 5)} opacity={bIn * (1 - prog(frame, V_RELEASE, 10))} />

            {/* the comparison, computed from the chart's data, docks on the same scale */}
            {frame >= COMPARE && (
              <div style={{ opacity: prog(frame, COMPARE, 6) }}>
                <Card x={dockX} y={b[1]} w={BW} tag="COMPARE · PREVIOUS QUARTER" label="Q4 vs Q3" hot={0.6}>
                  <CompareBars grow={grow} />
                </Card>
              </div>
            )}
            <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, opacity: guides }}>
              {[
                [g3x, g3y],
                [g4x, g4y],
              ].map(([x, y], i) => (
                <line key={i} x1={x} y1={y} x2={x + (b[0] + BW + 28 + BW - x - 30) * guides} y2={y} stroke={C.hot} strokeWidth={1.5} strokeDasharray="6 7" opacity={0.8} />
              ))}
            </svg>

            {/* voice panel (site .pg-panel.voice) */}
            <div style={{ position: 'absolute', left: panelX, top: panelY, width: 500, background: C.panel, border: `1.5px solid ${C.hot}`, padding: '0 26px 24px', clipPath: `inset(0 0 ${(1 - vp) * 100}% 0)`, opacity: (vp > 0 ? 1 : 0) * (1 - prog(frame, COMPARE + 4, 12)) }}>
              <div style={{ ...mono, display: 'flex', gap: 16, alignItems: 'center', height: 62, margin: '0 -26px 22px', padding: '0 26px', borderBottom: `1px solid ${C.line}`, fontSize: 17, color: C.mute }}>
                <span style={{ color: C.hot }}>Voice</span>
                <span>Vexo band mic</span>
              </div>
              <Waveform frame={frame} width={448} height={96} level={0.15 + 0.85 * listen} />
              <div style={{ fontFamily: F.sans, fontSize: 32, lineHeight: 1.3, color: C.ink, marginTop: 22, minHeight: 84 }}>
                {typed > 0 ? `“${UTTERANCE.slice(0, typed)}${typed < UTTERANCE.length ? '' : '”'}` : <span style={{ color: C.dim }}>Listening…</span>}
              </div>
            </div>
            {/* the result, where the voice panel was */}
            <div style={{ position: 'absolute', left: panelX + 20, top: b[1] + 120, width: 480, opacity: prog(frame, COMPARE + 20, 14) }}>
              <div style={{ ...mono, fontSize: 18, color: C.mute }}>“{UTTERANCE}”</div>
              <div style={{ fontFamily: F.sans, fontWeight: 500, fontSize: 44, lineHeight: 1.2, color: C.ink, marginTop: 14 }}>
                {COMPARE_LINE.split(': ')[0]}: <span style={{ color: C.hot }}>{COMPARE_LINE.split(': ')[1]}</span>
              </div>
              <div style={{ ...mono, fontSize: 17, color: C.mute, marginTop: 14 }}>Computed from the chart’s data</div>
            </div>
          </>
        )}
      </AbsoluteFill>
      <Kicker index="03" text={partB ? 'Act · Voice' : 'Act · Remember'} x={120} y={64} opacity={fade(frame, 2, 290, 10, 12) * (frame > VOICE_AT - 16 && frame < VOICE_AT - 4 ? 0 : 1)} />
      <Headline lines={['YOUR INTENT.', 'UNDERSTOOD.']} frame={frame} start={COMPARE + 30} size={88} out={out} style={{ left: 136, top: 760 }} />

    </AbsoluteFill>
  )
}
