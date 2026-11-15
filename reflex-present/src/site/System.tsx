// "How it works": the stack as a left-to-right pipeline. An example trace walks
// one gesture through each stage. Module names are the real ones in
// src/spatial and src/engine; the traces are illustrative and labelled so.

import { useEffect, useRef, useState } from 'react'
import { reducedMotion } from './motion'

const INPUTS = [
  { name: 'Camera', detail: 'Hand landmarks', status: 'Live demo' },
  { name: 'Vexo band', detail: 'Wrist rotation', status: 'Needs band' },
  { name: 'Mouse & touch', detail: 'Pointer events', status: 'This page' },
  { name: 'Voice', detail: 'Mic or typed', status: 'Preview' },
]

const STAGES = [
  { key: 'perception', title: 'Perception', question: 'Where is the hand, and what is it doing?', mods: ['HandTracker', 'GestureDetector', 'SensorFusion', 'Calibration'] },
  { key: 'intent', title: 'Intent', question: 'What does that mean, here?', mods: ['InteractionEngine', 'RadialMenuController', 'WristRotationMapper', 'Resolver'] },
  { key: 'execution', title: 'Execution', question: 'Do it.', mods: ['Canvas', 'Explain', 'Memory', 'Voice preview'] },
]

interface Trace {
  label: string
  input: number
  steps: [string, string, string, string]
}

const TRACES: Trace[] = [
  { label: 'Pinch and drag', input: 0, steps: ['Thumb meets index finger', 'Pinch closed, pointer at (0.36, 0.38)', 'Grab “Quarterly Revenue”, dragging', 'Object follows the hand'] },
  { label: 'Turn to choose', input: 1, steps: ['Wrist turns clockwise', 'Rotation integrated to +32°', 'Menu open on the chart; +32° selects Remember', 'Memory card saved in this browser'] },
  { label: 'Hold to explain', input: 2, steps: ['Button held still for 0.6 s', 'Press held, no movement', 'Menu opens; release on Explain', 'Five facts computed from the chart’s data'] },
  { label: 'Say it', input: 3, steps: ['“Compare this to last quarter”', 'Transcript, bound to the selected chart', 'Intent: compare · object: Quarterly Revenue', 'Q4 210 vs Q3 180: +30 (+16.7%)'] },
]

const STEP_MS = 1300

export function System() {
  const root = useRef<HTMLElement>(null)
  const [trace, setTrace] = useState(0)
  const [stage, setStage] = useState(0)
  const [auto, setAuto] = useState(true)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.25 })
    io.observe(root.current!)
    if (reducedMotion()) setAuto(false)
    return () => io.disconnect()
  }, [])

  // Walk the trace through the four stages, pause, then move to the next trace.
  useEffect(() => {
    if (!auto || !visible) return
    const id = window.setTimeout(
      () => {
        if (stage < 4) setStage(stage + 1)
        else {
          setStage(0)
          setTrace((t) => (t + 1) % TRACES.length)
        }
      },
      stage === 4 ? STEP_MS * 1.8 : STEP_MS,
    )
    return () => window.clearTimeout(id)
  }, [auto, visible, stage])

  const t = TRACES[trace]
  const pick = (i: number) => {
    setAuto(false)
    setTrace(i)
    setStage(4)
  }

  return (
    <section ref={root} className="system" id="system" aria-label="How it works">
      <div className="system-head">
        <h2 className="system-title" data-reveal>
          One engine.
          <br />
          Any hand.
        </h2>
        <p className="system-lede">A camera, a wristband, a mouse and your voice each report the same few things: where you’re pointing, grab, release, turn. Everything after that is shared, so a new input only has to speak that language.</p>
      </div>

      <div className="trace-picker" role="tablist" aria-label="Example trace">
        <span className="mono">Example trace</span>
        {TRACES.map((tr, i) => (
          <button key={tr.label} role="tab" aria-selected={trace === i} className={`chip ${trace === i ? 'hot' : ''}`} onClick={() => pick(i)}>
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
            <h3>Input</h3>
          </header>
          <p className="pipe-q">Anything that can point, grab or turn.</p>
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
            <li key={s.key} className={`pipe-col ${stage >= at ? 'lit' : ''} ${stage === at ? 'now' : ''}`}>
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
      <p className="provenance system-note">Module names are the real ones in the codebase. The traces are illustrative walkthroughs; the playground above runs the actual menu logic.</p>
    </section>
  )
}
