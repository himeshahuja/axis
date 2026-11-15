// Voice, on the website: a command bound to the selected object, resolved by
// the app's own deterministic resolver (previewVoiceCommand). The waveform is
// the real microphone level when permitted; otherwise a labelled demo signal.
// No speech is transcribed or sent anywhere from this page.

import { useEffect, useRef, useState } from 'react'
import { previewVoiceCommand, type VoiceCommandPreview } from '../spatial/radial/actions/voiceCommand'
import { fitCanvas } from './motion'
import { SITE_OBJECTS, type SiteObject } from './objects'

const SUGGEST: Record<string, string[]> = {
  chart: ['compare this to last quarter', 'what if this grows by 15%', 'summarize this'],
  metric: ['summarize this', 'highlight the biggest change'],
  note: ['summarize this'],
}

type MicState = 'off' | 'starting' | 'live' | 'demo'

function MicWave() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<MicState>('off')
  const [why, setWhy] = useState('')
  const audio = useRef<{ ctx: AudioContext; stream: MediaStream; an: AnalyserNode } | null>(null)

  useEffect(() => {
    let raf = 0
    const buf = new Uint8Array(1024)
    const draw = (t: number) => {
      const c = canvas.current
      if (c) {
        const { w, h, ctx } = fitCanvas(c)
        ctx.clearRect(0, 0, w, h)
        ctx.strokeStyle = 'rgba(242,240,235,0.12)'
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        ctx.beginPath()
        const a = audio.current
        if (a) a.an.getByteTimeDomainData(buf)
        const n = 96
        for (let i = 0; i <= n; i++) {
          let v = 0
          if (a) v = (buf[Math.floor((i / n) * (buf.length - 1))] - 128) / 128
          else if (state === 'demo') v = Math.sin(i * 0.5 + t * 0.008) * 0.35 * Math.sin((i / n) * Math.PI) * (0.6 + 0.4 * Math.sin(t * 0.002))
          const x = (i / n) * w
          const y = h / 2 + v * h * 0.9
          if (i) ctx.lineTo(x, y)
          else ctx.moveTo(x, y)
        }
        ctx.strokeStyle = state === 'live' ? '#FF5A1F' : 'rgba(242,240,235,0.6)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [state])

  useEffect(
    () => () => {
      const a = audio.current
      if (a) {
        a.stream.getTracks().forEach((t) => t.stop())
        a.ctx.close()
        audio.current = null
      }
    },
    [],
  )

  const start = async () => {
    if (state === 'live') {
      const a = audio.current
      a?.stream.getTracks().forEach((t) => t.stop())
      a?.ctx.close()
      audio.current = null
      setState('off')
      return
    }
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(an)
      audio.current = { ctx, stream, an }
      setState('live')
    } catch (e) {
      setWhy(e instanceof Error ? e.message : 'not available')
      setState('demo')
    }
  }

  return (
    <div className="mic">
      <canvas ref={canvas} className="mic-wave" aria-hidden="true" />
      <div className="mic-row mono">
        <button type="button" className={`chip ${state === 'live' ? 'hot' : ''}`} onClick={start}>
          {state === 'live' ? 'Stop microphone' : state === 'starting' ? 'Asking…' : 'Use microphone'}
        </button>
        <span>
          {state === 'live'
            ? 'Live mic level · stays in this browser · not transcribed'
            : state === 'demo'
              ? `Demo signal, not your voice (mic ${why.toLowerCase()})`
              : 'Optional · level meter only'}
        </span>
      </div>
    </div>
  )
}

export function VoiceConsole({ obj, all = SITE_OBJECTS, autoFocus = false }: { obj: SiteObject; all?: SiteObject[]; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<VoiceCommandPreview | null>(null)
  const kind = obj.content?.kind ?? 'note'
  const submit = (t: string) => {
    if (!t.trim()) return
    setText(t)
    setResult(previewVoiceCommand(t, obj, all))
  }
  return (
    <div className="voice">
      <div className="voice-context mono">
        <span className="dot" /> Context · {obj.label} <em>({kind})</em>
      </div>
      <MicWave />
      <form
        className="voice-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit(text)
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type what you’d say…" aria-label={`Command about ${obj.label}`} autoFocus={autoFocus} />
        <button type="submit" className="chip hot">
          Resolve
        </button>
      </form>
      <div className="voice-suggest">
        {(obj.id === 'revenue' ? SUGGEST.chart : kind === 'chart' ? ['what if this grows by 15%', 'highlight the biggest change', 'summarize this'] : (SUGGEST[kind] ?? SUGGEST.note)).map((s) => (
          <button key={s} type="button" className="chip" onClick={() => submit(s)}>
            “{s}”
          </button>
        ))}
      </div>
      {result && (
        <dl className="voice-result mono">
          <dt>Heard</dt>
          <dd>{result.transcript}</dd>
          <dt>Bound</dt>
          <dd>{result.bound}</dd>
          <dt>Intent</dt>
          <dd className="hot">{result.intent}</dd>
          <dt>Objects</dt>
          <dd>{result.objectTitles.join(', ')}</dd>
          {result.computed && (
            <>
              <dt>Result</dt>
              <dd>{result.computed}</dd>
            </>
          )}
          {result.requiresClarification && (
            <>
              <dt>Asks</dt>
              <dd>{result.clarificationPrompt}</dd>
            </>
          )}
        </dl>
      )}
      <p className="provenance mono">Preview: resolved by the app’s deterministic resolver. Nothing is executed, and no AI model is called.</p>
    </div>
  )
}
