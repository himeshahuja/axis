// What the Explain agent made: an interactive Desmos graph, a chart, a plot from its Python
// sandbox, and the code it ran (folded away). Inside the card each figure can be dragged out
// (mouse) or put on the slide with one press (hand); on the slide the same components draw it
// as an ordinary object (FigureView), filling its box and leaving pointer input to the stage.

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { isFigureArtifact, type AgentArtifact, type AgentFigure } from '../actions/agentTypes'
import { figureTitle } from '../figures'
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

/** `onStage`: fixed viewport and no controls, so grabbing the object never pans the graph. */
const DesmosGraph = memo(function DesmosGraph({ a, onStage = false }: { a: Of<'graph'>; onStage?: boolean }) {
  const el = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let calc: DesmosCalculator | null = null
    let gone = false
    loadDesmos()
      .then((D) => {
        if (gone || !el.current) return
        calc = D.GraphingCalculator(el.current, {
          expressions: false,
          settingsMenu: false,
          keypad: false,
          border: false,
          invertedColors: true,
          zoomButtons: !onStage,
          showResetButtonOnGraphpaper: !onStage,
          lockViewport: onStage,
        })
        // invertedColors (dark graph paper) inverts curve colours too: pre-invert so they match the card.
        a.expressions.forEach((latex, i) => calc!.setExpression({ id: `e${i}`, latex, color: invert(PALETTE[i % PALETTE.length]) }))
        if (a.bounds) calc.setMathBounds(a.bounds)
      })
      .catch((e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      gone = true
      calc?.destroy()
    }
  }, [a, onStage])
  return error ? <div className="ap-error">{error}</div> : <div ref={el} className="ag-desmos" />
})

