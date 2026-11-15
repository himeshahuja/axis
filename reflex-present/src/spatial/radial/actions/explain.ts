// Explain: describes an object from its own data with a deterministic local
// summary, labelled as such. Questions about the object go to Gemini through the
// dev server (the key never reaches the page); when no Gemini key or server is
// available, a local answer is built from the same data and says so.

import type { SpatialObject } from '../../types'
import { askGemini, GeminiError } from './gemini'

export interface Explanation {
  objectId: string
  title: string
  kind: string
  facts: string[]
  provider: { id: string; label: string; kind: 'local' | 'ai' }
}

export interface ExplanationProvider {
  id: string
  label: string
  kind: 'local' | 'ai'
  explain(obj: SpatialObject): Promise<Explanation>
}

const fmt = (v: number, unit?: string) => {
  const n = Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return unit ? `${unit === '$' ? '$' : ''}${n}${unit && unit !== '$' ? ` ${unit}` : ''}` : n
}
const signed = (v: number, unit?: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), unit)}`
const pct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`

/** Facts only: every number below is computed from the object's own content. */
export function describeObject(obj: SpatialObject): { kind: string; facts: string[] } {
  const c = obj.content
  if (!c) return { kind: obj.shape, facts: ['This object carries no data, only its label.'] }

  if (c.kind === 'metric') {
    const value = c.format === 'percent' ? `${(c.value * 100).toFixed(1)}%` : fmt(c.value)
    return { kind: 'metric', facts: [`Value: ${value}.`, ...(c.note ? [c.note] : [])] }
  }

  if (c.kind === 'note') {
    const lines = c.text.split('\n').map((l) => l.trim()).filter(Boolean)
    const words = c.text.split(/\s+/).filter(Boolean).length
    return { kind: 'note', facts: [`${lines.length} line${lines.length === 1 ? '' : 's'}, ${words} words.`, ...lines.slice(0, 4).map((l) => `“${l}”`)] }
  }

  const s = c.series
  if (s.length === 0) return { kind: 'chart', facts: ['The chart has no data points.'] }
  const u = c.unit
  const first = s[0]
  const last = s[s.length - 1]
  const max = s.reduce((a, b) => (b.value > a.value ? b : a))
  const min = s.reduce((a, b) => (b.value < a.value ? b : a))
  const avg = s.reduce((a, b) => a + b.value, 0) / s.length
  const facts = [`${s.length} points, ${first.label} to ${last.label}.`]
  if (s.length > 1) {
    const change = last.value - first.value
    facts.push(`From ${fmt(first.value, u)} to ${fmt(last.value, u)}: ${signed(change, u)}${first.value !== 0 ? ` (${pct((change / first.value) * 100)})` : ''}.`)
    let up = 0
    let down = 0
    let big = { from: s[0], to: s[1], delta: s[1].value - s[0].value }
    for (let i = 1; i < s.length; i++) {
      const d = s[i].value - s[i - 1].value
      if (d > 0) up++
      if (d < 0) down++
      if (Math.abs(d) > Math.abs(big.delta)) big = { from: s[i - 1], to: s[i], delta: d }
    }
    const steps = s.length - 1
    facts.push(up === steps ? 'Rises at every step.' : down === steps ? 'Falls at every step.' : `Rises in ${up} of ${steps} steps, falls in ${down}.`)
    facts.push(`Largest step: ${big.from.label} → ${big.to.label}, ${signed(big.delta, u)}.`)
  }
  facts.push(`Highest ${max.label} (${fmt(max.value, u)}), lowest ${min.label} (${fmt(min.value, u)}), average ${fmt(Math.round(avg * 100) / 100, u)}.`)
  return { kind: 'chart', facts }
}

export const localExplanationProvider: ExplanationProvider = {
  id: 'local',
  label: 'Local summary from the object’s data — no AI service connected',
  kind: 'local',
  async explain(obj) {
    const { kind, facts } = describeObject(obj)
    return { objectId: obj.id, title: obj.label, kind, facts, provider: { id: this.id, label: this.label, kind: this.kind } }
  },
}

// ---- questions -------------------------------------------------------------------------

export interface Answer {
  question: string
  text: string
  source: 'ai' | 'local'
  /** Where the answer came from, shown under it. */
  label: string
}

/** One-tap questions for a card, so a hand can ask without a keyboard. */
export function suggestedQuestions(obj: SpatialObject): string[] {
  const kind = obj.content?.kind
  if (kind === 'chart') return ['What’s the trend?', 'Where is the peak?', 'Summarize this']
  if (kind === 'metric') return ['What does this number mean?', 'Summarize this']
  return ['Summarize this', 'What’s the key point?']
}

