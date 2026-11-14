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

`board.html` shows where the band hand is on a whiteboard. Tap the board's left edge, then its far right
edge, and from then on the page draws a cursor and the trail of your hand on the board. Across, 0 is the
left edge and 1 the right; height uses the same scale and has no limit. Teach it two gestures: **Take**
lifts the writing around your hand, and **Put** drops it on the screen.

    git submodule update --init                 # the Vexo kit, once after cloning
    python3 -m http.server 8000 --bind 127.0.0.1

Open <http://localhost:8000/board.html> in Chrome or Edge, double-tap the band, check the band number
(68, set in `js/board/config.js`) and press Connect. No band? Choose "Pretend band" and press "Play a
pretend session".

1. After connecting, hold the band still for a second. That is when it learns which way is up and its
   gyroscope's bias, and it waits until you are still.
2. Press **Set up board**. Knock the board's left edge with your band hand and hold still, then knock
   its far right edge and hold still.
3. Write, and pause for a moment now and then (between words). Each pause lets the tracker take the
   drift out. The page reminds you after 4 seconds without one.
4. Drifted? Press **Re-anchor** (or double-tap the band) and knock the left or right edge.
5. Record Take, Put and "Not a gesture" (a few ordinary letters) three to five times each.
   **Keep on band** stores them in the band's storage (slots 900 to 929), and they load whenever the
   band connects. Anyone who connects to the band can read or wipe them.

**How it works.** Position comes from adding up the band's motion with `Tracker` (`js/fusion.js`). It
sets the speed to zero at every pause and takes each movement's drift out once the hand rests.
`js/board/tracker.js` adds the following, without changing `js/fusion.js`:
- the board frame from the two taps: across from the taps, up from gravity; motion toward or away from
  the board is ignored
- rest detection timed for the short pauses of writing
- a check that a "rest" is not just the hand slowing down at the end of a long move

Gestures use the kit's gesture-trainer recogniser, copied unchanged into `js/board/recogniser.js`.

**How accurate.** These numbers come from simulated sessions at 208 samples a second
(`node tests/board.mjs`). Nothing has been measured on a real board yet.

| Simulated session | Board width | Hand position (median / 95%) | Shape of each word |
| --- | --- | --- | --- |
| 1.2 m board, short pauses between letters | 0.1 cm off | 3.4 / 6.6 cm | 0.7 cm |
| 2.4 m board, side-stepping along it | 4.4 cm off | 1.8 / 8.1 cm | 0.8 cm |
| Written without a single pause | 0.1 cm off | 24 / 58 cm | 25 cm |

Motion sensors alone drift while the hand keeps moving, so the pauses are what keep it accurate. A
tracker that started with its gyroscope's bias badly off recovers at pauses of about a second, but not
without them. 208 samples a second beat 416: the extra noise in each sample breaks up the short rests.

To measure a real board, put a few dots on it and enter their positions under **Measure**. Turn on
"Measure taps", tap each dot, and use **Record session**. `node tests/board.mjs --replay <file>` plays a
recording back through the tracker.

**Not done yet:**
- Telling a marker on the board from a lifted one: every movement draws.
- Turning the writing into text. Each Put fires a `board:put` event carrying the strokes, ready for that.
- Recognising gestures on the band itself. The kit's firmware only detects its own seven built-in
  gestures, so the examples are kept on the band but matched on the computer.

Files: `board.html`, `css/board.css`, `js/board/` (tracker, gestures, the kit's recogniser, the
simulator, the page, and the band number in `config.js`), `tests/board.mjs`.

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
