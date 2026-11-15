# Reflex Present — P0 vertical slice

## The pitch — `/pitch`

The Axis pitch (about 3:30) as seven interactive scenes on the live spatial
engine. Open `http://localhost:5173/pitch` on the external display (F for
fullscreen) and press **P** to open the presenter console
(`/pitch?view=presenter`) on the laptop; the two stay in sync in the same
browser. Scenes, objects, beats and speaking notes are data in
[`src/pitch/scenes.ts`](src/pitch/scenes.ts); progression rules live in
[`src/pitch/pitchController.ts`](src/pitch/pitchController.ts) (tested).

| Scene | Live interaction | → key fallback |
| --- | --- | --- |
| 01 Problem | grab the window, move it aside → the old interface falls away | yes |
| 02 Product | drag Perception, Intent, Action from the pile into their slots → the pipeline connects | yes, one piece per press |
| 03 Live | pull the revenue chart into the spotlight; hold it → Explain; hold → Remember (saved on the band), open Memory | spotlight only |
| 04 Trade-offs | ask the Vexo band "What is the difference between this and conventional interfaces?" → the Axis card appears | yes |
| 05 Whiteboard | everything on one board, in any order — grab a card; hold → Explain → Ask with your voice; hold → Voice (the words land on the board); Annotate → draw an arrow; hold → Remember. The row at the bottom lights up as each is shown | no: → goes straight on |
| 06 Use cases | hold any card → Voice → ask: Now (teaching, whiteboarding), Next (wearable bands: accelerometer, no camera, many people at once), Later (AR glasses) all flip to what they unlock | yes |
| 07 Close | grab any piece and let go → it assembles; pull the page across → "The interface is you." | yes |

**Next with your hand:** grab empty space in the right quarter of the screen (or anywhere in
the thin strip at the very right edge) and pull it left by a fifth of the width, then let
go. It does what → does.

**Memory on the band:** Remember writes a compact entry (≤ 232 bytes) into the band's own
storage with the kit's `band.storage.put` (keys 901–940, index in 900), and the Memory tab
reads them back with `band.storage.getText`. The kit has no "context" or memory API; this
key-value store is the only thing a program can save on the wristband, and it is readable
by whoever connects next. To check it on the real band from your own Terminal:
`python3 reflex-present/scripts/check-band-memory.py` (needs `pip install --user bleak`).

Scene 05 listens through band 75's own microphone: Gemini if `GEMINI_API_KEY` is set
for the dev server (the other session's `/api/voice/gemini`), otherwise Deepgram with the
team key typed into the rehearsal panel (D). Connect the band from that panel too
(Bluetooth needs a click in the audience window). While it listens, the stage shows that
sound is being sent off the laptop.

Grabbing or dropping never advances a scene unless the scene names that
interaction. Keys: → next (completes a pending step first), ⇧→ skip, ← back,
Home restart, M reopen the actions menu, G pause gestures, K recalibrate,
C camera on/off, X reset the scene's layout, ⌘Z undo a move, D rehearsal
overlay (timing, steps, notes). Before going live, clear rehearsal entries
with the console's "Clear memory…" (it asks first).

## VexoAI hackathon presenter

The default route now opens a six-slide gesture presentation with the working
name **Untitled demo**. Edit the name, slide copy, colors, movable objects and
speaker notes in `src/data/presentationDeck.ts`.

The webcam starts mirrored. Move your palm to steer, close all four fingers
for a short steady grasp to grab, then open at least two fingers to release.
Partial/uncertain poses keep the current state. Lost tracking freezes a grab.
Grasp movement uses a pose-compensated cursor: wrist translation preserves real
movement while finger-base landmarks shift during closing/opening. A short
median filter rejects isolated spikes, adaptive smoothing reduces tremor, and a
soft pixel-sized steadiness zone keeps resting jitter from moving the cursor.
Filtering runs once per camera observation, not repeatedly per render frame.
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

- **Band 75** (`wearable/band.ts`, the only place the number lives). Connect it
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
- Explain opens with a deterministic local summary. Questions asked on the card
  (typed, a suggested chip, or by voice) go to the **Explain agent** below.
  Remember saves locally (Vexo has no memory
  API; its key-value store is not private). Voice uses the band mic → Deepgram
  (team key typed into the page, memory only), the browser's speech
  recognition, or typed text, and shows a command preview bound to the object;
  nothing is executed.
- **Voice → Gemini (the default).** Voice records band 75's microphone (Opus,
  decoded with the kit's `BandAudio`) until you press *done* or go quiet (12 s
  at most), sends it as a 16 kHz WAV to `/api/voice/gemini` on the dev server
  ([`server/geminiVoice.ts`](server/geminiVoice.ts)), which asks Google Gemini
  for the transcript and a short reply about the selected object; the reply pops
  up in the Voice panel. The key stays on the laptop — put
  `GEMINI_API_KEY=...` in `reflex-present/.env` (gitignored; optional
  `GEMINI_MODEL`, default `gemini-3.8-flash`) and restart `npm run dev`. It is
  never sent to the page. Without a band, the laptop microphone goes the same
  way (`laptop-gemini`, [`actions/laptopMic.ts`](src/spatial/radial/actions/laptopMic.ts));
  a recording with no speech in it is not sent (Gemini invents words for
  silence). Transcription uses `gemini-3.5-flash-lite` (~1 s; override with
  `GEMINI_TRANSCRIBE_MODEL`). The pretend band's mic plays the kit's sample
  recording and is labelled that way.

### Explain agent (`server/agent/`)

A question on an Explain card → `POST /api/agent` → Gemini (`GEMINI_MODEL`,
default `gemini-3.8-flash`) with the selected object's data, **a screenshot of
it** ([`actions/snapshot.ts`](src/spatial/radial/actions/snapshot.ts): the
stage rendered without overlays, cropped to the object) and these tools, in a
loop of at most 5 model calls ([`server/agent/loop.ts`](server/agent/loop.ts)):

| Tool | Runs | Shows on the card |
| --- | --- | --- |
| `plot_graph` | here: checks the Desmos LaTeX | interactive Desmos graph |
| `make_chart` | here: checks the points | bar / line / area / pie chart (recharts) |
| `read_slide_object` | here: another object's data | — |
| Python (Gemini code execution) | Google's sandbox (sympy, numpy, matplotlib), never this laptop | the code, its output, any plot |

Anything else is a plain multimodal answer. Ask by voice from the card ("Ask
with your voice": band mic, else laptop mic → Gemini transcript → the agent).
Add a tool in [`server/agent/tools.ts`](server/agent/tools.ts): a declaration,
a runner that validates the model's arguments, and (for something to draw) an
artifact type in `agentTypes.ts` plus its renderer in `ui/AgentArtifacts.tsx`.
Desmos uses its public demo key; set `VITE_DESMOS_API_KEY` for your own.

## Known gaps

- Object resolver is deterministic only; ambiguous references return
  `requiresClarification`, no LLM fallback is wired up (see resolver.ts).
- Single slide only — `next_slide`/`previous_slide` intents resolve but
  there's nothing to page between yet.
- No `ANTHROPIC_API_KEY` is used anywhere in this app (frontend-only; any
  future LLM call belongs behind a small backend, not called from the browser).
