import { describe, expect, it } from 'vitest'
import type { AgentFigure } from '../radial/actions/agentTypes'
import { figureObject, findSpot, placeFigure } from '../radial/figures'
import type { SpatialRuntime } from '../runtime'
import type { SpatialObject } from '../types'

const pie: AgentFigure = { type: 'chart', kind: 'pie', title: 'Revenue', unit: '$k', points: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] }
const graph: AgentFigure = { type: 'graph', expressions: ['y=x^2-3'] }

/** Just enough of the runtime: the objects and the interaction engine's add(). */
function fakeRuntime(objects: SpatialObject[] = []) {
  const ix = {
    objects,
    aspect: 16 / 9,
    add(o: SpatialObject) {
      ix.objects = [...ix.objects.filter((x) => x.id !== o.id), { ...o }]
    },
  }
  return { interaction: ix } as unknown as SpatialRuntime & { interaction: typeof ix }
}

describe('agent figures on the slide', () => {
  it('carries the figure and data the other actions can read', () => {
    const chart = figureObject(pie, { x: 0.1, y: 0.2 })
    expect(chart).toMatchObject({ label: 'Revenue', x: 0.1, y: 0.2, figure: pie, content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }] } })
    expect(figureObject(graph, { x: 0, y: 0 })).toMatchObject({ label: 'y=x^2-3', content: { kind: 'note', text: 'Graph of y=x^2-3' } })
    expect(figureObject(graph, { x: 0, y: 0 }).id).not.toBe(figureObject(graph, { x: 0, y: 0 }).id)
  })

  it('finds a clear spot near the object instead of covering it', () => {
    const near = { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }
    const spot = findSpot({ w: 0.3, h: 0.4 }, near, [near], 16 / 9)
    const r = { ...spot, w: 0.3, h: 0.4 }
    const overlapX = Math.max(0, Math.min(r.x + r.w, near.x + near.w) - Math.max(r.x, near.x))
    const overlapY = Math.max(0, Math.min(r.y + r.h, near.y + near.h) - Math.max(r.y, near.y))
    expect(overlapX * overlapY).toBeLessThan(0.002)
    expect(r.x + r.w).toBeLessThanOrEqual(0.98 + 1e-9)
    expect(r.y + r.h).toBeLessThanOrEqual(0.96 + 1e-9)
  })

  it('drops a dragged figure centred where the mouse let go, kept on the stage', () => {
    const rt = fakeRuntime()
    const o = placeFigure(rt, graph, { at: { x: 0.5, y: 0.5 } })
    expect(o.x).toBeCloseTo(0.5 - o.w / 2)
    expect(o.y).toBeCloseTo(0.5 - o.h / 2)
    const edge = placeFigure(rt, pie, { at: { x: 0.99, y: 0.01 }, area: { top: 0.22, bottom: 0.9, left: 0.02, right: 0.98 } })
    expect(edge.x + edge.w).toBeCloseTo(0.98)
    expect(edge.y).toBeCloseTo(0.22)
  })

  it('moves a figure that is already on the slide instead of adding a copy', () => {
    const rt = fakeRuntime()
    const first = placeFigure(rt, pie, {})
    expect(placeFigure(rt, pie, {})).toEqual(first) // "Put on slide" again: nothing changes
    const moved = placeFigure(rt, pie, { at: { x: 0.6, y: 0.6 } })
    expect(moved.id).toBe(first.id)
    expect(rt.interaction.objects.filter((x) => x.figure === pie)).toHaveLength(1)
    expect(rt.interaction.objects[0].x).toBeCloseTo(0.6 - first.w / 2)
  })
})
