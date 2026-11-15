// Ask an Explain card by voice, right inside the card: tap, speak, pause. The words go to
// Gemini to be written down (the band's microphone when it is connected, else this computer's),
// then the card asks the agent exactly as if they had been typed.

import { useEffect, useRef, useState } from 'react'
import type { SpatialObject } from '../../types'
import { BAND_NUMBER } from '../../wearable/band'
import type { VoiceProvider } from '../actions/voice'

type Phase = 'idle' | 'starting' | 'listening' | 'transcribing'

interface Finishable extends VoiceProvider {
  finish?: () => void
}

/** Band → laptop (both through Gemini) → the browser's own speech recognition. */
function pickVoiceProvider(providers: VoiceProvider[]): Finishable | null {
  const ready = (id: string) => providers.find((p) => p.id === id && !p.unavailable()) ?? null
  return ready('band-gemini') ?? ready('laptop-gemini') ?? ready('browser')
}

const source = (p: VoiceProvider | null) => (p?.id === 'band-gemini' ? `band ${BAND_NUMBER} mic → Gemini` : p?.id === 'laptop-gemini' ? 'laptop mic → Gemini' : p?.id === 'browser' ? 'laptop mic → browser speech' : '')

export function ExplainMic({ providers, object, objects, onQuestion, airAction }: { providers: VoiceProvider[]; object: SpatialObject; objects: SpatialObject[]; onQuestion: (q: string) => void; airAction?: string }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [words, setWords] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [using, setUsing] = useState<VoiceProvider | null>(null)
  const active = useRef<Finishable | null>(null)
  const asked = useRef(false)

  useEffect(() => () => active.current?.stop(), [])

  const start = () => {
    const p = pickVoiceProvider(providers)
    if (!p) {
      const why = providers.find((x) => x.id === 'laptop-gemini')?.unavailable() ?? providers.find((x) => x.id === 'browser')?.unavailable()
      return setError(why ?? 'No microphone is ready.')
    }
    active.current?.stop()
    active.current = p
    setUsing(p)
    asked.current = false
    setError(null)
    setWords('')
    setLevel(0)
    setPhase('starting')
    p.start(
      {
        onText: (t, final) => {
          setWords(t)
          if (!final || asked.current) return
          const q = t.trim()
          if (!q || /^\(no speech/i.test(q)) {
            setError('No speech was heard. Tap and try again.')
            return setPhase('idle')
          }
          asked.current = true
          setPhase('idle')
          onQuestion(q)
        },
        onState: (s) => setPhase((now) => (s === 'listening' ? 'listening' : s === 'thinking' ? 'transcribing' : now === 'transcribing' && !asked.current ? 'transcribing' : 'idle')),
        onError: (m) => {
          setError(m)
          setPhase('idle')
        },
        onLevel: setLevel,
      },
      // Only the words are needed: the agent answers, with the screenshot and the tools.
      { object, objects, mode: 'transcribe' },
    )
  }

  const send = () => {
    const p = active.current
    if (p?.finish) p.finish()
    else p?.stop()
  }
  const cancel = () => {
    active.current?.stop()
    active.current = null
    setPhase('idle')
  }

  if (phase === 'listening' || phase === 'starting')
    return (
      <div className="ag-mic is-listening">
        <button className="ag-mic-btn" data-air-action={airAction} onClick={send}>
          <span className="ap-pulse" /> {phase === 'starting' ? 'Opening the microphone…' : 'Listening · pause or tap to send'}
        </button>
        <span className="ap-level" aria-label="Microphone level">
          <span style={{ width: `${Math.round(level * 100)}%` }} />
        </span>
        <button className="ap-link" onClick={cancel}>
          Cancel
        </button>
        {words && <div className="ag-mic-words">“{words}”</div>}
        <div className="ap-muted ap-small">{source(using)}</div>
      </div>
    )
  if (phase === 'transcribing')
    return (
      <div className="ag-mic">
        <span className="ap-muted">Writing down what you said…</span>
      </div>
    )
  return (
    <div className="ag-mic">
      <button className="ap-voice-ask" data-air-action={airAction} onClick={start}>
        Ask with your voice
      </button>
      {error && <div className="ap-error">{error}</div>}
    </div>
  )
}
