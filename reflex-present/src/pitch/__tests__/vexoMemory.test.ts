import { afterEach, describe, expect, it } from 'vitest'
import { Band } from 'vexo-kit/index.js'
import type { MemoryEntry } from '../../spatial/radial/actions/memory'
import { BAND_NUMBER } from '../../spatial/wearable/band'
import { PLACEHOLDER_MEMORY } from '../placeholderMemory'
import { clearBand, decodeEntry, encodeEntry, INDEX_KEY, readFromBand, saveToBand, seedBand, storageOf, VALUE_MAX } from '../vexoMemory'

const entry = (title: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: title,
  createdAt: '2026-11-14T21:00:00.000Z',
  objectId: title.toLowerCase(),
  title,
  type: 'chart',
  content: { kind: 'chart', unit: '$k', series: [{ label: 'Q1', value: 120 }, { label: 'Q2', value: 150 }, { label: 'Q3', value: 180 }, { label: 'Q4', value: 210 }] },
  canvas: { bounds: { x: 0, y: 0, w: 0.1, h: 0.1 }, neighbours: [] },
  store: 'local',
  ...over,
})

describe('memory rows on the band', () => {
  it('fit one storage value and round-trip', () => {
    const text = encodeEntry(entry('Quarterly Revenue'))
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(VALUE_MAX)
    expect(decodeEntry(901, text)).toMatchObject({ title: 'Quarterly Revenue', type: 'chart', summary: 'Q1 120 · Q2 150 · Q3 180 · Q4 210' })
  })

  it('shortens a long summary to fit, in bytes not characters', () => {
    const long = entry('Notes', { type: 'note', content: { kind: 'note', text: 'é'.repeat(400) } })
    expect(new TextEncoder().encode(encodeEntry(long)).length).toBeLessThanOrEqual(VALUE_MAX)
  })

  it('treats junk on the band as nothing', () => {
    expect(decodeEntry(901, '{not json')).toBeNull()
    expect(decodeEntry(901, '{"v":2,"t":"x"}')).toBeNull()
  })
})

// The kit's own library against its pretend band, which speaks the real protocol (storage included).
describe('through the Vexo library (pretend band)', () => {
  let band: Band | null = null
  afterEach(async () => {
    await band?.disconnect()
    band = null
  })

  it('saves to band storage and reads it back from the band', async () => {
    band = await Band.connect(BAND_NUMBER, { transport: 'sim' })
    const s = storageOf(band)!
    expect(s).not.toBeNull()
    await saveToBand(s, entry('Quarterly Revenue'))
    await saveToBand(s, entry('Launch notes', { type: 'note', content: { kind: 'note', text: 'Ship pricing before Q1 close' } }))
    const rows = await readFromBand(s)
    expect(rows.map((r) => r.title)).toEqual(['Launch notes', 'Quarterly Revenue'])
    expect(rows[1]).toMatchObject({ key: 901, summary: 'Q1 120 · Q2 150 · Q3 180 · Q4 210' })
    expect(await s.getText(INDEX_KEY)).toBe('[901,902]')
    await clearBand(s)
    expect(await readFromBand(s)).toEqual([])
  })

  it('remembering the same thing twice updates it instead of adding a duplicate', async () => {
    band = await Band.connect(BAND_NUMBER, { transport: 'sim' })
    const s = storageOf(band)!
    await seedBand(s, PLACEHOLDER_MEMORY())
    expect((await readFromBand(s)).length).toBe(5)
    await saveToBand(s, entry('Quarterly Revenue'))
    await saveToBand(s, entry('Quarterly Revenue'))
    const rows = await readFromBand(s)
    expect(rows.length).toBe(6)
    expect(rows.filter((r) => r.title === 'Quarterly Revenue')).toHaveLength(1)
    // seeding again resets it to the placeholders
    await seedBand(s, PLACEHOLDER_MEMORY())
    expect((await readFromBand(s)).map((r) => r.title)).not.toContain('Quarterly Revenue')
  })
})
