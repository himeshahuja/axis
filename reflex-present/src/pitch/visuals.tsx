// How each pitch object is drawn. Objects are size containers, so everything
// inside scales with the object (cqw / cqh), on any display.

import { AxisMark } from './AxisMark'
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

/** Use cases, now to later: each card flips from where it starts to what it unlocks. */
function FutureCard({ o, transformed }: { o: PitchObject; transformed: boolean }) {
  let front: React.ReactNode = null
  let back: React.ReactNode = null
  if (o.visual === 'teach') {
    // A whiteboard sketch, drawn by the fingertip; then annotated in front of the class.
    const board = (done: boolean) => (
      <svg viewBox="0 0 100 70" className="pv-uc">
        <rect x="4" y="4" width="92" height="58" className="board" />
        <path d="M14 14 L14 50 L58 50" className="ink" />
        <path d={done ? 'M14 46 C24 44 30 36 38 30 S50 18 56 14' : 'M14 46 C24 44 30 36 38 30 S46 22 49 20'} className="ink" />
        {done ? (
          <>
            <circle cx="38" cy="30" r="5" className="mark" />
            <path d="M44 32 L66 40" className="mark" />
            <rect x="66" y="35" width="24" height="10" className="tag" />
            <path d="M70 18 h16 M70 25 h11" className="ink faint" />
          </>
        ) : (
          <>
            <path d="M70 18 h16 M70 25 h11 M70 32 h14" className="ink faint" />
            <circle cx="49" cy="20" r="2.6" className="tip" />
          </>
        )}
      </svg>
    )
    front = (
      <>
        {board(false)}
        <p className="what">{o.lines?.[0]}</p>
      </>
    )
    back = (
      <>
        {board(true)}
        <ol className="pv-steps">
          <li>Draw on the board in the air</li>
          <li>Move diagrams by hand</li>
          <li>Explain a chart to the class</li>
        </ol>
      </>
    )
  } else if (o.visual === 'band') {
    // One person in the camera's frame; then everyone's band, each with its own cursor on one board.
    const person = (x: number, cls: string, band?: number) => (
      <g className={cls} key={x}>
        <circle cx={x} cy="46" r="5" />
        <path d={`M${x - 10} 68 Q${x} 54 ${x + 10} 68`} />
        {band !== undefined && (
          <>
            <path d={`M${x + 7} 62 L${x + 12} 50`} />
            <circle cx={x + 11.2} cy="52.5" r="2" className={`wear t${band}`} />
          </>
        )}
      </g>
    )
    front = (
      <>
        <svg viewBox="0 0 100 70" className="pv-uc">
          <rect x="30" y="30" width="40" height="38" className="frame" />
          <rect x="46" y="25" width="8" height="5" className="cam" />
          {person(14, 'off')}
          {person(50, 'on')}
          {person(86, 'off')}
        </svg>
        <p className="what">{o.lines?.[0]}</p>
      </>
    )
    back = (
      <>
        <svg viewBox="0 0 100 70" className="pv-uc">
          <rect x="6" y="4" width="88" height="28" className="screen" />
          {[
            [24, 14],
            [52, 22],
            [78, 12],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.6" className={`tip t${i}`} />
          ))}
          {person(18, 'on', 0)}
          {person(50, 'on', 1)}
          {person(82, 'on', 2)}
        </svg>
        <ol className="pv-steps">
          <li>Accelerometer, not a camera</li>
          <li>More precise, in any light</li>
          <li>The whole room at once</li>
        </ol>
      </>
    )
  } else if (o.visual === 'glasses') {
    // A pair of glasses; then the street through them, with what you asked for laid over it.
    const lenses = <path d="M8 22 h36 v22 a8 8 0 0 1 -8 8 h-20 a8 8 0 0 1 -8 -8 Z M56 22 h36 v22 a8 8 0 0 1 -8 8 h-20 a8 8 0 0 1 -8 -8 Z M44 28 Q50 24 56 28 M8 26 L2 22 M92 26 L98 22" className="frame" />
    front = (
      <>
        <svg viewBox="0 0 100 70" className="pv-uc">
          {lenses}
        </svg>
        <p className="what">{o.lines?.[0]}</p>
      </>
    )
    back = (
      <>
        <svg viewBox="0 0 100 70" className="pv-uc">
          <path d="M10 46 V36 h6 v-6 h6 v16 M28 46 V32 h8 v14 M62 46 V34 h6 v-8 h8 v20 M80 46 V38 h8 v8" className="street" />
          <path d="M8 46 H44 M56 46 H92" className="street" />
          <path d="M20 46 Q30 40 36 41 M64 46 Q70 42 76 30" className="route" />
          <circle cx="76" cy="28" r="2.2" className="tip" />
          <rect x="14" y="26" width="18" height="6" className="tag" />
          {lenses}
        </svg>
        <p className="what">The world, as you want it.</p>
      </>
    )
  }
  return (
    <div className={`pv-future ${transformed ? 'is-done' : ''}`}>
      <div className="face front">
        <header>
          <span className="idx">{o.index}</span>
          <strong>
            {o.id === 'c-axis' && <AxisMark className="inline" />}
            {o.label}
          </strong>
        </header>
        <div className="body">{front}</div>
        <footer>{o.lines?.[1]}</footer>
      </div>
      <div className="face back">
        <header>
          <span className="idx">{o.index}</span>
          <strong>{o.label}</strong>
        </header>
        <div className="body">{back}</div>
        <footer>
          {o.index} · {o.destination}
        </footer>
      </div>
    </div>
  )
}

