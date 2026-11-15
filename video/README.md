# Axis launch film (VexoHacks 2026)

A 53-second product film for Axis, the spatial gesture interface in `../reflex-present/`.
It is built with Remotion (React + TypeScript), and every animation is a pure function of the frame number.

**Output:** `out/axis-launch-film.mp4`: 1920×1080, 16:9, 30 fps, H.264 High, yuv420p (BT.709 TV range), AAC 48 kHz stereo, −18 LUFS, 53.0 s (1590 frames).

## Commands

```bash
npm install
npm run render     # sfx → Remotion master (out/preview/master.mp4) → finalize → out/axis-launch-film.mp4
npm run preview    # half-res draft + contact sheet in out/preview/
npm run stills     # contact sheet of the final film (every 45 frames) → out/preview/final-contact-sheet.png
npm run studio     # Remotion Studio, for scrubbing and editing
npm run typecheck
```

Check the result:

```bash
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,pix_fmt -of default=nw=1 out/axis-launch-film.mp4
```

**Browser:** on this machine the `chrome-headless-shell` that Remotion downloads exits on launch. `remotion.config.ts` therefore uses Playwright's headless shell from `~/Library/Caches/ms-playwright` when it is there. You can override it with `REMOTION_BROWSER=/path/to/chrome-headless-shell`.

## Layout

| Path | What it is |
| --- | --- |
| `src/Root.tsx` | The composition (`AxisLaunch`), the scene order and the room-tone bed |
| `src/scenes/S1Problem.tsx` … `S7Close.tsx` | One file per scene; each exports its start frame |
| `src/components/` | Field (the site's orientation field), Viz (the site's object visuals), UI (card, brackets, pointer, hand, radial ring, headlines), Sfx |
| `src/theme.ts` | Colours and fonts copied from `reflex-present/src/site/site.css` |
| `src/data.ts` | Revenue series, Explain facts and comparison line, all taken from the app's own code |
| `scripts/make-sfx.mjs` | Synthesises every sound (clicks, ticks, whooshes, confirm tone, room tone) from sines and seeded noise. No samples and no music. |
| `scripts/finalize.sh` | Converts to TV range, normalises loudness and adds faststart |
| `scripts/contact-sheet.sh` | Tiles every Nth frame for review |
| `public/fonts/` | DM Sans and Gravitas One, from Fontsource (SIL OFL) |

## Timeline (30 fps)

| Frames | Scene | On screen |
| --- | --- | --- |
| 0–195 | 1 Problem | A cursor hunts through piling windows. "WE THINK WITH OUR HANDS." / "OUR COMPUTERS DON'T." |
| 195–390 | 2 Reveal | The orange point, the field unfolding, "AXIS.", "POINT. HOLD. ACT." |
| 390–615 | 3 Grab | Hover, pinch, lift, carry, land. "INFORMATION, WITHIN REACH." |
| 615–900 | 4 Radial | A 600 ms hold opens Explain, Remember and Voice. A wrist twist moves the highlight, then the Explain card appears. "ONE GESTURE. INFINITE POSSIBILITIES." |
| 900–1200 | 5 Act | Remember: the chart contracts into the saved collection. Voice: waveform, "Compare this with last quarter.", and a Q3 vs Q4 comparison on the same scale. "YOUR INTENT. UNDERSTOOD." |
| 1200–1350 | 6 Next | "WHAT COMES NEXT": Presentations (today), Collaboration and Ambient computing (concepts, not built) |
| 1350–1590 | 7 Close | The pieces assemble and fold into the point, the point goes out. "THE INTERFACE IS YOU.", then "AXIS." and "Built at VexoHacks 2026" |

## What is real and what is a concept

The film reenacts the product's interactions. It is not screen capture.

**Real and implemented in `reflex-present/`:**
- Camera hand tracking with MediaPipe, in the browser: pointer, pinch-grab, drag, drop.
- The 600 ms pinch-hold radial menu with exactly three sectors in this layout.
- Explain, a deterministic local summary. The four facts on screen are what `describeObject()` returns for the revenue series.
- Remember, which saves to browser storage on the device. Nothing is written to the band.
- The previous-quarter comparison `Q4 210 vs Q3 180: +30 (+16.7%)`, as computed by `computeQuarterCompare()`.

**Implemented but not yet verified on hardware, so the film shows the intended control without claiming results:**
- Choosing a sector by wrist rotation from the Vexo band's gyro. This was tested only with the kit's pretend band. Camera hand tilt and keys also work, and the caption says so.
- Voice through the band's microphone and Gemini. This was verified end to end with the pretend band's sample recording, not with the physical mic.

**Concepts, labelled in the film:** multi-person collaboration and ambient computing.

The film shows no band number, no latency or performance figures, and no Vexo memory API.
