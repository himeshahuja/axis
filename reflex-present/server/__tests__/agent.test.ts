import { describe, expect, it } from 'vitest'
import { AgentError, buildBody, buildContents, runAgent } from '../agent/loop.ts'
import { checkRequest } from '../agent/plugin.ts'
import { findObject, runTool } from '../agent/tools.ts'

const revenue = { id: 'rev', label: 'Revenue', content: { kind: 'chart', unit: '$', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] } }
const conversion = { id: 'conv', label: 'Conversion rate', content: { kind: 'metric', value: 0.042, format: 'percent' } }
const ctx = { object: revenue, others: [conversion] }

/** A fake generateContent: answers each call with the next canned response and keeps what was sent. */
function fakeGemini(...responses: (Record<string, unknown> | number)[]) {
  const sent: Record<string, unknown>[] = []
  const fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)))
    const r = responses.shift()
    if (typeof r === 'number') return new Response('{"error":{"message":"secret detail"}}', { status: r })
    return new Response(JSON.stringify(r), { status: 200 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, sent }
}
const turn = (...parts: Record<string, unknown>[]) => ({ candidates: [{ content: { role: 'model', parts } }] })
const opts = (fetch: typeof globalThis.fetch) => ({ key: 'k', model: 'gemini-test', fetch })

describe('agent tools', () => {
  it('plot_graph keeps valid expressions and a complete viewport only', () => {
    const r = runTool('plot_graph', { expressions: ['y=x^2-3', '  ', 'y=2x'], x_min: -5, x_max: 5, y_min: -4, y_max: 10 }, ctx)
    expect(r.step).toEqual({ tool: 'plot_graph', detail: 'y=x^2-3, y=2x', ok: true })
    expect(r.artifact).toEqual({ type: 'graph', expressions: ['y=x^2-3', 'y=2x'], title: undefined, bounds: { left: -5, right: 5, bottom: -4, top: 10 } })
    expect(r.display).toBe(true)
    expect(runTool('plot_graph', { expressions: ['y=x'], x_min: 5, x_max: -5, y_min: 0, y_max: 1 }, ctx).artifact).toMatchObject({ bounds: undefined })
  })

  it('plot_graph without expressions reports an error the model can act on', () => {
    const r = runTool('plot_graph', {}, ctx)
    expect(r.artifact).toBeUndefined()
    expect(r.step.ok).toBe(false)
    expect(String(r.response.error)).toContain('expression')
  })

  it('make_chart drops points without a numeric value and defaults the kind to bar', () => {
    const r = runTool('make_chart', { kind: 'donut', points: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: '150' }, { label: 'Q3', value: 'n/a' }, { value: 3 }] }, ctx)
    expect(r.artifact).toEqual({ type: 'chart', kind: 'bar', title: undefined, unit: undefined, points: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] })
  })

  it('read_slide_object finds another object by a loose name and lists names when it cannot', () => {
    expect(findObject('conversion', ctx)?.id).toBe('conv')
    expect(findObject('  REVENUE ', ctx)?.id).toBe('rev')
    const hit = runTool('read_slide_object', { name: 'Conversion' }, ctx)
    expect(hit.response).toEqual({ found: true, name: 'Conversion rate', data: conversion.content })
    expect(hit.display).toBe(false)
    expect(runTool('read_slide_object', { name: 'Churn' }, ctx).response).toEqual({ found: false, available: ['Conversion rate'] })
  })

  it('an unknown tool is an error, not a crash', () => {
    const r = runTool('rm_rf', {}, ctx)
    expect(r.step.ok).toBe(false)
    expect(String(r.response.error)).toContain('rm_rf')
    expect(runTool('toString', {}, ctx).step.ok).toBe(false)
  })
})

describe('agent request', () => {
  it('puts the screenshot first, then the object data, other names and the question', () => {
    const contents = buildContents({ question: 'what is this?', object: revenue, others: [conversion], image: { mimeType: 'image/jpeg', data: 'abc' } })
    expect(contents).toHaveLength(1)
    const [img, text] = contents[0].parts
    expect(img).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'abc' } })
    expect(text.text).toContain('Selected object: "Revenue"')
    expect(text.text).toContain('"Q2"')
    expect(text.text).toContain('"Conversion rate"')
    expect(text.text).toContain('The presenter asks: "what is this?"')
  })

  it('replays earlier questions on the card as turns', () => {
    const contents = buildContents({ question: 'and the lowest?', object: revenue, history: [{ question: 'peak?', answer: 'Q2 at $150.' }] })
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user'])
    expect(contents[1].parts[0].text).toBe('Q2 at $150.')
  })

  it('offers our tools and Gemini code execution together', () => {
    const body = buildBody(buildContents({ question: 'x' }))
    const names = (body.tools[0] as { functionDeclarations: { name: string }[] }).functionDeclarations.map((d) => d.name)
    expect(names).toEqual(['plot_graph', 'make_chart', 'read_slide_object'])
    expect(body.tools[1]).toEqual({ codeExecution: {} })
    expect(body.toolConfig).toEqual({ includeServerSideToolInvocations: true })
  })

  it('checkRequest keeps only what the agent uses and refuses bad screenshots', () => {
    expect(checkRequest({})).toBe('No question in the request.')
    expect(checkRequest({ question: 'hi', image: { mimeType: 'image/gif', data: 'x' } })).toContain('JPEG or PNG')
    const ok = checkRequest({ question: '  hi  ', object: { id: 'a', label: 'A', content: { kind: 'note', text: 't' } }, others: [{ label: 'B' }, 5, null], history: [{ question: 'q', answer: 'a' }, { nope: 1 }] })
    expect(ok).toEqual({ question: 'hi', object: { id: 'a', label: 'A', content: { kind: 'note', text: 't' } }, others: [{ id: 'B', label: 'B', content: undefined }], history: [{ question: 'q', answer: 'a' }] })
  })
})

