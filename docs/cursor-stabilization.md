**Cursor stabilization investigation — 2026-11-14**

The current implementation has a structural drift problem, a fragile rest detector, and discontinuous corrections. Smoothing can reduce tremor enough to let the detector work, but cannot by itself make the band an accurate absolute position sensor. For a cursor that must follow actual marker position continuously, add an independent position reference. For a band-only interaction, short relative strokes or an orientation-controlled pointer are more realistic targets.

This investigation covers the current working tree, including the uncommitted board, intake, recording, and bench work. No production code was changed. No real-band recording was found in the project files; the numerical results below are simulations and controlled synthetic probes, not measurements of this particular band. The board path is the main focus. The original page has a separate path, described below.

**What the implementation already does**

The board pipeline is:

```text
Band samples, with sensor timestamps
  -> Intake: learn a scalar 1 g value, optionally low-pass, interpolate gaps
  -> BoardTracker: decide whether motion looks calm
  -> Tracker: estimate orientation, subtract gravity, integrate velocity/position
  -> On rest: zero velocity and rewrite the preceding movement
  -> Project into the board frame established by two taps
  -> Draw the latest position directly
```

Using band timestamps instead of arrival times, recording raw samples, reporting missing samples, and keeping settled and live error separate are all useful foundations. The new bench is the right place to evaluate changes.

**What the existing tests actually show**

Ran `node tests/board.mjs`, `node tests/check.mjs`, and `node tests/read.mjs` against the existing working tree. The latter two pass. The board suite exits with one failed assertion: the gyro-bias recovery case with one-second pauses has 6.4 cm median settled error against a requirement below 6 cm. The other board assertions pass.

At 208 Hz, seed 1:

| Scenario | Median settled error | 95th percentile settled error | Median live error | 95th percentile live error |
| --- | ---: | ---: | ---: | ---: |
| Reach, no added tremor, default | 3.0 cm | 9.2 cm | 3.3 cm | 11.4 cm |
| Walk, default | 3.2 cm | 10.0 cm | 4.6 cm | 32.7 cm |
| Continuous writing, default | 61.7 cm | 82.9 cm | 122.2 cm | 594.8 cm |
| Reach, added tremor, default | 100.9 cm | 1272.6 cm | 108.1 cm | 1272.6 cm |
| Reach, added tremor, 6 Hz low-pass | 7.0 cm | 17.2 cm | 10.4 cm | 31.1 cm |
| Reach, no added tremor, 6 Hz low-pass | 4.7 cm | 7.7 cm | 4.3 cm | 21.8 cm |

“Settled” is the corrected historical trail. “Live” is what the user would have seen at the time. These are the existing `measure()` metrics over the simulated writing intervals, using the known physical board width. A good corrected shape does not establish a good live cursor.

The tremor simulation adds 0.2 m/s² sinusoidal acceleration plus angular disturbance. It is a stress case, not a model fitted to the user's hand. Across seeds 1–3, the default tremor case produces median settled errors of 100.9 cm, no board setup, and 1573.4 cm. With 6 Hz filtering these become 7.0, 7.8, and 4.6 cm. However, live 95th percentile errors remain 31.1, 83.5, and 36.5 cm. This is a useful mitigation, not a complete fix.

Also tried `calmSmooth: 0.025, pushSmooth: 0.04` and `calmSmooth: 0.05, pushSmooth: 0.05`. Neither was robust across these seeds; both degraded clean-motion results substantially. Increasing smoothing constants without checking false rests and latency is unsafe for accuracy.

The README's accuracy table describes older simulated results and does not match the current working tree.

**1. Position drift is amplified by gravity subtraction**

`js/fusion.js:141` rotates measured acceleration into world coordinates and subtracts gravity. At line 166 it integrates acceleration into velocity and velocity into position. A small tilt error leaves a component of gravity in the motion signal.

For a fixed 1° tilt error:

```text
false acceleration ≈ 9.80665 × sin(1°) = 0.171 m/s²
position error ≈ 0.5 × 0.171 × elapsed_seconds²
```

