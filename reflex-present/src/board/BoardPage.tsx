// AXIS Board, mounted at /board: the pitch for a Vexo band that tracks a marker on
// any whiteboard. Built on the product site's styles (src/site/site.css) and its
// motion plumbing; the live section runs the real engine in src/board/engine on
// simulated hardware.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BRAND_NAME, REPO_URL, ROUTES } from '../site/brand'
import { FieldCanvas } from '../site/FieldCanvas'
import { installPointer, reducedMotion } from '../site/motion'
import '../site/site.css'
import './board.css'
import { play, score, type Score } from './engine/concept/replay.js'
import { conceptSession, type SceneName, type SessionOptions } from './engine/concept/simulate.js'
import { LiveBoard } from './LiveBoard'

function Nav() {
  return (
    <nav className="nav" aria-label="Primary">
      <a href={ROUTES.site} className="nav-brand">
        <span className="nav-mark" aria-hidden="true" />
        {BRAND_NAME} <span className="bd-nav-sub">Board</span>
      </a>
      <div className="nav-links mono">
        <a href="#live">Live</a>
        <a href="#how">How</a>
        <a href="#hardware">Hardware</a>
        <a href="#proof">Proof</a>
      </div>
      <a href={ROUTES.pitch} className="nav-cta mono">
        The pitch ↗
      </a>
    </nav>
  )
}

/** The hero's giant word, sized to fill the width (and no taller than ~40% of the hero). */
function BigWord({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    const fit = () => {
      const parent = el.parentElement!
      const hero = el.closest('.hero') as HTMLElement | null
      el.style.fontSize = '100px'
      const w = el.scrollWidth
      if (w <= 0) return
      const byWidth = (100 * parent.clientWidth) / w
      const byHeight = hero ? (100 * hero.clientHeight * 0.4) / 72 : byWidth
      el.style.fontSize = `${Math.min(byWidth, byHeight) * 0.995}px`
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el.parentElement!)
    document.fonts?.ready.then(fit)
    return () => ro.disconnect()
  }, [text])
  return (
    <h1 ref={ref} className="hero-word bd-word" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="hero-letter" style={{ animationDelay: `${120 + i * 55}ms` }} aria-hidden="true">
          <span>{ch}</span>
        </span>
      ))}
    </h1>
  )
}

function Hero() {
  return (
    <section className="hero bd-hero" id="top">
      <FieldCanvas className="hero-field" />
      <div className="hero-copy">
        <div className="hero-meta mono">
          <span>Concept · the next Vexo band</span>
          <span>VexoHacks 2026</span>
        </div>
        <p className="hero-statement">
          Write on any
          <br />
          board. Keep
          <br />
          every <em>stroke.</em>
        </p>
        <div className="hero-support">
          <p>A band that clicks ultrasound to three pucks on the board, hears the marker, and feels your forearm. Every stroke lands on your screen as ink, to a few millimetres.</p>
          <div className="hero-ctas">
            <a className="btn btn-primary" href="#live">
              Watch it write <span aria-hidden="true">↘</span>
            </a>
            <a className="btn btn-ghost" href="#how">
              How it works
            </a>
          </div>
        </div>
      </div>
      <div className="hero-word-wrap">
        <BigWord text="BOARD" />
      </div>
    </section>
  )
}

const INPUTS = [
  { name: 'Ultrasound', detail: 'A click to three pucks, 50 a second', status: 'New' },
  { name: 'Motion', detail: 'Accelerometer and gyro, 208 a second', status: 'On the band' },
  { name: 'Microphone', detail: 'The marker’s hiss', status: 'On the band' },
  { name: 'EMG', detail: 'Eight electrodes, the forearm', status: 'New' },
]

const STAGES = [
  { title: 'Locate', question: 'Where is the band?', mods: ['Three distances → x, y', 'Late = echo, thrown out', 'Three that agree win it back'] },
  { title: 'Fuse', question: 'Where is the tip, every 5 ms?', mods: ['Kalman filter, motion between clicks', 'Hand’s turn → tip, 15 cm away', 'Tip measured once, on a puck'] },
  { title: 'Ink', question: 'Is it writing?', mods: ['Hiss while moving', 'Or the forearm pressing', 'Strokes out, for a recogniser'] },
]

