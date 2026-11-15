# Vexo Board engine

The tracking code behind `/board`, copied unchanged from the `vexo-board-concept` branch
(`js/concept/`, and the parts of `js/board/` and `js/fusion.js` it builds on). Plain JavaScript
with `.d.ts` files beside the modules the page uses.

- `concept/ultrasound.js`: the band's place from the three pucks' timings; echoes thrown out.
- `concept/contact.js`: the marker on the board, from the microphone's hiss.
- `concept/emg.js`: the forearm's muscles: pressing, pinching.
- `concept/tracker.js`: all of it fused with the band's motion, to the marker's tip, as ink.
- `concept/simulate.js`: the hardware, simulated (it does not exist yet).
- `concept/replay.js`: a simulated session played through the tracker, and scored.

The original also has its own checks: `node tests/concept.mjs` on `vexo-board-concept`.
Here, `src/board/__tests__/concept.test.ts` runs the same sessions under Vitest.
