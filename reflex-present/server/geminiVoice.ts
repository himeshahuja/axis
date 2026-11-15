// Band microphone → Google Gemini (Google DeepMind's model): speech to text and a reply.
//
// The page records the Vexo band's microphone, turns it into a WAV file and posts it here.
// This runs inside the Vite dev server on this laptop, so the Gemini key never reaches the
// web page (the kit's rule: model keys stay out of pages). The key is read from the
// environment or from reflex-present/.env (gitignored) as GEMINI_API_KEY; GEMINI_MODEL
// overrides the model, GEMINI_TRANSCRIBE_MODEL the one used for mode 'transcribe'. Only a
// status number is ever reported back, never the key and never what Google wrote in an error.
//
//   GET  /api/voice/gemini/status  → { configured, model }
//   POST /api/voice/gemini         { audio: base64 WAV | text: string, object: {...}, others: string[], mode? }
//                                  → { transcript, reply, model } | { error }
//
// mode 'answer' (default) transcribes and replies; 'explain' answers a question about the
// selected object in plain sentences; 'transcribe' only writes down what was said.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'
/** Writing down speech needs no reasoning: the lite model does it in about a second. */
export const DEFAULT_TRANSCRIBE_MODEL = 'gemini-3.5-flash-lite'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const MAX_BODY = 12 * 1024 * 1024 // ~60 s of 16 kHz WAV as base64, with room to spare

export interface VoiceObjectContext {
  label: string
  content?: unknown
}

export type VoiceMode = 'answer' | 'explain' | 'transcribe'

export interface VoiceRequest {
  mode?: VoiceMode
  /** Base64 WAV from the band's microphone. */
  audio?: string
  /** Or the words already transcribed (browser speech, Deepgram) or typed. */
  text?: string
  object?: VoiceObjectContext
  others?: string[]
}

export interface VoiceAnswer {
  transcript: string
  reply: string
}

const INSTRUCTIONS: Record<VoiceMode, string> = {
  answer: [
    'You are the voice assistant of a live presentation. The presenter wears a Vexo wristband and has just spoken into its microphone while pointing at one object on the slide.',
    'If you get audio, first transcribe exactly what was said (English); if you get the words as text, return them unchanged as the transcript. Then answer it in one to three short sentences, as a reply that will pop up on the shared screen.',
    'Words like "this", "that" or "it" mean the selected object. Use only the numbers in the object data you are given; never invent figures. If the audio has no speech, return an empty transcript and a reply saying nothing was heard.',
  ].join(' '),
  explain: [
    'You explain one object on a presentation slide. The presenter asks a question about the selected object; return the question unchanged as the transcript.',
    'Reply in plain prose: one to three short sentences, no markdown, no bullet points, no headings, no preamble.',
    'Words like "this", "that" or "it" mean the selected object. Use only the information and numbers in the object data you are given; never invent figures. If the data cannot answer the question, say so in one sentence.',
  ].join(' '),
  transcribe: [
    'Transcribe exactly what is said in the audio (English), with normal punctuation and capitalisation. Do not answer it, summarise it or add anything.',
    'Return the words as the transcript and an empty string as the reply. If there is no speech, return an empty transcript.',
  ].join(' '),
}

export function buildGeminiRequest(req: VoiceRequest) {
  const mode = req.mode ?? 'answer'
  const said = mode === 'explain' ? `The presenter asks: "${req.text ?? ''}"` : `The presenter said: "${req.text ?? ''}"`
  const context = req.object
    ? `Selected object: ${req.object.label}\nIts data: ${JSON.stringify(req.object.content ?? null)}\nOther objects on the slide: ${(req.others ?? []).join(', ') || 'none'}`
    : 'No object is selected.'
  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS[mode] }] },
    // Transcribing needs only the sound: any extra text would be written down as if it were said.
    contents: [{ role: 'user', parts: [req.audio ? { inlineData: { mimeType: 'audio/wav', data: req.audio } } : { text: said }, ...(mode === 'transcribe' ? [] : [{ text: context }])] }],
    generationConfig: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { transcript: { type: 'STRING' }, reply: { type: 'STRING' } },
        required: ['transcript', 'reply'],
      },
    },
  }
}