// ---- use-cases slide: roadmap illustrations (line art in the pitch's own style) ----------------------
/** A person: head and shoulders at (x, y) = head centre; `arm` raises a hand towards a point. */
function Person({ x, y, dim = false, arm, band = false, glasses = false }: { x: number; y: number; dim?: boolean; arm?: [number, number]; band?: boolean; glasses?: boolean }) {
  // the hand stops 9 units along the line from the shoulder towards the target
  const sx = x + (arm && arm[0] < x ? -5.5 : 5.5)
  const sy = y + 8
  const hand = arm ? (() => {
    const dx = arm[0] - sx
    const dy = arm[1] - sy
    const d = Math.hypot(dx, dy) || 1
    return [sx + (dx / d) * 10, sy + (dy / d) * 10] as const
  })() : null
  return (
    <g className={`person ${dim ? 'dim' : ''}`}>
      <circle cx={x} cy={y} r="3.6" />
      <path d={`M${x - 6.5} ${y + 15} q0 -9 6.5 -9 q6.5 0 6.5 9`} />
      {hand && <line x1={sx} y1={sy} x2={hand[0]} y2={hand[1]} className="arm" />}
      {glasses && <path d={`M${x - 3.4} ${y - 0.4} h6.8`} className="glasses" />}
      {band && hand && (
        <g>
          <circle cx={hand[0]} cy={hand[1]} r="2.4" className="band-glow" />
          <circle cx={hand[0]} cy={hand[1]} r="1.2" className="band" />
        </g>
      )}
    </g>
  )
}

/** The point a raised hand reaches, for drawing beams from it. */
const reach = (x: number, y: number, arm: [number, number]): [number, number] => {
  const sx = x + (arm[0] < x ? -5.5 : 5.5)
  const sy = y + 8
  const d = Math.hypot(arm[0] - sx, arm[1] - sy) || 1
  return [sx + ((arm[0] - sx) / d) * 10, sy + ((arm[1] - sy) / d) * 10]
}

const Chart = ({ x, y, w, h, lit = -1 }: { x: number; y: number; w: number; h: number; lit?: number }) => (
  <g>
    {[0.45, 0.6, 0.75, 1].map((v, i) => (
      <rect key={i} x={x + (i * w) / 4 + w * 0.05} y={y + h * (1 - v)} width={w / 4 - w * 0.1} height={h * v} className={i === lit ? 'bar hot' : 'bar'} />
    ))}
  </g>
)

/** A small floating card: a few text lines. */
const Chip = ({ x, y, w = 14, lines = 2, hot = false }: { x: number; y: number; w?: number; lines?: number; hot?: boolean }) => (
  <g className={`chip ${hot ? 'hot' : ''}`}>
    <rect x={x} y={y} width={w} height={3 + lines * 2.6} rx="1" />
    {Array.from({ length: lines }, (_, i) => (
      <line key={i} x1={x + 2} y1={y + 2.8 + i * 2.6} x2={x + w - 2 - (i % 2) * 3} y2={y + 2.8 + i * 2.6} />
    ))}
  </g>
)