const TRACES: { label: string; input: number; steps: [string, string, string, string] }[] = [
  { label: 'A stroke', input: 0, steps: ['Pucks hear the click 2.9, 4.4 and 3.1 ms after the flash', 'Band at 41.2, 77.0 cm', 'Tip 13 cm above it, turned with the hand', 'One more point of ink'] },
  { label: 'An echo', input: 0, steps: ['Top right hears it 20 cm late: the hand was in the way', 'Too long for the prediction: left out', 'Two pucks and the band’s distance out still place it', 'The stroke carries on, unbroken'] },
  { label: 'A loud room', input: 3, steps: ['Fan noise drowns the marker’s hiss', 'Position as usual', 'Flexors 0.14 above the holding grip: pressing', 'Still ink: 99% of the writing caught'] },
  { label: 'A pinch', input: 3, steps: ['Thumb-side channels high for 0.1 s, the rest quiet', 'The hand’s place on the board', 'Pinch: take the writing near the hand', 'Lifted off, ready to drop on screen'] },
]

const STEP_MS = 1300

function How() {
  const root = useRef<HTMLElement>(null)
  const [trace, setTrace] = useState(0)
  const [stage, setStage] = useState(0)
  const [auto, setAuto] = useState(() => !reducedMotion())
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 })
    io.observe(root.current!)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!auto || !visible) return
    const id = window.setTimeout(() => {
      if (stage < 4) setStage(stage + 1)
      else {
        setStage(0)
        setTrace((t) => (t + 1) % TRACES.length)
      }
    }, stage === 4 ? STEP_MS * 1.8 : STEP_MS)
    return () => window.clearTimeout(id)
  }, [auto, visible, stage])

  const t = TRACES[trace]
  return (
    <section ref={root} className="system" id="how" aria-label="How it works">
      <div className="system-head">
        <div className="section-index mono bd-index">
          <span>02</span>
          <span>How</span>
        </div>
        <h2 className="system-title" data-reveal>
          Four senses.
          <br />
          One stroke.
        </h2>
        <p className="system-lede">Ultrasound says where the band is. Motion fills in between clicks and swings out to the marker’s tip. Sound and muscle say whether it’s writing. Each covers what the others can’t.</p>
      </div>
      <div className="trace-picker" role="tablist" aria-label="Example trace">
        <span className="mono">Example trace</span>
        {TRACES.map((tr, i) => (
          <button key={tr.label} role="tab" aria-selected={trace === i} className={`chip ${trace === i ? 'hot' : ''}`} onClick={() => { setAuto(false); setTrace(i); setStage(4) }}>
            {tr.label}
          </button>
        ))}
        <button className="chip trace-auto" onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
          {auto ? 'Pause' : 'Play'}
        </button>
      </div>
      <ol className="pipeline">
        <li className={`pipe-col ${stage >= 1 ? 'lit' : ''} ${stage === 1 ? 'now' : ''}`}>
          <header>
            <span className="pipe-n">00</span>
            <h3>Sense</h3>
          </header>
          <p className="pipe-q">Two senses the band has, two it would gain.</p>
          <ul className="pipe-inputs">
            {INPUTS.map((inp, i) => (
              <li key={inp.name} className={i === t.input ? 'on' : ''}>
                <b>{inp.name}</b>
                <span>{inp.detail}</span>
                <em>{inp.status}</em>
              </li>
            ))}
          </ul>
          <div className="pipe-out" aria-live="polite">
            <span className="mono">Emits</span>
            <p>{stage >= 1 ? t.steps[0] : '…'}</p>
          </div>
          <i className={`pipe-link ${stage === 1 ? 'flow' : ''}`} aria-hidden="true" />
        </li>
        {STAGES.map((s, i) => {
          const at = i + 2
          return (
            <li key={s.title} className={`pipe-col ${stage >= at ? 'lit' : ''} ${stage === at ? 'now' : ''}`}>
              <header>
                <span className="pipe-n">0{i + 1}</span>
                <h3>{s.title}</h3>
              </header>
              <p className="pipe-q">{s.question}</p>
              <ul className="pipe-mods">
                {s.mods.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <div className="pipe-out">
                <span className="mono">{i === 2 ? 'Result' : 'Emits'}</span>
                <p>{stage >= at ? t.steps[i + 1] : '…'}</p>
              </div>
              {i < 2 && <i className={`pipe-link ${stage === at ? 'flow' : ''}`} aria-hidden="true" />}
            </li>
          )
        })}
      </ol>
      <p className="provenance system-note">Stage names follow src/board/engine (ultrasound, tracker, contact, emg). The traces are illustrative walkthroughs; the live board above runs the real code.</p>
    </section>
  )
}

