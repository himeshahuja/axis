# Air Draw

Write a character in the air with a sensor on your wrist; a Raspberry Pi reads which character it was, buzzes the wrist to confirm, and can send the message to Claude and buzz the reply back in Morse code.

The wrist unit has an accelerometer and gyroscope (MPU6050), one button and one vibration motor. The reader is a small neural network that takes the six sensor channels and gives the character. It does not try to rebuild the pen's path.

**Where this stands.** Everything below runs today against a *pretend* wrist that produces simulated readings. Nothing has been run on the hardware yet, and the network has only ever seen simulated data. Expect to collect real recordings and retrain before it reads real writing.

## Using it

    click            start; hold still for a second first
    (write one digit in the air)
    click            stop: one buzz = taken, two buzzes = not sure, write it again
    double click     send the message; a long buzz, then the reply in Morse
    long press       clear the message (three quick buzzes)

## Wiring

| Part | Connect |
| --- | --- |
| MPU6050 | VCC → 3.3 V, GND → GND, SDA → SDA, SCL → SCL (ESP32: pins 21 and 22; Uno/Nano: A4 and A5) |
| Button | one leg → pin 4, the other → GND (the internal pull-up is used) |
| Motor | pin 5 → 1 kΩ → base of an NPN transistor (2N2222); emitter → GND; collector → motor −; motor + → 3.3 V; a diode (1N4148) across the motor, stripe toward 3.3 V |

Do not drive the motor straight from a pin. Pins are set at the top of `firmware/wrist/wrist.ino`.

Mount the sensor the same way round on the same wrist every time.

## Steps

**1. Flash the wrist unit.** Open `firmware/wrist/wrist.ino` in the Arduino IDE, pick the board, upload. It needs no libraries. In the serial monitor at 115200 baud you should see `I ...` lines streaming and `B ...` lines when you press the button.

**2. Set up the Pi** (or a laptop):

    pip install numpy pyserial anthropic
    export ANTHROPIC_API_KEY=...

**3. Try it with no hardware:**

    python3 train/get_data.py                      # pen strokes the pretend wrist writes from (2 MB)
    python3 -m airwrite.run --fake 31415 --no-llm

**4. Collect recordings.** Each person, 30 of each digit:

    python3 -m airwrite.log --person ana --port /dev/ttyUSB0

It asks for digits in a shuffled order. Click, write, click; a long press throws away the last one. Files go to `recordings/<person>/<digit>/`. Aim for at least four people.

