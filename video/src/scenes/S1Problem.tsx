// 1 · Problem. A mouse cursor hunts through windows, toolbars and dialogs that keep
// piling up. "WE THINK WITH OUR HANDS." then "OUR COMPUTERS DON'T."

import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { easeInOut, fade, path, prog, springy, wobble } from '../anim'
import { Headline } from '../components/UI'
import { C, F } from '../theme'

interface Win {
  x: number
  y: number
  w: number
  h: number
  title: string
  at: number
  kind: 'doc' | 'toolbar' | 'dialog' | 'panel' | 'files'
}

// The pile, in the order it appears. Titles echo the pitch's problem scene.
const WINDOWS: Win[] = [
  { x: 980, y: 150, w: 760, h: 520, title: 'Q3 Review — Final(2).key', at: 2, kind: 'doc' },
  { x: 1040, y: 700, w: 700, h: 66, title: 'File   Edit   Insert   Format   Arrange   View', at: 14, kind: 'toolbar' },
  { x: 1220, y: 90, w: 420, h: 300, title: 'Format Shape', at: 26, kind: 'panel' },
  { x: 140, y: 120, w: 620, h: 420, title: 'Downloads', at: 38, kind: 'files' },
  { x: 560, y: 380, w: 560, h: 380, title: 'Slide 7 of 24', at: 50, kind: 'doc' },
  { x: 200, y: 640, w: 640, h: 66, title: '◀  ▶   100%   Insert ▸ Chart   Table   Shape', at: 62, kind: 'toolbar' },
  { x: 1300, y: 420, w: 440, h: 230, title: 'Insert ▸ Chart', at: 72, kind: 'panel' },
  { x: 760, y: 220, w: 460, h: 220, title: 'Save changes?', at: 84, kind: 'dialog' },
  { x: 90, y: 800, w: 560, h: 200, title: 'Untitled 4', at: 92, kind: 'doc' },
  { x: 1160, y: 800, w: 600, h: 190, title: 'Presenter Notes', at: 98, kind: 'doc' },
]

