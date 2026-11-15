// The page's side of the dev server's Gemini endpoint (server/geminiVoice.ts). The model key
// stays on the server; the page only sends what was said and the selected object's data.
//
// Stand-in: voice.ts and explain.ts import this module but it was never committed upstream;
// this is rebuilt from how they use it and from the server's request/response contract.

import type { SpatialObject } from '../../types'

/** What a question is about, so the answer can use the object's real data. */
export interface GeminiContext {
  object: SpatialObject
  objects: SpatialObject[]
}

export type GeminiMode = 'answer' | 'explain' | 'transcribe'

export interface GeminiAnswer {
  transcript: string
  reply: string
  model: string
}

/** `status` is the endpoint's HTTP status, or 0 when the dev server could not be reached. */
export class GeminiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

/**
 * Asks the dev server's Gemini endpoint about the selected object.
 * `audio` is a base64 WAV from the band; `text` is words already transcribed or typed.
 */
export async function askGemini(said: { audio: string } | { text: string }, ctx?: GeminiContext, signal?: AbortSignal, mode?: GeminiMode): Promise<GeminiAnswer> {
  const body = {
    ...said,
    ...(mode ? { mode } : {}),
    ...(ctx ? { object: { label: ctx.object.label, content: ctx.object.content ?? null }, others: ctx.objects.filter((o) => o.id !== ctx.object.id).map((o) => o.label) } : {}),
  }
  let r: Response
  try {
    r = await fetch('/api/voice/gemini', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new GeminiError('Could not reach the Gemini endpoint on the dev server.', 0)
  }
  const j = (await r.json().catch(() => ({}))) as { transcript?: string; reply?: string; model?: string; error?: string }
  if (!r.ok) throw new GeminiError(j.error ?? `The Gemini endpoint answered status ${r.status}.`, r.status)
  if (mode !== 'transcribe' && typeof j.reply !== 'string') throw new GeminiError(j.error ?? 'The Gemini endpoint sent no reply.', r.status)
  return { transcript: j.transcript ?? '', reply: j.reply ?? '', model: j.model ?? '' }
}
