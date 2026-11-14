// Section 3: the interactive playground. Objects are grabbed and thrown with the
// mouse (or touch); holding still opens the radial menu. The menu logic is the
// app's own RadialMenuController — the same state machine the camera and Vexo
// band drive in /spatial-test. Here, horizontal mouse travel stands in for wrist
// rotation and is labelled as such.

import { useCallback, useEffect, useRef, useState } from 'react'
import { describeObject } from '../spatial/radial/actions/explain'
import { memoryEntryFor } from '../spatial/radial/actions/memory'
import { RadialMenuController, type RadialContext } from '../spatial/radial/RadialMenuController'
import { ACTION_LABEL, isMenuOpen, type RadialAction, type RadialActionEvent, type RadialStatus, type SelectionSource } from '../spatial/radial/types'
import { siteMemory, useMemories } from './memory'
import { clamp, fitCanvas, reducedMotion, useFrame } from './motion'
import { ObjectVisual, SITE_OBJECTS, type SiteObject } from './objects'
import { needleAngle, RadialRing } from './RadialRing'
import { VoiceConsole } from './VoiceConsole'

const ROT_PER_PX = 0.4

/** Starting centres on phones (two columns, three rows). */
const PHONE_START: Record<string, [number, number]> = {
  revenue: [0.26, 0.21],
  latency: [0.74, 0.21],
  notes: [0.26, 0.47],
  conversion: [0.74, 0.47],
  terrain: [0.5, 0.75],
}

interface Body {
  id: string
  /** Centre, stage-normalized. */
  nx: number
  ny: number
  vx: number
  vy: number
  w: number
  h: number
  hover: number
  grab: number
}

interface Snap {
  status: RadialStatus
  objectId: string | null
  active: RadialAction
  source: SelectionSource
}

type Panel = { kind: 'explain'; id: string; obj: SiteObject; facts: string[]; kindLabel: string } | { kind: 'voice'; id: string; obj: SiteObject; all: SiteObject[] }

const SOURCE_TEXT: Record<SelectionSource, string> = {
  simulator: 'Mouse travel → simulated wrist rotation',
  vexo: 'Vexo band · wrist rotation',
  camera: 'Camera · hand tilt',
  keyboard: 'Keyboard',
  wheel: 'Mouse wheel',
  click: 'Click',
  none: 'Waiting for input',
}

const widthFor = (id: string, W: number) => {
  if (W < 760) return Math.max(140, W * 0.42)
  const f: Record<string, number> = { revenue: 0.21, latency: 0.17, notes: 0.19, conversion: 0.12, terrain: 0.16 }
  return clamp(W * (f[id] ?? 0.16), 150, 300)
}

