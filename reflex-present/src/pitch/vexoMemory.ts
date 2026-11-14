// Remember → the Vexo band itself. Checked against vexo-open-kit/docs/api.md: the kit has no
// "context" or memory API; the only thing a program can save on the wristband is its
// key-value storage (keys 0..999, values up to 232 bytes, `band.storage.put/getText/delete`).
// So each remembered object is written there as a compact JSON line, and the memory view
// reads them back from the band, so what it shows is what the band actually holds.
//
// The kit's rule: storage is not private (the next person who connects can read it), so only
// object titles and their numbers go in, never anything personal.

import type { MemoryEntry } from '../spatial/radial/actions/memory'

export const INDEX_KEY = 900
export const FIRST_KEY = 901
export const LAST_KEY = 940
export const VALUE_MAX = 232

/** The parts of the kit's BandStorage this uses (the kit is plain JS). */
export interface BandStorageLike {
  put(key: number, value: string): Promise<unknown>
  getText(key: number): Promise<string | null>
  delete(key: number): Promise<unknown>
}

export interface BandMemoryRow {
  key: number
  title: string
  type: string
  summary: string
  /** Unix seconds. */
  at: number
}

const bytes = (s: string) => new TextEncoder().encode(s).length

export function summarize(e: Pick<MemoryEntry, 'content'>): string {
  const c = e.content
  if (!c) return ''
  if (c.kind === 'chart') return c.series.map((p) => `${p.label} ${p.value}`).join(' · ')
  if (c.kind === 'metric') return c.format === 'percent' ? `${(c.value * 100).toFixed(1)}%` : String(c.value)
  return c.text.split('\n')[0]
}

/** One entry as a JSON line that fits a storage value (≤ 232 bytes, UTF-8). */
export function encodeEntry(e: Pick<MemoryEntry, 'title' | 'type' | 'content' | 'createdAt'>): string {
  const row = { v: 1, t: e.title.slice(0, 60), k: e.type.slice(0, 12), s: summarize(e), at: Math.floor(new Date(e.createdAt).getTime() / 1000) }
  let text = JSON.stringify(row)
  while (bytes(text) > VALUE_MAX && row.s.length > 0) {
    row.s = row.s.slice(0, Math.max(0, row.s.length - 8)) + '…'
    if (row.s === '…') row.s = ''
    text = JSON.stringify(row)
  }
  return text
}

/** Text from the band is untrusted (anyone may have written it): parse defensively, never execute. */
export function decodeEntry(key: number, text: string | null): BandMemoryRow | null {
  if (!text) return null
  try {
    const o = JSON.parse(text) as Record<string, unknown>
    if (o.v !== 1 || typeof o.t !== 'string') return null
    return { key, title: o.t, type: typeof o.k === 'string' ? o.k : '', summary: typeof o.s === 'string' ? o.s : '', at: typeof o.at === 'number' ? o.at : 0 }
  } catch {
    return null
  }
}

function parseIndex(text: string | null): number[] {
  try {
    const a = JSON.parse(text ?? '[]') as unknown
    return Array.isArray(a) ? a.filter((k): k is number => Number.isInteger(k) && k >= FIRST_KEY && k <= LAST_KEY) : []
  } catch {
    return []
  }
}

/** Save one entry: the next free key in 901..940, else the oldest is reused. Returns the key. */
export async function saveToBand(storage: BandStorageLike, entry: MemoryEntry): Promise<number> {
  const index = parseIndex(await storage.getText(INDEX_KEY))
  let key = FIRST_KEY
  while (index.includes(key) && key <= LAST_KEY) key++
  if (key > LAST_KEY) key = index[0]
  await storage.put(key, encodeEntry(entry))
  const next = [...index.filter((k) => k !== key), key]
  await storage.put(INDEX_KEY, JSON.stringify(next))
  return key
}

/** Everything the band holds, newest first, read from the band itself. */
export async function readFromBand(storage: BandStorageLike): Promise<BandMemoryRow[]> {
  const index = parseIndex(await storage.getText(INDEX_KEY))
  const rows: BandMemoryRow[] = []
  for (const key of index) {
    const row = decodeEntry(key, await storage.getText(key))
    if (row) rows.push(row)
  }
  return rows.reverse()
}

/** Remove the pitch's entries from the band (callers confirm first). */
export async function clearBand(storage: BandStorageLike) {
  const index = parseIndex(await storage.getText(INDEX_KEY))
  for (const key of index) await storage.delete(key)
  await storage.delete(INDEX_KEY)
}

export const storageOf = (band: unknown): BandStorageLike | null => {
  const s = (band as { storage?: BandStorageLike } | null)?.storage
  return s && typeof s.put === 'function' ? s : null
}
