# Reflex Present — P0 vertical slice

Voice/typed command → semantic object resolution → highlight → deterministic
transform → new visualization. No hardware or webcam required.

## Run it

    npm install
    npm run dev

Open http://localhost:5173 and try:

- `compare the revenue chart to last year`
- `what happens if the revenue chart grows by 15%`
- `highlight the biggest change`
- `summarize the revenue chart`

Type or click 🎙 Voice (Web Speech API — Chrome/Edge).

## Where things live

| File | Owns |
| --- | --- |
| [`src/types.ts`](src/types.ts) | Shared contracts: `SlideObject`, `CommandInput`, `ResolvedIntent`, router/telemetry types — the integration surface for all three workstreams |
| [`src/data/sampleDeck.ts`](src/data/sampleDeck.ts) | The structured slide data (real numbers, not placeholders) |
| [`src/engine/resolver.ts`](src/engine/resolver.ts) | Semantic object resolver — deterministic keyword matching; see the module comment for why there's no live LLM call here yet |
| [`src/engine/router.ts`](src/engine/router.ts) | DIRECT/CLARIFY routing + telemetry log (tokens/latency columns ready for SMALL_MODEL/LARGE_MODEL routes later) |
| [`src/engine/actions.ts`](src/engine/actions.ts) | Deterministic transforms (compare, scenario, highlight-change, summarize) — all real math on the slide's data |
| [`src/components/`](src/components) | Rendering: `SlideObjectView` (chart/metric + highlight), `CommandBar` (text + voice input) |

## Wiring in wearable/gesture input (P1)

Add a new `InputSource` in `types.ts` and an adapter that emits `CommandInput`
objects, same as `CommandBar` does for voice/text. The `../../airwrite/link.py`
`Clicks` class (click/double/long-press from button events) is the template
for turning raw wrist events into discrete gestures (next/prev/confirm/cancel)
— bridge it to the browser over WebSocket the way
`../../airwrite-trainer/server.py` already does for its live IMU viewer.

## Spatial perception (camera) — `/spatial-test`, `/spatial-debug`

`npm run dev`, then open http://localhost:5173/spatial-test on the TV/projector
(F = fullscreen) and http://localhost:5173/spatial-debug on the laptop.
`npm test` runs the unit tests (gestures, calibration, fusion, interaction).
`predev` vendors the MediaPipe wasm + hand model into `public/mediapipe/`
once, so the demo runs without wifi.

Pipeline (all in [`src/spatial/`](src/spatial)):

    webcam → HandTracker (MediaPipe, 1 hand) → handGeometry features
           → GestureDetector (pinch hysteresis, point, open palm)
           → calibration (camera → canvas virtual cursor)
           → SensorFusion ← WearableAdapter (mock now, Vexo later)
           → InteractionEngine (IDLE/HOVER/GRABBED/DRAGGING/RELEASED/CANCELLED/TRACKING_LOST)

| File | Owns |
| --- | --- |
| [`types.ts`](src/spatial/types.ts) | `CameraObservation`, `WearableObservation`, `PointerEstimate`, `GestureEvent`, `CalibrationSample`, `InteractionEvent`, `SensorFusionMode`. Time = `performance.now()` ms; every point carries its frame (`camera` / `canvas` / `device`). |
| [`wearable/adapter.ts`](src/spatial/wearable/adapter.ts) | **The Vexo boundary.** Implement `WearableAdapter`, hand it to `runtime.setWearable()`. Contract is in the file's doc comment. |
| [`wearable/mockWearable.ts`](src/spatial/wearable/mockWearable.ts) | Synthetic stream (orbit, or follows mouse) with noise, drift, link drops, a fake device clock. |
| [`clock.ts`](src/spatial/clock.ts) | Maps a device ms clock onto `performance.now()`. |
| [`fusion.ts`](src/spatial/fusion.ts) | Stale rejection, the three modes, confidence weighting, blended source handoff, drift correction for integrated pointers. Device-frame pointers are never fused. |
| [`calibration.ts`](src/spatial/calibration.ts) | Mirror/flip, movement region, 5-point least-squares affine, recenter, per-camera localStorage. A virtual cursor mapping, not a pointing ray. |
| [`interaction.ts`](src/spatial/interaction.ts) | Hit testing with magnet halo + hover stickiness, bounded drag, undo, cancel restores, tracking loss freezes (never drops) and cancels after 4s. |
| [`runtime.ts`](src/spatial/runtime.ts) | Wires it all per frame; keyboard/mouse fallback; calibration + accuracy-test flows; latency measurement. |

Controls: pinch or Space = grab/release · open palm or Esc = cancel · ⌘Z undo ·
R recenter · H hide HUD · D hide camera preview.

What the numbers mean (nothing is precomputed):
- **Capture→pointer**: from the frame's `captureTime` (when Chrome reports it)
  or else frame delivery, to the fused pointer. The debug view says which.
- **Capture→paint** (`latency.captureToPaint`): to the first animation frame
  after React commits — an upper bound, up to one frame high.
- **Accuracy test**: 9 on-screen targets; error = cursor − target in px and %
  of canvas height, as measured in that run.

## Known gaps

- Object resolver is deterministic only; ambiguous references return
  `requiresClarification`, no LLM fallback is wired up (see resolver.ts).
- Single slide only — `next_slide`/`previous_slide` intents resolve but
  there's nothing to page between yet.
- No `ANTHROPIC_API_KEY` is used anywhere in this app (frontend-only; any
  future LLM call belongs behind a small backend, not called from the browser).
