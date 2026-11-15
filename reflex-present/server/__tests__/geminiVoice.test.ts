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

  it('asks for plain answers in explain mode and words only in transcribe mode', () => {
    const explain = buildGeminiRequest({ mode: 'explain', text: 'what is the trend', object: { label: 'Revenue' } })
    expect((explain.contents[0].parts[0] as { text: string }).text).toBe('The presenter asks: "what is the trend"')
    expect(explain.systemInstruction.parts[0].text).toContain('no markdown')
    const transcribe = buildGeminiRequest({ mode: 'transcribe', audio: 'UklGRg==' })
    expect(transcribe.systemInstruction.parts[0].text).toContain('Do not answer it')
    expect(buildGeminiRequest({ text: 'hi' }).systemInstruction.parts[0].text).toContain('voice assistant')
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
