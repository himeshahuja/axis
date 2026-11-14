// Section 2: a conventional window; scrolling lifts one object out of it, the
// window folds away, and the object stays — floating, grabbed, with actions.

import { useEffect, useRef } from 'react'
import { lerp, pointer, reducedMotion, smooth, stickyProgress, useFrame } from './motion'
import { ObjectVisual } from './objects'

interface Geo {
  W: number
  H: number
  mobile: boolean
  win: { x: number; y: number; w: number; h: number }
  slot: { x: number; y: number; w: number; h: number }
  end: { x: number; y: number; w: number; h: number }
}

const STAGES = ['Window', 'Detach', 'Space']

export function Disappear() {
  const root = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const win = useRef<HTMLDivElement>(null)
  const winInner = useRef<HTMLDivElement>(null)
  const ghost = useRef<HTMLDivElement>(null)
  const chart = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLDivElement>(null)
  const click = useRef<HTMLDivElement>(null)
  const hand = useRef<HTMLDivElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const textA = useRef<HTMLHeadingElement>(null)
  const words = useRef<(HTMLSpanElement | null)[]>([])
  const bar = useRef<HTMLDivElement>(null)
  const stageLabels = useRef<(HTMLSpanElement | null)[]>([])
  const geo = useRef<Geo | null>(null)
  const still = useRef(false)

  useEffect(() => {
    still.current = reducedMotion()
    const el = stage.current!
    const layout = () => {
      const W = el.clientWidth
      const H = el.clientHeight
      const mobile = W < 760
      const ww = mobile ? W * 0.9 : Math.min(W * 0.5, 760)
      const wh = ww * 0.62
      const wx = mobile ? W * 0.05 : W * 0.45
      const wy = mobile ? H * 0.46 : (H - wh) / 2 + H * 0.02
      const slot = { x: wx + ww * 0.27, y: wy + wh * 0.2, w: ww * 0.42, h: wh * 0.5 }
      const ew = mobile ? W * 0.62 : Math.min(W * 0.3, 420)
      const eh = ew * (slot.h / slot.w)
      const end = { x: (mobile ? W * 0.5 : W * 0.68) - ew / 2, y: (mobile ? H * 0.64 : H * 0.5) - eh / 2, w: ew, h: eh }
      geo.current = { W, H, mobile, win: { x: wx, y: wy, w: ww, h: wh }, slot, end }
      const w = win.current!
      Object.assign(w.style, { left: `${wx}px`, top: `${wy}px`, width: `${ww}px`, height: `${wh}px` })
      const c = chart.current!
      Object.assign(c.style, { width: `${ew}px`, height: `${eh}px` })
      const g = ghost.current!
      Object.assign(g.style, { left: `${slot.x - wx}px`, top: `${slot.y - wy}px`, width: `${slot.w}px`, height: `${slot.h}px` })
    }
    layout()
    const ro = new ResizeObserver(layout)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useFrame(root, (_dt, t) => {
    const g = geo.current
    if (!g || !root.current) return
    const p = stickyProgress(root.current)
    const time = still.current ? 0 : t

    // Window: fades to wireframe, then folds back into the floor.
    const wire = smooth(0.28, 0.5, p)
    const fold = smooth(0.52, 0.82, p)
    win.current!.style.transform = `perspective(1400px) translateY(${(fold * g.H * 0.18).toFixed(1)}px) rotateX(${(fold * 74).toFixed(2)}deg)`
    win.current!.style.opacity = String(1 - fold)
    win.current!.style.setProperty('--wire', wire.toFixed(3))
    winInner.current!.style.opacity = String(1 - wire * 0.88)
    ghost.current!.style.opacity = String(smooth(0.3, 0.42, p))

    // The object lifts: slot rect → floating rect, with a lift arc.
    const e = smooth(0.26, 0.78, p)
    const lift = Math.sin(Math.PI * smooth(0.26, 0.62, p))
    const sx = lerp(g.slot.x, g.end.x, e)
    const sy = lerp(g.slot.y, g.end.y, e) - lift * 40
    const sw = lerp(g.slot.w, g.end.w, e)
    const s = sw / g.end.w
    const settled = smooth(0.78, 1, p)
    const driftX = Math.sin(time * 0.0006) * 8 * settled
    const driftY = Math.cos(time * 0.0005) * 10 * settled
    let px = 0
    let py = 0
    if (pointer.active && settled > 0) {
      px = (pointer.x / window.innerWidth - 0.5) * 18 * settled
      py = (pointer.y / window.innerHeight - 0.5) * 12 * settled
    }
    const rx = lift * 18 - py * 0.6
    const ry = -lift * 10 + px * 0.8
    const c = chart.current!
    c.style.transform = `translate3d(${(sx + driftX).toFixed(1)}px, ${(sy + driftY).toFixed(1)}px, 0) perspective(1000px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${s.toFixed(4)})`
    c.style.setProperty('--lift', smooth(0.26, 0.5, p).toFixed(3))
    c.style.setProperty('--grab', smooth(0.66, 0.72, p).toFixed(3))

    // Arrow cursor travels to the object and clicks, then gives way to the hand.
    const travel = smooth(0.02, 0.18, p)
    const ax = lerp(g.win.x + g.win.w * 0.86, g.slot.x + g.slot.w * 0.55, travel)
    const ay = lerp(g.win.y + g.win.h * 0.9, g.slot.y + g.slot.h * 0.55, travel)
    arrow.current!.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0)`
    arrow.current!.style.opacity = String(1 - smooth(0.26, 0.34, p))
    const ck = smooth(0.18, 0.26, p)
    click.current!.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) scale(${(0.4 + ck * 1.6).toFixed(3)})`
    click.current!.style.opacity = String(ck > 0 && ck < 1 ? 1 - ck : 0)

    const hx = g.end.x + g.end.w * 0.5 + driftX
    const hy = g.end.y + g.end.h * 0.5 + driftY
    const handIn = smooth(0.58, 0.66, p)
    const pinch = smooth(0.66, 0.72, p)
    hand.current!.style.transform = `translate3d(${hx.toFixed(1)}px, ${hy.toFixed(1)}px, 0) scale(${(1.6 - pinch * 0.75).toFixed(3)})`
    hand.current!.style.opacity = String(handIn)
    const fan = smooth(0.8, 0.94, p)
    actions.current!.style.transform = `translate3d(${hx.toFixed(1)}px, ${hy.toFixed(1)}px, 0)`
    actions.current!.style.setProperty('--fan', fan.toFixed(3))
    actions.current!.style.opacity = String(fan)

    // Copy.
    const outA = smooth(0.36, 0.5, p)
    textA.current!.style.opacity = String(1 - outA)
    textA.current!.style.transform = `translate3d(0, ${(-outA * 60).toFixed(1)}px, 0)`
    const thresholds = [0.56, 0.68, 0.82]
    words.current.forEach((w, i) => {
      if (!w) return
      const on = smooth(thresholds[i], thresholds[i] + 0.06, p)
      w.style.opacity = String(0.1 * smooth(0.44, 0.54, p) + on * 0.9)
      w.style.transform = `translate3d(0, ${((1 - on) * 30).toFixed(1)}px, 0)`
      w.classList.toggle('current', on > 0.5 && (i === 2 || p < thresholds[i + 1]))
    })
    bar.current!.style.transform = `scaleX(${p.toFixed(4)})`
    const si = p < 0.3 ? 0 : p < 0.6 ? 1 : 2
    stageLabels.current.forEach((l, i) => l?.classList.toggle('on', i === si))
  })

  return (
    <section ref={root} className="disappear" id="shift" aria-label="The interface disappears">
      <div ref={stage} className="disappear-stage">
        <div className="disappear-copy">
          <div className="section-index mono">
            <span>[02]</span>
            <span>The interface disappears</span>
          </div>
          <h2 ref={textA} className="disappear-a">
            Why are we still pointing and clicking?
          </h2>
          <h2 className="disappear-b" aria-label="Point. Grab. Act.">
            {['Point.', 'Grab.', 'Act.'].map((w, i) => (
              <span
                key={w}
                ref={(n) => {
                  words.current[i] = n
                }}
                aria-hidden="true"
              >
                {w}
              </span>
            ))}
          </h2>
        </div>

        <div ref={win} className="fake-window" aria-hidden="true">
          <div className="fw-bar">
            <i />
            <i />
            <i />
            <span>dashboard — untitled.app</span>
          </div>
          <div ref={winInner} className="fw-inner">
            <div className="fw-side">
              {['Overview', 'Reports', 'Files', 'Settings'].map((s, i) => (
                <span key={s} className={i === 1 ? 'on' : ''}>
                  {s}
                </span>
              ))}
            </div>
            <div className="fw-main">
              <div className="fw-tools">
                <span />
                <span />
                <span />
              </div>
              <div className="fw-card fw-card-a" />
              <div className="fw-card fw-card-b" />
              <div className="fw-row" />
              <div className="fw-row short" />
            </div>
          </div>
          <div ref={ghost} className="fw-ghost">
            <span className="mono">object detached</span>
          </div>
        </div>

        <div ref={chart} className="fly-card" aria-hidden="true">
          <div className="floater-head">
            <span>CHART · $k</span>
            <span>revenue</span>
          </div>
          <div className="floater-body">
            <ObjectVisual visual="chart" />
          </div>
          <div className="floater-foot">Quarterly revenue</div>
        </div>

        <div ref={arrow} className="fake-arrow" aria-hidden="true">
          <svg viewBox="0 0 20 28" width="20" height="28">
            <path d="M1,1 L1,22 L6.5,16.5 L10.5,26 L14,24.5 L10,15.5 L18,15.5 Z" />
          </svg>
        </div>
        <div ref={click} className="fake-click" aria-hidden="true" />
        <div ref={hand} className="fake-hand" aria-hidden="true">
          <i />
        </div>
        <div ref={actions} className="fan" aria-hidden="true">
          <span style={{ ['--a' as string]: '-90deg' }}>Explain</span>
          <span style={{ ['--a' as string]: '30deg' }}>Remember</span>
          <span style={{ ['--a' as string]: '150deg' }}>Voice</span>
        </div>

        <div className="disappear-progress mono" aria-hidden="true">
          <div className="dp-labels">
            {STAGES.map((s, i) => (
              <span
                key={s}
                ref={(n) => {
                  stageLabels.current[i] = n
                }}
              >
                {String(i + 1).padStart(2, '0')} {s}
              </span>
            ))}
          </div>
          <div className="dp-track">
            <div ref={bar} />
          </div>
        </div>
      </div>
    </section>
  )
}
