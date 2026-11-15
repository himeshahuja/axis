// Places the score and every cue from the audio event map. A cue's `frame` is its hit;
// the file starts `hitFrames` earlier so the transient lands exactly on that frame.

import { Html5Audio, Sequence, staticFile } from 'remotion'
import { CUES, ENVELOPES, type Cue } from './cues'
import manifest from './sfx-manifest.json'

/** Score level under the effects. The score is quieter than every key interaction. */
export const SCORE_GAIN = 0.3
/** Headroom on the effects bus so the summed mix never clips before mastering. */
export const SFX_GAIN = 0.72

export type Stem = 'all' | 'score' | 'sfx'

const M = manifest as Record<string, { file: string; hitFrames: number; frames: number }>

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t))
  return c * c * (3 - 2 * c)
}

/** Level over time for cues that follow the picture; `f` is frames since the cue's hit. */
function envelope(cue: Cue, f: number): number {
  if (cue.envelope === 'drag') {
    // The carry is eased in and out, so the hand is fastest mid-way: sound follows speed.
    const { start, end } = ENVELOPES.drag
    const p = (cue.frame + f - start) / (end - start)
    return p <= 0 || p >= 1 ? 0 : 0.15 + 0.85 * Math.sin(Math.PI * p) ** 1.5
  }
  if (cue.envelope === 'voice') {
    const { start, end } = ENVELOPES.voice
    const g = cue.frame + f
    return smooth((g - (start - 4)) / 8) * (1 - smooth((g - end) / 10))
  }
  return 1
}

export function Soundtrack({ stem = 'all' }: { stem?: Stem }) {
  return (
    <>
      {stem !== 'sfx' && <Html5Audio src={staticFile('audio/score.wav')} volume={SCORE_GAIN} name="score" />}
      {stem !== 'score' &&
        CUES.map((cue, i) => {
          const m = M[cue.sound]
          if (!m) throw new Error(`No designed sound for "${cue.sound}". Run npm run audio.`)
          const from = cue.frame - m.hitFrames
          return (
            <Sequence key={i} from={from} durationInFrames={m.frames} layout="none" name={`${cue.sound} @${cue.frame}`}>
              <Html5Audio src={staticFile(m.file)} volume={cue.envelope ? (f) => SFX_GAIN * cue.gain * envelope(cue, f - m.hitFrames) : SFX_GAIN * cue.gain} />
            </Sequence>
          )
        })}
    </>
  )
}
