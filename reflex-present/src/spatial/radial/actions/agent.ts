// The page's side of the agent endpoint (server/agent/). The key stays on the dev server; the
// page sends the question, the slide's objects and a screenshot of the selected one.

import type { SpatialObject } from '../../types'
import type { AgentArtifact, AgentObject, AgentRequest, AgentResult, AgentStep } from './agentTypes'
import { GeminiError } from './gemini'

export type { AgentArtifact, AgentResult, AgentStep } from './agentTypes'

export const toAgentObject = (o: SpatialObject): AgentObject => ({ id: o.id, label: o.label, content: o.content ?? undefined })

/** Throws GeminiError: status 503 means no key on the server, 0 means no dev server. */
export async function askAgent(req: AgentRequest, signal?: AbortSignal): Promise<AgentResult> {
  let r: Response
  try {
    r = await fetch('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req), signal })
  } catch (e) {
    if (signal?.aborted) throw e
    throw new GeminiError('Could not reach the agent on the dev server.', 0)
  }
  // A static host without the dev server answers 404 (or HTML): treat it as no server.
  if (r.status === 404) throw new GeminiError('The agent endpoint is not running (start the app with npm run dev).', 0)
  const j = (await r.json().catch(() => ({}))) as Partial<AgentResult> & { error?: string }
  if (!r.ok) throw new GeminiError(j.error ?? `The agent answered status ${r.status}.`, r.status)
  if (typeof j.reply !== 'string') throw new GeminiError('The agent sent no reply.', r.status)
  return { reply: j.reply, artifacts: j.artifacts ?? [], steps: j.steps ?? [], model: j.model ?? '', turns: j.turns ?? 1, ms: j.ms ?? 0 }
}

/** True when an answer has something to draw (not only code), so its card makes room. */
export const hasVisual = (artifacts?: AgentArtifact[]) => !!artifacts?.some((a) => a.type !== 'code')

const TOOL_NAME: Record<string, string> = {
  plot_graph: 'Desmos graph',
  make_chart: 'chart',
  read_slide_object: 'read',
  python: 'Python',
}

/** "Desmos graph · Python · read Conversion", for the line under an answer. */
export function describeSteps(steps: AgentStep[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of steps) {
    const name = TOOL_NAME[s.tool] ?? s.tool
    const label = s.tool === 'read_slide_object' && s.detail ? `${name} ${s.detail}` : name
    if (seen.has(label)) continue
    seen.add(label)
    out.push(s.ok ? label : `${label} (failed)`)
  }
  return out.join(' · ')
}
