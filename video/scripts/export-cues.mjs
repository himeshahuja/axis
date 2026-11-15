// Bundles src/audio/cues.ts and writes audio/cues.json (cues sorted by frame, plus the
// score's section markers), so the Python audio build and the review use the same map.
import { buildSync } from 'esbuild'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const tmp = join(root, 'out', 'preview', 'cues.bundle.mjs')
mkdirSync(dirname(tmp), { recursive: true })
buildSync({ entryPoints: [join(root, 'src/audio/cues.ts')], bundle: true, format: 'esm', platform: 'node', outfile: tmp, packages: 'external', jsx: 'automatic', logLevel: 'error' })
const m = await import(pathToFileURL(tmp).href)
rmSync(tmp)
const cues = [...m.CUES].sort((a, b) => a.frame - b.frame)
mkdirSync(join(root, 'audio'), { recursive: true })
writeFileSync(join(root, 'audio', 'cues.json'), JSON.stringify({ markers: m.MARKERS, envelopes: m.ENVELOPES, cues }, null, 1) + '\n')
console.log(`audio/cues.json: ${cues.length} cues`)
for (const c of cues) console.log(String(c.frame).padStart(5), (c.frame / 30).toFixed(2).padStart(6) + 's', c.sound.padEnd(18), c.note)