**5. Train and test** (on a laptop; needs [uv](https://docs.astral.sh/uv/) or PyTorch installed):

    uv run --with torch --with numpy train/real.py --adapt 10

This holds each person out in turn, learns from the others and tests on them, and prints the accuracy per person and a table of what was read as what. Then it trains on everyone and writes `model/`. `--adapt 10` also shows what a new person gains by giving 10 recordings of each digit first.

**6. Run it:**

    python3 -m airwrite.run --port /dev/ttyUSB0

Copy the `model/` folder to the Pi if you trained elsewhere. The Pi runs the network with numpy alone: no PyTorch and no ONNX runtime to install. (`--onnx` on either training script also writes `model/model.onnx` if you want it.)

## Guided air-writing trainer

For collecting labelled IMU recordings and retraining a live classifier, use the
standalone trainer in [`airwrite-trainer/`](airwrite-trainer/):

    cd airwrite-trainer
    pip install -r requirements.txt
    python3 server.py --source sim

Open http://localhost:8000. The simulated source works without hardware; use
`--source serial --port /dev/ttyUSB0` for a wrist unit that emits
`ax,ay,az,gx,gy,gz[,btn]` CSV lines, or `--source udp --port 9000` for UDP
input. The trainer saves recordings under `airwrite-trainer/data/<person>/`
(ignored by git), reloads them on startup, and retrains after each collected
sample. See [`airwrite-trainer/README.md`](airwrite-trainer/README.md) for the
workflow and options.

## Board tracking with the Vexo band

`board.html` shows where the band hand is on a whiteboard, and `bench.html` shows what the band and the
camera send. Across, 0 is the board's left edge and 1 its right; height uses the same scale and has no
limit. Teach two gestures: **Take** lifts the writing around your hand, and **Put** drops it on the screen.

    git submodule update --init                 # the Vexo kit, once after cloning
    node tools/get-vision.mjs                   # the camera's pose model, once (24 MB, into vendor/)
    python3 -m http.server 8000 --bind 127.0.0.1

Open <http://localhost:8000/board.html> in Chrome or Edge, double-tap the band, check the band number
(75, set in `js/board/config.js`) and press Connect. No band? Choose "Pretend band" and press "Play a
pretend session".

1. **Camera (for accuracy).** The camera card walks through five steps and ticks each off by itself:
   start the camera (pointed at the whiteboard from one side, so your body does not hide your hand); type
   the board's width and height in cm; click its four corners in the picture (it opens full-window for
   that; Backspace undoes a click, Esc cancels); step in with the band on, until a pink ring marks the
   band's wrist; and, optionally, hold the marker on the board and click its tip, so the cursor follows
   the tip rather than the wrist.
2. After connecting, hold the band still for a second. That is when it learns which way is up and its
   gyroscope's bias; it waits until you are still.
3. Setup starts by itself: knock the board's **left** edge with your band hand and hold still, then its
   far **right** edge and hold still. With the camera, a knock on the wrong edge is refused.
4. Write. Without a camera, pause for a moment now and then (between words): each pause lets the
   tracker take the drift out. With the camera, the band's motion only fills the gaps between frames
   and while the light is hidden.
5. Drifted (no camera)? Press **Re-anchor**, or double-tap the band, and knock the left or right edge.
6. Record Take, Put and "Not a gesture" (a few ordinary letters) three to five times each.
   **Keep on band** stores them in the band's storage (slots 900 to 929), and they load whenever the
   band connects. Anyone who connects to the band can read or wipe them.

**How it works.**
- **The band alone:** `Tracker` (`js/fusion.js`) adds up the band's motion, sets the speed to zero at
  every pause and takes each movement's drift out at the rest. `js/board/tracker.js` adds the board
  frame from the two knocks, rests timed for the short pauses of writing, and a check that a "rest" is
  not just the hand slowing down. Before any of that, `js/board/intake.js` fills in short gaps in the
  stream and learns what the band reads for 1 g (real accelerometers are a few percent off).
- **With the camera:** a pose model (Google's MediaPipe Pose Landmarker, Apache-2.0, fetched by
  `tools/get-vision.mjs`) finds every person in the picture and both of their wrists. It cannot see the
  band, but the band says how it moves: `js/board/wrists.js` follows each wrist over 0.3 s and picks the
  one whose movement agrees with the band's motion sensors, so the other hand and other people are left
  out. `js/board/homography.js` turns its pixel into board metres from the four corners, and
  `js/board/fuse.js` (a Kalman filter for each axis) moves on with the band's motion 208 times a second
  and is pulled to every camera fix. A picture arrives a little after it was taken, so the filter goes
  back to the moment of the picture and replays the band's samples since.
- **Gestures** use the kit's gesture-trainer recogniser, copied unchanged into `js/board/recogniser.js`.

**How accurate.** Simulated sessions at 208 samples a second (`node tests/board.mjs`). Nothing has been
measured on a real board yet.

| Simulated session | Hand position (median / 95%) | Shape of each word |
| --- | --- | --- |
| Band alone, 1.2 m board, short pauses between letters | 3.0 / 9.2 cm | 0.9 cm |
| Band alone, 2.4 m board, side-stepping | 3.2 / 10.0 cm | 1.2 cm |
| Band alone, written without a single pause | 62 / 83 cm | 41 cm |
| Camera and band (the wrist 1.5 cm off in each frame, pictures 80 ms late) | 0.6 / 1.3 cm | |
| Camera alone | 1.5 / 3.5 cm | |
| Camera and band, wrist hidden for 1.5 s | worst 2.1 cm while hidden | |

In the simulation the band's wrist is picked out of four (the other hand, and two of another person's)
in every frame, even with the hand setting wrong. The simulated camera is kinder than a real one (no lens
distortion, exact corners), so expect more on a real board; the bench measures it.

