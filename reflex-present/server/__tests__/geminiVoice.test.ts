import { describe, expect, it } from 'vitest'
import { buildGeminiRequest, parseGeminiReply, problemFor } from '../geminiVoice.ts'

describe('Gemini voice endpoint helpers', () => {
  it('sends the WAV inline with the selected object as context and asks for JSON', () => {
    const body = buildGeminiRequest({ audio: 'UklGRg==', object: { label: 'Revenue', content: { kind: 'chart', series: [{ label: 'Q3', value: 180 }] } }, others: ['Conversion'] })
    const parts = body.contents[0].parts as Record<string, unknown>[]
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } })
    expect(String(parts[1].text)).toContain('Revenue')
    expect(String(parts[1].text)).toContain('"Q3"')
    expect(String(parts[1].text)).toContain('Conversion')
    expect(body.generationConfig.responseMimeType).toBe('application/json')
  })

  it('sends already-transcribed or typed words as text instead of audio', () => {
    const body = buildGeminiRequest({ text: 'what is the difference', object: { label: 'Conventional interfaces' } })
    const parts = body.contents[0].parts as Record<string, unknown>[]
    expect(parts[0]).toEqual({ text: 'The presenter said: "what is the difference"' })
    expect(String(parts[1].text)).toContain('Conventional interfaces')
  })

  it('reads the transcript and reply from a generateContent response', () => {
    const r = { candidates: [{ content: { parts: [{ text: '{"transcript":" Compare this with last quarter ","reply":"Q4 is up 30k."}' }] } }] }
    expect(parseGeminiReply(r)).toEqual({ transcript: 'Compare this with last quarter', reply: 'Q4 is up 30k.' })
  })

  it('rejects answers without both fields', () => {
    expect(parseGeminiReply({ candidates: [{ content: { parts: [{ text: '{"reply":"x"}' }] } }] })).toBeNull()
    expect(parseGeminiReply({ candidates: [] })).toBeNull()
    expect(parseGeminiReply({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toBeNull()
  })

  it('reports status numbers only', () => {
    expect(problemFor(403)).toContain('403')
    expect(problemFor(404)).toContain('GEMINI_MODEL')
  })
})