function Chrome({ win, frame, freeze }: { win: Win; frame: number; freeze: number }) {
  const k = springy(frame, win.at, 30, 260, 22)
  if (frame < win.at) return null
  const jitter = freeze > 0 ? Math.round(wobble(frame * 7, win.at) * 6 * freeze) : 0
  const bar = win.kind === 'toolbar' ? win.h : 38
  return (
    <div
      style={{
        position: 'absolute',
        left: win.x + jitter,
        top: win.y,
        width: win.w,
        height: win.h,
        background: '#161616',
        border: `1px solid ${C.line2}`,
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 30px 70px -20px rgba(0,0,0,0.85)',
        transform: `scale(${0.94 + 0.06 * k})`,
        opacity: Math.min(1, k * 1.5),
        fontFamily: F.sans,
      }}
    >
      <div style={{ height: bar, display: 'flex', alignItems: 'center', gap: 9, padding: '0 16px', background: '#1d1d1d', borderBottom: `1px solid ${C.line}`, color: '#b8b6b1', fontSize: 17 }}>
        {win.kind !== 'toolbar' &&
          [0, 1, 2].map((i) => <span key={i} style={{ width: 13, height: 13, borderRadius: 7, background: '#3a3a3a', display: 'inline-block' }} />)}
        <span style={{ marginLeft: win.kind === 'toolbar' ? 0 : 14, whiteSpace: 'pre' }}>{win.title}</span>
      </div>
      {win.kind === 'doc' && (
        <div style={{ padding: 22, display: 'grid', gap: 14 }}>
          {[0.7, 0.92, 0.5, 0.84, 0.62].map((w, i) => (
            <div key={i} style={{ height: 14, width: `${w * 100}%`, background: 'rgba(242,240,235,0.08)', borderRadius: 3 }} />
          ))}
          <div style={{ height: win.h * 0.34, border: `1px dashed ${C.line2}`, borderRadius: 4 }} />
        </div>
      )}
      {win.kind === 'files' && (
        <div style={{ padding: '10px 18px' }}>
          {['Q3_Review_FINAL.key', 'Q3_Review_FINAL(1).key', 'Q3_Review_FINAL(2).key', 'chart_export_v3.png', 'notes (copy).txt', 'Screen Shot 11.12.png'].map((n) => (
            <div key={n} style={{ padding: '10px 0', borderBottom: `1px solid ${C.line}`, color: '#a9a7a2', fontSize: 18 }}>
              {n}
            </div>
          ))}
        </div>
      )}
      {win.kind === 'panel' && (
        <div style={{ padding: 18, display: 'grid', gap: 12 }}>
          {['Fill', 'Line', 'Shadow', 'Opacity', 'Size & Position'].slice(0, win.h > 260 ? 5 : 3).map((n) => (
            <div key={n} style={{ display: 'flex', justifyContent: 'space-between', color: '#a9a7a2', fontSize: 17 }}>
              <span>{n}</span>
              <span style={{ width: 90, height: 22, border: `1px solid ${C.line2}`, borderRadius: 4 }} />
            </div>
          ))}
        </div>
      )}
      {win.kind === 'dialog' && (
        <div style={{ padding: 24, color: '#c9c7c2', fontSize: 20 }}>
          <div>Do you want to save the changes to “Q3 Review”?</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 34, justifyContent: 'flex-end' }}>
            {["Don't Save", 'Cancel', 'Save'].map((b) => (
              <span key={b} style={{ padding: '8px 16px', border: `1px solid ${C.line2}`, borderRadius: 6, fontSize: 17 }}>
                {b}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** The system arrow cursor. */
function Arrow({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <svg width={44} height={60} viewBox="0 0 22 30" style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale})`, transformOrigin: '0 0', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.6))' }}>
      <path d="M1,1 L1,23 L6.5,18 L10.5,27 L14,25.5 L10,16.8 L17.5,16.8 Z" fill={C.ink} stroke="#080808" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  )
}

// Event frames (scene-local). The sound map in src/audio/cues.ts reads these.
export const CURSOR_CLICKS = [18, 34, 50, 66, 80]
export const FREEZE_AT = 112
export const S1_OUT = 178

export function S1Problem() {
  const frame = useCurrentFrame()
  // The cursor hunts: toolbar, a panel, the files, the dialog... never landing on what it wants.
  const [cx, cy] = path(frame, [
    [0, 1500, 980],
    [18, 1180, 728],
    [34, 1400, 260],
    [50, 420, 300],
    [66, 820, 560],
    [80, 520, 670],
    [96, 1000, 395],
    [112, 1120, 404],
    [128, 900, 480],
    [195, 900, 480],
  ])
  const clicks = [...CURSOR_CLICKS, FREEZE_AT]
  const press = clicks.reduce((m, c) => Math.max(m, 1 - Math.abs(frame - c) / 3), 0)
  // The pile freezes and shakes as the second line lands.
  const freeze = prog(frame, FREEZE_AT, 6) * (1 - prog(frame, 150, 20))
  const scrim = 0.3 + 0.28 * prog(frame, 8, 40)
  const out = prog(frame, S1_OUT, 17, easeInOut)
  const l1Out = prog(frame, 106, 12)
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill style={{ opacity: (1 - out) * fade(frame, 0, 999, 8, 1), filter: freeze > 0 ? `saturate(${1 - freeze})` : undefined }}>
        {WINDOWS.map((w) => (
          <Chrome key={w.title} win={w} frame={frame} freeze={freeze} />
        ))}
        <Arrow x={cx} y={cy} scale={1 - press * 0.12} />
      </AbsoluteFill>
      {/* a soft vignette so the type always reads over the clutter */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 60% at 30% 55%, rgba(8,8,8,${scrim + 0.25}) 0%, rgba(8,8,8,${scrim}) 55%, rgba(8,8,8,${scrim * 0.6}) 100%)`, opacity: 1 - out }} />
      <Headline lines={['WE THINK WITH', 'OUR HANDS.']} frame={frame} start={16} size={124} out={l1Out} style={{ left: 120, top: 330 }} />
      <Headline lines={['OUR COMPUTERS', "DON'T."]} frame={frame} start={114} size={124} out={out} hotWord="DON'T." style={{ left: 120, top: 330 }} />
    </AbsoluteFill>
  )
}