const PARTS = [
  { name: 'Motion sensor', what: 'Fills in between clicks; how the hand is turned; the knocks that set up the board', on: true },
  { name: 'Microphone', what: 'Hears the marker’s hiss on the board', on: true },
  { name: '40 kHz emitter + infrared LED', what: 'The click and the flash the pucks time', on: false },
  { name: 'Eight EMG electrodes', what: 'Pressing and pinching; later, handwriting from the muscles themselves', on: false },
  { name: 'Three stick-on pucks', what: 'Hear the clicks; measure the board themselves', on: false },
]

function Hardware() {
  return (
    <section className="bd-hardware" id="hardware" aria-label="The hardware">
      <div className="bd-head">
        <div className="section-index mono">
          <span>03</span>
          <span>Hardware</span>
        </div>
        <h2 className="bd-title" data-reveal>
          A band,
          <br />
          three <em>pucks.</em>
        </h2>
        <p className="bd-lede">No band can know where it is on a board by itself, so the board gets three pucks, one at each of three corners. Everything else is on the wrist.</p>
      </div>
      <div className="bd-hw-grid">
        <svg className="bd-diagram" viewBox="0 0 520 330" role="img" aria-label="A whiteboard with pucks at three corners and a band on the wrist clicking to each">
          <rect x="60" y="40" width="380" height="240" className="d-board" />
          {[34, 68, 102].map((r) => <circle key={r} cx="270" cy="190" r={r} className="d-ring" />)}
          {[[60, 280], [60, 40], [440, 40]].map(([x, y]) => <line key={`${x}${y}`} x1="270" y1="190" x2={x} y2={y} className="d-ray" />)}
          {[[60, 280, 'P1'], [60, 40, 'P2'], [440, 40, 'P3']].map(([x, y, l]) => (
            <g key={l as string}>
              <rect x={(x as number) - 8} y={(y as number) - 8} width="16" height="16" className="d-puck" />
              <text x={(x as number) + ((x as number) > 100 ? 14 : -32)} y={(y as number) + ((y as number) > 100 ? 22 : -14)} className="d-label">{l}</text>
            </g>
          ))}
          <path d="M214 138 q12 -18 26 -9 q10 8 -4 14 q-10 5 2 9" className="d-ink" />
          <path d="M150 150 q8 -16 18 -6 q7 8 -3 12" className="d-ink" />
          <line x1="270" y1="190" x2="244" y2="150" className="d-marker" />
          <rect x="258" y="178" width="24" height="24" className="d-band" />
          <rect x="266" y="186" width="8" height="8" className="d-band-core" />
          <text x="292" y="214" className="d-label">BAND</text>
          <text x="60" y="310" className="d-label">ANY WHITEBOARD · PUCKS MEASURE IT THEMSELVES</text>
        </svg>
        <ul className="pipe-inputs bd-parts">
          {PARTS.map((p) => (
            <li key={p.name} className={p.on ? '' : 'on'}>
              <b>{p.name}</b>
              <span>{p.what}</span>
              <em>{p.on ? 'On today’s band' : 'New'}</em>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

interface Proven {
  reach: Score
  walk: Score
  steady: Score
  loudMic: Score
  loudEmg: Score
}

/** The numbers, measured in this browser from simulated sessions, a session at a time so the page stays responsive. */
function useProof() {
  const [proof, setProof] = useState<Partial<Proven>>({})
  useEffect(() => {
    const jobs: [keyof Proven, SceneName, SessionOptions, boolean][] = [
      ['reach', 'reach', {}, true],
      ['walk', 'walk', {}, true],
      ['steady', 'steady', {}, true],
      ['loudMic', 'reach', { noisy: true }, false],
      ['loudEmg', 'reach', { noisy: true }, true],
    ]
    let cancelled = false
    let i = 0
    const next = () => {
      if (cancelled || i >= jobs.length) return
      const [key, scene, opts, emg] = jobs[i++]
      const s = conceptSession(scene, opts)
      const r = score(s, play(s, { emg }))
      setProof((p) => ({ ...p, [key]: r }))
      window.setTimeout(next, 30)
    }
    const id = window.setTimeout(next, 600)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [])
  return proof
}

function Proof() {
  const p = useProof()
  const mm = (m?: number) => (m == null ? '…' : m < 0.01 ? `${(m * 1000).toFixed(0)}` : (m * 100).toFixed(1))
  const unit = (m?: number) => (m == null ? '' : m < 0.01 ? 'mm' : 'cm')
  const pct = (v?: number) => (v == null ? '…' : `${Math.round(v * 100)}`)
  const rows: [string, Score | undefined][] = [
    ['1.2 m board, five words', p.reach],
    ['2.4 m board, walking along it', p.walk],
    ['Writing without a pause', p.steady],
  ]
  return (
    <section className="bd-proof" id="proof" aria-label="The numbers">
      <div className="bd-head">
        <div className="section-index mono">
          <span>04</span>
          <span>Proof</span>
        </div>
        <h2 className="bd-title" data-reveal>
          Millimetres,
          <br />
          <em>not</em> inches.
        </h2>
        <p className="bd-lede">Measured in your browser as this page loaded: whole sessions run through the engine, with a puck blocked a tenth of the time and the writer talking.</p>
      </div>
      <div className="bd-stats">
        <div className="bd-stat">
          <span className="mono">Marker tip, half the time</span>
          <b>{mm(p.reach?.tip[0])}<small>{unit(p.reach?.tip[0])}</small></b>
        </div>
        <div className="bd-stat">
          <span className="mono">95% of the time</span>
          <b>{mm(p.reach?.tip[1])}<small>{unit(p.reach?.tip[1])}</small></b>
        </div>
        <div className="bd-stat">
          <span className="mono">Writing caught</span>
          <b>{pct(p.reach?.recall)}<small>%</small></b>
        </div>
        <div className="bd-stat hot">
          <span className="mono">Loud room: mic alone → with EMG</span>
          <b>{pct(p.loudMic?.recall)}<small>%</small> <i>→</i> {pct(p.loudEmg?.recall)}<small>%</small></b>
        </div>
      </div>
      <table className="bd-table">
        <thead>
          <tr>
            <th className="mono">Scene</th>
            <th className="mono">Tip · median</th>
            <th className="mono">Tip · 95%</th>
            <th className="mono">Caught</th>
            <th className="mono">“On” right</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, r]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{r ? `${mm(r.tip[0])} ${unit(r.tip[0])}` : '…'}</td>
              <td className={r && r.tip[1] > 0.03 ? 'warn' : ''}>{r ? `${mm(r.tip[1])} ${unit(r.tip[1])}` : '…'}</td>
              <td>{r ? `${pct(r.recall)}%` : '…'}</td>
              <td>{r ? `${pct(r.precision)}%` : '…'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bd-left">
        <h3 className="mono">Still to prove on real hardware</h3>
        <ol>
          <li><b>Echoes.</b> A glossy board and a body reflect more than the simulation does. Writing without a pause already shows the weak spot: two pucks hearing echoes at once. A fourth puck would catch it.</li>
          <li><b>A light press.</b> Whether forearm EMG feels a marker on a board through a band, for many people.</li>
          <li><b>Battery.</b> Fifty clicks a second and eight EMG channels on a band’s battery.</li>
        </ol>
      </div>
      <p className="provenance">Every number on this page comes from simulated hardware running through src/board/engine. None is a measurement of a real band. Handwriting decoded from forearm EMG: Meta Reality Labs, “A generic non-invasive neuromotor interface”, Nature 645, 2025 (20.9 words a minute).</p>
    </section>
  )
}

function Close() {
  return (
    <section className="launch" id="close" aria-label="Back to AXIS">
      <FieldCanvas className="launch-field" spacing={34} radius={300} />
      <div className="launch-inner">
        <h2 className="launch-title" data-reveal>
          Every stroke,
          <br />
          <span className="hot">kept.</span>
        </h2>
        <div className="launch-row">
          <a className="btn btn-primary btn-xl" href="#live">
            Watch it again <span aria-hidden="true">↑</span>
          </a>
          <div className="launch-notes mono">
            <p>A concept for the next Vexo band, alongside the AXIS camera prototype. Board, pucks and EMG are proposals; the tracking code is real and runs here.</p>
            <p>
              <a href={ROUTES.site}>AXIS {ROUTES.site}</a> · <a href={ROUTES.pitch}>The pitch {ROUTES.pitch}</a>
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function BoardPage() {
  useEffect(() => {
    installPointer()
    document.documentElement.classList.add('site-root')
    document.title = `${BRAND_NAME} Board — every stroke, kept`
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io.unobserve(e.target)
          }
        }),
      { threshold: 0.2 },
    )
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el))
    return () => {
      io.disconnect()
      document.documentElement.classList.remove('site-root')
    }
  }, [])

  return (
    <div className="site bd">
      <a className="skip mono" href="#live">
        Skip to the live board
      </a>
      <Nav />
      <main>
        <Hero />
        <LiveBoard />
        <How />
        <Hardware />
        <Proof />
        <Close />
      </main>
      <footer className="footer mono">
        <span className="footer-brand">{BRAND_NAME}</span>
        <span>Board · a concept</span>
        <span>VexoHacks 2026</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub ↗
        </a>
      </footer>
    </div>
  )
}
