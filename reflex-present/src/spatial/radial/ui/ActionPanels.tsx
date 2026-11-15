import { useEffect, useRef, useState } from 'react'
import type { SpatialObject } from '../../types'
import { BAND_NUMBER } from '../../wearable/band'
import { askAction, suggestedQuestions } from '../actions/explain'
import type { MemoryEntry } from '../actions/memory'
import { askGemini, BandGeminiProvider, forgetDeepgramKey, hasDeepgramKey, setDeepgramKey, type VoiceProvider, type VoiceProviderId } from '../actions/voice'
import { previewVoiceCommand, type VoiceCommandPreview } from '../actions/voiceCommand'
import type { ExplainCard, ExplainQA, VoiceSession } from '../RadialActionExecutor'

const pct = (v: number) => `${v * 100}%`

/** Providers the user has started once on this page, after reading their notice. Later Voice actions start at once. */
const consented = new Set<VoiceProviderId>()

/** Places a card beside an object: right if there is room, else left; kept on screen. */
function beside(o: SpatialObject, cardW: number) {
  const right = o.x + o.w + 0.015
  const left = right + cardW > 0.98 ? Math.max(0.01, o.x - cardW - 0.015) : right
  return { left: pct(left), top: pct(Math.max(0.02, Math.min(0.62, o.y))), width: pct(cardW) }
}

