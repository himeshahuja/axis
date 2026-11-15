// Agent figures on the slide: a graph, chart or image the Explain agent made becomes an
// ordinary slide object, so the hand can grab and move it like any other card, and Explain
// and Remember work on it too (its content carries the figure's data).
//
// Every page adds it the same way (rt.interaction.add); each page only has to draw `figure`.

import type { SpatialRuntime } from '../runtime'
import type { SpatialObject, SpatialObjectContent } from '../types'
import type { AgentFigure } from './actions/agentTypes'

export const FIGURE_PREFIX = 'figure-'
export const isFigure = (o: SpatialObject) => !!o.figure

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Size on a 16:9 stage, as fractions of its width and height. */
export function figureSize(f: AgentFigure): { w: number; h: number } {
  if (f.type === 'chart' && f.kind === 'pie') return { w: 0.28, h: 0.4 }
  return { w: 0.3, h: 0.4 }
}

export function figureTitle(f: AgentFigure): string {
  if (f.type === 'image') return 'Figure'
  if (f.title) return f.title
  return f.type === 'graph' ? f.expressions.join(', ') : 'Chart'
}

/** What the figure means, as data the other actions already read. */
function contentFor(f: AgentFigure): SpatialObjectContent {
  if (f.type === 'chart') return { kind: 'chart', unit: f.unit, series: f.points.map((p) => ({ label: p.label, value: p.value })) }
  if (f.type === 'graph') return { kind: 'note', text: `Graph of ${f.expressions.join(', ')}` }
  return { kind: 'note', text: 'A figure the assistant drew' }
}

let seq = 0

export function figureObject(f: AgentFigure, at: { x: number; y: number }): SpatialObject {
  const { w, h } = figureSize(f)
  return { id: `${FIGURE_PREFIX}${Date.now().toString(36)}${++seq}`, label: figureTitle(f), color: '#151517', shape: 'card', x: at.x, y: at.y, w, h, content: contentFor(f), figure: f }
}

const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))

/**
 * The top-left for a `size` box inside `area` that covers as little of `avoid` as possible and
 * stays near `near`. Covering a whole box costs as much as two stage heights of distance.
 */
export function findSpot(size: { w: number; h: number }, near: Rect, avoid: Rect[], aspect: number, area = { top: 0.04, bottom: 0.96, left: 0.02, right: 0.98 }) {
  const pad = 0.012
  const blocks = avoid.map((r) => ({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }))
  let best = { x: Math.max(area.left, Math.min(area.right - size.w, near.x)), y: Math.max(area.top, Math.min(area.bottom - size.h, near.y)), score: Infinity }
  for (let y = area.top; y <= area.bottom - size.h + 1e-9; y += 0.01) {
    for (let x = area.left; x <= area.right - size.w + 1e-9; x += 0.01) {
      const r = { x, y, ...size }
      const cover = blocks.reduce((s, b) => s + overlap(r, b), 0) / (size.w * size.h)
      const dist = Math.hypot((x + size.w / 2 - near.x - near.w / 2) * aspect, y + size.h / 2 - near.y - near.h / 2)
      const score = cover + dist / 2
      if (score < best.score) best = { x, y, score }
    }
  }
  return { x: best.x, y: best.y }
}

export interface PlaceOptions {
  /** Where the presenter let go: the figure's centre, in stage fractions. Else a clear spot is found. */
  at?: { x: number; y: number }
  /** The object the figure is about: a clear spot is looked for near it. */
  near?: Rect
  /** Also keep clear of these (the Explain card), in stage fractions. */
  avoid?: Rect[]
  /** The part of the stage figures may go in (the pitch keeps its headline clear). */
  area?: { top: number; bottom: number; left: number; right: number }
}

/** Puts a figure on the slide, or moves it if it is already there. Returns the object. */
export function placeFigure(rt: SpatialRuntime, f: AgentFigure, opts: PlaceOptions = {}): SpatialObject {
  const ix = rt.interaction
  const area = opts.area ?? { top: 0.04, bottom: 0.96, left: 0.02, right: 0.98 }
  const existing = ix.objects.find((o) => o.figure === f)
  const size = existing ? { w: existing.w, h: existing.h } : figureSize(f)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  let pos: { x: number; y: number }
  if (opts.at) pos = { x: clamp(opts.at.x - size.w / 2, area.left, area.right - size.w), y: clamp(opts.at.y - size.h / 2, area.top, area.bottom - size.h) }
  else if (existing) return existing
  else {
    pos = findSpot(size, opts.near ?? { x: 0.5 - size.w / 2, y: 0.5 - size.h / 2, ...size }, [...ix.objects, ...(opts.avoid ?? [])], ix.aspect, area)
  }
  const o = existing ? { ...existing, ...pos } : figureObject(f, pos)
  ix.add(o) // notifies the page
  return o
}