/** The air-control action for a suggested question (index first: ids may contain colons). */
export const askAction = (objectId: string, index: number) => `explain-ask:${index}:${objectId}`

export function parseAskAction(action: string): { objectId: string; index: number } | null {
  const m = /^explain-ask:(\d+):(.+)$/.exec(action)
  return m ? { index: Number(m[1]), objectId: m[2] } : null
}

/** Plain sentences only: strips markdown a model may still add. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
}

/** Answers from the object's own data, without any AI. Every number is computed from its content. */
export function localAnswer(obj: SpatialObject, question: string): string {
  const q = question.toLowerCase()
  const name = obj.label.replace(/\n/g, ' ')
  const c = obj.content
  if (!c) return `“${name}” carries no data beyond its label.`

  if (c.kind === 'note') {
    const lines = c.text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return `“${name}” is empty.`
    if (/\b(key|main|point|title|headline)\b/.test(q)) return `The key point is “${lines[0]}”.`
    return lines.length > 1 ? `“${lines[0]}”: ${lines.slice(1).join(' ')}` : `It says “${lines[0]}”.`
  }

  if (c.kind === 'metric') {
    const value = c.format === 'percent' ? `${(c.value * 100).toFixed(1)}%` : fmt(c.value)
    return `${name} is ${value}.${c.note ? ` ${c.note}` : ''}`
  }

  const s = c.series
  if (s.length === 0) return 'The chart has no data points.'
  const u = c.unit
  const first = s[0]
  const last = s[s.length - 1]
  const max = s.reduce((a, b) => (b.value > a.value ? b : a))
  const min = s.reduce((a, b) => (b.value < a.value ? b : a))
  const avg = Math.round((s.reduce((a, b) => a + b.value, 0) / s.length) * 100) / 100
  const peak = `The highest point is ${max.label} at ${fmt(max.value, u)}.`
  if (s.length === 1) return `It has one point: ${first.label} at ${fmt(first.value, u)}.`
  const change = last.value - first.value
  let up = 0
  let big = { from: s[0], to: s[1], delta: s[1].value - s[0].value }
  for (let i = 1; i < s.length; i++) {
    const d = s[i].value - s[i - 1].value
    if (d > 0) up++
    if (Math.abs(d) > Math.abs(big.delta)) big = { from: s[i - 1], to: s[i], delta: d }
  }
  const steps = s.length - 1
  const trend = `From ${first.label} to ${last.label} it went from ${fmt(first.value, u)} to ${fmt(last.value, u)}, ${signed(change, u)}${first.value !== 0 ? ` (${pct((change / first.value) * 100)})` : ''}, rising in ${up} of ${steps} steps.`

  if (/\b(jump|biggest|largest|spike|step)\b/.test(q)) return `The biggest step is ${big.from.label} to ${big.to.label}: ${signed(big.delta, u)}.`
  if (/\b(high\w*|peak|max\w*|best|top|most)\b/.test(q)) return peak
  if (/\b(low\w*|min\w*|worst|least|bottom)\b/.test(q)) return `The lowest point is ${min.label} at ${fmt(min.value, u)}.`
  if (/\b(average|mean|typical)\b/.test(q)) return `The average is ${fmt(avg, u)} across ${s.length} points.`
  if (/\b(how many|points|count|periods)\b/.test(q)) return `It has ${s.length} points, from ${first.label} to ${last.label}.`
  if (/\b(trend\w*|change\w*|grow\w*|increas\w*|decreas\w*|ris\w*|fall\w*|drop\w*|up|down|direction)\b/.test(q)) return trend
  return `${trend} ${peak}`
}

/**
 * Answers a question about one object: Gemini when the dev server has a key, otherwise
 * a local answer from the object's data, labelled as such.
 */
export async function answerQuestion(question: string, obj: SpatialObject, objects: SpatialObject[], signal?: AbortSignal): Promise<Answer> {
  try {
    const a = await askGemini({ text: question }, { object: obj, objects }, signal, 'explain')
    return { question, text: cleanAnswer(a.reply), source: 'ai', label: `Gemini${a.model ? ` · ${a.model}` : ''}` }
  } catch (e) {
    // No key on this laptop (503) or no dev server (0): answer from the card's own data.
    if (e instanceof GeminiError && (e.status === 503 || e.status === 0)) {
      return { question, text: localAnswer(obj, question), source: 'local', label: 'Local answer from the card’s data · no AI connected' }
    }
    throw e
  }
}
