// Copies the MediaPipe wasm runtime out of node_modules and fetches the hand
// landmarker model once, so the demo does not depend on venue wifi.
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const wasmDst = join(root, 'public/mediapipe/wasm')
const modelDst = join(root, 'public/mediapipe/hand_landmarker.task')
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

mkdirSync(wasmDst, { recursive: true })
for (const f of readdirSync(wasmSrc)) copyFileSync(join(wasmSrc, f), join(wasmDst, f))

if (!existsSync(modelDst)) {
  try {
    const res = await fetch(MODEL_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()))
    console.log('[vendor-mediapipe] model downloaded')
  } catch (err) {
    console.warn(`[vendor-mediapipe] could not fetch model (${err.message}); the app will try the remote URL at runtime`)
  }
}
