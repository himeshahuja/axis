import type { SpatialObject } from '../types'
import { localExplanationProvider, type Explanation, type ExplanationProvider } from './actions/explain'
import { memoryEntryFor, type MemoryEntry, type MemoryStore } from './actions/memory'
import type { RadialAction, RadialActionEvent } from './types'

export type ExplainCard =
  | { objectId: string; status: 'loading' }
  | { objectId: string; status: 'done'; explanation: Explanation }
  | { objectId: string; status: 'error'; message: string }

export interface VoiceSession {
  id: number
  objectId: string
  objectTitle: string
  startedAtMs: number
}

export interface ExecutionRecord {
  event: RadialActionEvent
  objectTitle: string
  startedAtMs: number
  /** When the visible result was in place (explanation shown, entry saved, panel open). */
  resultAtMs: number | null
}

/** Runs confirmed radial actions. Each event id runs at most once. */
export class RadialActionExecutor {
  explainCards = new Map<string, ExplainCard>()
  voice: VoiceSession | null = null
  lastSaved: MemoryEntry | null = null
  last: ExecutionRecord | null = null
  readonly memory: MemoryStore
  provider: ExplanationProvider
  private done = new Set<number>()
  private onChange: () => void
  private now: () => number

  constructor(memory: MemoryStore, onChange: () => void, provider: ExplanationProvider = localExplanationProvider, now: () => number = () => performance.now()) {
    this.memory = memory
    this.onChange = onChange
    this.provider = provider
    this.now = now
  }

  /** Returns the action run, or null for a duplicate / missing object. */
  execute(ev: RadialActionEvent, objects: SpatialObject[]): RadialAction | null {
    if (this.done.has(ev.id)) return null
    const obj = objects.find((o) => o.id === ev.objectId)
    if (!obj) return null
    this.done.add(ev.id)
    const record: ExecutionRecord = { event: ev, objectTitle: obj.label, startedAtMs: this.now(), resultAtMs: null }
    this.last = record

    if (ev.action === 'explain') {
      this.explainCards.set(obj.id, { objectId: obj.id, status: 'loading' })
      this.provider
        .explain(obj)
        .then((explanation) => this.explainCards.set(obj.id, { objectId: obj.id, status: 'done', explanation }))
        .catch((err: unknown) => this.explainCards.set(obj.id, { objectId: obj.id, status: 'error', message: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          record.resultAtMs = this.now()
          this.onChange()
        })
    } else if (ev.action === 'remember') {
      const entry = memoryEntryFor(obj, objects)
      this.memory.add(entry)
      this.lastSaved = entry
      record.resultAtMs = this.now()
    } else {
      this.voice = { id: ev.id, objectId: obj.id, objectTitle: obj.label, startedAtMs: this.now() }
      record.resultAtMs = this.now()
    }
    this.onChange()
    return ev.action
  }

  closeExplain(objectId: string) {
    this.explainCards.delete(objectId)
    this.onChange()
  }

  closeVoice() {
    this.voice = null
    this.onChange()
  }
}
