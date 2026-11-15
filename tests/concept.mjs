// node tests/concept.mjs
//
// Checks for the Vexo Board concept (js/concept/): a band that clicks ultrasound to
// three pucks on the board, hears the marker with its microphone, and reads the
// forearm's muscles (EMG). The hardware does not exist yet, so every check runs on
// simulated sessions (js/concept/simulate.js) built on the board tracker's pretend
// writer. Exits 1 if any check fails.

import { conceptSession } from '../js/concept/simulate.js';
import { Contact, features, FRAME } from '../js/concept/contact.js';
import { Envelope, Muscles, BLOCK, CHANNELS } from '../js/concept/emg.js';
import { locate, Pings, speedOfSound, survey } from '../js/concept/ultrasound.js';
import { play, score } from '../js/concept/replay.js';

let failed = 0;
const check = (ok, line) => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`);
};
const cm = (m) => (m * 100).toFixed(2);

// ---------------------------------------------------------------- the geometry
check(Math.abs(speedOfSound(20) - 343.2) < 0.3 && speedOfSound(30) > speedOfSound(10), `sound at 20 °C: ${speedOfSound(20).toFixed(1)} m/s, faster when warm`);

const layout = survey({ across: 1.2, up: 1.2, diagonal: Math.hypot(1.2, 1.2) + 0.004 });
check(layout.width === 1.2 && layout.height === 1.2 && Math.abs(layout.square - 0.004) < 1e-9, 'the pucks measure the board themselves: 1.2 × 1.2 m, 4 mm off square');

{
  const band = [0.37, 0.81, 0.07], pucks = [[0, 0, 0], [0, 1.2, 0], [1.2, 1.2, 0]];
  const r = pucks.map((p) => Math.hypot(band[0] - p[0], band[1] - p[1], band[2] - p[2]));
  const all = locate(r, layout), two = locate([null, r[1], r[2]], layout, 0.07);
  check(Math.hypot(all.x - band[0], all.y - band[1], all.z - band[2]) < 1e-9, 'three distances put the band exactly where it is');
  check(Math.hypot(two.x - band[0], two.y - band[1]) < 1e-9, 'two distances and its distance out from the board do too');

  // An echo: the top right puck hears the click 20 cm late. With a prediction, it is left out.
  const c = speedOfSound(20), pings = new Pings(layout, { celsius: 20 });
  const echo = r.map((v, k) => (v + (k === 2 ? 0.2 : 0)) / c);
  const raw = locate(echo.map((d) => d * c), layout), kept = pings.fix(1000, echo, [band[0] + 0.003, band[1] - 0.002]);
  check(kept && Math.hypot(kept.x - band[0], kept.y - band[1]) < 0.01 && Math.hypot(raw.x - band[0], raw.y - band[1]) > 0.1,
    `an echo 20 cm long: taken as it is, ${cm(Math.hypot(raw.x - band[0], raw.y - band[1]))} cm off; left out, ${cm(Math.hypot(kept.x - band[0], kept.y - band[1]))} cm`);

  // The prediction gone 50 cm wrong: three full clicks that agree win it back.
  const lost = new Pings(layout, { celsius: 20 }), right = r.map((v) => v / c), wrongly = [band[0] + 0.5, band[1]];
  const answers = [0, 20, 40].map((t) => lost.fix(2000 + t, right, wrongly));
  check(!answers[0] && !answers[1] && answers[2]?.regained, 'a prediction 50 cm wrong: refused twice, then three agreeing clicks win it back');
}

// ---------------------------------------------------------------- hearing the marker
{
  const hiss = new Float32Array(FRAME), speech = new Float32Array(FRAME);
  let prev = 0, seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let n = 0; n < FRAME; n++) {
    const w = rand();
    hiss[n] = 0.02 * (w - prev);
    prev = w;
    for (let h = 1; h * 150 < 3500; h++) speech[n] += (0.05 / h) * Math.sin((2 * Math.PI * h * 150 * n) / 16000);
  }
  const a = features(hiss), b = features(speech);
  check(a.flat > 0.35 && a.high > a.low && b.high < b.low - 10, `a marker's hiss is high and noise-like (${a.high.toFixed(0)} dB high, flatness ${a.flat.toFixed(2)}); a voice is low (${b.low.toFixed(0)} dB low, ${b.high.toFixed(0)} dB high)`);
  const contact = new Contact();
  for (let i = 0; i < 20; i++) contact.frame(i * 20, features(new Float32Array(FRAME).map(() => 0.0005 * rand())), 0.2);
  for (let i = 20; i < 40; i++) contact.frame(i * 20, a, 0.2);
  for (let i = 40; i < 50; i++) contact.frame(i * 20, a, 0);
  check(contact.intervals.length === 1 && contact.at(600) && !contact.at(300) && !contact.at(950), 'hiss while moving is the marker on the board; the same hiss with the hand still is not');
}

