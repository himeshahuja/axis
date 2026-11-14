// How each pitch object is drawn. Objects are size containers, so everything
// inside scales with the object (cqw / cqh), on any display.

import type { SpatialObject } from '../spatial/types'
import type { PitchObject } from './scenes'

// An open right hand, MediaPipe landmark order, normalized to a 1×1 box.
const HAND: [number, number][] = [
  [0.5, 0.95], [0.36, 0.86], [0.26, 0.74], [0.18, 0.63], [0.1, 0.54],
  [0.38, 0.52], [0.35, 0.34], [0.34, 0.22], [0.33, 0.1],
  [0.5, 0.5], [0.5, 0.3], [0.5, 0.17], [0.5, 0.05],
  [0.61, 0.52], [0.64, 0.34], [0.66, 0.22], [0.67, 0.12],
  [0.71, 0.57], [0.77, 0.43], [0.8, 0.34], [0.83, 0.25],
]
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

export function HandGlyph({ lit = false }: { lit?: boolean }) {
  return (
    <svg viewBox="0 0 1 1" className={`pv-hand ${lit ? 'lit' : ''}`} preserveAspectRatio="xMidYMid meet">
      {BONES.map(([a, b], i) => (
        <line key={i} x1={HAND[a][0]} y1={HAND[a][1]} x2={HAND[b][0]} y2={HAND[b][1]} style={{ animationDelay: `${i * 40}ms` }} />
      ))}
      {HAND.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 8 || i === 4 ? 0.026 : 0.016} className={i === 8 || i === 4 ? 'tip' : ''} style={{ animationDelay: `${i * 35}ms` }} />
      ))}
    </svg>
  )
}

