// 6 · Beyond presentations. Three directions, labelled as what comes next: presentations
// is where Axis is today; collaboration and ambient computing are concepts, not built.

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeInOut, prog } from '../anim'
import { Field } from '../components/Field'
import { Headline, mono } from '../components/UI'
import { C, F } from '../theme'

export const S6_START = 1200

type Art = 'present' | 'team' | 'world'

function ArtView({ art, frame }: { art: Art; frame: number }) {
  const s = { fill: 'none', stroke: 'rgba(242,240,235,0.55)', strokeWidth: 0.7 }
  if (art === 'present')
    return (
      <svg viewBox="0 0 100 64" style={{ width: '100%', height: '100%' }}>
        <rect x="10" y="8" width="80" height="44" {...s} />
        <rect x="20" y="16" width="26" height="18" {...s} stroke={C.hot} />
        <path d="M22,30 L30,25 L36,27 L44,19" fill="none" stroke={C.hot} strokeWidth={0.8} />
        <line x1="54" y1="18" x2="80" y2="18" {...s} />
        <line x1="54" y1="24" x2="76" y2="24" {...s} />
        <circle cx={33 + Math.sin(frame * 0.08) * 3} cy={25} r="3" fill="none" stroke={C.hot} strokeWidth={0.9} />
        <line x1="40" y1="58" x2="60" y2="58" {...s} />
      </svg>
    )
  if (art === 'team')
    return (
      <svg viewBox="0 0 100 64" style={{ width: '100%', height: '100%' }}>
        <rect x="8" y="8" width="84" height="48" {...s} strokeDasharray="2 2" />
        {[
          [28, 24, 0],
          [64, 20, 2],
          [50, 42, 4],
        ].map(([x, y, k], i) => (
          <circle key={i} cx={x + Math.sin(frame * 0.06 + k) * 4} cy={y + Math.cos(frame * 0.05 + k) * 3} r="3.2" fill="none" stroke={i === 0 ? C.hot : C.ink} strokeOpacity={i === 0 ? 1 : 0.7} strokeWidth={0.9} />
        ))}
        <rect x="38" y="24" width="20" height="13" {...s} />
      </svg>
    )
  return (
    <svg viewBox="0 0 100 64" style={{ width: '100%', height: '100%' }}>
      {[10, 18, 26].map((r, i) => (
        <ellipse key={r} cx="50" cy="34" rx={r * 1.5} ry={r * 0.75} {...s} strokeOpacity={0.6 - i * 0.15} />
      ))}
      <line x1="6" y1="34" x2="94" y2="34" {...s} />
      <circle cx={50 + Math.cos(frame * 0.05) * 27} cy={34 + Math.sin(frame * 0.05) * 13.5} r="2.4" fill={C.hot} />
      <circle cx="50" cy="34" r="1.6" fill={C.ink} />
    </svg>
  )
}

const ITEMS: { art: Art; index: string; title: string; line: string; status: string; live?: boolean }[] = [
  { art: 'present', index: '01', title: 'Presentations', line: 'Point, hold and speak to the content you present.', status: 'Where Axis is today', live: true },
  { art: 'team', index: '02', title: 'Collaboration', line: 'Several people in one shared spatial workspace.', status: 'Concept · not built' },
  { art: 'world', index: '03', title: 'Ambient computing', line: 'Beyond fixed screens: context that follows you.', status: 'Concept · not built' },
]

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const CARDS_AT = [12, 20, 28]
export const S6_OUT = 136

export function S6Next() {
  const frame = useCurrentFrame()
  const g = frame + S6_START
  const out = prog(frame, S6_OUT, 14, easeInOut)
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: 0.4 * (1 - out) }}>
        <Field frame={g} />
      </AbsoluteFill>
      <Headline lines={['WHAT COMES NEXT']} frame={frame} start={2} size={76} out={out} style={{ left: 116, top: 120 }} />
      <div style={{ position: 'absolute', left: 120, top: 330, display: 'flex', gap: 40, opacity: 1 - out }}>
        {ITEMS.map((it, i) => {
          const p = prog(frame, CARDS_AT[i], 22)
          return (
            <div key={it.title} style={{ width: 532, background: C.card, border: `1.5px solid ${it.live ? C.hot : C.line2}`, opacity: p, transform: `translateY(${(1 - p) * 50}px)` }}>
              <div style={{ ...mono, display: 'flex', justifyContent: 'space-between', fontSize: 17, color: it.live ? C.hot : C.mute, padding: '15px 18px', borderBottom: `1px solid ${C.line}` }}>
                <span>{it.index}</span>
                <span>{it.status}</span>
              </div>
              <div style={{ height: 270, padding: 22 }}>
                <ArtView art={it.art} frame={g} />
              </div>
              <div style={{ padding: '22px 22px 26px', borderTop: `1px solid ${C.line}` }}>
                <div style={{ fontFamily: F.display, fontSize: 33, color: C.ink, whiteSpace: 'nowrap' }}>{it.title}</div>
                <div style={{ fontFamily: F.sans, fontSize: 23, lineHeight: 1.35, color: C.mute, marginTop: 12 }}>{it.line}</div>
              </div>
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}
