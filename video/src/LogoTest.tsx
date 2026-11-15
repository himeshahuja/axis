import { AbsoluteFill } from 'remotion'
import { Logo } from './components/Logo'
// Dev-only: the logo at the supplied artwork's own pixel scale, to compare against it.
export function LogoTest() {
  return (
    <AbsoluteFill style={{ background: '#0b0b0b' }}>
      <Logo height={186} x={69} y={58} />
    </AbsoluteFill>
  )
}
