// The site's miniature object visuals (reflex-present/src/site/objects.tsx), redrawn at
// film scale with the same geometry and the same CSS values.

import type { CSSProperties } from 'react'
import { REVENUE } from '../data'
import { C, F } from '../theme'

const vizStyle: CSSProperties = { width: '100%', height: '100%', overflow: 'visible', display: 'block' }

/** viewBox 0 0 100 64, exactly as the site draws it. `draw` 0..1 traces the line. */
export function LineChart({ draw = 1, highlight = [] as number[], labels = true }: { draw?: number; highlight?: number[]; labels?: boolean }) {
  const s = REVENUE
  const max = Math.max(...s.map((p) => p.value)) * 1.1
  const pts = s.map((p, i) => [8 + (i * 84) / (s.length - 1), 52 - (p.value / max) * 44] as const)
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
  const total = pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0)
  return (
    <svg viewBox="0 0 100 64" style={vizStyle}>
      {[12, 24, 36, 48].map((y) => (
        <line key={y} x1="8" x2="92" y1={y} y2={y} stroke="rgba(242,240,235,0.1)" strokeWidth={0.4} />
      ))}
      <path d={`${d} L92,56 L8,56 Z`} fill="rgba(255,90,31,0.1)" opacity={draw} />
      <path d={d} fill="none" stroke={C.hot} strokeWidth={1.4} strokeLinejoin="round" strokeDasharray={total} strokeDashoffset={total * (1 - draw)} />
      {pts.map(([x, y], i) => (
        <g key={i} opacity={draw >= i / (s.length - 1) - 0.001 ? 1 : 0}>
          {highlight.includes(i) && <circle cx={x} cy={y} r={3.6} fill="none" stroke={C.hot} strokeWidth={0.6} />}
          <circle cx={x} cy={y} r="1.6" fill={C.bg} stroke={C.hot} strokeWidth={1} />
          {labels && (
            <text x={x} y="62" fill={C.mute} style={{ font: `4.4px ${F.sans}` }} textAnchor="middle">
              {s[i].label}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

export function Note({ lines, size = 17 }: { lines: string[]; size?: number }) {
  return (
    <div style={{ width: '100%', fontFamily: F.sans, fontSize: size, lineHeight: 1.35, color: C.ink }}>
      {lines.map((l, i) => (
        <p key={i} style={{ display: 'flex', gap: 12, padding: '5px 0', margin: 0, borderBottom: `1px dashed ${C.line}` }}>
          <span style={{ fontSize: size * 0.8, color: C.hot, paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</span>
          {l}
        </p>
      ))}
    </div>
  )
}

/** Contour lines of a sum of gaussians (marching squares), as on the site. */
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

export function Terrain() {
  return (
    <svg viewBox="0 0 100 64" style={vizStyle} preserveAspectRatio="xMidYMid slice">
      {terrainPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={i === 7 ? C.hot : C.ink} strokeWidth={i === 7 ? 0.8 : 0.45} style={{ opacity: 0.25 + i * 0.07 }} />
      ))}
    </svg>
  )
}

export function Grid() {
  const lines = []
  for (let i = 0; i <= 10; i++) {
    lines.push(<line key={`v${i}`} x1={i * 10} x2={i * 10} y1="0" y2="64" stroke="rgba(242,240,235,0.12)" strokeWidth={0.4} />)
    if (i <= 6) lines.push(<line key={`h${i}`} x1="0" x2="100" y1={i * 10.6} y2={i * 10.6} stroke="rgba(242,240,235,0.12)" strokeWidth={0.4} />)
  }
  return (
    <svg viewBox="0 0 100 64" style={vizStyle}>
      {lines}
      <line x1="50" x2="50" y1="0" y2="64" stroke="rgba(242,240,235,0.5)" strokeWidth={0.4} />
      <line x1="0" x2="100" y1="32" y2="32" stroke="rgba(242,240,235,0.5)" strokeWidth={0.4} />
      <circle cx="68" cy="20" r="2.4" fill={C.hot} />
    </svg>
  )
}

export function Wire() {
  const s = { fill: 'none', stroke: 'rgba(242,240,235,0.55)', strokeWidth: 0.6 }
  return (
    <svg viewBox="0 0 100 64" style={vizStyle}>
      <rect x="6" y="6" width="88" height="52" {...s} />
      <line x1="6" y1="16" x2="94" y2="16" {...s} />
      <rect x="12" y="22" width="30" height="30" {...s} />
      <line x1="12" y1="22" x2="42" y2="52" {...s} />
      <line x1="42" y1="22" x2="12" y2="52" {...s} />
      <line x1="50" y1="24" x2="86" y2="24" {...s} />
      <line x1="50" y1="31" x2="80" y2="31" {...s} />
      <line x1="50" y1="38" x2="84" y2="38" {...s} />
      <rect x="50" y="44" width="18" height="8" {...s} stroke={C.hot} />
    </svg>
  )
}

/** A voice waveform: bars whose heights are a deterministic function of frame. */
export function Waveform({ frame, bars = 48, width = 520, height = 90, level = 1 }: { frame: number; bars?: number; width?: number; height?: number; level?: number }) {
  const gap = width / bars
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      {Array.from({ length: bars }, (_, i) => {
        const p = i / (bars - 1)
        const env = Math.sin(Math.PI * p) ** 0.8
        const v = 0.18 + 0.82 * Math.abs(Math.sin(frame * 0.31 + i * 0.73) * 0.55 + Math.sin(frame * 0.17 + i * 1.91) * 0.45)
        const h = Math.max(3, height * env * v * level)
        return <rect key={i} x={i * gap + gap * 0.2} y={(height - h) / 2} width={gap * 0.6} height={h} rx={gap * 0.3} fill={i % 7 === 3 ? C.ink : C.hot} opacity={0.55 + 0.45 * env} />
      })}
    </svg>
  )
}
