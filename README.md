# Air Draw

Draw in the air with a motion sensor. Accelerometer and gyroscope readings go in; the path the hand took comes out.

The sensor data is simulated for now: `js/fake.js` moves a hand along a shape and works out what the two sensors would have read, with noise and bias, and keeps the true path to compare against.

## Run it

Any static server from this folder, for example:

    python3 -m http.server 8000

then open http://localhost:8000. Drag the drawing to turn it.

The page has two modes:

- **Sensor** plays the simulated readings and draws the path recovered from them.
- **Write** is a pad: draw a character with the cursor or a finger, pause, and a small neural network reads it into text. It knows digits and capital letters.

## How the sensor path is recovered


`js/fusion.js` holds a `Tracker`. Feed it samples and read back positions:

    { t, ax, ay, az, gx, gy, gz, pen }

`t` in seconds, acceleration in m/s² with gravity included, turn rate in rad/s, both in the sensor's own axes. `pen` is optional: 0 while the pen is lifted.

1. **Start-up.** Held still, the accelerometer reads only gravity, which gives the tilt; whatever the gyroscope reads is its bias.
2. **Orientation.** The gyroscope turns the estimate. At rest the accelerometer pulls the tilt back toward gravity.
3. **Position.** Acceleration is turned into world axes, gravity is taken out, and what is left is summed twice.
4. **Stops.** Summing twice drifts fast. Each time the sensor comes to rest its true velocity is zero, so the velocity the sums had reached is drift; it is taken back out of the movement just made, along with the tilt the gyroscope lost on the way.

So a drawing has to be made of movements with a short rest (about a third of a second) between them. A long movement with no rest drifts, and so does heading over many strokes: nothing here measures which way is north.

## How a character is read

1. **Picture.** `js/raster.js` scales the strokes to fit a 20 × 20 box in the middle of a 28 × 28 picture and draws them with a soft pen. Stroke order and direction are thrown away on purpose: they vary between people, and will be rough from a sensor.
2. **Network.** `js/net.js` runs a small convolutional network (three 3 × 3 convolutions, two dense layers, about 117,000 weights, 470 KB) in plain JavaScript. It scores all 36 characters.
3. **Text.** After three quarters of a second without drawing, the best guess joins the text. The other guesses stay on show; picking one corrects it.

The network is trained by `train/train.py` on EMNIST "balanced" (86,400 handwritten digits and capitals), with each image thickened, thinned, turned, resized and slanted at random so cursor drawings look familiar. It reads **91.5%** of 14,400 held-out test images. Most of what it misses nobody could tell apart alone: 1/L/I and 0/O are two thirds of the errors. EMNIST also files some lower-case letters under their capitals (l with L, for one), which is where 1/L comes from.

To train it again:

    python3 train/get_data.py
    uv run --with torch --with numpy train/train.py

## Checked

`node tests/check.mjs` draws every shape with five different noise seeds and compares the recovered path with the true one. Drawings are 20 to 40 cm across; the recovered path stays within about 3 cm on average.

`node tests/read.mjs` checks that the JavaScript network gives the same scores as the trained one on saved test images, and that 15 characters drawn as plain strokes are read correctly.

## Using a real sensor

Replace the fake samples in `js/app.js` with real ones in the same format and call `tracker.feed(sample)` as they arrive. The thresholds for "at rest" at the top of `js/fusion.js` were set for the simulated noise and will need tuning.
