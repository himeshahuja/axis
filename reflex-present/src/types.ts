// Shared contracts between the input, semantic-resolution, and rendering
// layers, so hardware/ML/frontend workstreams can integrate independently.

export interface ChartDatum {
  label: string
  value: number
}

export interface ChartObject {
  id: string
  type: 'chart'
  title: string
  x: number
  y: number
  w: number
  h: number
  series: ChartDatum[]
  derivedFrom?: string // id of the object this was generated from, if any
}

export interface MetricObject {
  id: string
  type: 'metric'
  title: string
  x: number
  y: number
  w: number
  h: number
  value: number
  format?: 'percent' | 'number'
}

export type SlideObject = ChartObject | MetricObject

export interface Slide {
  id: string
  title: string
  objects: SlideObject[]
}

// -- Input abstraction (Section 5.D): every input source normalizes to this.

export type InputSource = 'voice' | 'text' | 'keyboard' | 'gesture'

export interface CommandInput {
  source: InputSource
  timestamp: number
  text: string // the instruction, already transcribed if voice
}

// -- Semantic object resolver (Section 5.B)

export type IntentKind =
  | 'select'
  | 'compare'
  | 'scenario'
  | 'highlight_change'
  | 'summarize'
  | 'next_slide'
  | 'previous_slide'
  | 'unknown'

export interface ResolvedIntent {
  intent: IntentKind
  objectIds: string[]
  parameters: Record<string, unknown>
  requiresClarification: boolean
  clarificationPrompt?: string
}

// -- Decision-driven inference router (Section 5.C)

export type RouteKind = 'DIRECT' | 'SMALL_MODEL' | 'LARGE_MODEL' | 'VISION_MODEL' | 'CLARIFY'

export interface RouterTelemetryEntry {
  id: string
  timestamp: number
  input: string
  route: RouteKind
  latencyMs: number
  tokensUsed: number
  success: boolean
}

// -- Action execution result

export interface ActionResult {
  highlightIds: string[]
  newObjects?: SlideObject[]
  message?: string
}