export function Playground() {
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const trail = useRef<HTMLCanvasElement>(null)
  const nodes = useRef<Record<string, HTMLDivElement | null>>({})
  const radialWrap = useRef<HTMLDivElement>(null)
  const holdRing = useRef<SVGCircleElement>(null)
  const needle = useRef<SVGGElement>(null)
  const panelEl = useRef<HTMLDivElement>(null)
  const tray = useRef<HTMLDivElement>(null)
  const ctl = useRef(new RadialMenuController())
  const size = useRef({ W: 1, H: 1 })
  /** Stage chrome objects must stay clear of: the HUD (top-right) and the tray's top edge. */
  const chrome = useRef({ hud: { x: 0, y: 0, w: 0, h: 0 }, floor: 1 })
  const hud = useRef<HTMLDivElement>(null)
  const bodies = useRef<Body[]>(
    SITE_OBJECTS.map((o) => ({ id: o.id, nx: o.x + o.w / 2, ny: o.y + o.h / 2, vx: 0, vy: 0, w: 200, h: 170, hover: 0, grab: 0 })),
  )
  const ptr = useRef({ x: -999, y: -999, inside: false, down: false })
  const drag = useRef<{ id: string; offX: number; offY: number; lastX: number; lastY: number; lastT: number; vx: number; vy: number } | null>(null)
  const trailPts = useRef<{ x: number; y: number; t: number; hot: boolean }[]>([])
  const still = useRef(false)
  const lastKey = useRef('')
  const [snap, setSnap] = useState<Snap>({ status: 'IDLE', objectId: null, active: 'explain', source: 'none' })
  const [log, setLog] = useState<{ t: number; to: string; reason: string }[]>([])
  const [panel, setPanel] = useState<Panel | null>(null)
  const [ring, setRing] = useState({ rIn: 120, rOut: 166 })
  const [flash, setFlash] = useState<string | null>(null)
  const memories = useMemories()

  const objFor = useCallback((id: string): SiteObject => {
    const base = SITE_OBJECTS.find((o) => o.id === id)!
    const b = bodies.current.find((x) => x.id === id)!
    const { W, H } = size.current
    return { ...base, x: b.nx - b.w / W / 2, y: b.ny - b.h / H / 2, w: b.w / W, h: b.h / H }
  }, [])
  const allObjs = useCallback(() => SITE_OBJECTS.map((o) => objFor(o.id)), [objFor])

  // Layout: sizes follow the stage; positions stay normalized so objects reflow.
  useEffect(() => {
    still.current = reducedMotion()
    const el = stage.current!
    let mode: 'phone' | 'wide' | null = null
    const layout = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      size.current = { W, H }
      const next = W < 760 ? 'phone' : 'wide'
      if (next !== mode) {
        // Crossing the breakpoint: objects take that layout's starting places.
        mode = next
        for (const b of bodies.current) {
          const o = SITE_OBJECTS.find((x) => x.id === b.id)!
          const [nx, ny] = next === 'phone' ? PHONE_START[b.id] : [o.x + o.w / 2, o.y + o.h / 2]
          b.nx = nx
          b.ny = ny
          b.vx = 0
          b.vy = 0
        }
      }
      for (const b of bodies.current) {
        b.w = widthFor(b.id, W)
        const n = nodes.current[b.id]
        if (n) {
          n.style.width = `${b.w}px`
          b.h = n.offsetHeight
        }
      }
      if (trail.current) fitCanvas(trail.current)
      const h = hud.current
      const t = tray.current
      chrome.current = {
        hud: h && getComputedStyle(h).display !== 'none' ? { x: h.offsetLeft, y: h.offsetTop, w: h.offsetWidth, h: h.offsetHeight } : { x: 0, y: 0, w: 0, h: 0 },
        floor: t ? (t.offsetTop - 14) / H : 1,
      }
    }
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ctx = (tMs: number): RadialContext => {
    const { W, H } = size.current
    const p = ptr.current
    return {
      tMs,
      aspect: W / H,
      pointer: { x: p.x / W, y: p.y / H, valid: true },
      grabbedId: p.down ? (drag.current?.id ?? null) : null,
      rotation: p.down && drag.current ? { angle: p.x * ROT_PER_PX, source: 'simulator' } : null,
    }
  }

  const fly = (id: string) => {
    const node = nodes.current[id]
    const t = tray.current
    if (!node || !t || still.current) return
    const from = node.getBoundingClientRect()
    const to = t.getBoundingClientRect()
    const clone = node.cloneNode(true) as HTMLDivElement
    clone.classList.add('fly-clone')
    Object.assign(clone.style, { position: 'fixed', left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, transform: 'none', margin: '0', zIndex: '60' })
    document.body.appendChild(clone)
    const s = 96 / from.width
    const dx = to.left + 24 - from.left
    const dy = to.top + to.height / 2 - from.height * s * 0.5 - from.top
    clone
      .animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.35 - 60}px) scale(${(1 + s) / 2}) rotate(-4deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.2 },
        ],
        { duration: 820, easing: 'cubic-bezier(.2,.7,.1,1)', fill: 'forwards' },
      )
      .finished.then(() => clone.remove())
  }

  const run = (ev: RadialActionEvent) => {
    const obj = objFor(ev.objectId)
    if (ev.action === 'explain') {
      const d = describeObject(obj)
      setPanel({ kind: 'explain', id: obj.id, obj, facts: d.facts, kindLabel: d.kind })
    } else if (ev.action === 'remember') {
      siteMemory.add(memoryEntryFor(obj, allObjs()))
      fly(obj.id)
      setPanel(null)
      setFlash(obj.label)
      window.setTimeout(() => setFlash(null), 1600)
    } else {
      setPanel({ kind: 'voice', id: obj.id, obj, all: allObjs() })
    }
  }

  const handle = (outs: ReturnType<RadialMenuController['update']>) => {
    for (const o of outs) if (o.kind === 'confirmed') run(o.event)
  }

  useFrame(root, (dt, t) => {
    const { W, H } = size.current
    const c = ctl.current
    const p = ptr.current
    const step = dt / 16
    const open = c.isOpen

    // ---- bodies (substepped so long frames stay stable) ---------------------------------
    const d = drag.current
    const bs = bodies.current
    const subs = Math.min(8, Math.ceil(dt / 16))
    for (let si = 0; si < subs; si++) {
      const step = dt / 16 / subs
      for (const b of bodies.current) {
        const grabbed = d?.id === b.id && p.down
        if (grabbed && !open) {
          const tx = (p.x - d!.offX) / W
          const ty = (p.y - d!.offY) / H
          b.nx = tx
          b.ny = ty
        } else if (!grabbed) {
          b.nx += (b.vx * step) / W
          b.ny += (b.vy * step) / H
          b.vx *= Math.pow(0.93, step)
          b.vy *= Math.pow(0.93, step)
          // Walls, with a soft bounce.
          const hx = b.w / W / 2
          const hy = b.h / H / 2
          if (b.nx < hx) {
            b.nx = hx
            b.vx = Math.abs(b.vx) * 0.5
          }
          if (b.nx > 1 - hx) {
            b.nx = 1 - hx
            b.vx = -Math.abs(b.vx) * 0.5
          }
          if (b.ny < hy + 0.02) {
            b.ny = hy + 0.02
            b.vy = Math.abs(b.vy) * 0.5
          }
          const floor = chrome.current.floor
          if (b.ny > floor - hy) {
            b.ny = floor - hy
            b.vy = -Math.abs(b.vy) * 0.5
          }
          // Keep out from under the HUD.
          const hr = chrome.current.hud
          if (hr.w) {
            const ox = (b.w / 2 + hr.w / 2 + 14) - Math.abs(b.nx * W - (hr.x + hr.w / 2))
            const oy = (b.h / 2 + hr.h / 2 + 14) - Math.abs(b.ny * H - (hr.y + hr.h / 2))
            if (ox > 0 && oy > 0) {
              if (ox < oy) b.vx -= ox * 0.08 * step
              else b.vy += oy * 0.08 * step
            }
          }
        }
      }
      // Objects make room for each other (never the one in your hand).
      for (let i = 0; i < bs.length; i++)
        for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i]
          const b = bs[j]
          const ox = (a.w + b.w) / 2 + 18 - Math.abs((a.nx - b.nx) * W)
          const oy = (a.h + b.h) / 2 + 18 - Math.abs((a.ny - b.ny) * H)
          if (ox > 0 && oy > 0) {
            const aLocked = (d?.id === a.id && p.down) || (open && c.state.objectId === a.id)
            const bLocked = (d?.id === b.id && p.down) || (open && c.state.objectId === b.id)
            const k = 0.06 * step
            if (ox < oy) {
              const s = Math.sign(a.nx - b.nx || 1) * ox * k
              if (!aLocked) a.vx += s * (bLocked ? 2 : 1)
              if (!bLocked) b.vx -= s * (aLocked ? 2 : 1)
            } else {
              const s = Math.sign(a.ny - b.ny || 1) * oy * k
              if (!aLocked) a.vy += s * (bLocked ? 2 : 1)
              if (!bLocked) b.vy -= s * (aLocked ? 2 : 1)
            }
          }
        }
    }

    // ---- radial controller -----------------------------------------------------------------
    handle(c.update(ctx(t)))
    const st = c.state
    const key = `${st.status}|${st.objectId}|${st.activeAction}|${st.inputSource}`
    if (key !== lastKey.current) {
      lastKey.current = key
      setSnap({ status: st.status, objectId: st.objectId, active: st.activeAction, source: st.inputSource })
      setLog(c.transitions.slice(-6).map((x) => ({ t: x.tMs, to: x.to, reason: x.reason })))
    }

    // ---- write transforms ----------------------------------------------------------------------
    const focusId = st.objectId
    for (const b of bs) {
      const n = nodes.current[b.id]
      if (!n) continue
      const cx = b.nx * W
      const cy = b.ny * H
      const dx = p.x - cx
      const dy = p.y - cy
      const near = p.inside && !p.down ? Math.max(0, 1 - Math.hypot(dx, dy) / (b.w * 0.9)) : 0
      b.hover += (near - b.hover) * (1 - Math.pow(0.85, step))
      const g = (d?.id === b.id && p.down) || focusId === b.id ? 1 : 0
      b.grab += (g - b.grab) * (1 - Math.pow(0.8, step))
      const mx = still.current ? 0 : dx * 0.03 * b.hover
      const my = still.current ? 0 : dy * 0.03 * b.hover
      const rx = still.current ? 0 : (-dy / b.h) * 10 * b.hover - b.vy * 0.4
      const ry = still.current ? 0 : (dx / b.w) * 10 * b.hover + b.vx * 0.4
      n.style.transform = `translate3d(${(cx - b.w / 2 + mx).toFixed(1)}px, ${(cy - b.h / 2 + my).toFixed(1)}px, 0) perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${(1 + b.grab * 0.05 + b.hover * 0.02).toFixed(4)})`
      n.style.setProperty('--hover', b.hover.toFixed(3))
      n.style.setProperty('--grab', b.grab.toFixed(3))
      n.style.zIndex = g ? '5' : '1'
    }

    // Radial + hold ring follow the frozen object.
    const fb = focusId ? bs.find((b) => b.id === focusId) : null
    if (radialWrap.current) {
      if (fb) radialWrap.current.style.transform = `translate3d(${(fb.nx * W).toFixed(1)}px, ${(fb.ny * H).toFixed(1)}px, 0)`
      if (holdRing.current) {
        const prog = st.status === 'HOLDING' ? st.holdProgress : isMenuOpen(st.status) || st.status === 'CONFIRMED' ? 1 : 0
        holdRing.current.style.strokeDashoffset = String(1 - prog)
      }
      if (needle.current) needle.current.setAttribute('transform', `rotate(${needleAngle(st.rotationDegrees).toFixed(2)})`)
    }

    // Panel stays beside its object.
    if (panelEl.current && panel) {
      const pb = bs.find((b) => b.id === panel.id)
      if (pb) {
        const pw = panelEl.current.offsetWidth
        const ph = panelEl.current.offsetHeight
        const mobile = W < 760
        let x = pb.nx * W + pb.w / 2 + 20
        if (x + pw > W - 12) x = pb.nx * W - pb.w / 2 - 20 - pw
        if (mobile || x < 12) x = clamp(pb.nx * W - pw / 2, 12, W - pw - 12)
        let y = mobile ? pb.ny * H + pb.h / 2 + 14 : pb.ny * H - ph / 2
        y = clamp(y, 12, H - ph - 12)
        panelEl.current.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      }
    }

    // ---- gesture trail ------------------------------------------------------------------------
    const cv = trail.current
    if (cv) {
      const { w, h, ctx: g2 } = fitCanvas(cv)
      g2.clearRect(0, 0, w, h)
      const pts = trailPts.current
      while (pts.length && t - pts[0].t > 650) pts.shift()
      g2.lineCap = 'round'
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        const age = 1 - (t - b.t) / 650
        g2.strokeStyle = b.hot ? `rgba(255,90,31,${(age * 0.85).toFixed(3)})` : `rgba(242,240,235,${(age * 0.35).toFixed(3)})`
        g2.lineWidth = 0.5 + age * 2
        g2.beginPath()
        g2.moveTo(a.x, a.y)
        g2.lineTo(b.x, b.y)
        g2.stroke()
      }
    }
  })

  // ---- pointer input ----------------------------------------------------------------------------
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y } = local(e)
    const p = ptr.current
    p.x = x
    p.y = y
    p.inside = true
    const d = drag.current
    if (d && p.down) {
      const now = performance.now()
      const dt = Math.max(1, now - d.lastT)
      d.vx = d.vx * 0.6 + ((x - d.lastX) / dt) * 16 * 0.4
      d.vy = d.vy * 0.6 + ((y - d.lastY) / dt) * 16 * 0.4
      d.lastX = x
      d.lastY = y
      d.lastT = now
      trailPts.current.push({ x, y, t: now, hot: ctl.current.isOpen || ctl.current.state.status === 'HOLDING' })
    }
  }

  const onObjectDown = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    try {
      stage.current!.setPointerCapture(e.pointerId)
    } catch {
      // synthetic or already-released pointer: moves still arrive while over the stage
    }
    const { x, y } = local(e)
    const b = bodies.current.find((v) => v.id === id)!
    const { W, H } = size.current
    ptr.current = { x, y, inside: true, down: true }
    drag.current = { id, offX: x - b.nx * W, offY: y - b.ny * H, lastX: x, lastY: y, lastT: performance.now(), vx: 0, vy: 0 }
    b.vx = 0
    b.vy = 0
    if (panel && panel.id !== id) setPanel(null)
    trailPts.current = [{ x, y, t: performance.now(), hot: false }]
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const p = ptr.current
    if (!p.down) return
    p.down = false
    const c = ctl.current
    const t = performance.now()
    const wasOpen = c.isOpen
    const out = c.release(t, false)
    if (out) handle([out])
    const d = drag.current
    if (d && !wasOpen) {
      const b = bodies.current.find((v) => v.id === d.id)
      if (b && !still.current) {
        b.vx = clamp(d.vx, -40, 40)
        b.vy = clamp(d.vy, -40, 40)
      }
    }
    drag.current = null
    try {
      if (stage.current?.hasPointerCapture(e.pointerId)) stage.current.releasePointerCapture(e.pointerId)
    } catch {
      // nothing to release
    }
  }

  // Wheel steps one sector while the menu is open (and only then swallows the scroll).
  useEffect(() => {
    const el = stage.current!
    const wheel = (e: WheelEvent) => {
      const c = ctl.current
      if (!c.isOpen) return
      e.preventDefault()
      c.step(e.deltaY > 0 ? 1 : -1, 'wheel', ptr.current.down ? ptr.current.x * ROT_PER_PX : null)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  const onKey = (id: string) => (e: React.KeyboardEvent) => {
    const c = ctl.current
    const t = performance.now()
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!c.isOpen) {
        setPanel(null)
        c.forceOpen(id, ctx(t))
      } else {
        const out = c.choose(c.state.activeAction, t, 'keyboard')
        if (out) handle([out])
      }
    } else if (e.key === 'Escape') {
      c.cancel(t, 'escape')
      setPanel(null)
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault()
      if (c.isOpen) {
        if (e.key === 'ArrowLeft') c.step(-1, 'keyboard', null)
        if (e.key === 'ArrowRight') c.step(1, 'keyboard', null)
      } else {
        const b = bodies.current.find((v) => v.id === id)!
        const k = 24
        if (e.key === 'ArrowLeft') b.vx -= k * 0.3
        if (e.key === 'ArrowRight') b.vx += k * 0.3
        if (e.key === 'ArrowUp') b.vy -= k * 0.3
        if (e.key === 'ArrowDown') b.vy += k * 0.3
      }
    }
  }

  const choose = (a: RadialAction) => {
    const out = ctl.current.choose(a, performance.now(), 'click')
    if (out) handle([out])
  }

  // Ring size depends on the object it surrounds.
  useEffect(() => {
    if (!snap.objectId) return
    const b = bodies.current.find((v) => v.id === snap.objectId)
    if (!b) return
    const rIn = Math.max(b.w, b.h) / 2 + 18
    setRing({ rIn, rOut: rIn + 44 })
  }, [snap.objectId])

  const open = isMenuOpen(snap.status)
  const showRadial = snap.objectId !== null && snap.status !== 'IDLE' && snap.status !== 'OBJECT_SELECTED'
  const panelObj = panel?.obj ?? null
  const ringSize = (ring.rOut + 90) * 2

  return (
    <section ref={root} className="playground" id="playground" aria-label="Interactive playground">
      <header className="pg-head">
        <div className="section-index mono">
          <span>[03]</span>
          <span>Playground</span>
        </div>
        <h2 className="pg-title" data-reveal>
          Grab something.
        </h2>
        <ol className="pg-steps mono">
          <li>
            <b>Drag</b> to move. Throw it.
          </li>
          <li>
            <b>Hold still</b> 0.6s to open actions.
          </li>
          <li>
            <b>Slide left / right</b> to turn the dial.
          </li>
          <li>
            <b>Release</b> to confirm.
          </li>
          <li className="kbd">
            Keys: Tab · Enter · ← → · Esc
          </li>
        </ol>
      </header>

      <div
        ref={stage}
        className={`pg-stage ${open ? 'menu-open' : ''}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!ptr.current.down) ptr.current.inside = false
        }}
      >
        <div className="pg-grid" aria-hidden="true" />
        <canvas ref={trail} className="pg-trail" aria-hidden="true" />

        {SITE_OBJECTS.map((o) => {
          const selected = snap.objectId === o.id && snap.status !== 'IDLE'
          return (
            <div
              key={o.id}
              ref={(n) => {
                nodes.current[o.id] = n
              }}
              className={`pg-obj ${selected ? 'selected' : ''} ${panel?.id === o.id ? 'has-panel' : ''}`}
              tabIndex={0}
              role="button"
              aria-label={`${o.label}. Enter opens actions.`}
              onPointerDown={onObjectDown(o.id)}
              onKeyDown={onKey(o.id)}
            >
              <div className="floater-head">
                <span>{o.tag}</span>
                <span>{o.id}</span>
              </div>
              <div className="floater-body">
                <ObjectVisual visual={o.visual} obj={o} />
              </div>
              <div className="floater-foot">{o.label}</div>
            </div>
          )
        })}

        <div ref={radialWrap} className={`pg-radial ${showRadial ? 'show' : ''} ${open ? 'open' : ''}`} style={{ ['--ring' as string]: `${ringSize}px` }}>
          <svg className="hold-ring" viewBox={`${-ringSize / 2} ${-ringSize / 2} ${ringSize} ${ringSize}`} width={ringSize} height={ringSize} aria-hidden="true">
            <circle r={ring.rIn - 8} pathLength={1} className="hold-track" />
            <circle ref={holdRing} r={ring.rIn - 8} pathLength={1} className="hold-prog" transform="rotate(-90)" />
          </svg>
          <RadialRing active={open ? snap.active : null} size={ringSize} rIn={ring.rIn} rOut={ring.rOut} open={open} onChoose={choose} needleRef={needle} />
        </div>

        {panel && panelObj && (
          <div ref={panelEl} className={`pg-panel ${panel.kind}`} role="dialog" aria-label={`${panel.kind === 'explain' ? 'Explain' : 'Voice'}: ${panelObj.label}`} onPointerDown={(e) => e.stopPropagation()}>
            <div className="pg-panel-head mono">
              <span className="hot">{panel.kind === 'explain' ? 'Explain' : 'Voice'}</span>
              <span>{panelObj.label}</span>
              <button type="button" onClick={() => setPanel(null)} aria-label="Close">
                ×
              </button>
            </div>
            {panel.kind === 'explain' ? (
              <>
                <ul className="facts">
                  {panel.facts.map((f, i) => (
                    <li key={i} style={{ animationDelay: `${i * 70}ms` }}>
                      {f}
                    </li>
                  ))}
                </ul>
                <p className="provenance mono">Computed in your browser from this object’s data by the app’s describeObject(). No AI model connected.</p>
              </>
            ) : (
              <VoiceConsole obj={panelObj} all={panel.all} autoFocus />
            )}
          </div>
        )}

        <div ref={hud} className="pg-hud mono" aria-live="polite">
          <div className="hud-row">
            <span>STATE</span>
            <b className={snap.status === 'IDLE' ? '' : 'hot'}>{snap.status}</b>
          </div>
          <div className="hud-row">
            <span>OBJECT</span>
            <b>{snap.objectId ?? '—'}</b>
          </div>
          <div className="hud-row">
            <span>ACTION</span>
            <b>{open ? ACTION_LABEL[snap.active] : '—'}</b>
          </div>
          <div className="hud-row">
            <span>INPUT</span>
            <b>{open ? SOURCE_TEXT[snap.source] : '—'}</b>
          </div>
          <ol className="hud-log">
            {log.map((l, i) => (
              <li key={`${l.t}-${i}`}>
                <span>{l.to}</span> {l.reason}
              </li>
            ))}
          </ol>
          <p className="hud-note">RadialMenuController · same state machine as the camera demo</p>
        </div>

        <div ref={tray} className={`pg-tray ${flash ? 'flash' : ''}`}>
          <div className="tray-label mono">
            <span>Memory</span>
            <b>{memories.length}</b>
            {memories.length > 0 && (
              <button type="button" onClick={() => siteMemory.clear()}>
                clear
              </button>
            )}
          </div>
          <div className="tray-items">
            {memories.length === 0 && <span className="tray-empty mono">Hold an object → Remember. It lands here, saved in this browser.</span>}
            {memories.slice(0, 8).map((m) => (
              <div key={m.id} className="tray-item">
                <span className="mono">{m.type}</span>
                <b>{m.title}</b>
                <time className="mono">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
              </div>
            ))}
          </div>
          {flash && <div className="tray-toast mono">Saved · {flash}</div>}
        </div>
      </div>
    </section>
  )
}
