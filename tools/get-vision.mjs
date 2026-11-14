// node tools/get-vision.mjs
//
// Downloads what the board page's camera needs to find people's wrists: Google's
// MediaPipe vision library and its pose model (Apache-2.0), into vendor/mediapipe/
// (not kept in git, about 24 MB). Done once; after that the page works offline.

import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '1.2.3';                    // @mediapipe/tasks-vision, pinned
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const FILES = [
  [`${LIB}/vision_bundle.mjs`, 'vision_bundle.mjs'],
  [`${LIB}/wasm/vision_wasm_internal.js`, 'wasm/vision_wasm_internal.js'],
  [`${LIB}/wasm/vision_wasm_internal.wasm`, 'wasm/vision_wasm_internal.wasm'],
  [MODEL, 'pose_landmarker_full.task'],
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'mediapipe');
for (const [url, name] of FILES) {
  const to = join(root, name);
  if (await stat(to).then((s) => s.size > 0, () => false)) {
    console.log(`have ${name}`);
    continue;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, bytes);
  console.log(`got  ${name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}
console.log(`MediaPipe ${VERSION} and the pose model are in vendor/mediapipe/`);
