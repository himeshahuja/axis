import { useState } from 'react'
import { currentRoute } from './base'
import { PresentationBoard } from './components/PresentationBoard'
import { sampleSlide } from './data/sampleDeck'
import { execute } from './engine/actions'
import { logDecision, route, telemetry } from './engine/router'
import { resolve } from './engine/resolver'
import type { CommandInput, Slide } from './types'
import { SlideObjectView } from './components/SlideObjectView'
import { CommandBar } from './components/CommandBar'

interface LogEntry {
  text: string
  source: string
  route: string
  message?: string
}

function App() {
  // The command prototype remains available at /command-demo; the default is
  // the presenter surface used for the hackathon demo.
  return currentRoute() === '/command-demo' ? <CommandDemo /> : <PresentationBoard />
}

function CommandDemo() {
  const [slide, setSlide] = useState<Slide>(sampleSlide)
  const [highlighted, setHighlighted] = useState<string[]>([])
  const [log, setLog] = useState<LogEntry[]>([])

  function handleCommand(cmd: CommandInput) {
    const started = performance.now()
    const intent = resolve(cmd.text, slide)
    const routeKind = route(intent)
    let message = intent.clarificationPrompt

    if (routeKind === 'DIRECT') {
      const result = execute(intent, slide)
      setHighlighted(result.highlightIds)
      message = result.message
      if (result.newObjects?.length) {
        setSlide((s) => ({ ...s, objects: [...s.objects, ...result.newObjects!] }))
      }
    } else {
      setHighlighted(intent.objectIds)
    }

    logDecision(cmd.text, routeKind, performance.now() - started, routeKind === 'DIRECT')
    setLog((l) => [{ text: cmd.text, source: cmd.source, route: routeKind, message }, ...l].slice(0, 6))
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0c0d12', color: '#e8e9ee', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Reflex Present — {slide.title}</h1>
        <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 13 }}>
          Voice or typed command → semantic resolution → highlight → deterministic transform
        </p>
      </header>

      <div style={{ position: 'relative', height: 620, background: '#14161d', borderRadius: 12, border: '1px solid #262a35', overflow: 'hidden' }}>
        {slide.objects.map((obj) => (
          <SlideObjectView key={obj.id} obj={obj} highlighted={highlighted.includes(obj.id)} />
        ))}
      </div>

      <div style={{ marginTop: 16 }}>
        <CommandBar onCommand={handleCommand} />
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 24 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 13, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent commands</h3>
          {log.length === 0 && <div style={{ opacity: 0.4, fontSize: 13 }}>Nothing yet — try a command above.</div>}
          {log.map((entry, i) => (
            <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: '1px solid #20232c' }}>
              <span style={{ opacity: 0.5 }}>[{entry.source}/{entry.route}]</span> {entry.text}
              {entry.message && <div style={{ opacity: 0.7, marginTop: 2 }}>→ {entry.message}</div>}
            </div>
          ))}
        </div>
        <div style={{ width: 220 }}>
          <h3 style={{ fontSize: 13, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Router telemetry</h3>
          <div style={{ fontSize: 13 }}>
            <div>Commands: {telemetry.length}</div>
            <div>Direct (no LLM): {telemetry.filter((t) => t.route === 'DIRECT').length}</div>
            <div>Clarify: {telemetry.filter((t) => t.route === 'CLARIFY').length}</div>
            <div>Avg latency: {telemetry.length ? Math.round(telemetry.reduce((a, t) => a + t.latencyMs, 0) / telemetry.length) : 0}ms</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
