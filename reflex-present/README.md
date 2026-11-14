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

## Known gaps

- Object resolver is deterministic only; ambiguous references return
  `requiresClarification`, no LLM fallback is wired up (see resolver.ts).
- Single slide only — `next_slide`/`previous_slide` intents resolve but
  there's nothing to page between yet.
- No `ANTHROPIC_API_KEY` is used anywhere in this app (frontend-only; any
  future LLM call belongs behind a small backend, not called from the browser).
