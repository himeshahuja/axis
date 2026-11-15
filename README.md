# Axis

Present by moving your hands. Axis is a web app that turns a webcam and a Vexo
wristband into the controls for a presentation: grab a card on the screen and drag it,
hold it to open a menu (Explain, Remember, Voice), and ask questions out loud through the
band's microphone. Answers come from Google Gemini and pop up next to what you are
pointing at.

Built at VexoHacks. Everything runs on your laptop in Chrome; the only things that
leave it are the calls to Google (and Deepgram, if you choose it), and the app tells you
before it sends anything.

## What you need

| | |
| --- | --- |
| **Computer** | macOS, Windows or Linux with [Node.js](https://nodejs.org) 20.19+ or 22.12+ |
| **Browser** | Google Chrome or Microsoft Edge (Bluetooth, USB and the band's audio decoder only work there) |
| **Webcam** | the laptop's own is fine; an external one pointed at you works better on a stage |
| **Vexo band** | optional — everything also works with the mouse, the keyboard and a pretend band. This repo is set up for **band 75** (Vexo-HACK-75) |
| **Gemini API key** | optional, needed for spoken questions and AI answers. Get one at [Google AI Studio](https://aistudio.google.com/apikey) |

## Start it

```bash
git clone https://github.com/himeshahuja/air-draw.git
```

```bash
cd air-draw/reflex-present
```

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:5173** in Chrome and allow the camera. The first start downloads
the hand-tracking model (about 8 MB) into `public/mediapipe/`; after that it runs offline,
apart from the AI features.

### Turn on the AI features (optional)

Copy the example file and put your key after the `=`:

```bash
cp .env.example .env
```

```
GEMINI_API_KEY=your-key-here
```

Then stop `npm run dev` (Ctrl+C) and start it again. Reloading the page is not enough.

The key stays on your laptop: the dev server reads it and calls Google itself, so it never
reaches the web page, and `.env` is ignored by git. Never paste a key into the code, a
commit, or a chat.

## The pages

| Address | What it is |
| --- | --- |
| [`/`](http://localhost:5173/) | **Presenter board.** A six-slide presentation you steer with your palm. Edit the slides in `src/data/presentationDeck.ts` |
| [`/pitch`](http://localhost:5173/pitch) | **The Axis pitch.** Seven interactive scenes (about 3½ minutes). Put it on the projector, press **F** for fullscreen and **P** to open the presenter console on the laptop |
| [`/site`](http://localhost:5173/site) | **Product site.** The Axis landing page with a playground |
| [`/spatial-test`](http://localhost:5173/spatial-test) | **Gesture test canvas.** Pinch-and-drag objects, for trying the hand tracking on a TV or whiteboard |
| [`/spatial-debug`](http://localhost:5173/spatial-debug) | **Sensor diagnostics.** The same canvas plus live numbers from the camera and the band, band connection, twist calibration and a simulator |
| [`/command-demo`](http://localhost:5173/command-demo) | The first prototype: type or say a command about a chart |

## How to use it

**With your hand (webcam)**

1. Stand where the camera sees your hand, then press **Calibrate** and hold your palm
   still at the two spots it asks for.
2. Move your open palm to steer the cursor.
3. Close your hand (or pinch, on the spatial pages) over a card to grab it; open your
   hand to let go.
4. Close your hand and **hold still for about half a second** to open the action menu
   instead of dragging.

**The action menu**

- **Explain** — a summary of the card from its own data. Ask follow-up questions on the
  card (typed, a suggestion, or by voice) and Gemini answers, with charts, graphs or
  worked maths when that helps.
- **Remember** — saves the card. On the pitch it is written to the band's own storage.
- **Voice** — press **Speak into band 75**, ask your question, then press **done** or just
  stop talking. Your words and Gemini's reply appear on the card.

Choose an action by twisting your wrist (with the band calibrated), tilting your hand, or
with the arrow keys, then open your hand or press Enter. **Esc** or an open palm cancels.

**Without a camera** — the mouse works everywhere: hold the button on a card to open
the menu. Keys: arrows move between slides or menu items, **Space** grabs and releases,
**Esc** cancels, **⌘Z / Ctrl+Z** undoes a move, **M** opens the menu on the card under
the cursor.

### Connecting the band

1. Turn the band on. Its name is on the bag it came in (here, Vexo-HACK-75).
2. On `/spatial-debug` (or the band controls on the other pages, or the pitch's rehearsal
   panel, **D**) choose **Bluetooth** or **USB** and pick the band in Chrome's list.
3. For wrist-twist selection press **Calibrate twist**: hold still for 2 seconds, then
   twist your wrist like turning a doorknob for 4 seconds, starting clockwise. This is
   saved per band.

No band to hand? Choose **Pretend band**. It sends made-up motion, and its microphone
plays a sample recording (a person reading a fable), so you can try the whole voice path.
The app labels it as pretend wherever it shows.

**Using a different band:** change the one number in
[`src/spatial/wearable/band.ts`](reflex-present/src/spatial/wearable/band.ts). The app only
ever connects to that band and checks the number after connecting, so it never picks up
another team's band in a crowded room.

**One app at a time:** a band takes a single Bluetooth connection. Close other pages or
programs that use it first.

## Privacy

- The band's microphone hears **everyone near it**. While it records, its light is
  solid blue. Tell the people around you before you use Voice.
- When you finish speaking, the recording and the selected card's data are sent to
  Google Gemini to be transcribed and answered. Questions on an Explain card send a
  picture of that card too. Nothing is sent until you start Voice or ask a question.
- The camera image never leaves the laptop; hand tracking runs in the browser.
- Deepgram (another speech-to-text option in the Voice menu) needs its key typed into the
  page each time; it is kept in memory only.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| "No Gemini key on this laptop" | Add `GEMINI_API_KEY` to `reflex-present/.env` and restart `npm run dev` |
| Gemini says status 404 | The model name is out of date: add `GEMINI_MODEL=` with a current model from Google's [model list](https://ai.google.dev/gemini-api/docs/models) to `.env` and restart |
| Gemini says status 401, 403 or 429 | The key is wrong, switched off, or out of quota |
| "Connect band 75 first" | Connect the band (above). If the list in Chrome is empty, check the band is on and not connected to another page |
| "This browser cannot decode the band's sound" | Use a current Chrome or Edge, at `http://localhost`, not by opening the file |
| The cursor shakes or drifts | Re-run **Calibrate** (**K** on the pitch), and light your hand from the front |
| No camera picture | Allow the camera in Chrome's address bar; close other apps using it |
| The menu doesn't open | Hold still a little longer, or press **M** over the card |

## For developers

```bash
npm test
```

```bash
npm run build
```

Run both from `reflex-present/`. They take a few seconds; the tests need no camera, band
or key. React 19, TypeScript and Vite; hand tracking is MediaPipe's HandLandmarker.

| Folder | What's in it |
| --- | --- |
| `reflex-present/src/spatial/` | The interaction engine: camera hand tracking, gestures, calibration, sensor fusion, the drag/hover state machine |
| `reflex-present/src/spatial/radial/` | The Explain / Remember / Voice menu, wrist-twist selection and the voice providers |
| `reflex-present/src/spatial/wearable/` | The Vexo band adapter and **the band number** (`band.ts`) |
| `reflex-present/server/` | The dev-server endpoints that hold the Gemini key: voice (`geminiVoice.ts`) and the Explain agent and its tools (`agent/`) |
| `reflex-present/src/pitch/` | The pitch: scenes and speaking notes are data in `scenes.ts` |
| `reflex-present/src/site/`, `src/components/`, `src/data/` | The product site, the presenter board and its slides |
| `vexo-open-kit/` | The band's JavaScript library, from the Vexo Open kit. Don't edit it; the app reads it in place |
| `video/` | The launch film's source (not in git yet) |

[`reflex-present/README.md`](reflex-present/README.md) has the engineering notes: each
pitch scene, how the cursor is filtered, what the latency numbers mean, and how to add a
tool to the Explain agent.

### Branches

`pinch-and-drag` has the latest work; `main` is behind it.
`board-tracking` and `vexo-board-concept` hold teammates' whiteboard-tracking work
(`/board`) that isn't merged here yet.
