// Voice: binds a transcript to the selected object and runs it through the
// app's existing deterministic resolver (src/engine/resolver.ts) as a
// *preview*. Nothing is executed from speech in this milestone.

import { resolve } from '../../../engine/resolver'
import type { ResolvedIntent, Slide, SlideObject } from '../../../types'
import type { SpatialObject } from '../../types'

export interface VoiceCommandPreview {
  transcript: string
  objectId: string
  objectTitle: string
  /** The transcript with "this / that / it" bound to the selected object. */
  bound: string
  intent: ResolvedIntent['intent']
  objectTitles: string[]
  parameters: Record<string, unknown>
  requiresClarification: boolean
  clarificationPrompt?: string
  /** A deterministic result the preview can already show (e.g. latest vs previous point). */
  computed?: string
}

function computeQuarterCompare(obj: SpatialObject): string | undefined {
  const c = obj.content
  if (c?.kind !== 'chart' || c.series.length < 2) return undefined
  const cur = c.series[c.series.length - 1]
  const prev = c.series[c.series.length - 2]
  const d = cur.value - prev.value
  const p = prev.value !== 0 ? ` (${d >= 0 ? '+' : '−'}${Math.abs((d / prev.value) * 100).toFixed(1)}%)` : ''
  return `${cur.label} ${cur.value} vs ${prev.label} ${prev.value}: ${d >= 0 ? '+' : '−'}${Math.abs(d)}${p}`
}

const DEICTIC = /\b(this|that|it)\b/gi

function toSlide(objects: SpatialObject[]): Slide {
  const slideObjects: SlideObject[] = []
  for (const o of objects) {
    const c = o.content
    if (c?.kind === 'chart') slideObjects.push({ id: o.id, type: 'chart', title: o.label, x: o.x, y: o.y, w: o.w, h: o.h, series: c.series })
    else if (c?.kind === 'metric') slideObjects.push({ id: o.id, type: 'metric', title: o.label, x: o.x, y: o.y, w: o.w, h: o.h, value: c.value, format: c.format })
  }
  return { id: 'spatial', title: 'Spatial canvas', objects: slideObjects }
}

export function previewVoiceCommand(transcript: string, selected: SpatialObject, objects: SpatialObject[]): VoiceCommandPreview {
  const bound = transcript.replace(DEICTIC, `the ${selected.label}`)
  const r = resolve(bound, toSlide(objects))
  // The selected object is what "this" means: make sure it leads the object list.
  const ids = r.objectIds.includes(selected.id) ? [selected.id, ...r.objectIds.filter((id) => id !== selected.id)] : [selected.id, ...r.objectIds]
  const title = (id: string) => objects.find((o) => o.id === id)?.label ?? id
  return {
    transcript,
    objectId: selected.id,
    objectTitle: selected.label,
    bound,
    intent: r.intent,
    objectTitles: ids.map(title),
    parameters: r.parameters,
    requiresClarification: r.requiresClarification,
    clarificationPrompt: r.clarificationPrompt,
    computed: r.intent === 'compare' && r.parameters.comparisonPeriod === 'previous_quarter' ? computeQuarterCompare(selected) : undefined,
  }
}