// ---------------------------------------------------------------- the forearm's muscles
{
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const block = (effort) => Array.from({ length: CHANNELS }, (_, c) => Float32Array.from({ length: BLOCK }, () => effort(c) * rand() * 1e-3 + 2e-3));
  const env = new Envelope(), many = (e) => Array.from({ length: 40 }, () => block(e));
  env.calibrate(many(() => 0.02), many(() => 1));
  const relaxed = env.level(block(() => 0.02)), hard = env.level(block(() => 1));
  check(relaxed.every((v) => v < 0.1) && hard.every((v) => v > 0.8), 'EMG levels: about 0 relaxed, about 1 squeezing hard, the electrodes\' offset ignored');
  const muscles = new Muscles();
  muscles.holding(many((c) => 0.02 + (c < 4 ? 0.12 : 0)).map((b) => env.level(b)));
  const states = [];
  for (let i = 0; i < 30; i++) states.push(muscles.frame(i * 20, env.level(block((c) => 0.02 + (c < 4 ? 0.12 : 0)))).pressing);
  for (let i = 30; i < 60; i++) states.push(muscles.frame(i * 20, env.level(block((c) => 0.02 + (c < 4 ? 0.3 : 0)))).pressing);
  for (let i = 60; i < 80; i++) muscles.frame(i * 20, env.level(block((c) => 0.02 + (c === 4 || c === 5 ? 0.7 : 0))));
  check(states.slice(5, 30).filter(Boolean).length <= 1 && states.slice(35).filter(Boolean).length >= 20 && muscles.events.length === 1,
    'holding the marker is not pressing; pressing it is; a thumb-and-finger pinch is one pinch');
}

// ---------------------------------------------------------------- whole sessions
const sessions = {};
for (const [key, name, opts, playOpts] of [
  ['reach', 'reach', {}, {}],
  ['walk', 'walk', {}, {}],
  ['steady', 'steady', {}, {}],
  ['quiet', 'reach', { blocked: false, talk: false }, {}],
  ['loudMic', 'reach', { noisy: true }, { emg: false }],
  ['loudEmg', 'reach', { noisy: true }, {}],
]) {
  const s = conceptSession(name, opts), vb = play(s, playOpts);
  sessions[key] = { s, vb, r: score(s, vb) };
}
const line = (r) => `tip ${cm(r.tip[0])} cm half the time, ${cm(r.tip[1])} cm 95%; band ${cm(r.band[0])} / ${cm(r.band[1])} cm`;
{
  const { vb, r } = sessions.reach;
  check(vb.ready && vb.news.some((n) => n.type === 'tip') && Math.abs(Math.hypot(...vb.tipBody) - Math.hypot(...sessions.reach.s.tipBody)) < 0.01,
    `set up by touching the tip to a puck (it is ${cm(Math.hypot(...vb.tipBody))} cm from the band) and knocking left, then right`);
  check(r.tip[0] < 0.005 && r.tip[1] < 0.015, `1.2 m board, a puck blocked a tenth of the time, the writer talking: ${line(r)}`);
  check(r.precision > 0.97 && r.recall > 0.95, `marker on the board: ${(r.precision * 100).toFixed(0)}% of "on" right, ${(r.recall * 100).toFixed(0)}% of its moving caught`);
  check(Math.abs(r.strokes - r.written) <= Math.max(3, 0.25 * r.written), `${r.strokes} strokes of ink for ${r.written} written`);
  check(r.pinches.found === r.pinches.of && r.pinches.extra === 0, `pinches: ${r.pinches.found} of ${r.pinches.of} found, ${r.pinches.extra} extra`);
  check(r.clicks.echoes > 50 && r.clicks.regained >= 1, `echoes left out: ${r.clicks.echoes}; clicks with a puck missing: ${r.clicks.partial}; times the track was won back: ${r.clicks.regained}`);
}
check(sessions.quiet.r.tip[1] < 0.006, `nothing in the way and no talking: ${line(sessions.quiet.r)}`);
check(sessions.walk.r.tip[0] < 0.008 && sessions.walk.r.tip[1] < 0.02, `2.4 m board, walking along it: ${line(sessions.walk.r)}`);
check(sessions.steady.r.tip[0] < 0.01, `written without a pause: ${line(sessions.steady.r)} (the 95% tail is two pucks hearing echoes at once; a fourth puck would catch it)`);
check(sessions.loudMic.r.recall < 0.2 && sessions.loudEmg.r.recall > 0.9 && sessions.loudEmg.r.precision > 0.95,
  `a loud room: the microphone alone catches ${(sessions.loudMic.r.recall * 100).toFixed(0)}% of the writing; with EMG, ${(sessions.loudEmg.r.recall * 100).toFixed(0)}%`);
{
  const ink = sessions.reach.vb.ink();
  check(ink.unit === 'cm' && ink.strokes.length === sessions.reach.r.strokes && ink.strokes.every((st) => st.x.length === st.y.length && st.x.length === st.t.length),
    `the ink for a handwriting recogniser: ${ink.strokes.length} strokes, ${ink.strokes.reduce((a, st) => a + st.x.length, 0)} points, in cm`);
}

process.exitCode = failed ? 1 : 0;
