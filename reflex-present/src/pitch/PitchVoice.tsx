// Voice in the pitch: a compact bar, not a form. It starts listening through the band at
// once, shows a live level and the words, and ends hands-free: tap the band, close your
// hand, or simply stop talking. One small line still says where the sound goes. Once the
// words are in, the stage puts them on a card and closes this (see PitchStage).

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { VoiceProvider } from '../spatial/radial/actions/voice'
import type { VoiceSession } from '../spatial/radial/RadialActionExecutor'
import type { SpatialRuntime } from '../spatial/runtime'
import type { SpatialObject } from '../spatial/types'
import { BAND_NUMBER } from '../spatial/wearable/band'

const BARS = 18
/** After speech, this long under the room's own noise level counts as "done talking". */
const QUIET_MS = 1100
/** However noisy the room, a recording ends (and sends) after this long. */
const MAX_MS = 15000

type Phase = 'waiting' | 'listening' | 'thinking' | 'answered' | 'error'

interface Finishable extends VoiceProvider {
  finish?: () => void
  recording?: boolean
}

export function PitchVoice({
  rt,
  session,
  object,
  finishRef,
  onRecording,
}: {
  rt: SpatialRuntime
  session: VoiceSession
  object: SpatialObject
  /** The stage calls this when the presenter closes their hand. */
  finishRef: React.MutableRefObject<(() => void) | null>
  onRecording: (on: boolean) => void
}) {
  const providers = rt.radial.voiceProviders as Finishable[]
  const provider = (['band-gemini', 'laptop-gemini', 'browser'] as const).map((id) => providers.find((p) => p.id === id && !p.unavailable())).find(Boolean) ?? null
  const reason = providers.find((p) => p.id === 'band-gemini')?.unavailable() ?? null
  const [phase, setPhase] = useState<Phase>('waiting')
  const [words, setWords] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0))
  const active = useRef<Finishable | null>(null)
  const quiet = useRef({ floor: 1, heard: false, quietSince: 0 })

  const finish = () => {
    const p = active.current
    if (p?.finish) p.finish()
    else p?.stop()
  }
  finishRef.current = phase === 'listening' ? finish : null

  // Start as soon as a microphone is ready (now, or once the band connects).
  useEffect(() => {
    if (!provider) return
    active.current = provider
    quiet.current = { floor: 1, heard: false, quietSince: 0 }
    provider.start(
      {
        onText: (t, final) => {
          setWords(t)
          if (final) setPhase((p) => (p === 'answered' ? p : 'thinking'))
        },
        onState: (s) => {
          if (s === 'listening') {
            setPhase('listening')
            onRecording(true)
          } else {
            onRecording(false)
            if (s === 'thinking') setPhase('thinking')
          }
        },
        onError: (m) => {
          onRecording(false)
          setError(m)
          setPhase('error')
        },
        onReply: (r) => {
          setReply(r.text)
          setPhase('answered')
        },
        onLevel: (level) => {
          setLevels((l) => [...l.slice(1), level])
          // Adaptive end of speech: the band hears the room, so "quiet" is relative to it.
          const q = quiet.current
          const now = performance.now()
          q.floor = Math.min(level, q.floor * 0.995 + level * 0.005)
          const loud = level > q.floor * 1.8 + 0.06
          if (loud) {
            q.heard = true
            q.quietSince = 0
          } else if (q.heard) {
            q.quietSince ||= now
            if (now - q.quietSince > QUIET_MS) finish()
          }
        },
      },
      // A question for Explain only needs the words: Explain answers it, not the Voice reply.
      { object, objects: rt.interaction.objects, mode: session.ask ? 'transcribe' : undefined },
    )
    return () => {
      provider.stop()
      onRecording(false)
    }
    // one recording per Voice session (and once the provider becomes available)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, provider?.id])

  useEffect(() => {
    if (phase !== 'listening') return
    const id = window.setTimeout(finish, MAX_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Tap the band to send: the band's own tap gesture, no screen needed.
  const band = rt.radial.band?.band as unknown as { on?: (t: string, fn: () => void) => () => void; configure?: (o: Record<string, unknown>) => Promise<unknown> } | undefined
  useEffect(() => {
    if (!band?.on || phase !== 'listening') return
    void band.configure?.({ events: true }).catch(() => {})
    const offs = ['tap', 'double-tap'].map((t) => band.on!(t, () => finish()))
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, phase])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && phase === 'listening') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish()
      } else if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        rt.radial.executor.closeVoice()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Beside the object, kept on the stage.
  const w = 0.25
  const right = object.x + object.w + 0.015
  const left = right + w > 0.97 ? Math.max(0.03, object.x - w - 0.015) : right
  const top = Math.max(0.2, Math.min(0.66, object.y + 0.02))
  // A question for Explain is drawn inside the card, in the slot it keeps for it.
  const slot = session.ask ? document.querySelector<HTMLElement>(`[data-voice-slot="${CSS.escape(object.id)}"]`) : null
  if (session.ask && !slot) return null

  const panel = (
    <div className={`pitch-voice is-${phase} ${slot ? 'is-inline' : ''}`} style={slot ? undefined : { left: `${left * 100}%`, top: `${top * 100}%`, width: `${w * 100}%` }} onMouseDown={(e) => e.stopPropagation()}>
      <header>
        <span className="dot" />
        <strong>{phase === 'thinking' ? 'Thinking' : phase === 'answered' ? 'Answer' : phase === 'error' ? 'Couldn’t hear it' : phase === 'waiting' ? (session.ask ? 'Ask' : 'Voice') : 'Listening'}</strong>
        <button className="x" data-air-action="close-voice" onClick={() => rt.radial.executor.closeVoice()} aria-label="Close">
          ×
        </button>
      </header>

      {!provider ? (
        <div className="need">
          <p>{reason ?? 'No microphone is ready.'}</p>
          <button className="pitch-chrome-btn" onClick={() => rt.radial.connectBand('ble')}>
            Connect band {BAND_NUMBER}
          </button>
        </div>
      ) : (
        <>
          <div className="meter" aria-hidden="true">
            {levels.map((l, i) => (
              <i key={i} style={{ transform: `scaleY(${phase === 'listening' ? 0.08 + Math.min(1, l) * 0.92 : 0.08})` }} />
            ))}
          </div>
          {words && <p className="words">“{words}”</p>}
          {reply && <p className="reply">{reply}</p>}
          {error && <p className="err">{error}</p>}
          {phase === 'listening' && <p className="how">Tap the band, close your hand, or pause to send</p>}
        </>
      )}
      <footer>{provider?.id === 'band-gemini' ? `Band ${BAND_NUMBER} mic → Gemini` : provider?.id === 'laptop-gemini' ? 'Laptop mic → Gemini' : provider ? 'Laptop mic → Google' : ''}</footer>
    </div>
  )
  return slot ? createPortal(panel, slot) : panel
}
