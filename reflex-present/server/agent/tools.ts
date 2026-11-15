// The agent's own tools. Each one is a Gemini function declaration plus a server-side runner
// that checks the model's arguments and returns (a) what the model reads back and (b) at most
// one artifact for the Explain card to draw. Nothing here runs code the model wrote: Python
// runs in Gemini's own code-execution sandbox (see loop.ts), never on this laptop.
//
// Adding a tool: write its declaration and runner below and add it to TOOLS. `display` tools
// only draw something; when the model already wrote its reply in the same turn, the loop
// stops there instead of spending another model call.

import type { AgentArtifact, AgentObject, AgentStep } from '../../src/spatial/radial/actions/agentTypes.ts'

export interface ToolContext {
  object?: AgentObject
  others: AgentObject[]
}

export interface ToolOutcome {
  /** What the model reads back as the function's result. */
  response: Record<string, unknown>
  artifact?: AgentArtifact
  step: AgentStep
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface AgentTool {
  declaration: FunctionDeclaration
  display: boolean
  run(args: Record<string, unknown>, ctx: ToolContext): ToolOutcome
}

const fail = (tool: string, error: string, detail?: string): ToolOutcome => ({ response: { error }, step: { tool, detail, ok: false } })
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// ---- plot_graph: an interactive Desmos graph ------------------------------------------------
const plotGraph: AgentTool = {
  display: true,
  declaration: {
    name: 'plot_graph',
    description:
      'Draw an interactive graph on a Desmos graphing calculator in the presenter’s card. Use it whenever the presenter asks to graph, plot or draw a function, equation, inequality, set of points or curve. Write each expression in Desmos LaTeX, one per item.',
    parameters: {
      type: 'OBJECT',
      properties: {
        expressions: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Desmos LaTeX, one per item, e.g. "y=x^2-3", "f(x)=\\sin(x)", "y<2x+1", "(1,2)", "(\\cos t,\\sin t)". At most 8.',
        },
        title: { type: 'STRING', description: 'A short caption for the graph.' },
        x_min: { type: 'NUMBER' },
        x_max: { type: 'NUMBER' },
        y_min: { type: 'NUMBER' },
        y_max: { type: 'NUMBER', description: 'Optional viewport; give all four or none.' },
      },
      required: ['expressions'],
    },
  },
  run(args) {
    const raw = Array.isArray(args.expressions) ? args.expressions : typeof args.expressions === 'string' ? [args.expressions] : []
    const expressions = raw.map((e) => text(e, 240)).filter(Boolean).slice(0, 8)
    if (expressions.length === 0) return fail('plot_graph', 'Give at least one expression in Desmos LaTeX, e.g. "y=x^2".')
    const { x_min, x_max, y_min, y_max } = args
    const bounds = finite(x_min) && finite(x_max) && finite(y_min) && finite(y_max) && x_min < x_max && y_min < y_max ? { left: x_min, right: x_max, bottom: y_min, top: y_max } : undefined
    const title = text(args.title, 80) || undefined
    return {
      response: { shown: true, expressions, note: 'The graph is on the presenter’s card now.' },
      artifact: { type: 'graph', expressions, title, bounds },
      step: { tool: 'plot_graph', detail: expressions.join(', '), ok: true },
    }
  },
}

// ---- make_chart: a bar / line / area / pie chart of labelled values ---------------------------
const CHART_KINDS = ['bar', 'line', 'area', 'pie'] as const
type ChartKind = (typeof CHART_KINDS)[number]

const makeChart: AgentTool = {
  display: true,
  declaration: {
    name: 'make_chart',
    description:
      'Draw a bar, line, area or pie chart of labelled values in the presenter’s card. Use it to chart data from the selected object, its screenshot, another slide object or numbers the presenter gives. Never invent values.',
    parameters: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: [...CHART_KINDS] },
        title: { type: 'STRING' },
        unit: { type: 'STRING', description: 'Unit of the values, e.g. "$", "%", "users".' },
        points: {
          type: 'ARRAY',
          description: 'The values in order, at most 40.',
          items: { type: 'OBJECT', properties: { label: { type: 'STRING' }, value: { type: 'NUMBER' } }, required: ['label', 'value'] },
        },
      },
      required: ['kind', 'points'],
    },
  },
  run(args) {
    const kind = (CHART_KINDS as readonly string[]).includes(String(args.kind)) ? (args.kind as ChartKind) : 'bar'
    const raw = Array.isArray(args.points) ? args.points : []
    const points = raw
      .map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>) : {}))
      .map((p) => ({ label: text(p.label, 40), value: typeof p.value === 'string' ? Number(p.value) : p.value }))
      .filter((p): p is { label: string; value: number } => p.label.length > 0 && finite(p.value))
      .slice(0, 40)
    if (points.length === 0) return fail('make_chart', 'Give at least one point as {label, value} with a numeric value.')
    const title = text(args.title, 80) || undefined
    const unit = text(args.unit, 12) || undefined
    return {
      response: { shown: true, kind, points: points.length, note: 'The chart is on the presenter’s card now.' },
      artifact: { type: 'chart', kind, title, unit, points },
      step: { tool: 'make_chart', detail: `${kind}${title ? ` · ${title}` : ''}`, ok: true },
    }
  },
}

// ---- read_slide_object: another object's data -------------------------------------------------
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

export function findObject(name: string, ctx: ToolContext): AgentObject | null {
  const all = [...(ctx.object ? [ctx.object] : []), ...ctx.others]
  const n = norm(name)
  if (!n) return null
  return all.find((o) => norm(o.label) === n) ?? all.find((o) => norm(o.label).includes(n) || n.includes(norm(o.label))) ?? null
}

const readSlideObject: AgentTool = {
  display: false,
  declaration: {
    name: 'read_slide_object',
    description: 'Read the data of another object on the slide by its name, e.g. to compare it with the selected object. The selected object’s own data is already in the prompt.',
    parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'The object’s name as listed.' } }, required: ['name'] },
  },
  run(args, ctx) {
    const name = text(args.name, 120)
    const o = findObject(name, ctx)
    if (!o) return { response: { found: false, available: ctx.others.map((x) => x.label) }, step: { tool: 'read_slide_object', detail: name, ok: false } }
    return { response: { found: true, name: o.label, data: o.content ?? null }, step: { tool: 'read_slide_object', detail: o.label, ok: true } }
  },
}

export const TOOLS: Record<string, AgentTool> = {
  plot_graph: plotGraph,
  make_chart: makeChart,
  read_slide_object: readSlideObject,
}

export function runTool(name: string, args: unknown, ctx: ToolContext): ToolOutcome & { display: boolean } {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined
  if (!tool) return { ...fail(name, `There is no tool called ${name}.`), display: false }
  const a = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  try {
    return { ...tool.run(a, ctx), display: tool.display }
  } catch (e) {
    return { ...fail(name, `The tool failed: ${e instanceof Error ? e.message : String(e)}`), display: false }
  }
}
