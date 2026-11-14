import type { VoicePhrase } from './scenes'

const norm = (t: string) => t.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ')

/**
 * Loose on wording, strict on meaning: speech-to-text varies ("difference" /
 * "different", "interfaces" / "interface"), but both ideas must be present.
 */
const MATCHERS: Record<VoicePhrase, (t: string) => boolean> = {
  difference_question: (t) => /\bdifferen(ce|t|ces)\b/.test(t) && /\b(conventional|traditional|normal|regular|old|usual)\b|\binterfaces?\b/.test(t),
}

export function matchesPhrase(phrase: VoicePhrase, transcript: string) {
  return MATCHERS[phrase](norm(transcript))
}
