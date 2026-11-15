// The Explain agent: one question about the selected object → Gemini with the object's data,
// a screenshot of it and the tools → run the tools it calls → feed the results back → repeat
// until it answers in words (at most MAX_TURNS model calls).
//
// Tools:
//   plot_graph, make_chart, read_slide_object   ours, run here (tools.ts)
//   code execution                              Gemini's own Python sandbox (sympy, numpy,
//                                               matplotlib) at Google; its code, output and
//                                               any plot come back as card artifacts
//
// The model's turns go back to it verbatim, so Gemini 3's thought signatures stay attached to
// their function calls (it rejects a follow-up turn without them).

import type { AgentArtifact, AgentRequest, AgentResult, AgentStep } from '../../src/spatial/radial/actions/agentTypes.ts'
import { runTool, TOOLS, type ToolContext } from './tools.ts'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
export const MAX_TURNS = 5
const CALL_TIMEOUT_MS = 40_000
const MAX_DATA_CHARS = 6000

export const SYSTEM = [
  'You are Axis, the assistant inside a live presentation. The presenter has selected one object on the slide and asked about it by voice or text; the words may be a speech transcript with small errors.',
  '"This", "that" and "it" mean the selected object. You get its data (when it has any) and a screenshot of it as the audience sees it: read both.',
  'Tools: plot_graph draws any function, equation or curve on a Desmos graph. make_chart charts labelled values. read_slide_object reads another object’s data. Run Python code for exact arithmetic, statistics, symbolic math (sympy) or a figure no other tool can draw.',
  'When the presenter asks you to create, draw, graph, plot, chart or calculate something, use a tool: never just describe what it would look like. When you call plot_graph or make_chart, also write your reply in that same turn.',
  'Your reply goes on a small card on the shared screen: one to three short sentences of plain prose. No markdown, no LaTeX, no bullet points, no code, no preamble. If you drew something, say in one sentence what it shows.',
  'Use only numbers from the object’s data, the screenshot, the presenter’s words or your own calculations. Never invent figures; if you cannot answer, say so in one sentence.',
].join(' ')

export class AgentError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'AgentError'
    this.status = status
  }
}

interface Part {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  inlineData?: { mimeType: string; data: string }
  functionCall?: { name: string; args?: unknown; id?: string }
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> }
  executableCode?: { language?: string; code?: string; id?: string }
  codeExecutionResult?: { outcome?: string; output?: string; id?: string }
}

interface Content {
  role: 'user' | 'model'
  parts: Part[]
}

const json = (v: unknown) => {
  const s = JSON.stringify(v ?? null)
  return s.length > MAX_DATA_CHARS ? `${s.slice(0, MAX_DATA_CHARS)}… (cut)` : s
}

/** The conversation for the first model call: earlier questions on this card, then this one. */
export function buildContents(req: AgentRequest): Content[] {
  const contents: Content[] = []
  for (const h of (req.history ?? []).slice(-3)) {
    contents.push({ role: 'user', parts: [{ text: h.question.slice(0, 600) }] })
    contents.push({ role: 'model', parts: [{ text: h.answer.slice(0, 800) }] })
  }
  const o = req.object
  const context = o
    ? [
        `Selected object: "${o.label.replace(/\n/g, ' ')}"`,
        `Its data: ${o.content === undefined || o.content === null ? 'none (read the screenshot)' : json(o.content)}`,
        `Other objects on the slide: ${(req.others ?? []).map((x) => `"${x.label.replace(/\n/g, ' ')}"`).join(', ') || 'none'}`,
      ].join('\n')
    : 'No object is selected.'
  const parts: Part[] = []
  if (req.image) parts.push({ inlineData: { mimeType: req.image.mimeType, data: req.image.data } })
  parts.push({ text: `${context}${req.image ? '\nThe image is a screenshot of the selected object.' : ''}\n\nThe presenter asks: "${req.question}"` })
  contents.push({ role: 'user', parts })
  return contents
}

export function buildBody(contents: Content[]) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    tools: [{ functionDeclarations: Object.values(TOOLS).map((t) => t.declaration) }, { codeExecution: {} }],
    // Lets Gemini's own code execution run alongside our function calls.
    toolConfig: { includeServerSideToolInvocations: true },
    generationConfig: { temperature: 0.4 },
  }
}

