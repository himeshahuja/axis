// 3 · Spatial interaction. The hand's pointer finds the revenue chart, pinches, and the
// chart lifts, travels and lands: the app's grab → drag → drop.

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeInOut, fade, lerp, path, prog, springy, wobble } from '../anim'
import { Field } from '../components/Field'
import { Grid, LineChart, Note, Terrain } from '../components/Viz'
import { Bracket, Card, cardHeight, Hand, Headline, Kicker, Pointer } from '../components/UI'
import { C } from '../theme'

export const S3_START = 390

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const HOVER_AT = 44
export const PINCH_AT = 70
export const DROP_AT = 150
export const S3_OUT = 205

export function S3Grab() {
  const frame = useCurrentFrame()
  const g = frame + S3_START
  const enter = (i: number) => prog(frame, 2 + i * 6, 24)

  // Hand path: enters bottom-right, finds the chart, carries it, lets go, drifts off.
  const CW = 440
  const CH = cardHeight(CW)
  const chartFrom: [number, number] = [210, 200]
  const chartTo: [number, number] = [790, 250]
  const grabOffset: [number, number] = [CW * 0.55, CH * 0.5]
  const [hx, hy] = path(frame, [
    [0, 1500, 1150],
    [52, chartFrom[0] + grabOffset[0] + 16, chartFrom[1] + grabOffset[1] + 12],
    [PINCH_AT, chartFrom[0] + grabOffset[0], chartFrom[1] + grabOffset[1]],
    [DROP_AT, chartTo[0] + grabOffset[0], chartTo[1] + grabOffset[1]],
    [200, chartTo[0] + grabOffset[0] + 160, chartTo[1] + grabOffset[1] + 260],
  ])
  const tremX = wobble(frame, 1) * 3
  const tremY = wobble(frame, 4) * 3
  const px = hx + tremX
  const py = hy + tremY
  const pinch = prog(frame, PINCH_AT - 4, 6) * (1 - prog(frame, DROP_AT, 6))
  const held = frame >= PINCH_AT && frame < DROP_AT + 2

  // The chart follows the pinch point with a little lag while carried.
  let cx = chartFrom[0]
  let cy = chartFrom[1]
  if (frame >= PINCH_AT) {
    const lagF = Math.min(frame, DROP_AT) - 3
    const [lx, ly] = path(Math.max(PINCH_AT, lagF), [
      [PINCH_AT, chartFrom[0], chartFrom[1]],
      [DROP_AT, chartTo[0], chartTo[1]],
    ])
    const settle = prog(frame, DROP_AT - 3, 8)
    cx = lerp(lx, chartTo[0], settle)
    cy = lerp(ly, chartTo[1], settle)
  }
  const vel = frame > PINCH_AT && frame < DROP_AT ? Math.sin(((frame - PINCH_AT) / (DROP_AT - PINCH_AT)) * Math.PI) : 0
  const lift = prog(frame, PINCH_AT, 8) * (1 - prog(frame, DROP_AT, 10))
  const land = frame >= DROP_AT ? 1 - springy(frame, DROP_AT, 30, 260, 12) : 0
  const scale = 1 + lift * 0.06 - land * 0.04 * (frame < DROP_AT + 20 ? 1 : 0)
  const hover = prog(frame, HOVER_AT, 10) * (1 - prog(frame, DROP_AT + 30, 14))
  const hot = Math.max(hover, lift)

  const out = prog(frame, S3_OUT, 20, easeInOut)
  const drift = (i: number) => [Math.sin(g * 0.012 + i * 1.7) * 10, Math.cos(g * 0.01 + i * 2.3) * 12] as const

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: 1 - out }}>
        <Field frame={g} hand={[px, py]} radius={300} opacity={0.75} />
        {/* the canvas: other objects at different depths */}
        <Card x={760 + drift(0)[0]} y={40 + drift(0)[1]} w={260} tag="COORD" index="01" label="Canvas frame" rot={-2} opacity={0.32 * enter(0)} blur={1.5}>
          <Grid />
        </Card>
        <Card x={1330 + drift(1)[0]} y={110 + drift(1)[1]} w={400} tag="NOTE" index="03" label="Launch notes" rot={2.5} opacity={0.85 * enter(1)}>
          <Note lines={['Ship pricing page before Q1 close', 'Move onboarding email to day 2', 'Risk: support load after launch']} size={17} />
        </Card>
        <Card x={1400 + drift(2)[0]} y={600 + drift(2)[1]} w={360} tag="RENDER" index="04" label="Contour study" rot={-3} opacity={0.6 * enter(2)}>
          <Terrain />
        </Card>
        {/* the chart that gets picked up */}
        <Card x={cx} y={cy} w={CW} tag="CHART · $K" index="02" label="Quarterly revenue" rot={lerp(-3, 0, prog(frame, PINCH_AT, 20)) + vel * 3} scale={scale} hot={hot} lift={lift} opacity={enter(3)}>
          <LineChart draw={prog(frame, 14, 30)} />
        </Card>
        <Bracket x={cx - 16} y={cy - 16} w={CW + 32} h={CH + 32} label={held ? 'GRABBED · CHART' : 'SELECT · CHART'} opacity={hover * (held ? 1 : 0.95)} />
        <Hand px={px} py={py} pinch={pinch} opacity={0.55 * fade(frame, 0, 215, 14, 14)} />
        <Pointer x={px} y={py} pinch={pinch} opacity={fade(frame, 0, 215, 10, 14)} />
      </AbsoluteFill>
      <Kicker index="01" text="Point · Camera hand tracking, in the browser" x={120} y={64} opacity={fade(frame, 8, 220, 14, 14)} />
      <Headline lines={['INFORMATION,', 'WITHIN REACH.']} frame={frame} start={112} size={104} out={out} style={{ left: 116, top: 700 }} />
    </AbsoluteFill>
  )
}
