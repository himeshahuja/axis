// Remember: a structured snapshot of an object, saved locally.
//
// Vexo check: the band has no memory API. Its only write is a key-value store
// (keys 0..999, 232 bytes each) that the kit's rules call not private: whoever
// connects next can read or erase it. So nothing is written to the band; entries
// stay in this browser, and the UI says so.

import type { SpatialObject, SpatialObjectContent } from '../../types'

export interface MemoryEntry {
  id: string
  createdAt: string
  objectId: string
  title: string
  type: string
  content: SpatialObjectContent | null
  canvas: {
    /** Object rectangle, canvas-normalized. */
    bounds: { x: number; y: number; w: number; h: number }
    /** The other objects on the canvas when it was saved (labels only). */
    neighbours: string[]
  }
  store: 'local'
}

export interface MemoryStore {
  readonly kind: 'local'
  readonly label: string
  list(): MemoryEntry[]
  add(entry: MemoryEntry): void
}

export function memoryEntryFor(obj: SpatialObject, all: SpatialObject[], now = new Date()): MemoryEntry {
  return {
    id: `${obj.id}-${now.getTime()}`,
    createdAt: now.toISOString(),
    objectId: obj.id,
    title: obj.label,
    type: obj.content?.kind ?? obj.shape,
    content: obj.content ? structuredClone(obj.content) : null,
    canvas: {
      bounds: { x: obj.x, y: obj.y, w: obj.w, h: obj.h },
      neighbours: all.filter((o) => o.id !== obj.id).map((o) => o.label),
    },
    store: 'local',
  }
}

export class LocalMemoryStore implements MemoryStore {
  readonly kind = 'local' as const
  readonly label = 'Saved in this browser (Vexo has no memory API)'
  private entries: MemoryEntry[] = []
  private key: string

  constructor(key = 'reflex.memory.v1', persist = true) {
    this.key = persist ? key : ''
    if (!this.key) return
    try {
      const raw = localStorage.getItem(this.key)
      if (raw) this.entries = JSON.parse(raw) as MemoryEntry[]
    } catch {
      this.entries = []
    }
  }

  list() {
    return this.entries
  }

  add(entry: MemoryEntry) {
    this.entries = [entry, ...this.entries].slice(0, 200)
    if (!this.key) return
    try {
      localStorage.setItem(this.key, JSON.stringify(this.entries))
    } catch {
      // storage blocked: kept for this page only
    }
  }
}
