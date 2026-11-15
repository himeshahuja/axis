// Orientation field: a lattice of short strokes following a slow flow. Near the
// pointer they swing tangent to it (like field lines around a hand), lengthen
// and step aside. Each stroke is a damped spring, so the field has inertia.

import { useEffect, useRef } from 'react'
import { fitCanvas, pointer, reducedMotion, useFrame } from './motion'

interface Cell {
  x: number
  y: number
  a: number
  va: number
  w: number
}

export function FieldCanvas({ spacing = 30, radius = 240, className = '', intensity = 1 }: { spacing?: number; radius?: number; className?: string; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cells = useRef<Cell[]>([])
  const size = useRef({ w: 0, h: 0 })
  const still = useRef(false)
  const smoothP = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    still.current = reducedMotion()
    const c = ref.current!
    const build = () => {
      const { w, h } = fitCanvas(c)
      size.current = { w, h }
      const s = w < 700 ? spacing * 0.85 : spacing
      const list: Cell[] = []
      const cols = Math.ceil(w / s) + 1
      const rows = Math.ceil(h / s) + 1
      const ox = (w - (cols - 1) * s) / 2
      const oy = (h - (rows - 1) * s) / 2
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) list.push({ x: ox + i * s, y: oy + j * s, a: 0, va: 0, w: 0 })
      cells.current = list
    }
    build()
    const ro = new ResizeObserver(build)
    ro.observe(c)
    return () => ro.disconnect()
  }, [spacing])

  useFrame(ref, (dt, t) => {
    const c = ref.current
    if (!c) return
    const { w, h, ctx } = fitCanvas(c)
    if (w !== size.current.w || h !== size.current.h) return
    const rect = c.getBoundingClientRect()
    const time = still.current ? 0 : t
    // Pointer, eased so the field trails the hand slightly.
    const tx = pointer.active ? pointer.x - rect.left : -9999
    const ty = pointer.active ? pointer.y - rect.top : -9999
    const sp = smoothP.current
    if (sp.x < -999 || tx < -999) {
      sp.x = tx
      sp.y = ty
    } else {
      const k = 1 - Math.exp(-dt / 70)
      sp.x += (tx - sp.x) * k
      sp.y += (ty - sp.y) * k
    }
    const R = radius
    const R2 = R * R
    const len = w < 700 ? 9 : 11
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    const base = new Path2D()
    const near = new Path2D()
    const hot = new Path2D()
    const k = still.current ? 1 : 1 - Math.exp(-dt / 90)
    for (const cell of cells.current) {
      const flow = Math.sin(cell.x * 0.0042 + time * 0.00018) * 1.1 + Math.cos(cell.y * 0.0051 - time * 0.00013) * 0.9 + Math.sin((cell.x + cell.y) * 0.0019 + time * 0.0001) * 0.6
      const dx = cell.x - sp.x
      const dy = cell.y - sp.y
      const d2 = dx * dx + dy * dy
      let target = flow
      let wt = 0
      if (d2 < R2) {
        const d = Math.sqrt(d2)
        wt = (1 - d / R) ** 2 * intensity
        const tangent = Math.atan2(dy, dx) + Math.PI / 2
        // Blend on the circle (strokes are undirected, so wrap to ±π/2).
        let diff = tangent - flow
        diff = ((((diff + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2
        target = flow + diff * Math.min(1, wt * 1.6)
      }
      let diff = target - cell.a
      diff = ((((diff + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2
      if (still.current) {
        cell.a = target
        cell.va = 0
      } else {
        cell.va += diff * 0.09 * (dt / 16)
        cell.va *= Math.pow(0.78, dt / 16)
        cell.a += cell.va
      }
      cell.w += (wt - cell.w) * k
      const cw = cell.w
      const push = cw * 16
      const dl = d2 > 0 ? Math.sqrt(d2) : 1
      const cx = cell.x + (dx / dl) * push
      const cy = cell.y + (dy / dl) * push
      const L = len * (0.55 + cw * 1.3) * 0.5
      const ux = Math.cos(cell.a) * L
      const uy = Math.sin(cell.a) * L
      const p = cw > 0.38 ? hot : cw > 0.06 ? near : base
      p.moveTo(cx - ux, cy - uy)
      p.lineTo(cx + ux, cy + uy)
    }
    ctx.lineWidth = 1
    ctx.strokeStyle = 'rgba(242,240,235,0.16)'
    ctx.stroke(base)
    ctx.lineWidth = 1.2
    ctx.strokeStyle = 'rgba(242,240,235,0.42)'
    ctx.stroke(near)
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(255,90,31,0.9)'
    ctx.stroke(hot)
  })

  return <canvas ref={ref} className={`field ${className}`} aria-hidden="true" />
}
