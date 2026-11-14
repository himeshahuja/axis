// Miniature objects the site floats around. Every chart is drawn from real
// numbers in SITE_OBJECTS, so the actions in the playground (which run the
// app's own describeObject / memoryEntryFor) talk about what you see.

import type { SpatialObject } from '../spatial/types'

export type Visual = 'chart' | 'bars' | 'note' | 'terrain' | 'wire' | 'wave' | 'grid' | 'terminal' | 'math' | 'metric'

export interface SiteObject extends SpatialObject {
  visual: Visual
  tag: string
}

/** Objects with structured content: the playground and the intelligence section use these. */
export const SITE_OBJECTS: SiteObject[] = [
  {
    id: 'revenue',
    label: 'Quarterly Revenue',
    tag: 'CHART · $k',
    visual: 'chart',
    color: '#FF5A1F',
    shape: 'card',
    x: 0.08,
    y: 0.16,
    w: 0.24,
    h: 0.3,
    content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }, { label: 'Q3', value: 180 }, { label: 'Q4', value: 210 }] },
  },
  {
    id: 'latency',
    label: 'Hand-tracking Latency',
    tag: 'BARS · ms',
    visual: 'bars',
    color: '#F2F0EB',
    shape: 'card',
    x: 0.44,
    y: 0.1,
    w: 0.2,
    h: 0.26,
    content: { kind: 'chart', unit: 'ms', series: [{ label: 'Mon', value: 48 }, { label: 'Tue', value: 41 }, { label: 'Wed', value: 44 }, { label: 'Thu', value: 33 }, { label: 'Fri', value: 29 }] },
  },
  {
    id: 'notes',
    label: 'Launch Notes',
    tag: 'NOTE',
    visual: 'note',
    color: '#F2F0EB',
    shape: 'card',
    x: 0.36,
    y: 0.56,
    w: 0.22,
    h: 0.26,
    content: { kind: 'note', text: 'Ship pricing page before Q1 close\nMove onboarding email to day 2\nRisk: support load after launch' },
  },
  {
    id: 'conversion',
    label: 'Conversion',
    tag: 'METRIC',
    visual: 'metric',
    color: '#F2F0EB',
    shape: 'card',
    x: 0.78,
    y: 0.56,
    w: 0.14,
    h: 0.2,
    content: { kind: 'metric', value: 0.124, format: 'percent', note: 'Sample figure for this demo.' },
  },
  {
    id: 'terrain',
    label: 'Contour Study',
    tag: 'RENDER',
    visual: 'terrain',
    color: '#F2F0EB',
    shape: 'card',
    x: 0.06,
    y: 0.6,
    w: 0.2,
    h: 0.26,
    content: { kind: 'note', text: 'Procedural contour render\nGenerated in your browser, not a photograph\nTen elevation bands' },
  },
]

export const byId = (id: string) => SITE_OBJECTS.find((o) => o.id === id)

// ---- visuals --------------------------------------------------------------------------

const series = (o?: SiteObject) => (o?.content?.kind === 'chart' ? o.content.series : [])

function LineChart({ obj }: { obj?: SiteObject }) {
  const s = series(obj ?? byId('revenue'))
  const max = Math.max(...s.map((p) => p.value)) * 1.1
  const pts = s.map((p, i) => [8 + (i * 84) / (s.length - 1), 52 - (p.value / max) * 44] as const)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 100 64" className="viz">
      {[12, 24, 36, 48].map((y) => (
        <line key={y} x1="8" x2="92" y1={y} y2={y} className="viz-grid" />
      ))}
      <path d={`${d} L92,56 L8,56 Z`} className="viz-area" />
      <path d={d} className="viz-line" />
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="1.6" className="viz-dot" />
          <text x={x} y="62" className="viz-label" textAnchor="middle">
            {s[i].label}
          </text>
        </g>
      ))}
    </svg>
  )
}

