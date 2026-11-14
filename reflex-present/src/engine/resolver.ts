// Semantic object resolver (Section 5.B). Deterministic matching first —
// this is what makes the demo reliable without a live LLM call in the loop.
// An LLM-backed fallback for genuinely ambiguous references is a clear
// extension point (see router.ts) but isn't wired to a real endpoint here:
// calling a model API straight from the browser would mean shipping a secret
// key in client code, which this scaffold deliberately avoids.

import type { ResolvedIntent, Slide, SlideObject } from '../types'

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'and', 'with', 'of', 'this', 'that', 'show', 'me',
  'please', 'what', 'happens', 'if', 'put', 'beside',
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, ' ')
    .split(/\s+/)
    // drop stopwords and symbol-only fragments (a lone "%" must never act as
    // a wildcard that matches any instruction mentioning a percentage)
    .filter((w) => w && !STOPWORDS.has(w) && /[a-z0-9]/.test(w))
}

const PERIOD_PHRASE_RE = /\b(last|previous|prior|next|this)\s+(year|quarter|period)\b/g

/** Strip temporal-period phrases ("to last year") before scoring objects, so
 * a stray "year"/"quarter" token doesn't bias matching toward an object whose
 * id/title happens to contain it (e.g. "revenue_chart_prev_year"). */
function objectTokens(text: string): string[] {
  return words(text.replace(PERIOD_PHRASE_RE, ' '))
}

/** Score an object against the instruction by word overlap with its id/title. */
function scoreObject(obj: SlideObject, tokens: string[]): number {
  const haystack = words(`${obj.title} ${obj.id}`)
  let score = 0
  for (const t of tokens) {
    // Exact match always counts; partial (substring) match only for tokens
    // long enough that a coincidental overlap is unlikely.
    const partialOk = t.length >= 4
    if (haystack.some((h) => h === t || (partialOk && h.length >= 4 && (h.includes(t) || t.includes(h))))) score += 1
  }
  return score
}

function bestMatches(slide: Slide, tokens: string[]): SlideObject[] {
  const scored = slide.objects
    .map((obj) => ({ obj, score: scoreObject(obj, tokens) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return []
  const top = scored[0].score
  return scored.filter((s) => s.score === top).map((s) => s.obj)
}

const PERCENT_RE = /(-?\d+(?:\.\d+)?)\s*%/
const DECREASE_WORDS = ['decrease', 'decreases', 'slow', 'slows', 'drop', 'drops', 'down', 'fall', 'falls']
const INCREASE_WORDS = ['increase', 'increases', 'grow', 'grows', 'up', 'rise', 'rises']

export function resolve(instruction: string, slide: Slide): ResolvedIntent {
  const text = instruction.toLowerCase().trim()
  const tokens = objectTokens(text)

  if (/\bnext slide\b/.test(text)) {
    return { intent: 'next_slide', objectIds: [], parameters: {}, requiresClarification: false }
  }
  if (/\b(previous|prev|back|last) slide\b/.test(text)) {
    return { intent: 'previous_slide', objectIds: [], parameters: {}, requiresClarification: false }
  }

  if (/\bcompare\b/.test(text) || /\bversus\b|\bvs\.?\b/.test(text)) {
    const matches = bestMatches(slide, tokens)
    if (matches.length >= 2) {
      return {
        intent: 'compare',
        objectIds: [matches[0].id, matches[1].id],
        parameters: {},
        requiresClarification: false,
      }
    }
    const period = text.match(/\b(?:last|previous|prior)\s+(year|quarter)\b/)?.[1]
    if (matches.length === 1 && period === 'quarter') {
      // "compare X with last quarter": X's latest point against its previous one.
      return {
        intent: 'compare',
        objectIds: [matches[0].id],
        parameters: { comparisonPeriod: 'previous_quarter' },
        requiresClarification: false,
      }
    }
    if (matches.length === 1) {
      // "compare X to last year" — look for a sibling object as the comparison target.
      const sibling = slide.objects.find(
        (o) => o.id !== matches[0].id && (o.id.startsWith(matches[0].id) || matches[0].id.startsWith(o.id.split('_prev')[0]))
      )
      if (sibling) {
        return {
          intent: 'compare',
          objectIds: [matches[0].id, sibling.id],
          parameters: { comparisonPeriod: 'previous_year' },
          requiresClarification: false,
        }
      }
      return {
        intent: 'compare',
        objectIds: [matches[0].id],
        parameters: { comparisonPeriod: 'previous_year' },
        requiresClarification: true,
        clarificationPrompt: `Compare "${matches[0].title}" to what? I couldn't find a matching prior-period object.`,
      }
    }
    return {
      intent: 'unknown',
      objectIds: [],
      parameters: {},
      requiresClarification: true,
      clarificationPrompt: "Which objects should I compare?",
    }
  }

  if (/\bwhat happens if\b|\bscenario\b/.test(text)) {
    const matches = bestMatches(slide, tokens)
    const pct = text.match(PERCENT_RE)
    const direction = DECREASE_WORDS.some((w) => text.includes(w))
      ? 'decrease'
      : INCREASE_WORDS.some((w) => text.includes(w))
        ? 'increase'
        : 'increase'
    if (matches.length >= 1 && pct) {
      return {
        intent: 'scenario',
        objectIds: [matches[0].id],
        parameters: { percent: Math.abs(parseFloat(pct[1])), direction },
        requiresClarification: false,
      }
    }
    return {
      intent: 'unknown',
      objectIds: matches.map((m) => m.id),
      parameters: {},
      requiresClarification: true,
      clarificationPrompt: 'Which object, and by what percentage?',
    }
  }

  if (/\bhighlight\b.*\bchange\b|\bbiggest change\b/.test(text)) {
    return { intent: 'highlight_change', objectIds: [], parameters: {}, requiresClarification: false }
  }

  if (/\bsummarize\b/.test(text)) {
    const matches = bestMatches(slide, tokens)
    if (matches.length >= 1) {
      return { intent: 'summarize', objectIds: [matches[0].id], parameters: {}, requiresClarification: false }
    }
    return {
      intent: 'unknown',
      objectIds: [],
      parameters: {},
      requiresClarification: true,
      clarificationPrompt: 'Summarize which object?',
    }
  }

  const matches = bestMatches(slide, tokens)
  if (matches.length === 1) {
    return { intent: 'select', objectIds: [matches[0].id], parameters: {}, requiresClarification: false }
  }
  if (matches.length > 1) {
    return {
      intent: 'select',
      objectIds: matches.map((m) => m.id),
      parameters: {},
      requiresClarification: true,
      clarificationPrompt: `Did you mean ${matches.map((m) => `"${m.title}"`).join(' or ')}?`,
    }
  }

  return {
    intent: 'unknown',
    objectIds: [],
    parameters: {},
    requiresClarification: true,
    clarificationPrompt: "I didn't catch an object or action in that — try again?",
  }
}
