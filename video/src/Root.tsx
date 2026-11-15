import { AbsoluteFill, Composition, Sequence, useCurrentFrame } from 'remotion'
import { fade } from './anim'
import { Logo, LOGO_H, LOGO_W } from './components/Logo'
import { Soundtrack, type Stem } from './audio/Soundtrack'
import { loadFonts } from './fonts'
import { S1Problem } from './scenes/S1Problem'
import { S2_START, S2Reveal } from './scenes/S2Reveal'
import { S3_START, S3Grab } from './scenes/S3Grab'
import { S4_START, S4Radial } from './scenes/S4Radial'
import { S5_START, S5Act } from './scenes/S5Act'
import { S6_START, S6Next } from './scenes/S6Next'
import { S7_START, S7Close } from './scenes/S7Close'
import { C, DURATION, FPS, H, W } from './theme'
import { LogoTest } from './LogoTest'

loadFonts()


const SCENES = [
  { name: '1 Problem', from: 0, to: S2_START, C: S1Problem },
  { name: '2 Reveal', from: S2_START, to: S3_START, C: S2Reveal },
  { name: '3 Grab', from: S3_START, to: S4_START, C: S3Grab },
  { name: '4 Radial', from: S4_START, to: S5_START, C: S4Radial },
  { name: '5 Remember + Voice', from: S5_START, to: S6_START, C: S5Act },
  { name: '6 What comes next', from: S6_START, to: S7_START, C: S6Next },
  { name: '7 Close', from: S7_START, to: DURATION, C: S7Close },
]

export function Film({ stem = 'all' }: { stem?: Stem }) {
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {SCENES.map(({ name, from, to, C: Scene }) => (
        <Sequence key={name} name={name} from={from} durationInFrames={to - from}>
          <Scene />
        </Sequence>
      ))}
      {/* the logo as a corner mark through the product scenes */}
      <Sequence name="Logo mark" from={S3_START} durationInFrames={S7_START - S3_START}>
        <CornerMark length={S7_START - S3_START} />
      </Sequence>
      <Soundtrack stem={stem} />
    </AbsoluteFill>
  )
}

const MARK_H = 30
function CornerMark({ length }: { length: number }) {
  const frame = useCurrentFrame()
  const w = (LOGO_W * MARK_H) / LOGO_H
  return <Logo height={MARK_H} x={W - 120 - w} y={58} opacity={0.9 * fade(frame, 6, length, 16, 14)} />
}

export function RemotionRoot() {
  return (
    <>
      <Composition id="AxisLaunch" component={Film} durationInFrames={DURATION} fps={FPS} width={W} height={H} defaultProps={{ stem: 'all' as Stem }} />
      <Composition id="LogoTest" component={LogoTest} durationInFrames={1} fps={FPS} width={772} height={318} />
    </>
  )
}
