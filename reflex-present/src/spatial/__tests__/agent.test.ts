import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeSteps } from '../radial/actions/agent'
import { answerQuestion } from '../radial/actions/explain'
import { resample } from '../radial/actions/wav'
import type { SpatialObject } from '../types'

const chart: SpatialObject = { id: 'rev', label: 'Revenue', shape: 'card', x: 0.1, y: 0.1, w: 0.3, h: 0.3, color: '#fff', content: { kind: 'chart', unit: '$', series: [{ label: 'Q1', value: 100 }, { label: 'Q2', value: 140 }] } } as SpatialObject
const note: SpatialObject = { id: 'n', label: 'Note', shape: 'card', x: 0.5, y: 0.1, w: 0.2, h: 0.2, color: '#fff', content: { kind: 'note', text: 'Hello' } } as SpatialObject

afterEach(() => vi.unstubAllGlobals())

describe('agent client', () => {
  it('sends the question with the selected object, the others and earlier turns, and keeps the artifacts', async () => {
    const calls: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ reply: '**Up** 40%.', artifacts: [{ type: 'graph', expressions: ['y=x'] }], steps: [{ tool: 'plot_graph', ok: true }], model: 'gemini-x', turns: 1, ms: 5 }), { status: 200 })
    })
    const a = await answerQuestion('graph it', chart, [chart, note], undefined, [{ question: 'peak?', answer: 'Q2.' }])
    expect(calls[0]).toMatchObject({ question: 'graph it', object: { id: 'rev', label: 'Revenue' }, others: [{ id: 'n', label: 'Note' }], history: [{ question: 'peak?', answer: 'Q2.' }] })
    expect(a.text).toBe('Up 40%.')
    expect(a.source).toBe('ai')
    expect(a.artifacts).toEqual([{ type: 'graph', expressions: ['y=x'] }])
    expect(a.label).toBe('Gemini · gemini-x · Desmos graph')
  })

  it('falls back to a local answer when the server has no key', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'No Gemini key' }), { status: 503 }))
    const a = await answerQuestion('where is the peak?', chart, [chart])
    expect(a.source).toBe('local')
    expect(a.text).toContain('Q2')
  })

  it('shows a real agent error instead of hiding it behind a local answer', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Gemini refused the key (status 403).' }), { status: 403 }))
    await expect(answerQuestion('hi', chart, [chart])).rejects.toThrow('refused the key')
  })

  it('names each tool once, marking failures', () => {
    expect(describeSteps([{ tool: 'python', ok: true }, { tool: 'python', ok: true }, { tool: 'read_slide_object', detail: 'Churn', ok: false }, { tool: 'make_chart', ok: true }])).toBe('Python · read Churn (failed) · chart')
  })
})

describe('resample', () => {
  it('averages 48 kHz down to 16 kHz', () => {
    const out = resample(new Float32Array([0, 0.3, 0.6, 0.9, 0.9, 0.9]), 48000, 16000)
    expect(Array.from(out).map((v) => Math.round(v * 100) / 100)).toEqual([0.3, 0.9])
    const same = new Float32Array([1, 2])
    expect(resample(same, 16000, 16000)).toBe(same)
  })
})
