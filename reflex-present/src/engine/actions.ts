// Deterministic transformations (Section 10: "prefer deterministic
// mathematical operations over LLM-generated numerical calculations").
// Every number here comes from the slide's real structured data.

import type { ActionResult, ChartObject, ResolvedIntent, Slide, SlideObject } from '../types'

function isChart(obj: SlideObject | undefined): obj is ChartObject {
  return !!obj && obj.type === 'chart'
}

function findObject(slide: Slide, id: string): SlideObject | undefined {
  return slide.objects.find((o) => o.id === id)
}

function placeBeside(anchor: SlideObject, offset = 40): Pick<SlideObject, 'x' | 'y' | 'w' | 'h'> {
  return { x: anchor.x + anchor.w + offset, y: anchor.y, w: anchor.w, h: anchor.h }
}

export function execute(intent: ResolvedIntent, slide: Slide): ActionResult {
  switch (intent.intent) {
    case 'select': {
      return { highlightIds: intent.objectIds }
    }

    case 'compare': {
      const [aId, bId] = intent.objectIds
      const a = findObject(slide, aId)
      const b = bId ? findObject(slide, bId) : undefined
      if (!isChart(a) || !isChart(b)) {
        return { highlightIds: intent.objectIds, message: 'Need two charts with matching categories to compare.' }
      }
      const byLabel = new Map(b.series.map((d) => [d.label, d.value]))
      const changeSeries = a.series.map((d) => {
        const prev = byLabel.get(d.label)
        const pct = prev ? ((d.value - prev) / prev) * 100 : 0
        return { label: d.label, value: Math.round(pct * 10) / 10 }
      })
      const newChart: ChartObject = {
        id: `${a.id}_vs_${b.id}_change`,
        type: 'chart',
        title: `${a.title} vs ${b.title}: % Change`,
        ...placeBeside(b),
        series: changeSeries,
        derivedFrom: a.id,
      }
      return { highlightIds: [a.id, b.id], newObjects: [newChart] }
    }

    case 'scenario': {
      const [id] = intent.objectIds
      const obj = findObject(slide, id)
      const percent = Number(intent.parameters.percent ?? 0)
      const direction = intent.parameters.direction === 'decrease' ? -1 : 1
      const factor = 1 + (direction * percent) / 100
      if (!isChart(obj)) {
        return { highlightIds: intent.objectIds, message: 'Scenario transforms need a chart object.' }
      }
      const projected = obj.series.map((d, i) => {
        if (i === 0) return { ...d }
        return { label: d.label, value: Math.round(d.value * factor * 100) / 100 }
      })
      const newChart: ChartObject = {
        id: `${obj.id}_scenario`,
        type: 'chart',
        title: `${obj.title}: ${direction > 0 ? '+' : '-'}${percent}% scenario`,
        ...placeBeside(obj),
        series: projected,
        derivedFrom: obj.id,
      }
      return { highlightIds: [obj.id], newObjects: [newChart] }
    }

    case 'highlight_change': {
      const charts = slide.objects.filter(isChart)
      let biggestId: string | null = null
      let biggestDelta = -Infinity
      for (const c of charts) {
        for (let i = 1; i < c.series.length; i++) {
          const delta = Math.abs(c.series[i].value - c.series[i - 1].value)
          if (delta > biggestDelta) {
            biggestDelta = delta
            biggestId = c.id
          }
        }
      }
      return { highlightIds: biggestId ? [biggestId] : [], message: biggestId ? `Biggest change: ${biggestId}` : 'No change to highlight.' }
    }

    case 'summarize': {
      const obj = findObject(slide, intent.objectIds[0])
      if (!isChart(obj)) return { highlightIds: intent.objectIds, message: 'Nothing to summarize.' }
      const values = obj.series.map((d) => d.value)
      const min = Math.min(...values)
      const max = Math.max(...values)
      const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      return {
        highlightIds: [obj.id],
        message: `${obj.title}: min ${min}, max ${max}, avg ${avg} across ${values.length} points.`,
      }
    }

    default:
      return { highlightIds: [], message: intent.clarificationPrompt ?? 'Not sure what to do.' }
  }
}
