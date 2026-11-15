// The live board: a simulated session played through the real Vexo Board engine
// (src/board/engine), in a multiple of real time. Everything that moves is drawn
// from requestAnimationFrame straight to canvases; React renders the structure and
// the few things that change a handful of times a session.

import { useEffect, useMemo, useRef, useState } from 'react'
import { fitCanvas, useFrame } from '../site/motion'
import { features } from './engine/concept/contact.js'
import { arrivals, deliver, score, tracker, type Arrival, type Score } from './engine/concept/replay.js'
import { conceptSession, type ConceptSession, type EmgBlock, type Ping, type SceneName } from './engine/concept/simulate.js'
import type { VexoBoard } from './engine/concept/tracker.js'

const SCENES: { id: SceneName; label: string }[] = [
  { id: 'reach', label: '1.2 m board · five words' },
  { id: 'walk', label: '2.4 m board · walking' },
  { id: 'steady', label: 'No pauses' },
]
const STEPS = ['Tip on the puck', 'Knock left', 'Knock right', 'Writing']
const SOUND = 331.3 * Math.sqrt(1 + 22 / 273.15) // m/s in the simulated room, 22 °C
const WINDOW_MS = 6000
const HOT = '#ff5a1f'
const INK = '#080808'
const PAPER = '#f2f0eb'

interface Run {
  s: ConceptSession
  vb: VexoBoard
  queue: Arrival[]
  next: number
  clock: number
  end: number
  index: Map<number, number>
  rings: number[]
  ranges: [number, (number | null)[], boolean][]
  mic: [number, number, boolean][]
  muscle: [number, number, number, boolean][]
  pinchAt: number
  emg: boolean
  err: number | null
}

