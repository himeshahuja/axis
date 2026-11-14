// One memory collection for the whole site, built on the app's own
// LocalMemoryStore (kept under its own key so it never mixes with the live demo's).

import { useSyncExternalStore } from 'react'
import { LocalMemoryStore, type MemoryEntry } from '../spatial/radial/actions/memory'

const store = new LocalMemoryStore('site.memory.v1')
let snapshot: MemoryEntry[] = store.list()
const subs = new Set<() => void>()

export const siteMemory = {
  label: 'Saved in this browser only',
  add(entry: MemoryEntry) {
    store.add(entry)
    snapshot = store.list()
    subs.forEach((f) => f())
  },
  clear() {
    try {
      localStorage.removeItem('site.memory.v1')
    } catch {
      // storage blocked
    }
    // LocalMemoryStore has no clear(); swap in a fresh one by emptying its list.
    store.list().length = 0
    snapshot = []
    subs.forEach((f) => f())
  },
}

export function useMemories() {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => snapshot,
  )
}