export function ExplainPanel({
  card,
  object,
  onClose,
  compact = false,
  thread = [],
  onAsk,
  hoverAction = null,
}: {
  card: ExplainCard
  object: SpatialObject
  onClose: () => void
  compact?: boolean
  /** Questions asked on this card so far. */
  thread?: ExplainQA[]
  /** Ask a question about the object; without it the card only summarizes. */
  onAsk?: (question: string) => void
  /** The air control the hand cursor is on, to highlight it. */
  hoverAction?: string | null
}) {
  const [draft, setDraft] = useState('')
  const asked = new Set(thread.map((qa) => qa.question))
  const submit = () => {
    if (!onAsk || !draft.trim()) return
    onAsk(draft)
    setDraft('')
  }
  return (
    <div className="ap-card ap-explain" style={beside(object, 0.24)} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="ap-head">
        <span className="ap-dot" style={{ background: object.color }} />
        <strong>Explain · {object.label}</strong>
        <button className="ap-x" data-air-action={compact ? `close-explain:${card.objectId}` : undefined} onClick={onClose} aria-label="Close explanation">
          ×
        </button>
      </div>
      {card.status === 'loading' && <div className="ap-muted">Working it out from the object’s data…</div>}
      {card.status === 'error' && <div className="ap-error">Explanation failed: {card.message}</div>}
      {card.status === 'done' && thread.length === 0 && (
        <>
          <ul className="ap-facts">
            {(compact && card.explanation.kind === 'note' && card.explanation.facts.length > 1 ? card.explanation.facts.slice(1) : card.explanation.facts).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <div title={card.explanation.provider.label} className={`ap-badge ${card.explanation.provider.kind === 'local' ? 'ap-badge-local' : ''}`}>{compact && card.explanation.provider.kind === 'local' ? 'Local summary' : card.explanation.provider.label}</div>
        </>
      )}
      {thread.map((qa) => (
        <div key={qa.id} className="ap-qa">
          <div className="ap-q">{qa.question}</div>
          {qa.status === 'thinking' && <div className="ap-muted">Thinking…</div>}
          {qa.status === 'error' && <div className="ap-error">{qa.message}</div>}
          {qa.answer && (
            <>
              <p className="ap-a">{qa.answer.text}</p>
              <div className="ap-muted ap-small">{qa.answer.label}</div>
            </>
          )}
        </div>
      ))}
      {onAsk && (
        <>
          <div className="ap-suggest">
            {suggestedQuestions(object).map((q, i) =>
              asked.has(q) ? null : (
                <button key={q} className={compact && hoverAction === askAction(object.id, i) ? 'proximity-active' : undefined} data-air-action={compact ? askAction(object.id, i) : undefined} onClick={() => onAsk(q)}>
                  {q}
                </button>
              ),
            )}
          </div>
          <form
            className="ap-ask"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask anything about this…" aria-label={`Ask about ${object.label.replace(/\n/g, ' ')}`} />
            <button type="submit" disabled={!draft.trim()}>
              Ask
            </button>
          </form>
        </>
      )}
    </div>
  )
}

export function MemoryPanel({ entries, label, highlightId, open, onToggle }: { entries: MemoryEntry[]; label: string; highlightId: string | null; open: boolean; onToggle: () => void }) {
  return (
    <div className={`ap-memory ${open ? '' : 'ap-memory-closed'}`} onMouseDown={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()}>
      <button className="ap-memory-tab" onClick={onToggle}>
        Memory · {entries.length}
      </button>
      {open && (
        <div className="ap-memory-body">
          <div className="ap-muted" style={{ marginBottom: 8 }}>
            {label}
          </div>
          {entries.length === 0 && <div className="ap-muted">Nothing remembered yet. Pinch-hold an object and choose Remember.</div>}
          {entries.map((e) => (
            <div key={e.id} className={`ap-mem ${e.id === highlightId ? 'ap-mem-new' : ''}`}>
              <div>
                <strong>{e.title}</strong> <span className="ap-muted">· {e.type}</span>
              </div>
              <div className="ap-muted">{summarize(e)}</div>
              <div className="ap-muted ap-small">{new Date(e.createdAt).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function summarize(e: MemoryEntry) {
  const c = e.content
  if (!c) return 'no data'
  if (c.kind === 'chart') return c.series.map((p) => `${p.label} ${p.value}`).join(' · ')
  if (c.kind === 'metric') return c.format === 'percent' ? `${(c.value * 100).toFixed(1)}%` : c.value.toLocaleString('en-US')
  return c.text.split('\n')[0]
}

/** Toast shown when Remember saves an entry. */
export function SavedToast({ entry }: { entry: MemoryEntry }) {
  return (
    <div className="ap-saved" key={entry.id}>
      <span className="ap-check">✓</span> Remembered <strong>{entry.title}</strong>
    </div>
  )
}

export function VoiceCapturePanel({
  session,
  object,
  objects,
  providers,
  onClose,
  onConnectBand,
  bandStatus,
  onPaste,
}: {
  session: VoiceSession
  object: SpatialObject
  objects: SpatialObject[]
  providers: VoiceProvider[]
  onClose: () => void
  /** Connect the band from right here (must run in a click: Web Bluetooth needs a user gesture). */
  onConnectBand?: () => void
  bandStatus?: string
  /** Dictation: record, transcribe, then hand the words to this instead of asking for a reply. */
  onPaste?: (text: string) => void
}) {
  const dictate = !!onPaste
  // Voice uses the Vexo band by default: the team band's microphone → Gemini. If the band is not
  // ready the panel says why instead of quietly switching to the laptop's microphone. Dictation
  // only needs words, so it starts on this computer's microphone when the band isn't ready.
  const [providerId, setProviderId] = useState<VoiceProviderId>(() => {
    const band = providers.find((p) => p.id === 'band-gemini')
    const laptop = providers.find((p) => p.id === 'browser' && !p.unavailable())
    if (dictate && laptop && (!band || band.unavailable())) return laptop.id
    return band ? band.id : providers[0].id
  })
  const [phase, setPhase] = useState<'idle' | 'listening' | 'thinking'>('idle')
  const listening = phase === 'listening'
  const [partial, setPartial] = useState('')
  const [final, setFinal] = useState('')
  const [typed, setTyped] = useState('')
  const [reply, setReply] = useState<{ text: string; model: string } | null>(null)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [, force] = useState(0)
  const active = useRef<VoiceProvider | null>(null)
  const provider = providers.find((p) => p.id === providerId)!
  const gemini = provider instanceof BandGeminiProvider ? provider : null
  // The same dev-server endpoint answers words from any provider (browser speech, Deepgram, typed).
  const answerer = providers.find((p): p is BandGeminiProvider => p instanceof BandGeminiProvider) ?? null
  const canAnswer = !!answerer?.status?.configured
  const why = provider.unavailable()
  const [asking, setAsking] = useState(false)
  const askAbort = useRef<AbortController | null>(null)
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const finalRef = useRef('')
  const partialRef = useRef('')
  /** Dictation: true once this recording was pasted or cancelled, so it pastes at most once. */
  const settled = useRef(false)
  const [pasted, setPasted] = useState(false)

  /** Dictation: put what was heard on the slide. */
  const commit = () => {
    if (!onPaste || settled.current) return
    const text = [finalRef.current, partialRef.current].filter(Boolean).join(' ').trim()
    if (!text || /^\(no speech/i.test(text)) return
    settled.current = true
    onPaste(text)
    setPasted(true)
  }

  /** Words from a provider that only transcribes → Gemini for a reply about this object. */
  const ask = (text: string) => {
    const words = text.trim()
    if (!words || !canAnswer) return
    askAbort.current?.abort()
    const abort = new AbortController()
    askAbort.current = abort
    setAsking(true)
    setError(null)
    setReply(null)
    askGemini({ text: words }, { object, objects }, abort.signal)
      .then((a) => !abort.signal.aborted && setReply({ text: a.reply, model: a.model }))
      .catch((e: unknown) => !abort.signal.aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !abort.signal.aborted && setAsking(false))
  }
  /** Deepgram sends several final pieces: ask once the speaker pauses. */
  const askSoon = () => {
    if (askTimer.current) clearTimeout(askTimer.current)
    askTimer.current = setTimeout(() => ask(finalRef.current), 900)
  }
  const cancelAsk = () => {
    if (askTimer.current) clearTimeout(askTimer.current)
    askAbort.current?.abort()
    setAsking(false)
  }

  const start = () => {
    consented.add(provider.id)
    setError(null)
    setPartial('')
    setFinal('')
    setReply(null)
    setLevel(0)
    setPasted(false)
    finalRef.current = ''
    partialRef.current = ''
    settled.current = false
    cancelAsk()
    active.current?.stop()
    active.current = provider
    provider.start(
      {
        onText: (text, isFinal) => {
          if (!isFinal) {
            partialRef.current = text
            return setPartial(text)
          }
          finalRef.current = finalRef.current ? `${finalRef.current} ${text}` : text
          partialRef.current = ''
          setFinal(finalRef.current)
          setPartial('')
          if (!gemini && !dictate) askSoon() // band-gemini answers in the same call
        },
        onState: (s) => {
          setPhase(s === 'stopped' ? 'idle' : s)
          if (s === 'stopped') commit()
        },
        onError: (m) => {
          setError(m)
          setPhase('idle')
        },
        onReply: (r) => !dictate && setReply(r),
        onLevel: setLevel,
      },
      { object, objects, mode: dictate ? 'transcribe' : 'answer' },
    )
  }
  /** Stop without pasting. */
  const stop = () => {
    settled.current = true
    active.current?.stop()
    setPhase('idle')
  }
  /** Dictation: stop recording and paste the words. */
  const finish = () => {
    if (gemini) return gemini.finish() // pastes when Gemini sends the words back
    active.current?.stop()
    // Speech recognition reports 'stopped' after its last words; paste anyway if a provider stays quiet.
    window.setTimeout(commit, 2500)
  }

  useEffect(() => {
    // Re-check the dev server's Gemini key each time the panel opens (the key never comes to the page).
    if (answerer) void answerer.refresh().then(() => force((n) => n + 1))
    if (providerId !== 'typed' && consented.has(providerId) && !provider.unavailable()) start()
    return () => {
      settled.current = true
      active.current?.stop()
      cancelAsk()
    }
    // only when the panel opens for a new session or the provider changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, providerId])

  useEffect(() => {
    if (!pasted) return
    const t = window.setTimeout(onClose, 1200)
    return () => window.clearTimeout(t)
    // onClose is a new function on every frame; the timer must survive re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted])

  const transcript = providerId === 'typed' ? typed : [final, partial].filter(Boolean).join(' ')
  const parsed: VoiceCommandPreview | null = transcript.trim() && !dictate ? previewVoiceCommand(transcript, object, objects) : null
  // The local parser only knows a few commands; a plain question is Gemini's to answer, not an error.
  const preview = parsed && parsed.intent !== 'unknown' ? parsed : null

  return (
    <div className="ap-card ap-voice" style={beside(object, 0.3)} onMouseDown={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="ap-head">
        <span className="ap-dot" style={{ background: object.color }} />
        <strong>{dictate ? 'Voice · dictate onto the slide' : `Voice · about ${session.objectTitle}`}</strong>
        <button className="ap-x" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <select value={providerId} onChange={(e) => (stop(), setProviderId(e.target.value as VoiceProviderId))} className="ap-select">
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {providerId === 'band' && (
        <div className="ap-key">
          {hasDeepgramKey() ? (
            <span className="ap-muted">
              Deepgram key set (this page only){' '}
              <button
                className="ap-link"
                onClick={() => {
                  forgetDeepgramKey()
                  force((n) => n + 1)
                }}
              >
                Forget key
              </button>
            </span>
          ) : (
            <input
              type="password"
              autoComplete="off"
              placeholder="Team Deepgram key, then Enter"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setDeepgramKey(keyInput)
                  setKeyInput('')
                  force((n) => n + 1)
                }
              }}
            />
          )}
        </div>
      )}

      <div className="ap-notice">
        {dictate && gemini ? 'Records the Vexo band’s microphone, which hears everyone near it (its light turns solid blue). When you stop or go quiet, the recording goes to Google Gemini through this laptop to be transcribed.' : provider.notice}
      </div>
      {gemini?.pretend && <div className="ap-warnline">Pretend band: its microphone plays the kit’s sample recording, not your voice.</div>}

      {providerId === 'typed' ? (
        <input
          className="ap-typed"
          autoFocus
          placeholder={dictate ? 'Type the text, then Enter to paste it' : 'Ask about it, then Enter — e.g. "Compare this with last quarter"'}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (!dictate) return ask(typed)
            finalRef.current = typed.trim()
            partialRef.current = ''
            settled.current = false
            commit()
          }}
        />
      ) : gemini ? (
        <div className="ap-row">
          {phase === 'listening' ? (
            <>
              <button className="ap-btn ap-btn-stop" onClick={() => gemini.finish()}>
                <span className="ap-pulse" /> Band {BAND_NUMBER} listening — {dictate ? 'done, paste' : 'done'}
              </button>
              <span className="ap-level" aria-label="Band microphone level">
                <span style={{ width: `${Math.round(level * 100)}%` }} />
              </span>
              <button className="ap-link" onClick={stop}>
                Cancel
              </button>
            </>
          ) : phase === 'thinking' ? (
            <span className="ap-muted">{dictate ? 'Gemini is transcribing…' : 'Gemini is transcribing and answering…'}</span>
          ) : (
            <button className="ap-btn" disabled={!!why} onClick={start}>
              {dictate ? `Record with band ${BAND_NUMBER}` : reply ? 'Speak again' : `Speak into band ${BAND_NUMBER}`}
            </button>
          )}
          {why && phase === 'idle' && <span className="ap-muted">{why}</span>}
          {why && phase === 'idle' && onConnectBand && provider.id.startsWith('band') && bandStatus !== 'connected' && bandStatus !== 'connecting' && (
            <button className="ap-btn" onClick={onConnectBand}>
              Connect band
            </button>
          )}
        </div>
      ) : (
        <div className="ap-row">
          {listening ? (
            <button className="ap-btn ap-btn-stop" onClick={dictate ? finish : stop}>
              <span className="ap-pulse" /> {dictate ? 'Listening — stop and paste' : 'Listening — stop'}
            </button>
          ) : (
            <button className="ap-btn" disabled={!!why} onClick={start}>
              {dictate ? 'Start recording' : 'Start listening'}
            </button>
          )}
          {listening && dictate && (
            <button className="ap-link" onClick={stop}>
              Cancel
            </button>
          )}
          {why && <span className="ap-muted">{why}</span>}
        </div>
      )}
      {error && <div className="ap-error">{error}</div>}

      {providerId !== 'typed' && (
        <div className="ap-transcript">
          {final && <span>{final} </span>}
          {partial && <span className="ap-partial">{partial}</span>}
          {!final && !partial && (
            <span className="ap-muted">
              {dictate ? 'Speak; your words go onto the slide when you stop or pause.' : gemini ? 'What you said appears here when you finish (or go quiet).' : 'Transcript appears here.'}
            </span>
          )}
        </div>
      )}
      {pasted && (
        <div className="ap-pasted" role="status">
          <span className="ap-check">✓</span> Pasted on the slide
        </div>
      )}

      {!dictate && !gemini && canAnswer && providerId !== 'typed' && <div className="ap-muted ap-small">The words and this object’s data are then sent to Google Gemini for a reply.</div>}
      {!dictate && transcript.trim() && answerer?.status && !canAnswer && phase === 'idle' && (
        <div className="ap-warnline">No reply: {answerer.status.offline ? 'the Gemini endpoint is not running (start the app with npm run dev).' : 'there is no Gemini key on this laptop. Put GEMINI_API_KEY=... in reflex-present/.env and restart npm run dev.'}</div>
      )}
      {asking && <div className="ap-muted">Gemini is answering…</div>}
      {reply && (
        <div className="ap-reply" role="status">
          <div className="ap-muted ap-small">Gemini{reply.model ? ` · ${reply.model}` : ''} · {gemini ? `heard through band ${BAND_NUMBER}` : providerId === 'typed' ? 'typed' : 'from the transcript'}</div>
          <div className="ap-reply-text">{reply.text}</div>
        </div>
      )}

      {preview && (
        <div className="ap-preview">
          <div className="ap-muted ap-small">Command preview — not executed</div>
          <div>
            <b>{preview.intent}</b> → {preview.objectTitles.join(', ')}
          </div>
          {Object.keys(preview.parameters).length > 0 && <div className="ap-muted">{JSON.stringify(preview.parameters)}</div>}
          {preview.computed && <div className="ap-computed">{preview.computed}</div>}
          {preview.requiresClarification && <div className="ap-warnline">{preview.clarificationPrompt}</div>}
        </div>
      )}
    </div>
  )
}
