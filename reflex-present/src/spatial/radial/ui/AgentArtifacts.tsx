// What the Explain agent made, drawn inside its card: an interactive Desmos graph, a chart,
// a plot from its Python sandbox, and the code it ran (folded away).

import { useEffect, useRef, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AgentArtifact } from '../actions/agentTypes'
import './agent.css'

type Of<T extends AgentArtifact['type']> = Extract<AgentArtifact, { type: T }>

const PALETTE = ['#edca7c', '#7fe3ff', '#e9a58e', '#abc8bc', '#b8a6e8', '#f2b8d0']

// ---- Desmos ---------------------------------------------------------------------------------
/** Desmos's public demo key, for development; set VITE_DESMOS_API_KEY to use your own. */
const DESMOS_DEMO_KEY = 'dcb31709b452b1cf9dc26972add0fda6'

interface DesmosCalculator {
  setExpression(e: { id: string; latex: string; color?: string }): void
  setMathBounds(b: { left: number; right: number; bottom: number; top: number }): void
  destroy(): void
}
interface DesmosApi {
  GraphingCalculator(el: HTMLElement, options?: Record<string, unknown>): DesmosCalculator
}

let desmosScript: Promise<DesmosApi> | null = null

const invert = (hex: string) => `#${(0xffffff ^ parseInt(hex.slice(1), 16)).toString(16).padStart(6, '0')}`

function loadDesmos(): Promise<DesmosApi> {
  const w = window as unknown as { Desmos?: DesmosApi }
  if (w.Desmos) return Promise.resolve(w.Desmos)
  desmosScript ??= new Promise<DesmosApi>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `https://www.desmos.com/api/v1.12/calculator.js?apiKey=${encodeURIComponent(import.meta.env.VITE_DESMOS_API_KEY || DESMOS_DEMO_KEY)}`
    s.async = true
    s.onload = () => (w.Desmos ? resolve(w.Desmos) : reject(new Error('Desmos did not load.')))
    s.onerror = () => {
      desmosScript = null
      s.remove()
      reject(new Error('Could not load Desmos (is this laptop online?).'))
    }
    document.head.appendChild(s)
  })
  return desmosScript
}

function DesmosGraph({ a }: { a: Of<'graph'> }) {
  const el = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let calc: DesmosCalculator | null = null
    let gone = false
    loadDesmos()
      .then((D) => {
        if (gone || !el.current) return
        calc = D.GraphingCalculator(el.current, { expressions: false, settingsMenu: false, keypad: false, zoomButtons: true, border: false, invertedColors: true, showResetButtonOnGraphpaper: true })
        // invertedColors (dark graph paper) inverts curve colours too: pre-invert so they match the card.
        a.expressions.forEach((latex, i) => calc!.setExpression({ id: `e${i}`, latex, color: invert(PALETTE[i % PALETTE.length]) }))
        if (a.bounds) calc.setMathBounds(a.bounds)
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      gone = true
      calc?.destroy()
    }
  }, [a])
  return (
    <figure className="ag-figure">
      {a.title && <figcaption className="ag-title">{a.title}</figcaption>}
      {error ? <div className="ap-error">{error}</div> : <div ref={el} className="ag-desmos" />}
      <div className="ag-exprs">
        {a.expressions.map((x, i) => (
          <code key={i} style={{ color: PALETTE[i % PALETTE.length] }}>
            {x}
          </code>
        ))}
      </div>
    </figure>
  )
}

// ---- charts -----------------------------------------------------------------------------------
function AgentChart({ a }: { a: Of<'chart'> }) {
  const data = a.points.map((p) => ({ name: p.label, value: p.value }))
  const fmt = (v: unknown) => {
    const n = typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v)
    return a.unit === '$' ? `$${n}` : a.unit === '%' ? `${n}%` : a.unit ? `${n} ${a.unit}` : n
  }
  const axis = { stroke: '#8d8b85', fontSize: 11, tickLine: false }
  const tip = <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#1c1d1f', border: '1px solid #ffffff22', borderRadius: 8, color: '#eee' }} />
  const grid = <CartesianGrid stroke="#ffffff12" vertical={false} />
  const x = <XAxis dataKey="name" {...axis} />
  const y = <YAxis {...axis} width={44} tickFormatter={(v) => fmt(v)} />
  return (
    <figure className="ag-figure">
      {a.title && <figcaption className="ag-title">{a.title}</figcaption>}
      <div className="ag-chart">
        <ResponsiveContainer width="100%" height="100%">
          {a.kind === 'pie' ? (
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" outerRadius="75%" label={({ name }) => String(name)} stroke="none">
                {data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
              {tip}
            </PieChart>
          ) : a.kind === 'line' ? (
            <LineChart data={data}>
              {grid}
              {x}
              {y}
              {tip}
              <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          ) : a.kind === 'area' ? (
            <AreaChart data={data}>
              {grid}
              {x}
              {y}
              {tip}
              <Area dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.25} strokeWidth={2} />
            </AreaChart>
          ) : (
            <BarChart data={data}>
              {grid}
              {x}
              {y}
              {tip}
              <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

// ---- all of them ------------------------------------------------------------------------------
export function AgentArtifacts({ artifacts }: { artifacts?: AgentArtifact[] }) {
  if (!artifacts?.length) return null
  const visual = artifacts.filter((a) => a.type !== 'code')
  const code = artifacts.filter((a): a is Of<'code'> => a.type === 'code')
  return (
    <div className="ag-artifacts">
      {visual.map((a, i) =>
        a.type === 'graph' ? (
          <DesmosGraph key={i} a={a} />
        ) : a.type === 'chart' ? (
          <AgentChart key={i} a={a} />
        ) : a.type === 'image' ? (
          <img key={i} className="ag-image" src={`data:${a.mimeType};base64,${a.data}`} alt="Figure drawn by the agent’s Python code" />
        ) : null,
      )}
      {code.map((c, i) => (
        <details key={`c${i}`} className="ag-code">
          <summary>
            Python it ran{c.ok ? '' : ' · failed'}
          </summary>
          <pre>{c.code}</pre>
          {c.output && <pre className="ag-out">{c.output}</pre>}
        </details>
      ))}
    </div>
  )
}
