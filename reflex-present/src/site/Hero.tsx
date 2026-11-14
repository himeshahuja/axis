import { useEffect, useLayoutEffect, useRef } from 'react'
import { BRAND_NAME, ROUTES } from './brand'
import { FieldCanvas } from './FieldCanvas'
import { clamp, pointer, reducedMotion, useFrame } from './motion'
import { ObjectVisual, type Visual } from './objects'

interface Floater {
  visual: Visual
  label: string
  tag: string
  /** Anchor in the hero box, 0..1. */
  ax: number
  ay: number
  /** Simulated depth: <1 behind the headline, >1 in front of it. */
  z: number
  rot: number
  w: number
  /** Shown on phones, at this anchor. */
  mobile?: [number, number]
}

const FLOATERS: Floater[] = [
  { visual: 'grid', label: 'Canvas frame', tag: 'COORD', ax: 0.47, ay: 0.1, z: 0.42, rot: -2, w: 200 },
  { visual: 'terrain', label: 'Contour study', tag: 'RENDER', ax: 0.87, ay: 0.06, z: 0.58, rot: 3, w: 220, mobile: [0.58, 0.46] },
  { visual: 'chart', label: 'Quarterly revenue', tag: 'CHART', ax: 0.3, ay: 0.22, z: 1.04, rot: -4, w: 230, mobile: [0.06, 0.4] },
  { visual: 'wave', label: 'Wrist gyro · z', tag: 'SIGNAL', ax: 0.5, ay: 0.7, z: 0.52, rot: 2, w: 200 },
  { visual: 'math', label: 'Rotation, integrated', tag: 'NOTE', ax: 0.47, ay: 0.47, z: 0.74, rot: -3, w: 190 },
  { visual: 'note', label: 'Launch notes', tag: 'DOC', ax: 0.66, ay: 0.55, z: 0.92, rot: 2.5, w: 230 },
  { visual: 'terminal', label: 'Gesture log', tag: 'TTY', ax: 0.9, ay: 0.6, z: 1.16, rot: -2, w: 210 },
  { visual: 'wire', label: 'Panel wireframe', tag: 'WIRE', ax: 0.73, ay: 0.86, z: 0.46, rot: 1.5, w: 200 },
  { visual: 'bars', label: 'Tracking latency', tag: 'BARS', ax: 0.17, ay: 0.78, z: 1.22, rot: 3, w: 200 },
]

