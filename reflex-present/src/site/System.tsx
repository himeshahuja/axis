// Section 6: the stack as an exploded isometric diagram. Planes separate as the
// section scrolls through; pulses carry input events up through the layers.
// Module names are the real ones in src/spatial and src/engine.

import { useRef } from 'react'
import { clamp, lerp, reducedMotion, smooth, useFrame } from './motion'

const INPUTS = [
  { name: 'Camera', detail: 'MediaPipe hand landmarks', status: 'Live demo' },
  { name: 'Vexo band', detail: 'Gyro · wrist rotation', status: 'Needs band' },
  { name: 'Mouse / touch', detail: 'Pointer events', status: 'This page' },
  { name: 'Keyboard', detail: 'Tab · arrows · enter', status: 'This page' },
  { name: 'Voice', detail: 'Browser or band mic', status: 'Preview' },
]

const LAYERS = [
  { key: 'perception', n: '01', title: 'Perception', text: 'Where is the hand, and what is it doing? Camera tracking, wearable motion and gesture detection, fused into one pointer.', mods: ['HandTracker', 'GestureDetector', 'SensorFusion', 'Calibration'] },
  { key: 'intent', n: '02', title: 'Intent', text: 'What does it mean here? Grab, drag and hold resolve against the object under the hand; rotation picks an action.', mods: ['InteractionEngine', 'RadialMenuController', 'WristRotationMapper', 'Resolver'] },
  { key: 'execution', n: '03', title: 'Execution', text: 'Do it. Move the object, explain it from its data, remember it, or carry it into a voice command.', mods: ['Canvas', 'Explain', 'Memory', 'Voice preview'] },
]

const CX = 600
const A = 220
const B = 100
const IN_X = 250

type P = [number, number]
const bez = (p0: P, p1: P, p2: P, p3: P, t: number): P => {
  const u = 1 - t
  return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]
}