// ---- charts -----------------------------------------------------------------------------------
// The page re-renders every frame: the chart is memoized on its artifact and not animated, or
// recharts would restart its grow-in animation each frame and never draw the bars or slices.
const AgentChart = memo(function AgentChart({ a }: { a: Of<'chart'> }) {
  const data = useMemo(() => a.points.map((p) => ({ name: p.label, value: p.value })), [a])
  const fmt = (v: unknown) => {
    const n = typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v)
    return a.unit === '$' ? `$${n}` : a.unit === '%' ? `${n}%` : a.unit ? `${n} ${a.unit}` : n
  }
  const axis = { stroke: '#8d8b85', fontSize: 11, tickLine: false }
  const tip = <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: '#1c1d1f', border: '1px solid #ffffff22', borderRadius: 8, color: '#eee' }} />
  const grid = <CartesianGrid stroke="#ffffff12" vertical={false} />
  const x = <XAxis dataKey="name" {...axis} />
  // Wide enough for a value and its unit on one line ("210 $k").
  const y = <YAxis {...axis} width={a.unit && a.unit.length > 1 ? 58 : 44} tickFormatter={(v) => fmt(v)} />
  return (
    <div className="ag-chart">
      <ResponsiveContainer width="100%" height="100%">
        {a.kind === 'pie' ? (
          <PieChart margin={{ top: 6, right: 12, bottom: 6, left: 12 }}>
            <Pie data={data} dataKey="value" nameKey="name" outerRadius="62%" label={({ name, value }) => `${name} ${fmt(value)}`} labelLine={false} stroke="#151517" strokeWidth={2} isAnimationActive={false} fontSize={11}>
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
            <Line dataKey="value" stroke={PALETTE[0]} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        ) : a.kind === 'area' ? (
          <AreaChart data={data}>
            {grid}
            {x}
            {y}
            {tip}
            <Area dataKey="value" stroke={PALETTE[0]} fill={PALETTE[0]} fillOpacity={0.25} strokeWidth={2} isAnimationActive={false} />
          </AreaChart>
        ) : (
          <BarChart data={data}>
            {grid}
            {x}
            {y}
            {tip}
            <Bar dataKey="value" fill={PALETTE[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
})

function FigureBody({ f, onStage = false }: { f: AgentFigure; onStage?: boolean }) {
  if (f.type === 'graph') return <DesmosGraph a={f} onStage={onStage} />
  if (f.type === 'chart') return <AgentChart a={f} />
  return <img className="ag-image" src={`data:${f.mimeType};base64,${f.data}`} alt="Figure drawn by the agent’s Python code" draggable={false} />
}

/** A figure as a slide object: drawn to fill the object's box. */
export const FigureView = memo(function FigureView({ figure }: { figure: AgentFigure }) {
  return (
    <div className={`ag-onstage ag-onstage-${figure.type}`}>
      <div className="ag-onstage-title">{figureTitle(figure)}</div>
      <div className="ag-onstage-body">
        <FigureBody f={figure} onStage />
      </div>
      {figure.type === 'graph' && (
        <div className="ag-exprs">
          {figure.expressions.map((x, i) => (
            <code key={i} style={{ color: PALETTE[i % PALETTE.length] }}>
              {x}
            </code>
          ))}
        </div>
      )}
    </div>
  )
})

// ---- taking a figure out of the card ------------------------------------------------------------
export interface FigurePlacing {
  /** Put this figure on the slide; `at` is where the mouse let go, in screen pixels. */
  onPlace: (f: AgentFigure, at?: { clientX: number; clientY: number }) => void
  /** Figures already on the slide (their button says so; dragging one again moves it). */
  placed: (f: AgentFigure) => boolean
  /** Air-control id for the figure's button, so a closed hand can press it. */
  airAction?: (index: number) => string | undefined
  /** The air control the hand cursor is on, to highlight it. */
  hoverAction?: string | null
}

const DRAG_START_PX = 6

function PlaceControls({ f, index, placing }: { f: AgentFigure; index: number; placing: FigurePlacing }) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)
  const start = useRef<{ x: number; y: number; id: number } | null>(null)
  const placed = placing.placed(f)

  // Mouse/touch: press the handle and drag the figure onto the slide. A press without a drag is a click.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // no compatibility mouse events: the stage must not start a grab underneath
    e.stopPropagation()
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== start.current?.id) return
      if (Math.hypot(ev.clientX - start.current.x, ev.clientY - start.current.y) >= DRAG_START_PX) setGhost({ x: ev.clientX, y: ev.clientY })
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== start.current?.id) return
      const dragged = Math.hypot(ev.clientX - start.current.x, ev.clientY - start.current.y) >= DRAG_START_PX
      start.current = null
      setGhost(null)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      placing.onPlace(f, dragged ? { clientX: ev.clientX, clientY: ev.clientY } : undefined)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="ag-place">
      <button className="ag-drag" onPointerDown={onPointerDown} title="Drag onto the slide" aria-label="Drag onto the slide">
        <span className="ag-grip" aria-hidden="true">
          ⠿
        </span>
        Drag onto the slide
      </button>
      <button className={`ag-put ${placed ? 'is-placed' : ''} ${placing.hoverAction && placing.hoverAction === placing.airAction?.(index) ? 'proximity-active' : ''}`} data-air-action={placing.airAction?.(index)} onClick={() => placing.onPlace(f)} disabled={placed}>
        {placed ? 'On the slide ✓' : 'Put on slide'}
      </button>
      {ghost &&
        createPortal(
          <div className="ag-ghost" style={{ left: ghost.x, top: ghost.y }}>
            <span className="ag-grip">⠿</span> {figureTitle(f)}
            <small>Let go on the slide</small>
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---- everything one answer made ---------------------------------------------------------------
export function AgentArtifacts({ artifacts, placing }: { artifacts?: AgentArtifact[]; placing?: FigurePlacing }) {
  if (!artifacts?.length) return null
  const figures = artifacts.filter(isFigureArtifact)
  const code = artifacts.filter((a): a is Of<'code'> => a.type === 'code')
  return (
    <div className="ag-artifacts">
      {figures.map((f, i) => (
        <figure key={i} className="ag-figure">
          {f.type !== 'image' && f.title && <figcaption className="ag-title">{f.title}</figcaption>}
          <div className={`ag-frame ag-frame-${f.type}`}>
            <FigureBody f={f} />
          </div>
          {f.type === 'graph' && (
            <div className="ag-exprs">
              {f.expressions.map((x, j) => (
                <code key={j} style={{ color: PALETTE[j % PALETTE.length] }}>
                  {x}
                </code>
              ))}
            </div>
          )}
          {placing && <PlaceControls f={f} index={i} placing={placing} />}
        </figure>
      ))}
      {code.map((c, i) => (
        <details key={`c${i}`} className="ag-code">
          <summary>Python it ran{c.ok ? '' : ' · failed'}</summary>
          <pre>{c.code}</pre>
          {c.output && <pre className="ag-out">{c.output}</pre>}
        </details>
      ))}
    </div>
  )
}
