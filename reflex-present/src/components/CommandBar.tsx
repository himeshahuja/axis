import { useEffect, useRef, useState } from 'react'
import type { CommandInput } from '../types'

// Minimal ambient typing for the Web Speech API (not in standard lib.dom yet).
interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((ev: Event) => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition as new () => SpeechRecognitionLike) || (w.webkitSpeechRecognition as new () => SpeechRecognitionLike) || null
}

export function CommandBar({ onCommand }: { onCommand: (cmd: CommandInput) => void }) {
  const [text, setText] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  useEffect(() => {
    setVoiceSupported(getSpeechRecognition() !== null)
  }, [])

  function submit(value: string, source: CommandInput['source']) {
    const trimmed = value.trim()
    if (!trimmed) return
    onCommand({ source, timestamp: Date.now(), text: trimmed })
    setText('')
  }

  function toggleVoice() {
    const Ctor = getSpeechRecognition()
    if (!Ctor) return
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const recognition = new Ctor()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'
    recognition.onresult = (ev) => {
      const transcript = ev.results[ev.results.length - 1][0].transcript
      submit(transcript, 'voice')
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit(text, 'text')
        }}
        placeholder='Try: "compare the revenue chart to last year"'
        style={{
          flex: 1,
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #3a3f4b',
          background: '#11131a',
          color: '#e8e9ee',
          fontSize: 14,
        }}
      />
      <button onClick={() => submit(text, 'text')} style={buttonStyle}>
        Send
      </button>
      {voiceSupported && (
        <button onClick={toggleVoice} style={{ ...buttonStyle, background: listening ? '#ff5a36' : buttonStyle.background }}>
          {listening ? 'Listening…' : '🎙 Voice'}
        </button>
      )}
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: 'none',
  background: '#5b8dee',
  color: '#fff',
  fontSize: 14,
  cursor: 'pointer',
}