**The bench** (`bench.html`) takes in the band (live), a recording, or a simulated session, and shows the
stream's health (rate, timing, lost samples, what 1 g reads as), the six signals, their spectrum (writing
below 5 Hz, tremor at 6 to 12 Hz), every part of the tracker's rest decision, the camera's health, and how
far the band alone strays from the camera. A low-pass filter can be tried live. **Guided capture**
records a marked session; `node tests/board.mjs --bench <file>` reports on it (add `--lowpass 8` to replay
it filtered). Recordings from `board.html`'s **Record session** read the same way.

**Real recordings as tests.** `tests/recordings/` holds captures from band 68, listed in
`recordings.json` with when each knock really happened (and the distance between the knocks, when it was
measured). `node tests/board.mjs` replays every one and checks the board sets up from those two knocks
and nothing else. To add one: type the distance between your knocks (measured with a tape) on the bench
before a guided capture, then put the file in `tests/recordings/` and list it.

**Not done yet:**
- Telling a marker on the board from a lifted one: every movement draws.
- Turning the writing into text. Each Put fires a `board:put` event carrying the strokes, ready for that.
- Recognising gestures on the band itself: the kit's firmware only detects its own seven built-in
  gestures, so the examples are kept on the band but matched on the computer.
- A phone as the camera: `getUserMedia` needs HTTPS away from `localhost`.

Files: `board.html`, `bench.html`, `css/`, `js/board/` (the band number is in `config.js`),
`tests/board.mjs`.

## Vexo Board: a concept for the next band

The band on its own cannot know where on a board it is, and its motion sensor drifts. **Vexo Board** is
the band we would build for whiteboards. <http://localhost:8000/concept.html> is the pitch: what it is,
and a simulated session played through its tracking code.

The hardware adds three things:
- **A 40 kHz ultrasonic emitter and an infrared LED on the band.** 50 times a second it clicks and
  flashes.
- **Three pucks stuck on the board's corners** (bottom left, top left, top right). Each times the click
  against the flash, which gives the band's distance from it. They also measure the board themselves.
- **Eight EMG electrodes inside the band.** They read the forearm's muscles: pressing the marker on the
  board, and pinching.

The motion sensor and microphone are already on today's band.

**How it works:**

- **Where the band is.** `js/concept/ultrasound.js` turns three distances into the band's place,
  exactly; the formula does not even need its distance out from the board. Echoes off the board or a
  wall are always late, so a distance much longer than predicted is thrown out. Three agreeing clicks
  in a row win the track back if the prediction goes wrong.
- **Smooth, and to the tip.** The board tracker's filter (`js/board/fuse.js`) fills in with the band's
  motion 208 times a second. The band's orientation then places the marker's tip, about 15 cm from the
  band. That offset is measured once: hold the tip on the bottom left puck for a second.
- **Writing or not.** `js/concept/contact.js` hears the marker's hiss in the band's microphone (high,
  noise-like, while moving), or `js/concept/emg.js` feels the forearm press. EMG keeps working in a
  room too loud for the microphone.
- **The ink.** `VexoBoard.ink()` gives strokes in cm with times, which any stroke-based handwriting
  recogniser takes. EMG may later decode the writing directly: Meta's sEMG wristband research reached
  20.9 words a minute (*Nature*, 2025).

**In simulation** (`node tests/concept.mjs`, 21 checks), with a puck blocked a tenth of the time and
the writer talking:

| Scene | Tip error, median / 95% |
|---|---|
| 1.2 m board, five words | 0.23 / 0.99 cm |
| 2.4 m board, walking along it | 0.42 / 0.97 cm |
| Writing without a pause | 0.53 / 6.5 cm |

The last one's tail is two pucks hearing echoes at once; a fourth puck would catch it.