const rad = (d: number) => (d * Math.PI) / 180
function arc(r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${0.5 + r * Math.cos(rad(a))},${0.5 + r * Math.sin(rad(a))}`
  return `M${p(r1, a0)} A${r1},${r1} 0 0 1 ${p(r1, a1)} L${p(r0, a1)} A${r0},${r0} 0 0 0 ${p(r0, a0)} Z`
}

export function RingGlyph({ lit = false, labels = true }: { lit?: boolean; labels?: boolean }) {
  const sectors = [
    { mid: -90, label: 'EXPLAIN' },
    { mid: 30, label: 'REMEMBER' },
    { mid: 150, label: 'VOICE' },
  ]
  return (
    <svg viewBox="0 0 1 1" className={`pv-ring ${lit ? 'lit' : ''}`}>
      {sectors.map((s, i) => (
        <g key={s.label} className={`sector s${i}`}>
          <path d={arc(0.2, 0.46, s.mid - 57, s.mid + 57)} />
          {labels && (
            <text x={0.5 + 0.33 * Math.cos(rad(s.mid))} y={0.5 + 0.33 * Math.sin(rad(s.mid)) + 0.015} textAnchor="middle">
              {s.label}
            </text>
          )}
        </g>
      ))}
      <circle cx="0.5" cy="0.5" r="0.1" className="core" />
    </svg>
  )
}

function Bars({ series, highlight, labels = true }: { series: { label: string; value: number }[]; highlight?: number; labels?: boolean }) {
  const max = Math.max(...series.map((p) => p.value), 1)
  return (
    <div className="pv-bars">
      {series.map((p, i) => (
        <div key={p.label} className={`bar ${i === highlight ? 'hot' : ''}`}>
          {labels && <span className="v">{p.value}</span>}
          <i style={{ height: `${(p.value / max) * 100}%`, animationDelay: `${120 + i * 70}ms` }} />
          {labels && <span className="l">{p.label}</span>}
        </div>
      ))}
    </div>
  )
}

function Pillar({ o, lit }: { o: PitchObject; lit: boolean }) {
  const viz =
    o.id === 'perception' ? <HandGlyph lit={lit} /> : o.id === 'intent' ? <RingGlyph lit={lit} labels={false} /> : (
      <div className={`pv-act ${lit ? 'lit' : ''}`}>
        <Bars series={[{ label: '', value: 3 }, { label: '', value: 4 }, { label: '', value: 5 }, { label: '', value: 7 }]} highlight={3} labels={false} />
        <span className="tick">✓</span>
      </div>
    )
  return (
    <div className="pv-pillar">
      <span className="idx">{o.index}</span>
      <div className="viz">{viz}</div>
      <strong>{o.label}</strong>
      {o.lines?.[0] && <p>{o.lines[0]}</p>}
    </div>
  )
}

export function ObjectVisual({ o, lit }: { o: PitchObject; lit: boolean }) {
  const c = o.content
  switch (o.visual) {
    case 'window':
      return (
        <div className="pv-window">
          <div className="bar">
            <i />
            <i />
            <i />
            <span>{o.label}</span>
          </div>
          <div className="body">
            <div className="side">
              {[0, 1, 2, 3].map((i) => (
                <b key={i} className={i === 1 ? 'sel' : ''} />
              ))}
            </div>
            <div className="canvas">
              <div className="ph h" />
              <div className="ph" />
              <div className="ph s" />
              <div className="grid">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <b key={i} />
                ))}
              </div>
            </div>
            <div className="inspector">
              {['Format', 'Arrange', 'Animate'].map((t) => (
                <span key={t}>{t}</span>
              ))}
              {[0, 1, 2, 3, 4].map((i) => (
                <b key={i} />
              ))}
            </div>
          </div>
        </div>
      )
    case 'cursor':
      return (
        <svg viewBox="0 0 24 36" className="pv-cursor">
          <path d="M2 2 L2 29 L9 22.5 L13.5 33 L18 31 L13.6 20.8 L22.5 20.8 Z" />
        </svg>
      )
    case 'toolbar':
      return (
        <div className="pv-toolbar">
          {o.label.split(/\s{2,}/).map((t, i) => (
            <span key={t} className={i === 4 ? 'open' : ''}>
              {t}
            </span>
          ))}
          <em>⌘ ⌥ ⇧</em>
        </div>
      )
    case 'pillar':
      return <Pillar o={o} lit={lit} />
    case 'chart':
      return c?.kind === 'chart' ? (
        <div className="pv-chart">
          <header>
            {o.index && <span className="idx">{o.index}</span>}
            <strong>{o.label}</strong>
            <em>{c.unit}</em>
          </header>
          <Bars series={c.series} highlight={c.series.length - 1} />
        </div>
      ) : null
    case 'metric':
      return c?.kind === 'metric' ? (
        <div className="pv-metric">
          {o.index && <span className="idx">{o.index}</span>}
          <span className="num">
            {c.value >= 0 ? '+' : '−'}
            {Math.abs(c.format === 'percent' ? c.value * 100 : c.value).toFixed(1)}
            {c.format === 'percent' ? '%' : ''}
          </span>
          <strong>{o.label}</strong>
          {c.note && <p>{c.note}</p>}
        </div>
      ) : null
    case 'diagram':
      return (
        <div className="pv-diagram">
          <header>
            {o.index && <span className="idx">{o.index}</span>}
            <strong>{o.label}</strong>
          </header>
          <ol>
            {(o.lines ?? []).map((l, i) => (
              <li key={l} style={{ animationDelay: `${200 + i * 110}ms` }}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {l}
              </li>
            ))}
          </ol>
        </div>
      )
    case 'note':
      return c?.kind === 'note' ? (
        <div className="pv-note">
          <header>
            {o.index && <span className="idx">{o.index}</span>}
            <strong>{o.label}</strong>
          </header>
          <ul>
            {c.text.split('\n').map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null
    case 'contrast':
      return (
        <div className={`pv-contrast ${o.id === 'c-axis' ? 'ours' : 'theirs'}`}>
          <span className="idx">{o.index}</span>
          <strong>{o.label}</strong>
          <ul>
            {(o.lines ?? []).map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )
    case 'glyph-hand':
      return (
        <div className="pv-glyph">
          <HandGlyph lit />
          <span>{o.label}</span>
        </div>
      )
    case 'glyph-ring':
      return (
        <div className="pv-glyph">
          <RingGlyph lit labels={false} />
          <span>{o.label}</span>
        </div>
      )
    case 'glyph-memory':
      return (
        <div className="pv-glyph pv-memory">
          <div className="stack">
            <b />
            <b />
            <b className="top">✓</b>
          </div>
          <span>{o.label}</span>
        </div>
      )
    case 'glyph-voice':
      return (
        <div className="pv-glyph pv-voice">
          <div className="wave">
            {[0.3, 0.7, 1, 0.55, 0.85, 0.4, 0.65].map((h, i) => (
              <i key={i} style={{ height: `${h * 100}%`, animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
          <span>{o.label}</span>
        </div>
      )
  }
}

/** Ghost used when Remember sends an object into the memory collection. */
export function MemoryGhost({ o, stage }: { o: SpatialObject; stage: { w: number; h: number } }) {
  const toX = stage.w - 0.06 * stage.w - o.x * stage.w - (o.w * stage.w) / 2
  const toY = 0.06 * stage.h - o.y * stage.h - (o.h * stage.h) / 2
  return (
    <div
      className="pitch-ghost"
      style={
        {
          left: `${o.x * 100}%`,
          top: `${o.y * 100}%`,
          width: `${o.w * 100}%`,
          height: `${o.h * 100}%`,
          '--to-x': `${toX}px`,
          '--to-y': `${toY}px`,
        } as React.CSSProperties
      }
    />
  )
}