describe('agent loop', () => {
  it('runs a tool call, sends the result back with the model turn intact, then answers', async () => {
    const g = fakeGemini(
      turn({ functionCall: { name: 'read_slide_object', args: { name: 'conversion' }, id: 'c1' }, thoughtSignature: 'sig-1' }),
      turn({ text: 'Revenue grew while conversion sits at 4.2%.' }),
    )
    const r = await runAgent({ question: 'compare with conversion', object: revenue, others: [conversion] }, opts(g.fetch))
    expect(r.reply).toBe('Revenue grew while conversion sits at 4.2%.')
    expect(r.turns).toBe(2)
    expect(r.steps).toEqual([{ tool: 'read_slide_object', detail: 'Conversion rate', ok: true }])
    const second = g.sent[1].contents as { role: string; parts: Record<string, unknown>[] }[]
    expect(second[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'read_slide_object', args: { name: 'conversion' }, id: 'c1' }, thoughtSignature: 'sig-1' }] })
    expect(second[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'read_slide_object', id: 'c1', response: { found: true, name: 'Conversion rate', data: conversion.content } } }] })
  })

  it('stops after one call when it draws something and says what in the same turn', async () => {
    const g = fakeGemini(turn({ text: 'Here is the parabola.' }, { functionCall: { name: 'plot_graph', args: { expressions: ['y=x^2'] } } }))
    const r = await runAgent({ question: 'graph x squared' }, opts(g.fetch))
    expect(g.sent).toHaveLength(1)
    expect(r.reply).toBe('Here is the parabola.')
    expect(r.artifacts).toEqual([{ type: 'graph', expressions: ['y=x^2'], title: undefined, bounds: undefined }])
  })

  it('asks again when a drawing tool was called without a reply', async () => {
    const g = fakeGemini(turn({ functionCall: { name: 'make_chart', args: { kind: 'line', points: [{ label: 'a', value: 1 }] } } }), turn({ text: 'A line chart.' }))
    const r = await runAgent({ question: 'chart it' }, opts(g.fetch))
    expect(g.sent).toHaveLength(2)
    expect(r.reply).toBe('A line chart.')
  })

  it('turns Gemini code execution into code and image artifacts', async () => {
    const g = fakeGemini(
      turn(
        { executableCode: { language: 'PYTHON', code: 'import sympy as sp\nprint(sp.pi**2 - 4)' } },
        { codeExecutionResult: { outcome: 'OUTCOME_OK', output: 'pi**2 - 4\n' } },
        { inlineData: { mimeType: 'image/png', data: 'png64' } },
        { text: 'It is pi squared minus four.' },
      ),
    )
    const r = await runAgent({ question: 'integrate' }, opts(g.fetch))
    expect(r.artifacts).toEqual([
      { type: 'code', language: 'python', code: 'import sympy as sp\nprint(sp.pi**2 - 4)', output: 'pi**2 - 4\n', ok: true },
      { type: 'image', mimeType: 'image/png', data: 'png64' },
    ])
    expect(r.steps).toEqual([{ tool: 'python', detail: 'print(sp.pi**2 - 4)', ok: true }])
    expect(r.reply).toBe('It is pi squared minus four.')
  })

  it('gives up after the turn limit with what it has', async () => {
    const call = turn({ functionCall: { name: 'read_slide_object', args: { name: 'x' } } })
    const g = fakeGemini(call, call, call)
    const r = await runAgent({ question: 'loop' }, { ...opts(g.fetch), maxTurns: 3 })
    expect(g.sent).toHaveLength(3)
    expect(r.reply).toContain('could not finish')
  })

  it('reports a refused key without passing on what Google wrote', async () => {
    const g = fakeGemini(403)
    const err = await runAgent({ question: 'hi' }, opts(g.fetch)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AgentError)
    expect((err as AgentError).message).toContain('GEMINI_API_KEY')
    expect((err as AgentError).message).not.toContain('secret detail')
  })
})