function Bars({ obj }: { obj?: SiteObject }) {
  const s = series(obj ?? byId('latency'))
  const max = Math.max(...s.map((p) => p.value))
  const w = 84 / s.length
  return (
    <svg viewBox="0 0 100 64" className="viz">
      <line x1="8" x2="92" y1="54" y2="54" className="viz-grid" />
      {s.map((p, i) => {
        const h = (p.value / max) * 42
        return (
          <g key={p.label}>
            <rect x={8 + i * w + w * 0.18} y={54 - h} width={w * 0.64} height={h} className={i === s.length - 1 ? 'viz-bar hot' : 'viz-bar'} />
            <text x={8 + i * w + w / 2} y="62" className="viz-label" textAnchor="middle">
              {p.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Note({ obj }: { obj?: SiteObject }) {
  const o = obj ?? byId('notes')
  const lines = o?.content?.kind === 'note' ? o.content.text.split('\n') : []
  return (
    <div className="viz-note">
      {lines.map((l, i) => (
        <p key={i}>
          <span>{String(i + 1).padStart(2, '0')}</span>
          {l}
        </p>
      ))}
    </div>
  )
}

/** Contour lines of a sum of gaussians, traced as level sets on a coarse grid (marching squares). */
const terrainPaths = (() => {
  const N = 40
  const f = (x: number, y: number) =>
    Math.exp(-((x - 0.32) ** 2 + (y - 0.4) ** 2) / 0.04) + 0.8 * Math.exp(-((x - 0.7) ** 2 + (y - 0.62) ** 2) / 0.06) + 0.3 * Math.sin(x * 9) * Math.cos(y * 7) * 0.3
  const g: number[][] = []
  for (let j = 0; j <= N; j++) {
    g.push([])
    for (let i = 0; i <= N; i++) g[j].push(f(i / N, j / N))
  }
  const paths: string[] = []
  for (let lvl = 1; lvl <= 10; lvl++) {
    const t = lvl * 0.095
    let d = ''
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const c = [g[j][i], g[j][i + 1], g[j + 1][i + 1], g[j + 1][i]]
        const pts: [number, number][] = []
        const edge = (a: number, b: number, ax: number, ay: number, bx: number, by: number) => {
          if (a < t !== b < t) {
            const k = (t - a) / (b - a)
            pts.push([(ax + (bx - ax) * k) / N, (ay + (by - ay) * k) / N])
          }
        }
        edge(c[0], c[1], i, j, i + 1, j)
        edge(c[1], c[2], i + 1, j, i + 1, j + 1)
        edge(c[2], c[3], i + 1, j + 1, i, j + 1)
        edge(c[3], c[0], i, j + 1, i, j)
        if (pts.length >= 2) d += `M${(pts[0][0] * 100).toFixed(1)},${(pts[0][1] * 64).toFixed(1)}L${(pts[1][0] * 100).toFixed(1)},${(pts[1][1] * 64).toFixed(1)}`
      }
    paths.push(d)
  }
  return paths
})()

function Terrain() {
  return (
    <svg viewBox="0 0 100 64" className="viz viz-terrain" preserveAspectRatio="xMidYMid slice">
      {terrainPaths.map((d, i) => (
        <path key={i} d={d} className={i === 7 ? 'hot' : undefined} style={{ opacity: 0.25 + i * 0.07 }} />
      ))}
    </svg>
  )
}

function Wire() {
  return (
    <svg viewBox="0 0 100 64" className="viz viz-wire">
      <rect x="6" y="6" width="88" height="52" />
      <line x1="6" y1="16" x2="94" y2="16" />
      <rect x="12" y="22" width="30" height="30" />
      <line x1="12" y1="22" x2="42" y2="52" />
      <line x1="42" y1="22" x2="12" y2="52" />
      <line x1="50" y1="24" x2="86" y2="24" />
      <line x1="50" y1="31" x2="80" y2="31" />
      <line x1="50" y1="38" x2="84" y2="38" />
      <rect x="50" y="44" width="18" height="8" className="hot" />
      <circle cx="11" cy="11" r="1.4" />
      <circle cx="16" cy="11" r="1.4" />
    </svg>
  )
}

function Wave() {
  let d = ''
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * 100
    const env = Math.sin((i / 120) * Math.PI)
    const y = 32 + Math.sin(i * 0.55) * 18 * env * (0.6 + 0.4 * Math.sin(i * 0.13))
    d += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }
  return (
    <svg viewBox="0 0 100 64" className="viz">
      <line x1="0" x2="100" y1="32" y2="32" className="viz-grid" />
      <path d={d} className="viz-line" />
    </svg>
  )
}

function Grid() {
  const lines = []
  for (let i = 0; i <= 10; i++) {
    lines.push(<line key={`v${i}`} x1={i * 10} x2={i * 10} y1="0" y2="64" />)
    if (i <= 6) lines.push(<line key={`h${i}`} x1="0" x2="100" y1={i * 10.6} y2={i * 10.6} />)
  }
  return (
    <svg viewBox="0 0 100 64" className="viz viz-coord">
      {lines}
      <line x1="50" x2="50" y1="0" y2="64" className="axis" />
      <line x1="0" x2="100" y1="32" y2="32" className="axis" />
      <circle cx="68" cy="20" r="2.4" className="hot" />
      <text x="71" y="17">
        (0.36, 0.38)
      </text>
    </svg>
  )
}

function Terminal() {
  return (
    <div className="viz-term">
      <p>
        <b>›</b> pinch.detect()
      </p>
      <p className="dim">hysteresis 0.32 / 0.42</p>
      <p>
        <b>›</b> grab revenue
      </p>
      <p className="hot">GRABBED · 16ms</p>
    </div>
  )
}

function MathFrag() {
  return (
    <div className="viz-math">
      <span>θ = ∫ ω dt</span>
      <span className="small">|θ| &lt; 6° → 0</span>
    </div>
  )
}

function Metric({ obj }: { obj?: SiteObject }) {
  const o = obj ?? byId('conversion')
  const v = o?.content?.kind === 'metric' ? o.content.value : 0
  return (
    <div className="viz-metric">
      <strong>{(v * 100).toFixed(1)}</strong>
      <span>%</span>
    </div>
  )
}

export function ObjectVisual({ visual, obj }: { visual: Visual; obj?: SiteObject }) {
  switch (visual) {
    case 'chart':
      return <LineChart obj={obj} />
    case 'bars':
      return <Bars obj={obj} />
    case 'note':
      return <Note obj={obj} />
    case 'terrain':
      return <Terrain />
    case 'wire':
      return <Wire />
    case 'wave':
      return <Wave />
    case 'grid':
      return <Grid />
    case 'terminal':
      return <Terminal />
    case 'math':
      return <MathFrag />
    case 'metric':
      return <Metric obj={obj} />
  }
}
