// Explain: describes an object from its own data. This repository has no AI
// explanation service (the kit's rules keep model keys out of web pages), so
// the only provider today is a deterministic local summary, labelled as such.
// An AI provider plugs in behind the same interface later (e.g. a small local
// Python bridge using vexo-open-kit/examples/python/ai.py).

import type { SpatialObject } from '../../types'

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
