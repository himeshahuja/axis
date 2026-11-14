# Reflex Present — P0 vertical slice

## VexoAI hackathon presenter

The default route now opens a six-slide gesture presentation with the working
name **Untitled demo**. Edit the name, slide copy, colors, movable objects and
speaker notes in `src/data/presentationDeck.ts`.

The webcam starts mirrored. Move your palm to steer, close all four fingers
for a short steady grasp to grab, then open at least two fingers to release.
Partial/uncertain poses keep the current state. Lost tracking freezes a grab.
The spatial test routes retain their original pinch detector for comparison.

Use **Calibrate** to set sensitivity through two steady palm positions. Smaller
movement ranges increase cursor gain. The calibration view shows the full
camera image and the raw palm position. No separate sensitivity slider is used.
The single stage toolbar works with the hand cursor and mouse. Arrow keys change
slides, Space grabs/releases, Esc cancels a grab, and Cmd/Ctrl+Z undoes a move.
Slide layouts persist when navigating during the session.

Hold a grasp still on a card to open the merged **Explain / Remember / Voice**
menu. Move immediately to drag instead. Tilt the hand or use arrow keys to
highlight an action, then open the hand to confirm. Esc cancels. M opens the
menu on a hovered card for keyboard testing. Explain summarizes authored object
content locally, Remember stores it locally, and Voice opens the provider panel
(including a typed fallback). Camera/microphone providers retain their notices.

Marketing handoff files are in `public/marketing/`: `creative-brief.md` has
three art directions, production prompts and a rehearsal script;
`concept-board.png` is AI-generated campaign reference artwork. Both can be
downloaded from the presenter footer. No official event logo is included.

The earlier command prototype remains available at `/command-demo`.

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

## Reflex Actions — radial menu (`src/spatial/radial/`)

Point at an object → pinch (or hold the mouse) still for 0.6 s → a radial menu
opens → rotate the wrist (Explain top, Remember clockwise, Voice
counter-clockwise) → release to run. Open palm or Esc cancels; ← → / wheel /
click work as fallbacks; **M** opens the menu on the hovered object.

- **Band 68** (`wearable/band.ts`, the only place the number lives). Connect it
  from the HUD or `/spatial-debug` (Bluetooth, USB or the kit's pretend band),
  then **Calibrate twist**: 2 s still (gyro bias), 4 s doorknob twist starting
  clockwise (finds the axis and sign). Saved per band in localStorage. Until
  calibrated, the band is not used for rotation.
- The band only exposes raw gyro (°/s), so the angle is integrated on the
  calibrated axis, with real band timestamps, only while a menu is open; the
  bias on that axis is refreshed from the still hold.
- Fallbacks, in order: camera hand tilt (an approximation, labelled) → keys /
  wheel / click. The debug simulator overrides everything and is labelled
  SIMULATOR wherever it shows.
- Explain is a deterministic local summary (no AI service exists here; the kit
  keeps model keys out of web pages). Remember saves locally (Vexo has no memory
  API; its key-value store is not private). Voice uses the band mic → Deepgram
  (team key typed into the page, memory only), the browser's speech
  recognition, or typed text, and shows a command preview bound to the object;
  nothing is executed.

## Known gaps

- Object resolver is deterministic only; ambiguous references return
  `requiresClarification`, no LLM fallback is wired up (see resolver.ts).
- Single slide only — `next_slide`/`previous_slide` intents resolve but
  there's nothing to page between yet.
- No `ANTHROPIC_API_KEY` is used anywhere in this app (frontend-only; any
  future LLM call belongs behind a small backend, not called from the browser).
