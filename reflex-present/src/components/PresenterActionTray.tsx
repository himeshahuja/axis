import { useEffect, useState } from 'react'
import { forgetDeepgramKey, hasDeepgramKey, setDeepgramKey, type VoiceProvider, type VoiceProviderId } from '../spatial/radial/actions/voice'

export function PresenterActionTray({ providers, onClose, onPlace, onConnectBand }: {
  providers: VoiceProvider[]
  onClose: () => void
  onPlace: (text: string) => void
  onConnectBand: (link: 'serial' | 'ble') => void
}) {
  const [providerId, setProviderId] = useState<VoiceProviderId>(() => hasDeepgramKey() ? 'band' : 'browser')
  const [keyInput, setKeyInput] = useState('')
  const [transcript, setTranscript] = useState('')
  const [partial, setPartial] = useState('')
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, refresh] = useState(0)
  const provider = providers.find((item) => item.id === providerId) ?? providers[0]
  const unavailable = provider.unavailable()

  useEffect(() => () => provider.stop(), [provider])

  const start = () => {
    setError(null)
    setPartial('')
    provider.start({
      onText: (text, isFinal) => {
        if (isFinal) {
          setTranscript((previous) => [previous, text].filter(Boolean).join(' ').trim())
          setPartial('')
        } else setPartial(text)
      },
      onState: (state) => setListening(state === 'listening'),
      onError: (message) => { setError(message); setListening(false) },
    })
  }

  const stop = () => {
    provider.stop()
    setListening(false)
    setPartial('')
  }

  return (
    <section className="presenter-action-tray" role="dialog" aria-label="Actions" onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
      <header className="pat-head">
        <div><span>SLIDE ACTIONS</span><strong>Transcribe and place text</strong></div>
        <button className="pat-close" onClick={onClose} aria-label="Close actions">×</button>
      </header>

      <label className="pat-label" htmlFor="pat-provider">Microphone source</label>
      <select id="pat-provider" value={providerId} onChange={(event) => { stop(); setProviderId(event.target.value as VoiceProviderId) }}>
        <option value="browser">Computer microphone</option>
        <option value="band">Vexo band microphone</option>
      </select>

      {providerId === 'band' && (
        <div className="pat-key">
          {hasDeepgramKey() ? <span>Deepgram key is held in this page only. <button onClick={() => { forgetDeepgramKey(); refresh((n) => n + 1) }}>Forget key</button></span> : <>
            <input type="password" autoComplete="off" placeholder="Team Deepgram key" value={keyInput} onChange={(event) => setKeyInput(event.target.value)} onKeyDown={(event) => {
              if (event.key === 'Enter' && keyInput.trim()) { setDeepgramKey(keyInput); setKeyInput(''); refresh((n) => n + 1) }
            }} />
            <button disabled={!keyInput.trim()} onClick={() => { setDeepgramKey(keyInput); setKeyInput(''); refresh((n) => n + 1) }}>Save for this page</button>
          </>}
        </div>
      )}

      <p className="pat-notice">{provider.notice}</p>
      {providerId === 'band' && unavailable?.includes('Connect band first') && <div className="pat-connect">
        <span>Connect Vexo 75 to use its microphone.</span>
        <button onClick={() => onConnectBand('serial')}>Connect USB</button>
        <button onClick={() => onConnectBand('ble')}>Connect Bluetooth</button>
      </div>}
      {error && <p className="pat-error" role="alert">{error}</p>}
      <div className="pat-row">
        {listening ? <button className="pat-primary pat-stop" onClick={stop}>Stop listening</button> : <button className="pat-primary" disabled={!!unavailable} onClick={start}>Start listening</button>}
        {unavailable && <span className="pat-muted">{unavailable}</span>}
      </div>

      <label className="pat-label" htmlFor="pat-transcript">Transcript</label>
      <textarea id="pat-transcript" value={transcript} onChange={(event) => setTranscript(event.target.value)} placeholder="Your words will appear here. You can edit them before placing." />
      {partial && <div className="pat-partial">{partial}</div>}
      <footer className="pat-footer">
        <button onClick={() => { setTranscript(''); setPartial(''); setError(null) }} disabled={!transcript && !partial}>Clear</button>
        <button className="pat-primary" onClick={() => onPlace(transcript.trim())} disabled={!transcript.trim()}>Place on slide</button>
      </footer>
      <p className="pat-footnote">Choose “Place on slide,” then move the cursor and close your hand or click anywhere on this slide.</p>
    </section>
  )
}
