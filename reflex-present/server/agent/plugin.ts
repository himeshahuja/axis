// The agent's endpoint on the Vite dev (and preview) server. Like the voice endpoint, the
// Gemini key stays here: the page sends the question, the selected object's data and its
// screenshot, and gets back the reply, what the agent drew and which tools it used.
//
//   GET  /api/agent/status  → { configured, model }
//   POST /api/agent         AgentRequest → AgentResult | { error }

import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AgentObject, AgentRequest } from '../../src/spatial/radial/actions/agentTypes.ts'
import { DEFAULT_GEMINI_MODEL, readBody, sameOrigin, send } from '../geminiVoice.ts'
import { AgentError, runAgent } from './loop.ts'

const MAX_BODY = 16 * 1024 * 1024 // a screenshot plus slide data
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png'])

const asObject = (v: unknown): AgentObject | null => {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.label !== 'string') return null
  return { id: typeof o.id === 'string' ? o.id : o.label, label: o.label.slice(0, 200), content: o.content ?? undefined }
}

/** The request with only what the agent uses, or why it is not usable. */
export function checkRequest(raw: unknown): AgentRequest | string {
  if (!raw || typeof raw !== 'object') return 'Bad request.'
  const b = raw as Record<string, unknown>
  const question = typeof b.question === 'string' ? b.question.trim().slice(0, 2000) : ''
  if (!question) return 'No question in the request.'
  const req: AgentRequest = { question }
  const object = asObject(b.object)
  if (object) req.object = object
  if (Array.isArray(b.others)) req.others = b.others.map(asObject).filter((o): o is AgentObject => !!o).slice(0, 40)
  if (b.image && typeof b.image === 'object') {
    const img = b.image as Record<string, unknown>
    if (typeof img.mimeType !== 'string' || !IMAGE_TYPES.has(img.mimeType) || typeof img.data !== 'string' || !img.data) return 'The screenshot must be a base64 JPEG or PNG.'
    req.image = { mimeType: img.mimeType as 'image/jpeg' | 'image/png', data: img.data }
  }
  if (Array.isArray(b.history)) {
    req.history = b.history
      .filter((h): h is { question: string; answer: string } => !!h && typeof h === 'object' && typeof (h as Record<string, unknown>).question === 'string' && typeof (h as Record<string, unknown>).answer === 'string')
      .slice(-3)
  }
  return req
}

export function geminiAgentPlugin(env: () => { key?: string; model?: string }): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/agent' && url !== '/api/agent/status') return next()
    const { key, model = DEFAULT_GEMINI_MODEL } = env()
    if (url === '/api/agent/status') return send(res, 200, { configured: !!key, model })
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' })
    if (!sameOrigin(req)) return send(res, 403, { error: 'Only this app’s page can use this endpoint.' })
    if (!key) return send(res, 503, { error: 'No Gemini key on this laptop: put GEMINI_API_KEY=... in reflex-present/.env (or export it) and restart npm run dev.' })

    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody(req, MAX_BODY))
    } catch (e) {
      return send(res, 413, { error: e instanceof Error && e.message === 'too-large' ? 'The request is too large.' : 'Bad request.' })
    }
    const body = checkRequest(parsed)
    if (typeof body === 'string') return send(res, 400, { error: body })

    // Stop spending model calls when the page gives up (a newer question replaced this one).
    const abort = new AbortController()
    res.on('close', () => !res.writableEnded && abort.abort())
    try {
      const result = await runAgent(body, { key, model, signal: abort.signal })
      const used = result.steps.map((s) => s.tool).join(', ') || 'no tools'
      console.log(`[agent] ${result.ms} ms · ${result.turns} call${result.turns === 1 ? '' : 's'} · ${used}${body.image ? ' · with screenshot' : ''}`)
      send(res, 200, result)
    } catch (e) {
      if (abort.signal.aborted) return
      if (e instanceof AgentError) return send(res, e.status, { error: e.message })
      send(res, 500, { error: 'The agent failed unexpectedly.' })
    }
  }
  return {
    name: 'reflex-gemini-agent',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
  }
}
