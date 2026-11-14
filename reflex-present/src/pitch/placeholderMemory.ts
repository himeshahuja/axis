// Demo memory the pitch starts with on every load, so the Memory view shows a working
// history rather than one chart remembered over and over. Placeholder content for the demo.

import type { MemoryEntry } from '../spatial/radial/actions/memory'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const entry = (title: string, type: string, content: MemoryEntry['content'], ago: number): MemoryEntry => ({
  id: `placeholder-${title}`,
  createdAt: minutesAgo(ago),
  objectId: `placeholder-${title}`,
  title,
  type,
  content,
  canvas: { bounds: { x: 0, y: 0, w: 0, h: 0 }, neighbours: [] },
  store: 'local',
})

/** Oldest first (saved in this order, shown newest first). */
export const PLACEHOLDER_MEMORY = (): MemoryEntry[] => [
  entry('Q3 review — action items', 'note', { kind: 'note', text: 'Hire two support engineers before launch' }, 190),
  entry('Customer call: Northwind', 'note', { kind: 'note', text: 'Wants single sign-on before rolling out' }, 140),
  entry('Conversion rate', 'metric', { kind: 'metric', value: 0.12, format: 'percent' }, 95),
  entry('Pricing page draft', 'note', { kind: 'note', text: 'Three tiers, annual discount' }, 50),
  entry('Launch checklist', 'note', { kind: 'note', text: 'Docs, status page, changelog' }, 20),
]
