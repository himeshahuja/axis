// 4 · Radial menu. Pinch and hold 600 ms on the chart: exactly three sectors open,
// Explain on top, Remember clockwise, Voice counter-clockwise. A wrist twist moves the
// orange highlight; letting go on Explain opens the local summary beside the object.

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeInOut, fade, lerp, prog, wobble } from '../anim'
import { EXPLAIN_FACTS } from '../data'
import { Field } from '../components/Field'
import { LineChart } from '../components/Viz'
import { Card, cardHeight, Hand, Headline, Kicker, mono, Pointer, Radial, type Action } from '../components/UI'
import { C, F } from '../theme'

export const S4_START = 615

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const PINCH = 18
export const OPEN = PINCH + 18 // 600 ms at 30 fps
export const RELEASE = 168
export const PANEL_AT = RELEASE + 8
export const S4_OUT = 268

/** Wrist rotation (deg, clockwise +) over time: right to Remember, left to Voice, back to Explain. */
export function wrist(f: number) {
  const keys: [number, number][] = [
    [OPEN + 14, 0],
    [OPEN + 36, 42],
    [OPEN + 52, 42],
    [OPEN + 82, -42],
    [OPEN + 98, -42],
    [OPEN + 118, 0],
  ]
  if (f <= keys[0][0]) return 0
  for (let i = 1; i < keys.length; i++) {
    if (f <= keys[i][0]) {
      const t = easeInOut((f - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]))
      return lerp(keys[i - 1][1], keys[i][1], t)
    }
  }
  return 0
}
/** As the site: needle = -90 + rotation × 3; sectors switch half-way between centres. */
const needleOf = (rot: number) => -90 + Math.max(-150, Math.min(150, rot * 3))
export const actionOf = (rot: number): Action => (rot * 3 > 60 ? 'remember' : rot * 3 < -60 ? 'voice' : 'explain')

/** Every frame where the highlighted sector changes, from the same rotation curve the picture uses. */
export function sectorChanges(): { frame: number; action: Action }[] {
  const out: { frame: number; action: Action }[] = []
  for (let f = OPEN + 1; f < RELEASE; f++) if (actionOf(wrist(f)) !== actionOf(wrist(f - 1))) out.push({ frame: f, action: actionOf(wrist(f)) })
  return out
}

export function S4Radial() {
  const frame = useCurrentFrame()
  const g = frame + S4_START
  const CW = 460
  const CH = cardHeight(CW)
  const card: [number, number] = [300, 250]
  const px = card[0] + CW * 0.52 + wobble(frame, 2) * 2
  const py = card[1] + CH * 0.5 + wobble(frame, 5) * 2
  const rot = wrist(frame)
  const active = actionOf(rot)
  const pinch = prog(frame, PINCH - 4, 6) * (1 - prog(frame, RELEASE, 5))
  const hold = frame >= PINCH && frame < OPEN + 4 ? prog(frame, PINCH, OPEN - PINCH, (t) => t) : 0
  const open = prog(frame, OPEN, 12) * (1 - prog(frame, RELEASE + 4, 10))
  const confirm = prog(frame, RELEASE, 8)
  const panel = prog(frame, PANEL_AT, 16)
  const out = prog(frame, S4_OUT, 17, easeInOut)

  const panelX = card[0] + CW + 340
  const panelY = card[1] - 10
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Field frame={g} hand={[px, py]} radius={260} opacity={0.5} />
        <Card x={card[0]} y={card[1]} w={CW} tag="CHART · $K" index="02" label="Quarterly revenue" hot={1} lift={0.4} opacity={fade(frame, 0, 999, 10, 1)}>
          <LineChart />
        </Card>
        {/* the menu dims the object it acts on */}
        <div style={{ position: 'absolute', left: card[0], top: card[1], width: CW, height: CH, background: C.bg, opacity: open * 0.45 }} />
        <Radial cx={px} cy={py} open={open} active={frame < RELEASE + 4 ? active : 'explain'} needle={needleOf(rot)} confirm={confirm} />
        <Hand px={px} py={py} pinch={pinch} tilt={rot * 0.9} opacity={0.5 * (1 - open * 0.55)} />
        <Pointer x={px} y={py} pinch={pinch} hold={hold} opacity={1 - open * 0.3} />

        {/* wrist indicator: the intended control, drawn as a dial */}
        <div style={{ position: 'absolute', left: 120, top: 860, display: 'flex', alignItems: 'center', gap: 24, opacity: open * (1 - prog(frame, RELEASE, 10)) }}>
          <svg width={90} height={90} viewBox="-45 -45 90 90">
            <circle r={38} fill="none" stroke={C.line2} strokeWidth={2} />
            <g transform={`rotate(${rot})`}>
              <rect x={-14} y={-40} width={28} height={16} rx={4} fill={C.hot} />
              <line x1={0} y1={-24} x2={0} y2={0} stroke={C.ink} strokeWidth={2.5} />
            </g>
            <circle r={4} fill={C.ink} />
          </svg>
          <div>
            <div style={{ ...mono, fontSize: 22, color: C.ink }}>Twist the wrist to choose</div>
            <div style={{ ...mono, fontSize: 18, color: C.mute, marginTop: 8 }}>Vexo band gyro · camera hand tilt · keys</div>
          </div>
        </div>

        {/* Explain: the local summary panel (site .pg-panel) */}
        <div style={{ position: 'absolute', left: panelX, top: panelY, width: 620, background: C.panel, border: `1.5px solid ${C.hot}`, padding: '0 26px 22px', clipPath: `inset(0 0 ${(1 - panel) * 100}% 0)`, opacity: panel > 0 ? 1 : 0 }}>
          <div style={{ ...mono, display: 'flex', gap: 16, alignItems: 'center', height: 62, margin: '0 -26px 14px', padding: '0 26px', borderBottom: `1px solid ${C.line}`, fontSize: 17, color: C.mute }}>
            <span style={{ color: C.hot }}>Explain</span>
            <span>Quarterly revenue</span>
          </div>
          {EXPLAIN_FACTS.map((f, i) => {
            const p = prog(frame, RELEASE + 16 + i * 5, 16)
            return (
              <div key={f} style={{ position: 'relative', padding: '14px 0 14px 50px', borderBottom: `1px solid ${C.line}`, fontFamily: F.sans, fontSize: 25, lineHeight: 1.35, color: C.ink, opacity: p, transform: `translateY(${(1 - p) * 16}px)` }}>
                <span style={{ ...mono, position: 'absolute', left: 0, top: 19, fontSize: 16, color: C.hot }}>{String(i + 1).padStart(2, '0')}</span>
                {f}
              </div>
            )
          })}
          <div style={{ ...mono, fontSize: 17, color: C.mute, marginTop: 16, letterSpacing: '0.06em' }}>Local summary from the object’s data</div>
        </div>
        {/* connector from object to panel */}
        <div style={{ position: 'absolute', left: card[0] + CW + 6, top: panelY + 31, width: (panelX - card[0] - CW - 6) * panel, height: 1.5, background: C.hot, opacity: panel }} />
      </AbsoluteFill>
      <Kicker index="02" text="Hold · Pinch and hold for actions" x={120} y={64} opacity={fade(frame, 4, 282, 14, 14)} />
      <Headline lines={['ONE GESTURE.', 'INFINITE POSSIBILITIES.']} frame={frame} start={RELEASE + 26} size={70} out={out} style={{ left: 116, top: 790 }} />
    </AbsoluteFill>
  )
}