Other results:
- **Marker on the board:** 100% of "on" decisions right, and 99% of the writing caught.
- **Loud room:** the microphone alone catches 0% of the writing; with EMG, 99%.
- **Pinches:** 2 of 2 found, none extra.

**Still to be shown on real hardware:** echoes off a real board and body, whether EMG through a band
feels a marker's light press, and battery life.

Files: `concept.html`, `css/concept.css`, `js/concept/`, `tests/concept.mjs`.

**The AXIS version.** The same pitch is also a page in the AXIS app, in its design, at `/board`:
`cd reflex-present && npm install && npx vite`, then open <http://localhost:5173/board>. It runs this
engine (copied into `reflex-present/src/board/engine/`) live in the browser. `reflex-present/` is the
AXIS app from the `pinch-and-drag` branch, with the Board page added.

## If time runs short

- No real recordings yet: the network in `model/` was trained on simulated readings and is there to start from. It may or may not read real writing; try it, but plan on step 4.
- Accuracy is poor with all ten digits: record fewer (`--labels 01234`) and retrain. The label set comes from the recordings.
- No internet: `--no-llm` buzzes the message itself back. The same happens automatically if Claude cannot be reached.

## What is in here

| | |
| --- | --- |
| `firmware/wrist/wrist.ino` | The wrist unit: streams readings and button presses, plays motor patterns |
| `airwrite/link.py` | The line to the wrist (serial), the pretend wrist, and click / double click / long press |
| `airwrite/log.py` | Collects labelled recordings |
| `airwrite/features.py` | Readings → what the network takes |
| `airwrite/model.py` | Runs the network with numpy |
| `airwrite/run.py` | The live demo |
| `airwrite/llm.py`, `morse.py` | The call to Claude, and text as Morse buzzes |
| `airwrite/synth.py` | Simulated wrist readings from real pen strokes |
| `train/train.py` | Trains on simulated readings (what `model/` holds now) |
| `train/real.py` | Trains and tests on real recordings |
| `index.html`, `js/` | A web page: draw with the cursor and watch the same network read it from simulated readings; also the original path-recovery view |

### The line to the wrist

Text lines at 115200 baud:

    wrist → Pi   I <ms> <ax> <ay> <az> <gx> <gy> <gz>    100 a second, m/s² and rad/s
                 B <ms> <1|0>                             button down (1) or up (0)
    Pi → wrist   V <on ms> <off ms> <on ms> ...           run the motor in this pattern

On an ESP32 the same lines can go over Bluetooth serial instead of USB (see the note at the top of the firmware).

### How a character is read

1. The second of stillness before the start click gives the gyroscope's bias, which is subtracted.
2. The jolt of each click and the stillness at both ends are cut off.
3. Gravity says which way is up, so the readings are turned to make up the same axis every time, however the sensor sits. Gravity is then removed from the accelerometer.
4. The six channels are resampled to 96 steps and given to a 1D convolutional network (about 83,000 weights, 165 KB).
5. Below 50% sure, the character is not taken.

On send, Claude (`claude-haiku-5-5`) gets the top three readings of each character with their probabilities, works out the intended message and answers in at most five words.

## What has been checked

All of this is with simulated data.

- The network trained on simulated readings reads 98% of simulated digits by 20 writers it did not learn from. Its misses are mostly 0, 7 and 9 read as 8.
- The full loop with the pretend wrist: clicks, recording, reading, confidence gate, send, Morse pattern.
- `train/real.py` end to end on 240 pretend recordings from four pretend people.
- `node tests/read.mjs`: the web page's copies of the simulation, features and network agree with the Python ones.

Not checked: the firmware (never compiled or run), the serial link, the motor, and the call to Claude (no API key was used).

The simulated readings come from [UJI Pen Characters v2](https://archive.ics.uci.edu/dataset/177/uji+pen+characters+version+2), real pen strokes from 60 writers, passed through a model of a forearm swinging about the elbow. A real wrist will differ, which is why step 4 matters.