export function LiveBoard() {
  const root = useRef<HTMLElement>(null)
  const boardRef = useRef<HTMLCanvasElement>(null)
  const stripRef = useRef<HTMLCanvasElement>(null)
  const errRef = useRef<HTMLSpanElement>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const clicksRef = useRef<HTMLSpanElement>(null)
  const micRef = useRef<HTMLSpanElement>(null)
  const emgRef = useRef<HTMLSpanElement>(null)
  const pinchRef = useRef<HTMLSpanElement>(null)
  const run = useRef<Run | null>(null)

  const [scene, setScene] = useState<SceneName>('reach')
  const [blocked, setBlocked] = useState(true)
  const [talk, setTalk] = useState(true)
  const [noisy, setNoisy] = useState(false)
  const [emg, setEmg] = useState(true)
  const [truth, setTruth] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [step, setStep] = useState(-1)
  const [status, setStatus] = useState('Press play to watch a writer at the board.')
  const [result, setResult] = useState<Score | null>(null)
  const [playing, setPlaying] = useState(false)
  const opts = useRef({ truth, speed })
  useEffect(() => {
    opts.current = { truth, speed }
  }, [truth, speed])

  const start = () => {
    const s = conceptSession(scene, { blocked, talk, noisy })
    const vb = tracker(s, { emg })
    run.current = {
      s, vb, queue: arrivals(s, { emg }), next: 0, clock: s.samples[0].t, end: s.samples[s.samples.length - 1].t,
      index: new Map(s.samples.map((m, i) => [m.t, i])), rings: [], ranges: [], mic: [], muscle: [], pinchAt: -Infinity, emg, err: null,
    }
    setResult(null)
    setStep(0)
    setPlaying(true)
  }

  function drawBoard() {
    const c = boardRef.current
    if (!c) return
    const { w, h, ctx } = fitCanvas(c)
    ctx.clearRect(0, 0, w, h)
    const r = run.current
    const W = r ? r.s.layout.width : 1.2, H = 1.2
    const pad = 36, scale = Math.min((w - 2 * pad) / W, (h - 2 * pad) / H)
    const ox = (w - W * scale) / 2, oy = (h - H * scale) / 2
    const X = (x: number) => ox + x * scale, Y = (y: number) => oy + (H - y) * scale

    // The board: warm ivory, a 10 cm grid, a hairline edge.
    ctx.fillStyle = PAPER
    ctx.fillRect(X(0), Y(H), W * scale, H * scale)
    ctx.strokeStyle = 'rgba(8,8,8,0.06)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 0.1; x < W - 1e-6; x += 0.1) { ctx.moveTo(Math.round(X(x)) + 0.5, Y(H)); ctx.lineTo(Math.round(X(x)) + 0.5, Y(0)) }
    for (let y = 0.1; y < H - 1e-6; y += 0.1) { ctx.moveTo(X(0), Math.round(Y(y)) + 0.5); ctx.lineTo(X(W), Math.round(Y(y)) + 0.5) }
    ctx.stroke()
    const pucks: [number, number, string][] = [[0, 0, 'P1'], [0, H, 'P2'], [W, H, 'P3']]

    if (r) {
      const f = r.vb.fused, last = f.length - 1
      const band = last >= 0 ? [f.x[last], f.y[last]] : null
      // Each click: rays to the pucks that heard it, and a ring growing from the band.
      if (band) {
        const recent = r.ranges.length ? r.ranges[r.ranges.length - 1] : null
        if (recent && r.clock - recent[0] < 40) {
          ctx.setLineDash([3, 4])
          recent[1].forEach((d, k) => {
            if (d == null) return
            ctx.strokeStyle = recent[2] ? 'rgba(255,90,31,0.55)' : 'rgba(8,8,8,0.25)'
            ctx.beginPath()
            ctx.moveTo(X(band[0]), Y(band[1]))
            ctx.lineTo(X(pucks[k][0]), Y(pucks[k][1]))
            ctx.stroke()
          })
          ctx.setLineDash([])
        }
        for (const t of r.rings) {
          const age = (r.clock - t) / 160
          ctx.strokeStyle = `rgba(255,90,31,${(0.5 * (1 - age)).toFixed(3)})`
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.arc(X(band[0]), Y(band[1]), 5 + age * 70, 0, 2 * Math.PI)
          ctx.stroke()
        }
      }
      // The true path, for comparison.
      if (opts.current.truth) {
        ctx.strokeStyle = 'rgba(255,90,31,0.55)'
        ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        let up = true
        for (let i = 0; i < r.s.samples.length && r.s.samples[i].t <= r.clock; i += 2) {
          if (!r.s.touching[i]) { up = true; continue }
          const p = r.s.tip[i]
          if (up) ctx.moveTo(X(p[0]), Y(p[1])); else ctx.lineTo(X(p[0]), Y(p[1]))
          up = false
        }
        ctx.stroke()
        ctx.setLineDash([])
      }
      // The ink.
      ctx.strokeStyle = INK
      ctx.lineWidth = 2.4
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const stroke of r.vb.strokes()) {
        ctx.beginPath()
        stroke.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))))
        ctx.stroke()
      }
      // The band (a square, like the brand's mark) and the tip, held in selection brackets.
      if (band) {
        const tip = r.vb.tipAt(last)
        ctx.strokeStyle = INK
        ctx.lineWidth = 1.5
        ctx.strokeRect(X(band[0]) - 6, Y(band[1]) - 6, 12, 12)
        ctx.fillStyle = INK
        ctx.fillRect(X(band[0]) - 2.5, Y(band[1]) - 2.5, 5, 5)
        if (r.vb.tipBody) {
          ctx.strokeStyle = 'rgba(8,8,8,0.35)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(X(band[0]), Y(band[1]))
          ctx.lineTo(X(tip[0]), Y(tip[1]))
          ctx.stroke()
          brackets(ctx, X(tip[0]), Y(tip[1]), r.vb.contact.on)
          const k = r.index.get(f.t[last])
          r.err = k === undefined ? null : Math.hypot(tip[0] - r.s.tip[k][0], tip[1] - r.s.tip[k][1])
        }
      }
      if (errRef.current) errRef.current.textContent = r.err == null ? '—' : `${(r.err * 1000).toFixed(0)}`
      if (clockRef.current) clockRef.current.textContent = `${((r.clock - r.s.samples[0].t) / 1000).toFixed(1)} / ${((r.end - r.s.samples[0].t) / 1000).toFixed(1)} s`
      if (clicksRef.current) {
        const st = r.vb.pings.stats
        clicksRef.current.textContent = `${st.used} used · ${st.echoes} echoes out · ${st.missing} unheard`
      }
      micRef.current?.classList.toggle('on', r.vb.contact.on)
      emgRef.current?.classList.toggle('on', Boolean(r.emg && r.vb.muscles.last?.pressing))
      pinchRef.current?.classList.toggle('on', r.clock - r.pinchAt < 700)
    }
    // The pucks: small squares in the hot colour, labelled.
    for (const [x, y, label] of pucks) {
      ctx.fillStyle = HOT
      ctx.fillRect(X(x) - 6, Y(y) - 6, 12, 12)
      ctx.fillStyle = 'rgba(242,240,235,0.7)'
      ctx.font = '500 10px "DM Sans", system-ui, sans-serif'
      ctx.fillText(label, X(x) + (x > 0 ? 10 : -26), Y(y) + (y > 0 ? -8 : 16))
    }
    ctx.fillStyle = 'rgba(242,240,235,0.45)'
    ctx.font = '500 10px "DM Sans", system-ui, sans-serif'
    ctx.fillText(`${(W * 100).toFixed(0)} × ${(H * 100).toFixed(0)} CM`, X(0) + 14, Y(0) + 20)
  }

  function drawStrips() {
    const c = stripRef.current
    if (!c) return
    const { w, h, ctx } = fitCanvas(c)
    ctx.clearRect(0, 0, w, h)
    const lanes = 3, lh = h / lanes, label = 128
    const r = run.current, t1 = r ? r.clock : 0, t0 = t1 - WINDOW_MS
    const T = (t: number) => label + ((t - t0) / WINDOW_MS) * (w - label)
    const names = ['ULTRASOUND · 3 PUCKS', 'MICROPHONE · HISS', 'EMG · FOREARM']
    for (let k = 0; k < lanes; k++) {
      const y0 = k * lh
      ctx.strokeStyle = 'rgba(242,240,235,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, Math.round(y0 + lh) - 0.5)
      ctx.lineTo(w, Math.round(y0 + lh) - 0.5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(242,240,235,0.55)'
      ctx.font = '500 10px "DM Sans", system-ui, sans-serif'
      ctx.fillText(names[k], 0, y0 + 18)
    }
    if (!r) return
    // Ultrasound: each puck's distance, 0 to 2.6 m; a gap where it heard nothing, a jump up for an echo.
    const uy = (d: number) => lh - 8 - (d / 2.6) * (lh - 16)
    for (let p = 0; p < 3; p++) {
      ctx.strokeStyle = ['rgba(242,240,235,0.85)', 'rgba(242,240,235,0.55)', 'rgba(242,240,235,0.3)'][p]
      ctx.lineWidth = 1.2
      ctx.beginPath()
      let up = true
      for (const [t, ds] of r.ranges) {
        const d = ds[p]
        if (d == null) { up = true; continue }
        if (up) ctx.moveTo(T(t), uy(d)); else ctx.lineTo(T(t), uy(d))
        up = false
      }
      ctx.stroke()
    }
    for (const [t, , used] of r.ranges) if (!used) { ctx.fillStyle = HOT; ctx.fillRect(T(t) - 1, lh - 6, 2, 4) }
    // Microphone: the high band's level; hot while the marker is on the board.
    const lows = r.mic.map((m) => m[1]), lo = Math.min(...lows, 0), hi = Math.max(...lows, lo + 20)
    const my = (v: number) => lh * 2 - 6 - ((v - lo) / (hi - lo)) * (lh - 26)
    for (const [t, v, on] of r.mic) {
      ctx.fillStyle = on ? HOT : 'rgba(242,240,235,0.35)'
      ctx.fillRect(T(t), my(v), Math.max(1.5, (20 / WINDOW_MS) * (w - label)), lh * 2 - 6 - my(v))
    }
    // EMG: the flexors (pressing) and the thumb side (pinch).
    const ey = (v: number) => lh * 3 - 6 - Math.min(1, v / 0.8) * (lh - 26)
    for (const [t, , , press] of r.muscle) if (press) { ctx.fillStyle = 'rgba(255,90,31,0.18)'; ctx.fillRect(T(t), lh * 2 + 22, Math.max(1.5, (20 / WINDOW_MS) * (w - label)), lh - 28) }
    for (const [idx, colour] of [[1, 'rgba(242,240,235,0.85)'], [2, HOT]] as [1 | 2, string][]) {
      ctx.strokeStyle = colour
      ctx.lineWidth = 1.2
      ctx.beginPath()
      r.muscle.forEach((m, i) => (i ? ctx.lineTo(T(m[0]), ey(m[idx])) : ctx.moveTo(T(m[0]), ey(m[idx]))))
      ctx.stroke()
    }
  }

  useFrame(root, (dt) => {
    const r = run.current
    if (r && r.clock < r.end) {
      r.clock = Math.min(r.end, r.clock + dt * opts.current.speed)
      while (r.next < r.queue.length && r.queue[r.next].at <= r.clock) {
        const a = r.queue[r.next++]
        if (a.kind === 'ping') {
          const p = a.data as Ping, fix = r.vb.ping(p)
          r.rings.push(p.t)
          r.ranges.push([p.t, p.delays.map((d) => (d == null ? null : d * SOUND)), Boolean(fix)])
        } else if (a.kind === 'emg') {
          const e = a.data as EmgBlock, m = r.vb.emg(e), last = r.vb.muscles.last
          if (m.pinch) r.pinchAt = e.t
          if (last) r.muscle.push([e.t, last.flex, last.thumb, m.pressing])
        } else if (a.kind === 'audio') {
          deliver(r.vb, a)
          const f = features((a.data as { samples: Float32Array }).samples)
          r.mic.push([(a.data as { t: number }).t, f.high, r.vb.contact.on])
        } else {
          deliver(r.vb, a)
        }
      }
      const cut = r.clock - WINDOW_MS
      for (const list of [r.ranges, r.mic, r.muscle] as [number, ...unknown[]][][]) while (list.length && list[0][0] < cut) list.shift()
      r.rings = r.rings.filter((t) => r.clock - t < 160)
      // The setup steps, from what the tracker has done so far.
      const news = r.vb.news, held = (r.vb as unknown as { held: unknown }).held
      const now = r.vb.ready ? 3 : news.some((n) => n.type === 'left') ? 2 : held ? 1 : 0
      if (now !== step) setStep(now)
      const text = r.vb.status()
      if (text !== status) setStatus(text)
      if (r.clock >= r.end) {
        setResult(score(r.s, r.vb))
        setPlaying(false)
      }
    }
    drawBoard()
    drawStrips()
  })

  const download = () => {
    const r = run.current
    if (!r) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.vb.ink(), null, 1)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'vexo-board-ink.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const scores = useMemo(() => {
    if (!result) return null
    const mm = (m: number) => (m < 0.01 ? `${(m * 1000).toFixed(0)} mm` : `${(m * 100).toFixed(1)} cm`)
    return [
      ['Tip · half the time', mm(result.tip[0])],
      ['Tip · 95% of the time', mm(result.tip[1])],
      ['Writing caught', `${Math.round(result.recall * 100)}%`],
      ['“On the board” right', `${Math.round(result.precision * 100)}%`],
      ['Echoes thrown out', String(result.clicks.echoes)],
      ['Pinches', `${result.pinches.found} / ${result.pinches.of}`],
    ]
  }, [result])

  const toggle = (on: boolean, set: (v: boolean) => void, label: string) => (
    <button className={`chip ${on ? 'hot' : ''}`} aria-pressed={on} onClick={() => set(!on)}>
      {label}
    </button>
  )

  return (
    <section ref={root} className="bd-live" id="live" aria-label="A simulated session, live">
      <div className="bd-head">
        <div className="section-index mono">
          <span>01</span>
          <span>Live</span>
        </div>
        <h2 className="bd-title" data-reveal>
          Watch it
          <br />
          <em>write.</em>
        </h2>
        <p className="bd-lede">A pretend writer at the board, played through the real tracking code. The hardware doesn’t exist yet, so its clicks, sound and muscle signals are simulated, echoes and a talking writer included.</p>
      </div>

      <div className="trace-picker bd-controls" role="group" aria-label="Session">
        <span className="mono">Scene</span>
        {SCENES.map((s) => (
          <button key={s.id} className={`chip ${scene === s.id ? 'hot' : ''}`} aria-pressed={scene === s.id} onClick={() => setScene(s.id)}>
            {s.label}
          </button>
        ))}
        <span className="bd-sep" aria-hidden="true" />
        {toggle(blocked, setBlocked, 'Blocked pucks')}
        {toggle(talk, setTalk, 'Talking')}
        {toggle(noisy, setNoisy, 'Loud room')}
        {toggle(emg, setEmg, 'EMG')}
        {toggle(truth, setTruth, 'True path')}
        <span className="bd-sep" aria-hidden="true" />
        {[1, 2, 4].map((v) => (
          <button key={v} className={`chip ${speed === v ? 'hot' : ''}`} aria-pressed={speed === v} onClick={() => setSpeed(v)}>
            {v}×
          </button>
        ))}
        <button className="btn btn-primary bd-play" onClick={start}>
          {playing ? 'Restart' : result ? 'Play again' : 'Play'} <span aria-hidden="true">↘</span>
        </button>
      </div>

      <div className="bd-stage">
        <div className="bd-board">
          <canvas ref={boardRef} className="bd-board-canvas" role="img" aria-label="The whiteboard: three pucks, the band, the marker's tip and the ink so far" />
          <ol className="bd-steps mono" aria-label="Setup">
            {STEPS.map((label, i) => (
              <li key={label} className={step > i ? 'done' : step === i ? 'now' : ''}>
                <span>0{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
        </div>
        <aside className="bd-readouts">
          <div className="pipe-out bd-big">
            <span className="mono">Tip error now · mm</span>
            <p>
              <span ref={errRef} className="bd-num">—</span>
            </p>
          </div>
          <div className="pipe-out">
            <span className="mono">Status</span>
            <p className="bd-status" aria-live="polite">{status}</p>
          </div>
          <div className="pipe-out">
            <span className="mono">Senses</span>
            <div className="bd-lights">
              <span ref={micRef} className="bd-light">Mic · marker</span>
              <span ref={emgRef} className="bd-light">EMG · press</span>
              <span ref={pinchRef} className="bd-light">Pinch</span>
            </div>
          </div>
          <div className="pipe-out">
            <span className="mono">Clicks</span>
            <p>
              <span ref={clicksRef}>—</span>
            </p>
            <span ref={clockRef} className="mono bd-clock">—</span>
          </div>
        </aside>
      </div>

      <canvas ref={stripRef} className="bd-strips" role="img" aria-label="The last six seconds: each puck's distance, the microphone's hiss, and the forearm's muscles" />

      {scores && (
        <div className="bd-result">
          <dl className="bd-scores">
            {scores.map(([k, v]) => (
              <div key={k}>
                <dt className="mono">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <button className="btn btn-ghost" onClick={download}>
            Download the ink <span aria-hidden="true">↓</span>
          </button>
        </div>
      )}
      <p className="provenance">Simulated hardware, real tracking code (src/board/engine). The tip error compares the tracker’s answer with where the pretend writer’s marker really was.</p>
    </section>
  )
}

/** Selection brackets round the tip, like the site's selection brackets; filled while the marker is on the board. */
function brackets(ctx: CanvasRenderingContext2D, x: number, y: number, on: boolean) {
  const s = 11, l = 5
  ctx.strokeStyle = HOT
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.moveTo(x + dx * s, y + dy * (s - l))
    ctx.lineTo(x + dx * s, y + dy * s)
    ctx.lineTo(x + dx * (s - l), y + dy * s)
  }
  ctx.stroke()
  ctx.fillStyle = on ? HOT : 'rgba(255,90,31,0.35)'
  ctx.beginPath()
  ctx.arc(x, y, on ? 3.5 : 2.5, 0, 2 * Math.PI)
  ctx.fill()
}