/** Use-cases slide scenes: today on the front (`after` false), with Axis on the back. */
function HorizonArt({ art, after }: { art: 'now' | 'team' | 'world'; after: boolean }) {
  if (art === 'now') {
    const me: [number, number] = [60, 22]
    const [hx, hy] = reach(22, 30, me)
    return (
      <svg viewBox="0 0 100 64" className={`pv-hz ${after ? 'is-after' : ''}`}>
        <rect x="40" y="6" width="54" height="34" className="screen" />
        <Chart x={46} y={14} w={26} h={20} lit={after ? 3 : -1} />
        {after ? (
          <>
            <Chip x={75} y={12} w={15} lines={3} hot />
            <Person x={22} y={30} arm={me} band />
            <path d={`M${hx} ${hy} L66 22`} className="beam" />
            {[0, 1, 2].map((i) => (
              <path key={i} d={`M${13 - i * 2.4} ${26 - i * 1.6} q-2 4 0 8`} className="wave" style={{ animationDelay: `${i * 160}ms` }} />
            ))}
            <Chip x={6} y={46} w={14} lines={2} />
            <path d={`M${hx - 2} ${hy + 4} Q12 44 13 46`} className="beam soft" />
          </>
        ) : (
          <>
            <Person x={22} y={30} />
            <rect x="6" y="50" width="20" height="8" className="laptop" />
            <line x1="4" y1="58" x2="28" y2="58" className="laptop" />
            <path d="M24 46 Q30 52 24 54" className="trudge" />
          </>
        )}
      </svg>
    )
  }
  if (art === 'team') {
    const xs = [22, 50, 78]
    const aims: [number, number][] = [
      [34, 16],
      [50, 16],
      [66, 16],
    ]
    return (
      <svg viewBox="0 0 100 64" className={`pv-hz ${after ? 'is-after' : ''}`}>
        <rect x="12" y="4" width="76" height="22" className="screen" />
        {after ? (
          <>
            <Chip x={16} y={8} w={14} lines={3} />
            <Chip x={43} y={8} w={14} lines={3} hot />
            <Chip x={70} y={8} w={14} lines={3} />
            {xs.map((x, i) => {
              const [hx, hy] = reach(x, 40, aims[i])
              return (
                <g key={x}>
                  <Person x={x} y={40} arm={aims[i]} band />
                  <path d={`M${hx} ${hy} L${aims[i][0]} 22`} className="beam" style={{ animationDelay: `${i * 220}ms` }} />
                  <rect x={x + 5} y={32} width="6" height="4" rx="0.8" className="mem" />
                </g>
              )
            })}
          </>
        ) : (
          <>
            <path d="M47 26 h6 l-1 3 h-4 z" className="camera" />
            <path d="M48 29 L40 60 M52 29 L60 60" className="cone" />
            <Person x={50} y={40} arm={[50, 26]} />
            <Person x={22} y={40} dim />
            <Person x={78} y={40} dim />
          </>
        )}
      </svg>
    )
  }
  // world
  return (
    <svg viewBox="0 0 100 64" className={`pv-hz ${after ? 'is-after' : ''}`}>
      {after ? (
        <>
          <circle cx="50" cy="34" r="26" className="field" />
          <circle cx="50" cy="34" r="15" className="field" />
          <Person x={50} y={28} glasses arm={[64, 20]} band />
          {/* things in the world, each with its own floating panel */}
          <g className="thing">
            <path d="M12 16 h8 l-2 -6 h-4 z" />
            <line x1="16" y1="16" x2="16" y2="24" />
          </g>
          <Chip x={6} y={26} w={14} lines={1} hot />
          <g className="thing">
            <path d="M84 12 a4 4 0 1 1 0.01 0 M84 20 l0 4" />
          </g>
          <Chip x={78} y={28} w={16} lines={2} hot />
          <g className="thing">
            <rect x="12" y="50" width="12" height="9" rx="1" />
            <line x1="12" y1="53" x2="24" y2="53" />
          </g>
          <g className="thing">
            <rect x="76" y="48" width="14" height="10" rx="1" />
          </g>
          <path d="M44 30 Q30 22 20 20" className="beam soft" />
          <path d="M57 32 Q70 24 80 18" className="beam" />
          <path d="M46 40 Q34 52 24 54" className="beam soft" />
          <path d="M55 40 Q66 50 76 52" className="beam soft" />
        </>
      ) : (
        <>
          <rect x="36" y="38" width="28" height="18" className="screen" />
          <Person x={50} y={26} />
          <g className="thing dim">
            <path d="M12 16 h8 l-2 -6 h-4 z" />
            <line x1="16" y1="16" x2="16" y2="24" />
          </g>
          <g className="thing dim">
            <path d="M84 12 a4 4 0 1 1 0.01 0 M84 20 l0 4" />
          </g>
          <g className="thing dim">
            <rect x="12" y="50" width="12" height="9" rx="1" />
          </g>
          <g className="thing dim">
            <rect x="76" y="48" width="14" height="10" rx="1" />
          </g>
        </>
      )}
    </svg>
  )
}

function HorizonCard({ o, transformed }: { o: PitchObject; transformed: boolean }) {
  const h = o.horizon
  if (!h) return null
  const head = (
    <header>
      <span className="idx">{o.index}</span>
      <strong>{o.label}</strong>
    </header>
  )
  return (
    <div className={`pv-future ${transformed ? 'is-done' : ''}`}>
      <div className="face front">
        {head}
        <p className="hz-title">{h.title}</p>
        <div className="body">
          <HorizonArt art={h.art} after={false} />
        </div>
        <footer>
          Today · <span className="hz-today">{h.today}</span>
        </footer>
      </div>
      <div className="face back">
        {head}
        <p className="hz-title">{h.title}</p>
        <div className="body">
          <HorizonArt art={h.art} after />
        </div>
        <ul className="hz-tags">
          {h.axis.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <footer>
          With Axis · {h.status}
          {h.note && <span className="hz-note">{h.note}</span>}
        </footer>
      </div>
    </div>
  )
}

export function ObjectVisual({ o, lit, transformed = false }: { o: PitchObject; lit: boolean; transformed?: boolean }) {
  const c = o.content
  switch (o.visual) {
    case 'horizon':
      return <HorizonCard o={o} transformed={transformed} />
    case 'teach':
    case 'band':
    case 'glasses':
      return <FutureCard o={o} transformed={transformed} />
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
    case 'transcript':
      return (
        <div className="pv-transcript">
          <span className="idx">Said</span>
          <p>{c?.kind === 'note' ? c.text : o.label}</p>
        </div>
      )
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
