# Air Draw

Draw in the air with a motion sensor. Accelerometer and gyroscope readings go in; the path the hand took comes out.

The sensor data is simulated for now: `js/fake.js` moves a hand along a shape and works out what the two sensors would have read, with noise and bias, and keeps the true path to compare against.

## Run it

Any static server from this folder, for example:

    python3 -m http.server 8000

then open http://localhost:8000. Drag the drawing to turn it.

## How it works

`js/fusion.js` holds a `Tracker`. Feed it samples and read back positions:

    { t, ax, ay, az, gx, gy, gz, pen }

`t` in seconds, acceleration in m/s² with gravity included, turn rate in rad/s, both in the sensor's own axes. `pen` is optional: 0 while the pen is lifted.

1. **Start-up.** Held still, the accelerometer reads only gravity, which gives the tilt; whatever the gyroscope reads is its bias.
2. **Orientation.** The gyroscope turns the estimate. At rest the accelerometer pulls the tilt back toward gravity.
3. **Position.** Acceleration is turned into world axes, gravity is taken out, and what is left is summed twice.
4. **Stops.** Summing twice drifts fast. Each time the sensor comes to rest its true velocity is zero, so the velocity the sums had reached is drift; it is taken back out of the movement just made, along with the tilt the gyroscope lost on the way.

So a drawing has to be made of movements with a short rest (about a third of a second) between them. A long movement with no rest drifts, and so does heading over many strokes: nothing here measures which way is north.

## Checked

`node tests/check.mjs` draws every shape with five different noise seeds and compares the recovered path with the true one. Drawings are 20 to 40 cm across; the recovered path stays within about 3 cm on average.

## Using a real sensor

Replace the fake samples in `js/app.js` with real ones in the same format and call `tracker.feed(sample)` as they arrive. The thresholds for "at rest" at the top of `js/fusion.js` were set for the simulated noise and will need tuning.
