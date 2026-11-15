import { useState } from 'react'
import type { CommandInput } from '../types'

// Typed commands only: voice input comes from the Vexo band (the Voice action), never this
// computer's microphone.
export function CommandBar({ onCommand }: { onCommand: (cmd: CommandInput) => void }) {
  const [text, setText] = useState('')

  function submit(value: string, source: CommandInput['source']) {
    const trimmed = value.trim()
    if (!trimmed) return
    onCommand({ source, timestamp: Date.now(), text: trimmed })
    setText('')
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
