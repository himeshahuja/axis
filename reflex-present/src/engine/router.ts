// Decision-driven inference router (Section 5.C). For the P0 slice every
// resolved command is deterministic (DIRECT) or needs clarification
// (CLARIFY); SMALL_MODEL / LARGE_MODEL / VISION_MODEL are routes a real
// classifier or LLM call would occupy later (P3/P4) — the telemetry log
// already has a column for it so "LLM calls avoided" is measurable from day one.

import type { ResolvedIntent, RouteKind, RouterTelemetryEntry } from '../types'

let counter = 0
export const telemetry: RouterTelemetryEntry[] = []

export function route(intent: ResolvedIntent): RouteKind {
  if (intent.requiresClarification || intent.intent === 'unknown') return 'CLARIFY'
  return 'DIRECT'
}

export function logDecision(input: string, routeKind: RouteKind, latencyMs: number, success: boolean) {
  telemetry.push({
    id: `t${++counter}`,
    timestamp: Date.now(),
    input,
    route: routeKind,
    latencyMs,
    tokensUsed: 0, // every route here is local computation — zero tokens spent
    success,
  })
}