That is about 8.6 cm after one second and 34.2 cm after two seconds, before corrections. These are illustrative calculations assuming zero initial velocity error and a constant tilt error. Orientation error propagation is a standard cause of inertial position drift; see [Woodman's inertial-navigation report](https://www.cl.cam.ac.uk/techreports/UCAM-CL-TR-696.pdf).

A low-pass filter preserves a constant error. Raising the sample rate does not remove it either. Zeroing velocity at a genuine stop supplies useful information, but does not reveal the true position reached. Gravity constrains tilt, not heading; yaw drift remains another source of board-coordinate error.

**2. The rest detector fails in both directions**

`js/board/tracker.js:35` requires about 0.1 seconds of calm, roughly 21 consecutive samples at 208 Hz. `calmSmooth` is zero by default. Noise or tremor repeatedly breaks that run, preventing velocity resets and tilt correction.

The opposite problem is at `js/board/tracker.js:168`:

```js
why.push < o.stillWorld || why.steady < o.stillSteady
```

The second condition accepts a persistent acceleration as evidence of rest, on the assumption that it is gravity leaking through a tilt error. Real sustained acceleration can also meet that condition.

Reproduction: after one second of ideal stationary readings, apply a horizontal acceleration of 0.5 m/s² with zero angular rate. The tracker declares rest about 0.524 seconds into the acceleration and remains still. Over a nominal three-second acceleration interval the true displacement is approximately 2.25 m; the estimated x ends near −0.007 m. This is deliberately a simple counterexample, not a claim about typical writing motion.

Constant-velocity translation with fixed orientation is intrinsically indistinguishable from rest to these sensors alone. Statistical rest detection can improve the common case, but cannot eliminate that ambiguity.

Recommended change: separate “low disturbance” from “confirmed stationary.” Use time-based window statistics, different thresholds for entering and leaving rest, and explicit confidence. Calibrate thresholds using both known stationary recordings and slow translations. Do not promote a steady acceleration to a hard zero-velocity update solely because it is steady. A deliberate stationary calibration action or independent contact/position measurement gives stronger evidence. Board contact alone still allows motion along the board.

**3. Automatic 1 g learning can learn the movement itself**

`js/board/intake.js:93` learns a scalar acceleration magnitude whenever angular rate is small and the magnitude is stable. It has no independent stationary confirmation. `scaled()` then divides all three axes by that value.

In a vertical version of the 0.5 m/s² probe, the learned value rises to 1.048 g and the tracker declares rest about 0.913 seconds into the acceleration. The calibration is absorbing the acceleration it should track.

A single scalar also cannot identify three axis offsets and three sensitivities. A body-frame offset rotates into different world-frame errors as the wrist turns. Normalizing one stationary pose does not calibrate the other poses.

Recommended change: collect stationary measurements in multiple orientations, fit per-axis offsets and gains, and freeze them during drawing. Start with a diagonal model `a_calibrated = S × (a_raw − bias)`; use a full matrix only if the measurements justify it. Learn gyro bias from a verified stationary interval. [NXP AN4399](https://www.nxp.com/docs/en/application-note/AN4399.pdf) explains multi-orientation accelerometer calibration. Its method is relevant; its device-specific numbers should not be assumed to describe this band.

**4. Gap filling and filtering use inconsistent timelines**

`js/board/intake.js:56` learns and filters the newly received sample before checking for a gap. Missing samples are then interpolated between already-filtered endpoints. The biquad advances once for the received sample, while the tracker advances through all reconstructed samples.

Controlled probe at 208 Hz and a 6 Hz cutoff: after a stable input, skip 41 samples and receive an x input of 1 g. The current filtered endpoint is 0.00726 g. Advancing the same filter through the exact linear raw interpolation assumed for that gap gives 0.81528 g. Neither interpolation is evidence of what actually happened, but the large difference demonstrates inconsistent filter-time accounting.

`BRIDGE_MS = 250` can also fabricate around 50 samples at 208 Hz. An entire acceleration/deceleration pulse can occur inside such a gap. `filled: true` is carried by Intake but discarded by `fromBand()`, so artificial samples can contribute to the tracker's rest count like measured samples.

Recommended processing order:

```text
validate finite channels, timestamps, and sample numbers
  -> identify discontinuities
  -> apply fixed sensor calibration
  -> reconstruct only short permitted gaps, retaining quality flags
  -> filter on a coherent timebase
  -> update orientation, rest confidence, velocity, and position
```

Use actual timestamps for integration and time-based detector windows. Fixed-rate filters need a coherent sampling grid or another explicit treatment of irregular timing. On a discontinuity, reset filter and detector history; retaining fixed calibration is reasonable. `BoardTracker.restart()` currently retains the Intake object and its signal history. Reject duplicate/out-of-order samples appropriately instead of allowing them to contaminate calibration first. Do not count interpolated data as independent evidence for calibration or rest. Choose the permitted gap length from motion/error measurements; start conservatively with a few samples, not an unqualified quarter-second.

**5. Some visible jumps are generated by the correction algorithm**

`js/fusion.js:172` re-integrates up to 0.3 seconds before movement was detected. `settle()` at line 190 rewrites the movement after a detected rest. `js/board/page.js:297` draws the resulting latest coordinate directly.

Instrumenting the position immediately before and after `settle()` in the clean reach simulation gives 19 corrections after board setup: median board-plane displacement 2.26 cm, maximum 10.74 cm. These measurements include the remainder of the session after setup, not only writing. In the unfiltered tremor case, only one such correction occurs, moving the estimate about 113 cm. This supports missed-rest detection as a major failure mechanism in that simulation.

Recommended change: separate the causal live state, the retrospectively corrected stroke, and the displayed cursor. Track correction magnitudes explicitly. A small timestamp-based display buffer can interpolate packet arrivals; a brief blend can reduce visible correction jumps. Large corrections should trigger recovery or re-anchoring rather than silently showing a long false stroke. Presentation smoothing adds latency and does not improve physical accuracy.

For display jitter, evaluate a [One Euro filter](https://gery.casiez.net/1euro/), which changes smoothing with speed. Tune in a declared coordinate unit using timestamped data. Keep it out of sensor calibration and the estimator feedback loop. It cannot fix drift, and will still follow a drifting estimate.

The kit sends batches containing up to 50 ms of samples. Correct sensor timestamps preserve integration timing despite those bursts, but drawing only the latest point can still look stepped. Distinguish sample-time irregularity, packet-arrival irregularity, and render-frame irregularity in the logs.

**6. Orientation filtering is worth improving, but is not a position reference**

The current complementary correction only uses accelerometer tilt feedback after detecting rest. Missed rests therefore also allow tilt error to grow. After fixing ingestion and calibration, compare the current orientation estimator against [VQF](https://vqf.readthedocs.io/en/stable/) on identical recordings. VQF supports magnetometer-free orientation and gyro-bias estimation. Its published capabilities concern orientation; they do not establish accurate position for this application.

Adding an EKF with state `[position, velocity, orientation, gyro_bias, accel_bias]` can organize uncertainty and measurement updates. It still needs trustworthy measurements or constraints to correct unobservable position error. A Kalman filter supplied only with the same ambiguous inertial data does not create new position information.

**7. The wrist and marker tip are different points**

Even perfect wrist tracking would not exactly track a marker tip. A fixed rigid offset requires a transform such as `p_tip = p_sensor + R(q) × offset`. Fingers and wrist articulation can change that offset, so a constant correction is only an approximation. The current simulator generates sensor readings from its nominal hand/marker trajectory and does not validate a separate articulated wrist-to-tip model.

The board's width and direction are also inferred from the integrated path between taps. Their error affects every later coordinate. The tape-width input currently changes displayed measurements, not the estimator's physical calibration. `anchor()` corrects across-board/depth translation; it does not reset vertical drift, width, or heading.

**Recommended implementation order**

1. Capture real input and establish metrics before tuning. Use the bench's existing guided capture and raw export. Record supported stillness, free-hand stillness, slow and fast translations between marked points, rotation with the sensor position held approximately fixed, return-to-origin strokes, and writing with/without pauses. Compare USB and Bluetooth in separate sessions. Ensure setup taps are included in any recording intended for full board replay.
2. Fix validation, gap/filter ordering, quality propagation, and discontinuity resets. Add targeted regression cases for those failures. Keep the estimator and display clocks separate.
3. Replace continuous scalar 1 g learning with explicit multi-orientation calibration. Measure stillness thresholds on this band with its actual mounting. Use verified rests for bias adaptation.
4. Rework rest confidence and hysteresis against both stationary and moving examples. Measure missed rests and false rests separately. Preserve the slow-motion cases that expose erroneous zero-velocity updates.
5. Compare orientation/filter settings by replay. Evaluate off, 6, 8, and 12 Hz using the same captures. A 6 Hz cutoff is an immediate diagnostic option, not a proven default. Measure live error, correction jumps, and latency as well as the final trail.
6. Add cursor presentation smoothing only after the estimator is characterized. Record display latency, stationary jitter in pixels, and correction magnitude. Freeze or flag stale/unreliable tracking rather than integrating indefinitely through missing information.
7. Choose the sensing architecture based on the intended interaction:

| Required behavior | Recommended direction | Remaining limitation |
| --- | --- | --- |
| Actual marker position across a board during continuous writing | Camera observes board reference and marker/tip; IMU supplies orientation, gestures, and short-term prediction | Occlusion, calibration, tip offset, and camera latency need measurement |
| Band-only pointer controlled by wrist movement | Relative angular-rate or orientation mapping with clutch/recenter | Does not reproduce arbitrary hand translations; heading can drift |
| Band-only reconstruction of short strokes | Explicit stroke boundaries, verified pauses, frequent known-point anchors | Accuracy degrades with motion duration; smooth slow movement remains ambiguous |

For the first option, a calibrated camera can locate board markers and a tracked marker/tip in a common frame. Planar mapping is appropriate for a visible point on the board surface; an off-surface wrist needs a 3D treatment or a constrained tip model. [OpenCV's ArUco documentation](https://docs.opencv.org/4.11.0/d5/dae/tutorial_aruco_detection.html) supplies a concrete pose-estimation building block. The proposed camera/IMU combination still needs validation on this board; it is not an accuracy guarantee.

**What can be tried immediately with the existing code**

Open `board.html?rate=208&lowpass=6` for a temporary comparison. Use `bench.html` to load the same recorded session repeatedly with filtering off, 6 Hz, 8 Hz, and 12 Hz; selecting a cutoff restarts replay. The command-line equivalent is:

```sh
node tests/board.mjs --bench /path/to/recording.json
node tests/board.mjs --bench /path/to/recording.json --lowpass 6
node tests/board.mjs --bench /path/to/recording.json --lowpass 8
node tests/board.mjs --bench /path/to/recording.json --lowpass 12
```

The existing report gives timing, loss/clipping, spectrum, calm failures, rest events, board setup, and measured-dot results when available. Full live accuracy needs an independent timestamped position reference; a static dot at the endpoint only checks that endpoint. Add live percentile error, correction jumps, false/missed-rest counts, and latency to the acceptance criteria. Do not treat the bench's approximate frequency-band labels as a universal separation between handwriting and tremor.

For reproduction of the extended simulation comparison, the existing exported helpers are sufficient:

```sh
node --input-type=module - <<'JS'
import { session } from './js/board/simulate.js';
import { track, measure } from './tests/board.mjs';
for (const tremor of [0, 0.2]) {
  for (const lowpass of [null, 6, 8, 12]) {
    for (const seed of [1, 2, 3]) {
      const s = session('reach', { rate: 208, seed, tremor });
      const tracked = track(s, { lowpass });
      console.log({ tremor, lowpass, seed, board: !!tracked.bt.frame,
        metres: measure(s, tracked) });
    }
  }
}
JS
```

**If the original page is the one showing instability**

`js/app.js:283` requests 50 Hz and constructs `Tracker` directly at line 292. It bypasses the new board Intake and guarded startup. Its default sample-count settings therefore mean 1.2 seconds for startup, 0.6 seconds to confirm rest, and 1.2 seconds of movement lookback at 50 Hz. The board's filtering options do not affect this path. Its camera also continuously recenters/rescales the scene, which can add apparent screen motion. Consolidate ingestion and rate-aware settings before applying board-specific tuning conclusions there.
