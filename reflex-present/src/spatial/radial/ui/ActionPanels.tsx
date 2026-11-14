import { useEffect, useRef, useState } from 'react'
import type { SpatialObject } from '../../types'
import type { MemoryEntry } from '../actions/memory'
import { forgetDeepgramKey, hasDeepgramKey, setDeepgramKey, type VoiceProvider, type VoiceProviderId } from '../actions/voice'
import { previewVoiceCommand, type VoiceCommandPreview } from '../actions/voiceCommand'
import type { ExplainCard, VoiceSession } from '../RadialActionExecutor'

const pct = (v: number) => `${v * 100}%`

/** Providers the user has started once on this page, after reading their notice. Later Voice actions start at once. */
const consented = new Set<VoiceProviderId>()

/** Places a card beside an object: right if there is room, else left; kept on screen. */
function beside(o: SpatialObject, cardW: number) {
  const right = o.x + o.w + 0.015
  const left = right + cardW > 0.98 ? Math.max(0.01, o.x - cardW - 0.015) : right
  return { left: pct(left), top: pct(Math.max(0.02, Math.min(0.62, o.y))), width: pct(cardW) }
}

export function ExplainPanel({ card, object, onClose, compact = false }: { card: ExplainCard; object: SpatialObject; onClose: () => void; compact?: boolean }) {
  return (
    <div className="ap-card ap-explain" style={beside(object, 0.24)} onMouseDown={(e) => e.stopPropagation()}>
      <div className="ap-head">
        <span className="ap-dot" style={{ background: object.color }} />
        <strong>Explain · {object.label}</strong>
        <button className="ap-x" data-air-action={compact ? `close-explain:${card.objectId}` : undefined} onClick={onClose} aria-label="Close explanation">
          ×
        </button>
      </div>
      {card.status === 'loading' && <div className="ap-muted">Working it out from the object’s data…</div>}
      {card.status === 'error' && <div className="ap-error">Explanation failed: {card.message}</div>}
      {card.status === 'done' && (
        <>
          <ul className="ap-facts">
            {(compact && card.explanation.kind === 'note' && card.explanation.facts.length > 1 ? card.explanation.facts.slice(1) : card.explanation.facts).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <div title={card.explanation.provider.label} className={`ap-badge ${card.explanation.provider.kind === 'local' ? 'ap-badge-local' : ''}`}>{compact && card.explanation.provider.kind === 'local' ? 'Local summary' : card.explanation.provider.label}</div>
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
}: {
  session: VoiceSession
  object: SpatialObject
  objects: SpatialObject[]
  providers: VoiceProvider[]
  onClose: () => void
}) {
  const [providerId, setProviderId] = useState<VoiceProviderId>(() => {
    const b = providers.find((p) => p.id === 'band')
    return b && !b.unavailable() ? 'band' : 'browser'
  })
  const [listening, setListening] = useState(false)
  const [partial, setPartial] = useState('')
  const [final, setFinal] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [, force] = useState(0)
  const active = useRef<VoiceProvider | null>(null)
  const provider = providers.find((p) => p.id === providerId)!
  const why = provider.unavailable()

  const start = () => {
    consented.add(provider.id)
    setError(null)
    setPartial('')
    setFinal('')
    active.current?.stop()
    active.current = provider
    provider.start({
      onText: (text, isFinal) => (isFinal ? (setFinal((f) => (f ? `${f} ${text}` : text)), setPartial('')) : setPartial(text)),
      onState: (s) => setListening(s === 'listening'),
      onError: (m) => {
        setError(m)
        setListening(false)
      },
    })
  }
  const stop = () => {
    active.current?.stop()
    setListening(false)
  }

  useEffect(() => {
    if (providerId !== 'typed' && consented.has(providerId) && !provider.unavailable()) start()
    return () => active.current?.stop()
    // only when the panel opens for a new session or the provider changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, providerId])

  const transcript = providerId === 'typed' ? typed : [final, partial].filter(Boolean).join(' ')
  const preview: VoiceCommandPreview | null = transcript.trim() ? previewVoiceCommand(transcript, object, objects) : null

  return (
    <div className="ap-card ap-voice" style={beside(object, 0.3)} onMouseDown={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="ap-head">
        <span className="ap-dot" style={{ background: object.color }} />
        <strong>Voice · about {session.objectTitle}</strong>
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

      <div className="ap-notice">{provider.notice}</div>

      {providerId === 'typed' ? (
        <input className="ap-typed" autoFocus placeholder='e.g. "Compare this with last quarter"' value={typed} onChange={(e) => setTyped(e.target.value)} />
      ) : (
        <div className="ap-row">
          {listening ? (
            <button className="ap-btn ap-btn-stop" onClick={stop}>
              <span className="ap-pulse" /> Listening — stop
            </button>
          ) : (
            <button className="ap-btn" disabled={!!why} onClick={start}>
              Start listening
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
          {!final && !partial && <span className="ap-muted">Transcript appears here.</span>}
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