function FitWord({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    const fit = () => {
      const parent = el.parentElement!
      el.style.fontSize = '100px'
      const w = el.scrollWidth
      if (w > 0) el.style.fontSize = `${(100 * parent.clientWidth) / w}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement!)
    document.fonts?.ready.then(fit)
    return () => ro.disconnect()
  }, [text])
  return (
    <h1 ref={ref} className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="hero-letter" style={{ animationDelay: `${120 + i * 55}ms` }} aria-hidden="true">
          <span>{ch}</span>
        </span>
      ))}
    </h1>
  )
}

export function Hero() {
  const root = useRef<HTMLElement>(null)
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const bracket = useRef<HTMLDivElement>(null)
  const bracketLabel = useRef<HTMLSpanElement>(null)
  const sim = useRef(FLOATERS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0, tilt: 0, hover: 0 })))
  const brk = useRef({ x: 0, y: 0, w: 0, h: 0, o: 0, target: -1 })
  const letterScale = useRef<number[]>([])
  const still = useRef(false)

  useEffect(() => {
    still.current = reducedMotion()
  }, [])

  useFrame(root, (dt, t) => {
    const el = root.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const W = r.width
    const H = r.height
    const px = pointer.active ? pointer.x - r.left : W / 2
    const py = pointer.active ? pointer.y - r.top : H / 2
    const nx = px / W - 0.5
    const ny = py / H - 0.5
    const scroll = -r.top
    const time = still.current ? 0 : t
    const mobile = W < 760
    const step = dt / 16

    // Nearest card under (or near) the pointer gets the selection brackets.
    let best = -1
    let bestD = 70
    FLOATERS.forEach((f, i) => {
      const node = cards.current[i]
      if (!node) return
      if (mobile && !f.mobile) {
        node.style.display = 'none'
        return
      }
      node.style.display = ''
      const s = sim.current[i]
      const scale = (mobile ? 0.62 : 1) * (0.55 + f.z * 0.45)
      const cw = f.w * scale
      const ch = cw * 0.86
      const ax = (mobile && f.mobile ? f.mobile[0] : f.ax) * W
      const ay = (mobile && f.mobile ? f.mobile[1] : f.ay) * H
      // Parallax: deeper objects move less, nearer ones more, opposite to the hand.
      const par = (f.z - 0.3) * 46
      const driftX = Math.sin(time * 0.00031 * (1 + i * 0.13) + i * 1.7) * 9 * f.z
      const driftY = Math.cos(time * 0.00027 * (1 + i * 0.11) + i * 2.3) * 11 * f.z
      const baseX = ax - nx * par + driftX
      const baseY = ay - ny * par * 0.7 + driftY - scroll * (f.z - 0.55) * 0.55
      const cx = baseX + s.x + cw / 2
      const cy = baseY + s.y + ch / 2
      // Soft repulsion from the pointer, springing home with inertia.
      const dx = cx - px
      const dy = cy - py
      const d = Math.hypot(dx, dy) || 1
      const reach = 150 + cw * 0.5
      if (pointer.active && d < reach && !still.current) {
        const f2 = (1 - d / reach) ** 2 * 2.2 * f.z
        s.vx += (dx / d) * f2 * step
        s.vy += (dy / d) * f2 * step
      }
      s.vx += -s.x * 0.018 * step
      s.vy += -s.y * 0.018 * step
      s.vx *= Math.pow(0.88, step)
      s.vy *= Math.pow(0.88, step)
      s.x += s.vx * step
      s.y += s.vy * step

      const edge = Math.max(Math.abs(px - cx) - cw / 2, Math.abs(py - cy) - ch / 2)
      if (pointer.active && edge < bestD) {
        bestD = edge
        best = i
      }
      s.hover += ((brk.current.target === i ? 1 : 0) - s.hover) * (1 - Math.pow(0.82, step))
      const rx = -ny * 14 * f.z + Math.sin(time * 0.0004 + i) * 3
      const ry = nx * 18 * f.z + Math.cos(time * 0.00035 + i) * 4
      const rz = f.rot + Math.sin(time * 0.0002 + i * 3) * 1.5
      const lift = 1 + s.hover * 0.05
      node.style.width = `${f.w}px`
      node.style.transform = `translate3d(${(baseX + s.x).toFixed(1)}px, ${(baseY + s.y).toFixed(1)}px, 0) perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${(scale * lift).toFixed(3)})`
      node.style.setProperty('--hover', s.hover.toFixed(3))
    })

    // Selection brackets: magnetic, inertial, and only ever around one object.
    const b = brk.current
    b.target = best
    const bn = bracket.current
    if (bn) {
      const node = best >= 0 ? cards.current[best] : null
      if (node) {
        const cr = node.getBoundingClientRect()
        const tx = cr.left - r.left - 10
        const ty = cr.top - r.top - 10
        const k = b.o < 0.05 ? 1 : 1 - Math.pow(0.7, step)
        b.x += (tx - b.x) * k
        b.y += (ty - b.y) * k
        b.w += (cr.width + 20 - b.w) * k
        b.h += (cr.height + 20 - b.h) * k
        if (bracketLabel.current) bracketLabel.current.textContent = `SELECT · ${FLOATERS[best].tag}`
      }
      b.o += ((node ? 1 : 0) - b.o) * (1 - Math.pow(0.8, step))
      bn.style.transform = `translate3d(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px, 0)`
      bn.style.width = `${b.w.toFixed(1)}px`
      bn.style.height = `${b.h.toFixed(1)}px`
      bn.style.opacity = b.o.toFixed(3)
    }

    // Letters lean up toward the hand.
    const letters = el.querySelectorAll<HTMLSpanElement>('.hero-letter > span')
    letters.forEach((span, i) => {
      const lr = span.parentElement!.getBoundingClientRect()
      const lx = lr.left + lr.width / 2 - r.left
      const ly = lr.top + lr.height / 2 - r.top
      const dd = Math.hypot((lx - px) * 0.8, (ly - py) * 1.4)
      const target = pointer.active && !still.current ? 1 + 0.16 * Math.max(0, 1 - dd / 420) ** 2 : 1
      const cur = letterScale.current[i] ?? 1
      const next = cur + (target - cur) * (1 - Math.pow(0.85, step))
      letterScale.current[i] = next
      span.style.transform = `scaleY(${next.toFixed(4)})`
    })
  })

  return (
    <section ref={root} className="hero" id="top">
      <FieldCanvas className="hero-field" />
      <div className="hero-floaters" aria-hidden="true">
        {FLOATERS.map((f, i) => (
          <div
            key={f.label}
            ref={(n) => {
              cards.current[i] = n
            }}
            className={`floater ${f.z > 1 ? 'front' : 'back'}`}
            style={{ zIndex: f.z > 1 ? 10 : 3, opacity: 0.28 + 0.72 * clamp((f.z - 0.35) / 0.75), animationDelay: `${400 + i * 70}ms` }}
          >
            <div className="floater-head">
              <span>{f.tag}</span>
              <span>{String(i + 1).padStart(2, '0')}</span>
            </div>
            <div className="floater-body">
              <ObjectVisual visual={f.visual} />
            </div>
            <div className="floater-foot">{f.label}</div>
          </div>
        ))}
      </div>
      <div ref={bracket} className="select-bracket" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <span ref={bracketLabel} />
      </div>

      <div className="hero-copy">
        <div className="hero-meta mono">
          <span>[01]</span>
          <span>Spatial interaction engine</span>
          <span>VexoHacks 2026 · San Francisco</span>
        </div>
        <p className="hero-statement">
          Your hands
          <br />
          already know
          <br />
          what to <em>do.</em>
        </p>
        <div className="hero-support">
          <p>An interface for moving information with your hands, the context around it, and your voice.</p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#playground">
              Experience the demo <span aria-hidden="true">↘</span>
            </a>
            <a className="btn btn-ghost" href="#system">
              How it works
            </a>
          </div>
          <a className="hero-live mono" href={ROUTES.liveDemo}>
            Camera demo live at {ROUTES.liveDemo} ↗
          </a>
        </div>
      </div>
      <div className="hero-word-wrap">
        <FitWord text={BRAND_NAME} className="hero-word" />
      </div>
    </section>
  )
}