export function problemFor(status: number): string {
  if (status === 400) return 'Gemini rejected the request (status 400): check GEMINI_MODEL.'
  if (status === 401 || status === 403) return `Gemini refused the key (status ${status}). Check GEMINI_API_KEY (it may have expired).`
  if (status === 404) return 'Gemini does not know that model (status 404). Set GEMINI_MODEL to a current model id.'
  if (status === 429) return 'Gemini says too many requests or no quota left (status 429). Wait a moment.'
  return `Gemini answered status ${status}.`
}

const firstLine = (code: string) => code.split('\n').find((l) => l.trim() && !l.trim().startsWith('#') && !/^\s*(import|from)\s/.test(l))?.trim().slice(0, 60)

export interface RunOptions {
  key: string
  model: string
  signal?: AbortSignal
  fetch?: typeof fetch
  maxTurns?: number
}

export async function runAgent(req: AgentRequest, opts: RunOptions): Promise<AgentResult> {
  const started = Date.now()
  const doFetch = opts.fetch ?? fetch
  const ctx: ToolContext = { object: req.object, others: req.others ?? [] }
  const contents = buildContents(req)
  const artifacts: AgentArtifact[] = []
  const steps: AgentStep[] = []
  let reply = ''
  let lastText = ''
  let turns = 0

  for (; turns < (opts.maxTurns ?? MAX_TURNS); ) {
    turns++
    const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS)
    let r: Response
    try {
      r = await doFetch(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.key },
        body: JSON.stringify(buildBody(contents)),
        signal,
      })
    } catch (e) {
      if (opts.signal?.aborted) throw e
      throw new AgentError('Could not reach generativelanguage.googleapis.com (network, or it took too long).', 504)
    }
    if (!r.ok) throw new AgentError(problemFor(r.status))
    const body = (await r.json().catch(() => null)) as { candidates?: { content?: { parts?: Part[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } } | null
    const cand = body?.candidates?.[0]
    const parts = cand?.content?.parts ?? []
    if (parts.length === 0) {
      const why = body?.promptFeedback?.blockReason ?? cand?.finishReason
      throw new AgentError(why ? `Gemini returned no answer (${why}).` : 'Gemini returned no answer.')
    }

    const calls: { name: string; args?: unknown; id?: string }[] = []
    let text = ''
    for (const p of parts) {
      if (p.thought) continue
      if (p.functionCall) calls.push(p.functionCall)
      else if (p.executableCode?.code) {
        artifacts.push({ type: 'code', language: (p.executableCode.language ?? 'python').toLowerCase(), code: p.executableCode.code, ok: true })
        steps.push({ tool: 'python', detail: firstLine(p.executableCode.code), ok: true })
      } else if (p.codeExecutionResult) {
        const code = [...artifacts].reverse().find((a): a is Extract<AgentArtifact, { type: 'code' }> => a.type === 'code')
        const ok = p.codeExecutionResult.outcome === undefined || p.codeExecutionResult.outcome === 'OUTCOME_OK'
        if (code) {
          code.output = p.codeExecutionResult.output?.slice(0, 4000)
          code.ok = ok
        }
        const step = [...steps].reverse().find((s) => s.tool === 'python')
        if (step) step.ok = ok
      } else if (p.inlineData && p.inlineData.mimeType.startsWith('image/')) {
        artifacts.push({ type: 'image', mimeType: p.inlineData.mimeType, data: p.inlineData.data })
      } else if (typeof p.text === 'string') text += p.text
    }
    text = text.trim()
    if (text) lastText = text
    // Back to the model verbatim: thought signatures must stay on their parts.
    contents.push({ role: 'model', parts })

    if (calls.length === 0) {
      reply = text
      break
    }
    const outcomes = calls.map((c) => ({ call: c, ...runTool(c.name, c.args, ctx) }))
    for (const o of outcomes) {
      steps.push(o.step)
      if (o.artifact) artifacts.push(o.artifact)
    }
    // It drew something and already said what: no need to ask it again.
    if (text && outcomes.every((o) => o.display && o.step.ok)) {
      reply = text
      break
    }
    contents.push({ role: 'user', parts: outcomes.map((o) => ({ functionResponse: { name: o.call.name, ...(o.call.id ? { id: o.call.id } : {}), response: o.response } })) })
  }

  if (!reply) reply = lastText || (artifacts.length ? 'Done: it is on the card.' : 'I could not finish that in time; try asking it more simply.')
  return { reply, artifacts, steps, model: opts.model, turns, ms: Date.now() - started }
}