/** The answer inside a generateContent response, or null if it has none. */
export function parseGeminiReply(body: unknown): VoiceAnswer | null {
  const parts = (body as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts
  const text = parts?.map((p) => p.text ?? '').join('')
  if (!text) return null
  try {
    const j = JSON.parse(text) as Partial<VoiceAnswer>
    if (typeof j.transcript !== 'string' || typeof j.reply !== 'string') return null
    return { transcript: j.transcript.trim(), reply: j.reply.trim() }
  } catch {
    return null
  }
}

export function problemFor(status: number): string {
  if (status === 400) return 'Gemini rejected the request (status 400): check GEMINI_MODEL, or the recording was not readable.'
  if (status === 401 || status === 403) return `Gemini refused the key (status ${status}). Check GEMINI_API_KEY.`
  if (status === 404) return 'Gemini does not know that model (status 404). Set GEMINI_MODEL to a current model id.'
  if (status === 429) return 'Gemini says too many requests or no quota left (status 429). Wait a moment.'
  return `Gemini answered status ${status}.`
}

export function readBody(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        reject(new Error('too-large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Only this app's own page may spend the key: reject requests sent from other sites. */
export function sameOrigin(req: IncomingMessage) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin') return false
  const origin = req.headers.origin
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }
  return true
}

export function geminiVoicePlugin(env: () => { key?: string; model?: string; transcribeModel?: string }): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url?.split('?')[0]
    if (url !== '/api/voice/gemini' && url !== '/api/voice/gemini/status') return next()
    const { key, model: answerModel = DEFAULT_GEMINI_MODEL, transcribeModel = DEFAULT_TRANSCRIBE_MODEL } = env()
    let model = answerModel
    if (url === '/api/voice/gemini/status') return send(res, 200, { configured: !!key, model })
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only.' })
    if (!sameOrigin(req)) return send(res, 403, { error: 'Only this app’s page can use this endpoint.' })
    if (!key) return send(res, 503, { error: 'No Gemini key on this laptop: put GEMINI_API_KEY=... in reflex-present/.env (or export it) and restart npm run dev.' })

    let body: VoiceRequest
    try {
      body = JSON.parse(await readBody(req)) as VoiceRequest
    } catch (e) {
      return send(res, 413, { error: e instanceof Error && e.message === 'too-large' ? 'The recording is too long.' : 'Bad request.' })
    }
    const hasAudio = typeof body.audio === 'string' && body.audio.length > 0
    const hasText = typeof body.text === 'string' && body.text.trim().length > 0
    if (!hasAudio && !hasText) return send(res, 400, { error: 'No recording or text in the request.' })
    if (body.mode !== undefined && !(typeof body.mode === 'string' && Object.hasOwn(INSTRUCTIONS, body.mode))) return send(res, 400, { error: 'Unknown mode.' })
    if (!hasAudio) body = { ...body, audio: undefined, text: body.text!.trim().slice(0, 2000) }
    if (body.mode === 'transcribe') model = transcribeModel

    let r: Response
    try {
      r = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(buildGeminiRequest(body)),
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      return send(res, 502, { error: 'Could not reach generativelanguage.googleapis.com (network, or it took over 30 s).' })
    }
    if (!r.ok) return send(res, 502, { error: problemFor(r.status) })
    const answer = parseGeminiReply(await r.json().catch(() => null))
    if (!answer) return send(res, 502, { error: 'Gemini answered, but not with a transcript and a reply.' })
    send(res, 200, { ...answer, model })
  }
  return {
    name: 'reflex-gemini-voice',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next))
    },
  }
}
