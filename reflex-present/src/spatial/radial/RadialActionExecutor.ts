import type { SpatialObject } from '../types'
import { answerQuestion, localExplanationProvider, suggestedQuestions, type Answer, type Explanation, type ExplanationProvider } from './actions/explain'
import { memoryEntryFor, type MemoryEntry, type MemoryStore } from './actions/memory'
import type { RadialAction, RadialActionEvent } from './types'

export type ExplainCard =
  | { objectId: string; status: 'loading' }
  | { objectId: string; status: 'done'; explanation: Explanation }
  | { objectId: string; status: 'error'; message: string }

/** One question asked on an Explain card. */
export interface ExplainQA {
  id: number
  question: string
  status: 'thinking' | 'done' | 'error'
  answer?: Answer
  message?: string
}

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
  /** Questions asked on each Explain card, oldest first, at most three. */
  explainThreads = new Map<string, ExplainQA[]>()
  answer: typeof answerQuestion = answerQuestion
  voice: VoiceSession | null = null
  lastSaved: MemoryEntry | null = null
  last: ExecutionRecord | null = null
  readonly memory: MemoryStore
  provider: ExplanationProvider
  private done = new Set<number>()
  private qaSeq = 0
  private qaAbort = new Map<string, AbortController>()
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
      // One overlay at a time: Explain replaces an open Voice capture.
      this.voice = null
      this.explainCards.set(obj.id, { objectId: obj.id, status: 'loading' })
      // A card closed while loading (by Voice, or by hand) stays closed.
      const stillOpen = () => this.explainCards.has(obj.id)
      this.provider
        .explain(obj)
        .then((explanation) => stillOpen() && this.explainCards.set(obj.id, { objectId: obj.id, status: 'done', explanation }))
        .catch((err: unknown) => stillOpen() && this.explainCards.set(obj.id, { objectId: obj.id, status: 'error', message: err instanceof Error ? err.message : String(err) }))
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
      // Voice makes way: any Explain card (and its questions) closes first.
      for (const id of [...this.explainCards.keys()]) this.dropExplain(id)
      this.voice = { id: ev.id, objectId: obj.id, objectTitle: obj.label, startedAtMs: this.now() }
      record.resultAtMs = this.now()
    }
    this.onChange()
    return ev.action
  }

  /** Asks about an object; a newer question replaces one still waiting for its answer. */
  ask(objectId: string, question: string, objects: SpatialObject[]) {
    const obj = objects.find((o) => o.id === objectId)
    const q = question.trim()
    if (!obj || !q) return
    this.qaAbort.get(objectId)?.abort()
    const abort = new AbortController()
    this.qaAbort.set(objectId, abort)
    const item: ExplainQA = { id: ++this.qaSeq, question: q, status: 'thinking' }
    const earlier = (this.explainThreads.get(objectId) ?? []).filter((x) => x.status !== 'thinking')
    this.explainThreads.set(objectId, [...earlier, item].slice(-3))
    this.onChange()
    this.answer(q, obj, objects, abort.signal)
      .then((answer) => {
        item.status = 'done'
        item.answer = answer
      })
      .catch((err: unknown) => {
        item.status = 'error'
        item.message = err instanceof Error ? err.message : String(err)
      })
      .finally(() => {
        if (abort.signal.aborted) return
        this.qaAbort.delete(objectId)
        this.onChange()
      })
  }

  /** Asks one of the card's suggested questions (the hand's way to ask). */
  askSuggested(objectId: string, index: number, objects: SpatialObject[]) {
    const obj = objects.find((o) => o.id === objectId)
    const question = obj && suggestedQuestions(obj)[index]
    if (question) this.ask(objectId, question, objects)
  }

  closeExplain(objectId: string) {
    this.dropExplain(objectId)
    this.onChange()
  }

  private dropExplain(objectId: string) {
    this.explainCards.delete(objectId)
    this.qaAbort.get(objectId)?.abort()
    this.qaAbort.delete(objectId)
    this.explainThreads.delete(objectId)
  }

  closeVoice() {
    this.voice = null
    this.onChange()
  }
}