export function System() {
  const root = useRef<HTMLElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const ex = useRef(0)
  const still = useRef<boolean | null>(null)

  useFrame(root, (dt, t) => {
    const s = svg.current
    const el = root.current
    if (!s || !el) return
    if (still.current === null) still.current = reducedMotion()
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight
    const target = smooth(0.15, 0.75, clamp((vh - r.top) / (vh + r.height * 0.4)))
    ex.current += (target - ex.current) * (1 - Math.pow(0.88, dt / 16))
    const gap = lerp(96, 180, ex.current)
    const cy = [470 + gap, 470, 470 - gap]
    const time = still.current ? 0 : t

    LAYERS.forEach((_, i) => {
      const g = s.querySelector<SVGGElement>(`[data-layer="${i}"]`)
      g?.setAttribute('transform', `translate(0, ${(cy[i] - 470).toFixed(1)})`)
    })

    // Input cables into the bottom plane, with a pulse each.
    const glow = [0, 0, 0]
    INPUTS.forEach((_, i) => {
      const y0 = 300 + i * 74
      const end: P = [CX - A * 0.55 + i * 22, cy[0] - B * 0.45 + i * 18]
      const p0: P = [IN_X, y0]
      const p1: P = [IN_X + 120, y0]
      const p2: P = [end[0] - 120, end[1]]
      s.querySelector(`[data-cable="${i}"]`)?.setAttribute('d', `M${p0[0]},${p0[1]} C${p1[0]},${p1[1]} ${p2[0]},${p2[1]} ${end[0]},${end[1]}`)
      const ph = (time * 0.00032 + i * 0.37) % 1.6
      const dot = s.querySelector<SVGCircleElement>(`[data-pulse="${i}"]`)
      if (dot) {
        if (ph < 1 && !still.current) {
          const [x, y] = bez(p0, p1, p2, end, ph)
          dot.setAttribute('cx', x.toFixed(1))
          dot.setAttribute('cy', y.toFixed(1))
          dot.style.opacity = String(Math.sin(ph * Math.PI))
        } else dot.style.opacity = '0'
      }
      if (ph > 0.9 && ph < 1.1) glow[0] = Math.max(glow[0], 1 - Math.abs(ph - 1) * 10)
    })

    // Risers carry the event up through the stack.
    const riseX = CX + A * 0.18
    const riser = s.querySelector('[data-riser]')
    riser?.setAttribute('d', `M${riseX},${cy[0]} L${riseX},${cy[2]}`)
    for (let k = 0; k < 2; k++) {
      const ph = (time * 0.0004 + k * 0.5) % 1
      const y = lerp(cy[0], cy[2], ph)
      const dot = s.querySelector<SVGCircleElement>(`[data-rise="${k}"]`)
      dot?.setAttribute('cx', String(riseX))
      dot?.setAttribute('cy', y.toFixed(1))
      if (dot) dot.style.opacity = still.current ? '0' : '1'
      for (let i = 0; i < 3; i++) glow[i] = Math.max(glow[i], 1 - Math.abs(y - cy[i]) / 46)
    }
    LAYERS.forEach((_, i) => {
      const g = s.querySelector<SVGGElement>(`[data-layer="${i}"]`)
      g?.style.setProperty('--glow', clamp(glow[i]).toFixed(3))
    })
  })

  const plane = (cy: number) => `${CX - A},${cy} ${CX},${cy - B} ${CX + A},${cy} ${CX},${cy + B}`
  const tile = (x: number, y: number) => `${x - 40},${y} ${x},${y - 18} ${x + 40},${y} ${x},${y + 18}`
  const mods = [
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ]

  return (
    <section ref={root} className="system" id="system" aria-label="Technical foundation">
      <div className="system-head">
        <div className="section-index mono">
          <span>[06]</span>
          <span>How it works</span>
        </div>
        <h2 className="system-title" data-reveal>
          One engine.
          <br />
          Any hand.
        </h2>
        <p className="system-lede">A camera, a wristband, a mouse and a keyboard all report the same few things: where the pointer is, grab, release, rotate. The layers above never need to know which one you’re using.</p>
      </div>

      <svg ref={svg} className="system-svg" viewBox="0 0 1200 900" role="img" aria-label="Inputs feed Perception, then Intent, then Execution">
        {INPUTS.map((inp, i) => (
          <g key={inp.name} className="sys-input">
            <text x={IN_X - 16} y={300 + i * 74 - 6} textAnchor="end" className="sys-in-name">
              {inp.name}
            </text>
            <text x={IN_X - 16} y={300 + i * 74 + 14} textAnchor="end" className="sys-in-detail">
              {inp.detail} · <tspan className={inp.status === 'This page' || inp.status === 'Live demo' ? 'ok' : 'warn'}>{inp.status.toUpperCase()}</tspan>
            </text>
            <circle cx={IN_X} cy={300 + i * 74} r="3.5" className="sys-port" />
            <path data-cable={i} className="sys-cable" />
          </g>
        ))}
        {LAYERS.map((l, i) => (
          <g key={l.key} data-layer={i} className="sys-layer">
            <polygon points={plane(470)} className="sys-plane" />
            <polygon points={plane(470)} className="sys-plane-glow" />
            {mods.map(([u, v], k) => {
              const x = CX + (u - v) * A * 0.5
              const y = 470 + (u + v) * B * 0.5
              return (
                <g key={k}>
                  <polygon points={tile(x, y)} className="sys-tile" />
                  <text x={x} y={y + 4} textAnchor="middle" className="sys-mod">
                    {l.mods[k]}
                  </text>
                </g>
              )
            })}
            <line x1={CX + A} y1={470} x2={CX + A + 36} y2={470} className="sys-lead" />
            <text x={CX + A + 48} y={466} className="sys-layer-n">
              {l.n}
            </text>
            <text x={CX + A + 84} y={470} className="sys-layer-title">
              {l.title}
            </text>
          </g>
        ))}
        <path data-riser className="sys-riser" />
        <circle data-rise="0" r="4" className="sys-pulse" />
        <circle data-rise="1" r="4" className="sys-pulse" />
        {INPUTS.map((_, i) => (
          <circle key={i} data-pulse={i} r="3.5" className="sys-pulse" />
        ))}
      </svg>

      <ol className="system-layers">
        {LAYERS.map((l) => (
          <li key={l.key}>
            <span className="mono">{l.n}</span>
            <b>{l.title}</b>
            <p>{l.text}</p>
          </li>
        ))}
      </ol>

      <ul className="system-inputs-mobile mono">
        {INPUTS.map((inp) => (
          <li key={inp.name}>
            <b>{inp.name}</b> {inp.detail} <em>{inp.status}</em>
          </li>
        ))}
      </ul>
    </section>
  )
}
