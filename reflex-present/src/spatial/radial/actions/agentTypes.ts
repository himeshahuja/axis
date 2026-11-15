// The contract between the page and the dev server's agent (server/agent/). Types only, so the
// page and the server share them without either pulling in the other's runtime.
//
//   POST /api/agent         AgentRequest → AgentResult | { error }
//   GET  /api/agent/status  → { configured, model }

/** One object on the slide, as the agent sees it. */
export interface AgentObject {
  id: string
  label: string
  /** The object's data (chart series, metric, note text), when it has any. */
  content?: unknown
}

export interface AgentRequest {
  /** What the presenter asked: a voice transcript or typed words. */
  question: string
  /** The selected object. "this", "that" and "it" mean this one. */
  object?: AgentObject
  /** Everything else on the slide; the agent reads their data with a tool when it needs it. */
  others?: AgentObject[]
  /** A screenshot of the selected object, base64 without the data: prefix. */
  image?: { mimeType: 'image/jpeg' | 'image/png'; data: string }
  /** Earlier questions on this card, oldest first, so follow-ups make sense. */
  history?: { question: string; answer: string }[]
}

/** Something the agent made for the card to show. */
export type AgentArtifact =
  | {
      type: 'graph'
      /** Desmos LaTeX, one expression each, e.g. "y=x^2-3". */
      expressions: string[]
      title?: string
      bounds?: { left: number; right: number; bottom: number; top: number }
    }
  | {
      type: 'chart'
      kind: 'bar' | 'line' | 'area' | 'pie'
      title?: string
      unit?: string
      points: { label: string; value: number }[]
    }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'code'; language: string; code: string; output?: string; ok: boolean }

/** One tool the agent used, in order, for the card's "how" line. */
export interface AgentStep {
  tool: string
  /** Short human summary, e.g. "y=x^2-3" or "Revenue". */
  detail?: string
  ok: boolean
}

export interface AgentResult {
  reply: string
  artifacts: AgentArtifact[]
  steps: AgentStep[]
  model: string
  /** How many model calls the answer took. */
  turns: number
  ms: number
}
