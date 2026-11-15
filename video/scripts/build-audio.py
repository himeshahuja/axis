# Builds the film's soundtrack from audio/cues.json and the recordings in audio/sources:
#   public/audio/sfx/<sound>.wav   designed sound effects (recorded layers + synthesis)
#   public/audio/score.wav         the ambient score, written against the film's markers
#   src/audio/sfx-manifest.json    where each sound's hit sits, in whole frames
#
# Run: python3 -I scripts/build-audio.py   (needs numpy and ffmpeg; deterministic)
#
# Every designed sound is padded so its hit (the transient you should feel) falls on an
# exact frame boundary; the Soundtrack component starts it that many frames early.

import json, math, os, subprocess, sys, wave
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SR = 48000
FPS = 30
SPF = SR // FPS  # samples per frame (1600)
SRC = os.path.join(ROOT, 'audio', 'sources', 'freesound')
OUT = os.path.join(ROOT, 'public', 'audio')
os.makedirs(os.path.join(OUT, 'sfx'), exist_ok=True)
rng = np.random.default_rng(20261114)

# ---- io ---------------------------------------------------------------------------------

_cache = {}
def load(sid):
    """A Freesound source as float32 stereo [n, 2] at 48 kHz."""
    if sid in _cache:
        return _cache[sid].copy()
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', os.path.join(SRC, f'{sid}.ogg'), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)
    _cache[sid] = x
    return x.copy()

def write(path, x):
    x = np.asarray(x, np.float64)
    if x.ndim == 1:
        x = np.stack([x, x], 1)
    tpdf = (rng.random(x.shape) - rng.random(x.shape)) / 32768.0
    y = np.clip(x + tpdf, -1, 1)
    data = (y * 32767).astype('<i2').tobytes()
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)

# ---- basic dsp --------------------------------------------------------------------------

def secs(s):
    return int(round(s * SR))

def st(x):
    return x if x.ndim == 2 else np.stack([x, x], 1)

def mono(x):
    return x.mean(1) if x.ndim == 2 else x

def silence(s):
    return np.zeros((secs(s), 2))

def peak(x):
    return float(np.abs(x).max()) + 1e-12

def norm(x, db=-1.0):
    return x * (10 ** (db / 20) / peak(x))

def db(v):
    return 10 ** (v / 20)

def fade(x, fin=0.002, fout=0.01):
    x = st(x).copy()
    n = len(x)
    a = min(secs(fin), n // 2)
    b = min(secs(fout), n // 2)
    if a > 0:
        x[:a] *= np.linspace(0, 1, a)[:, None] ** 2
    if b > 0:
        x[-b:] *= np.linspace(1, 0, b)[:, None] ** 2
    return x

def dk(x, tau):
    """Exponential decay over the signal's own length."""
    x = st(x)
    return x * np.exp(-np.arange(len(x)) / SR / tau)[:, None]

def seg(x, t0, t1):
    return x[secs(t0):secs(t1)].copy()

def env_follow(x, ms=2.0):
    m = np.abs(mono(x))
    k = max(1, int(SR * ms / 1000))
    return np.convolve(m, np.ones(k) / k, mode='same')

def onsets(x, thr=0.25, gap=0.05):
    """Transient sample indices: envelope crossing thr×peak after being quiet."""
    e = env_follow(x, 1.5)
    t = e.max() * thr
    out = []
    last = -10 ** 9
    lag = secs(0.004)
    for i in np.where((e[lag:] > t) & (e[:-lag] < t * 0.5))[0] + lag:
        if i - last > secs(gap):
            out.append(int(i))
            last = i
    return out

def transient(x, nth=0, thr=0.25):
    o = onsets(x, thr)
    return o[min(nth, len(o) - 1)] if o else 0

def fft_filter(x, curve):
    """Zero-phase filter by a magnitude curve(f). Fine for smooth EQ on short sounds."""
    x = st(x)
    n = len(x)
    N = 1 << int(math.ceil(math.log2(n + secs(0.05))))
    f = np.fft.rfftfreq(N, 1 / SR)
    g = curve(np.maximum(f, 1e-3))
    pad = np.zeros((N, 2))
    pad[:n] = x
    y = np.fft.irfft(np.fft.rfft(pad, axis=0) * g[:, None], N, axis=0)
    return y[:n]

def hp(x, fc, order=2):
    return fft_filter(x, lambda f: 1 / np.sqrt(1 + (fc / f) ** (2 * order)))

def lp(x, fc, order=2):
    return fft_filter(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))

def bp(x, lo, hi, order=2):
    return lp(hp(x, lo, order), hi, order)

def shelf(x, fc, gain_db, high=True):
    g = db(gain_db)
    def c(f):
        r = (f / fc) ** 2 if high else (fc / f) ** 2
        return 1 + (g - 1) * r / (1 + r)
    return fft_filter(x, c)

def peq(x, fc, gain_db, q=1.0):
    g = db(gain_db)
    return fft_filter(x, lambda f: 1 + (g - 1) * np.exp(-0.5 * (np.log2(f / fc) * q * 2.2) ** 2))

def onepole_lp(x, fc_arr):
    """Time-varying one-pole low-pass (cutoff per sample). For sweeps."""
    x = st(x)
    k = 1 - np.exp(-2 * np.pi * np.asarray(fc_arr) / SR)
    k = np.broadcast_to(k, (len(x),))
    y = np.empty_like(x)
    s0 = 0.0
    s1 = 0.0
    xl = x[:, 0]
    xr = x[:, 1]
    for i in range(len(x)):
        s0 += (xl[i] - s0) * k[i]
        s1 += (xr[i] - s1) * k[i]
        y[i, 0] = s0
        y[i, 1] = s1
    return y

def resample(x, ratio):
    """Tape-style pitch/speed change: ratio > 1 is higher and shorter."""
    x = st(x)
    n = int(len(x) / ratio)
    t = np.arange(n) * ratio
    return np.stack([np.interp(t, np.arange(len(x)), x[:, c]) for c in range(2)], 1)

def semis(x, s):
    return resample(x, 2 ** (s / 12))

def pan(x, p):
    """Constant-power pan, p in [-1, 1]."""
    m = mono(x)
    a = (p + 1) * np.pi / 4
    return np.stack([m * np.cos(a), m * np.sin(a)], 1) * math.sqrt(2)

def widen(x, ms=9.0, amt=0.5):
    x = st(x)
    d = secs(ms / 1000)
    r = np.concatenate([np.zeros(d), x[:, 1]])[: len(x)]
    out = x.copy()
    out[:, 1] = x[:, 1] * (1 - amt) + r * amt
    return out

def sat(x, drive=1.5):
    return np.tanh(x * drive) / np.tanh(drive)

def mix(*parts, length=None):
    """parts: (signal, start_seconds, gain). Returns stereo mix."""
    L = length or max(secs(t) + len(st(s)) for s, t, g in parts)
    out = np.zeros((secs(L) if isinstance(L, float) else L, 2))
    for s, t, g in parts:
        s = st(s)
        i = secs(t)
        j = min(len(out), i + len(s))
        if j > i:
            out[i:j] += s[: j - i] * g
    return out

def tone(freq, dur, partials=((1, 1.0),), attack=0.004, decay=0.3, vib=0.0, phase_seed=0):
    t = np.arange(secs(dur)) / SR
    f = np.broadcast_to(np.asarray(freq, np.float64), t.shape) if np.ndim(freq) else np.full(t.shape, float(freq))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if vib:
        ph = ph + vib * np.sin(2 * np.pi * 5.1 * t)
    y = np.zeros_like(t)
    for k, a in partials:
        y += a * np.sin(k * ph + phase_seed * k)
    env = np.minimum(t / max(attack, 1e-4), 1) * np.exp(-t / decay)
    return y * env

def noise(dur):
    return rng.standard_normal((secs(dur), 2))

_irs = {}
def ir(length=2.0, damp=4500.0, pre=0.012, early=True, seed=1):
    """A synthetic stereo room: early reflections + decorrelated noise tail whose highs die faster."""
    key = (length, damp, pre, early, seed)
    if key in _irs:
        return _irs[key]
    g = np.random.default_rng(seed)
    n = secs(length)
    t = np.arange(n) / SR
    tail = g.standard_normal((n, 2))
    # three bands, each with its own decay: lows ring longest
    lo = lp(tail, 400)
    mid = bp(tail, 400, damp)
    hi = hp(tail, damp)
    T = length / 6.9  # -60 dB at `length`
    y = lo * np.exp(-t / (T * 1.15))[:, None] + mid * np.exp(-t / T)[:, None] + hi * np.exp(-t / (T * 0.45))[:, None] * 0.6
    y[: secs(pre)] = 0
    y[secs(pre):] *= np.minimum(1, (t[secs(pre):] - pre) / 0.02)[:, None]
    if early:
        for i, (d, a) in enumerate([(0.011, 0.5), (0.017, 0.38), (0.023, 0.3), (0.031, 0.24), (0.043, 0.18)]):
            y[secs(pre * 0.5 + d), i % 2] += a * 6
    y /= np.sqrt((y ** 2).sum(0, keepdims=True))
    _irs[key] = y
    return y

def conv(x, h):
    x = st(x)
    n = len(x) + len(h) - 1
    N = 1 << int(math.ceil(math.log2(n)))
    X = np.fft.rfft(x, N, axis=0)
    Hh = np.fft.rfft(h, N, axis=0)
    return np.fft.irfft(X * Hh, N, axis=0)[:n]

def verb(x, wet=0.25, length=1.6, damp=4500.0, pre=0.012, hp_send=180.0, tail=None):
    x = st(x)
    w = conv(hp(x, hp_send), ir(length, damp, pre))
    out = np.zeros((len(w), 2))
    out[: len(x)] += x * (1 - wet * 0.35)
    out += w * wet
    if tail is not None:
        out = out[: secs(tail)]
    return out

def trim_tail(x, floor_db=-70.0):
    e = env_follow(x, 10)
    idx = np.where(e > peak(x) * db(floor_db))[0]
    end = (idx.max() + secs(0.02)) if len(idx) else len(x)
    return fade(x[: min(len(x), end)], 0, 0.03)

def pitch_of(x, lo=300, hi=4000):
    m = mono(x)[: secs(0.4)]
    X = np.abs(np.fft.rfft(m * np.hanning(len(m)), 1 << 16))
    f = np.fft.rfftfreq(1 << 16, 1 / SR)
    band = (f > lo) & (f < hi)
    return float(f[band][np.argmax(X[band])])

# ---- the sounds ---------------------------------------------------------------------------

NOTE = {'D2': 73.42, 'A2': 110.0, 'D3': 146.83, 'E3': 164.81, 'F#3': 185.0, 'G3': 196.0, 'A3': 220.0, 'B3': 246.94, 'C#4': 277.18, 'D4': 293.66, 'E4': 329.63, 'F#4': 369.99, 'G4': 392.0, 'A4': 440.0, 'B4': 493.88, 'C#5': 554.37, 'D5': 587.33, 'E5': 659.25, 'F#5': 739.99, 'A5': 880.0, 'B5': 987.77, 'D6': 1174.66, 'F#6': 1479.98, 'A6': 1760.0}

def at_transient(x, nth=0, pre=0.004, post=0.25, thr=0.25):
    i = transient(x, nth, thr)
    return x[max(0, i - secs(pre)): i + secs(post)].copy()

GLASS = load(198401)
GLASS_F0 = pitch_of(GLASS, 400, 3000)

def glass(note, dur=0.5, decay=0.18):
    """The wine glass, retuned to `note`, with a matching sine partial for clarity."""
    g = at_transient(GLASS, 0, 0.002, 0.9)
    g = semis(g, 12 * math.log2(NOTE[note] / GLASS_F0))
    g = hp(g, NOTE[note] * 0.6)
    g = g[: secs(dur)] * np.exp(-np.arange(min(len(g), secs(dur))) / SR / decay)[:, None]
    s = tone(NOTE[note], dur, ((1, 1.0), (2, 0.18), (3, 0.05)), 0.003, decay * 1.2)
    return fade(mix((norm(g, -3), 0, 0.8), (st(s), 0, 0.42), length=secs(dur)), 0.001, 0.05)

def click_core():
    a = at_transient(load(766639), 1, 0.003, 0.09, 0.3)
    b = at_transient(load(378085), 0, 0.002, 0.07)
    a = shelf(hp(a, 220), 6000, -3)
    b = lp(hp(b, 300), 7000)
    body = tone(np.linspace(150, 72, secs(0.07)), 0.07, ((1, 1.0),), 0.0015, 0.022)
    return mix((norm(a, -1), 0, 1.0), (norm(b, -1), 0, 0.35), (st(body), 0.001, 0.5), length=secs(0.12))

def knob():
    return hp(at_transient(load(144194), 0, 0.001, 0.05), 400)

SOUNDS = {}  # id -> (stereo audio, hit sample)

def steepest_rise(x, around, span=0.12):
    """Sample of the steepest rise of the loudness envelope near `around` (the felt hit)."""
    m = np.abs(mono(x))
    e = np.convolve(np.convolve(m, np.ones(48) / 48, mode='same'), np.ones(96) / 96, mode='same')
    a = max(0, around - secs(span))
    b = min(len(e) - 1, around + secs(span))
    return a + int(np.argmax(np.diff(e[a:b + 1])))

def put(name, x, hit=0.0, peak_db=-1.0, refine=True):
    x = st(x)
    h = secs(hit)
    if refine:
        h = steepest_rise(x, h)
    SOUNDS[name] = (norm(x, peak_db), h)

# 1 · problem ---------------------------------------------------------------------------
mc = load(534104)
mo = onsets(mc, 0.3, 0.08)
for name, k in (('mouse-click-a', 0), ('mouse-click-b', 2)):
    c = mc[mo[k] - secs(0.003): mo[k] + secs(0.07)]
    put(name, fade(lp(hp(c, 250), 9000), 0.001, 0.02), 0.003, -4)

boom = load(157245)
freeze = mix(
    (lp(at_transient(boom, 0, 0.002, 1.3), 260), 0, 1.0),
    (lp(semis(at_transient(load(339437), 0, 0.002, 0.3), -3), 180), 0, 0.6),
    (bp(at_transient(load(481789), 0, 0.001, 0.12), 400, 5000), 0, 0.25),
)
put('freeze-hit', verb(fade(freeze, 0.001, 0.4), 0.18, 1.4, 2500), 0.002)

# 2 · reveal --------------------------------------------------------------------------------
sonar = at_transient(load(736851), 0, 0.002, 2.6)
point = mix(
    (hp(sonar, 250), 0, 0.55),
    (st(tone(NOTE['D5'], 2.4, ((1, 1), (2, 0.2), (3, 0.06)), 0.01, 0.7)), 0, 0.28),
    (st(tone(NOTE['A5'], 2.0, ((1, 1),), 0.02, 0.5)), 0.04, 0.12),
    (st(tone(np.linspace(110, 73.4, secs(0.6)), 0.6, ((1, 1),), 0.004, 0.18)), 0, 0.55),
)
put('point-in', verb(point, 0.4, 3.2, 5000, 0.03), 0.002)

rumble = load(856174)
rev = rumble[::-1][-secs(2.2):].copy()  # the last 2.2 s of the reversed rumble: rises into the hit
air = noise(2.2) * np.linspace(0, 1, secs(2.2))[:, None] ** 2.5
air = widen(onepole_lp(air, np.linspace(300, 5200, secs(2.2)) ** 1.0), 12, 0.7)
shim = sum(st(tone(NOTE[n], 2.2, ((1, 1),), 1.6, 9)) for n in ('D5', 'A5', 'E5'))
swell = mix((lp(rev, 700), 0, 0.9), (air, 0, 0.05), (shim * np.linspace(0, 1, secs(2.2))[:, None] ** 2, 0, 0.06))
swell = mix((swell, 0, 1), (verb(swell[-secs(0.3):], 1.0, 1.6, 3000), 2.2 - 0.3, 0.6))
put('field-swell', fade(swell, 0.4, 0.6), 2.2, refine=False)

glide = tone(np.geomspace(NOTE['D5'], NOTE['A5'], secs(0.22)), 0.22, ((1, 1), (2, 0.15)), 0.01, 0.12)
put('crossbar', verb(mix((st(glide), 0, 0.6), (glass('A5', 0.6, 0.2), 0.18, 0.5)), 0.3, 1.4), 0.0)

ps = load(464302)
grains = []
for i in range(6):
    g = ps[secs(0.4 + i * 0.13): secs(0.4 + i * 0.13 + 0.05)]
    grains.append((pan(fade(hp(g, 2200), 0.004, 0.02), -0.5 if i % 2 else 0.5), i * 0.035, 0.7 - i * 0.07))
put('scanlines', verb(mix(*grains), 0.18, 0.8), 0.0, -8)

# magnetic lock: a short pull-in, the catch, a low body, a small ring.
def magnetic(ring_note, latch=True, pull=0.09):
    fid = at_transient(load(857285), 0, 0.002, 0.08)
    pullin = fade(bp(noise(pull), 1500, 7000) * np.linspace(0, 1, secs(pull))[:, None] ** 3, 0.01, 0.002)
    body = dk(lp(at_transient(load(339437), 0, 0.001, 0.16), 160), 0.05)
    parts = [(pullin, 0, 0.05), (hp(fid, 300), pull, 1.0), (body, pull, 0.75), (glass(ring_note, 0.5, 0.14), pull + 0.004, 0.16)]
    if latch:
        parts.append((lp(semis(at_transient(load(481789), 0, 0.001, 0.1), -2), 6500), pull + 0.002, 0.35))
    return verb(mix(*parts), 0.16, 0.9, 6000), pull

x, h = magnetic('D6', True)
put('lock', x, h)
x, h = magnetic('A5', False)
put('snap', x, h)

# three sector tones: pitch + position say which sector (Voice left, Explain centre, Remember right)
for name, note, p in (('tone-explain', 'A5', 0.0), ('tone-remember', 'D6', 0.35), ('tone-voice', 'F#5', -0.35)):
    t_ = mix((glass(note, 0.5, 0.11), 0, 0.85), (knob(), 0, 0.45))
    put(name, verb(pan(t_, p) * 0.8 + t_ * 0.2, 0.2, 1.0, 6500), 0.001, -3)

# 3 · grab --------------------------------------------------------------------------------------
put('ui-click', verb(click_core(), 0.07, 0.5, 7000, 0.006), 0.003)

cloth = load(493505)
mov = load(391551)
dr = mix((bp(cloth, 350, 5500), 0, 1.0), (bp(cloth[::-1], 350, 5500), 0.7, 0.8), (bp(mov, 120, 3000), 1.2, 0.9), (bp(cloth, 350, 5500), 1.9, 0.7), length=secs(3.0))
dr = dr + bp(noise(3.0), 500, 2500) * 0.004
dr = widen(dr * np.stack([np.linspace(1.0, 0.55, len(dr)), np.linspace(0.55, 1.0, len(dr))], 1), 8, 0.4)
put('drag', fade(dr, 0.08, 0.3), 0.0, -6, refine=False)

# 4 · radial ---------------------------------------------------------------------------------
hold_t = 18 / FPS
hl = sum(st(tone(NOTE[n], hold_t + 0.15, ((1, 1), (2, 0.1)), hold_t * 0.9, 9)) for n in ('D5', 'A5'))
hl = onepole_lp(hl, np.linspace(500, 4000, len(hl)))
ticks = [(knob(), hold_t * (1 - (1 - k / 6) ** 1.6), 0.08 + k * 0.025) for k in range(6)]
put('hold', fade(mix((hl, 0, 0.8), *ticks, length=secs(hold_t + 0.15)), 0.02, 0.1), 0.0, -6, refine=False)

def radial(short=False):
    cam = load(553077)
    mech = lp(semis(at_transient(cam, 0, 0.003, 0.3, 0.3), -2), 9000)
    servo = load(875419)[secs(0.05): secs(0.23)]
    servo = fade(bp(servo, 900, 4200), 0.02, 0.08)
    parts = [(norm(mech, -1), 0, 0.9), (servo, 0.0, 0.12 if not short else 0.06)]
    for i, (n, p) in enumerate((('D6', 0.0), ('F#6', 0.45), ('A6', -0.45))):
        parts.append((pan(knob(), p), 0.012 + i * 0.05, 0.35))
        parts.append((pan(glass(n, 0.7, 0.16 if not short else 0.1), p * 0.6), 0.03 + i * 0.05, 0.22 if not short else 0.15))
    if not short:
        cg = at_transient(load(198385), 0, 0.002, 0.5)
        cg = semis(cg, 12 * math.log2(NOTE['D6'] / pitch_of(cg, 600, 4000)))
        parts.append((hp(cg[::-1], 1200), -0.32, 0.12))  # a reversed shimmer that blooms into the open
        sparkle = dk(hp(noise(0.7), 6500), 0.18)
        parts.append((widen(sparkle, 11, 0.8), 0.02, 0.018))
        parts.append((st(tone(np.linspace(98, 73.4, secs(0.35)), 0.35, ((1, 1),), 0.005, 0.12)), 0, 0.45))
    lead = 0.32 if not short else 0.0
    parts = [(s, t + lead, g) for s, t, g in parts]
    return verb(mix(*parts), 0.26 if not short else 0.2, 1.5, 6000, 0.015), lead

x, h = radial(False)
put('radial-open', x, h)
x, h = radial(True)
put('radial-open-short', x, h, -2.5)

# confirm: the signature. A soft tap, then a fifth rising D6 → A6, a warm low thock.
conf = mix(
    (click_core(), 0, 0.35),
    (glass('D6', 0.9, 0.26), 0.004, 0.75),
    (glass('A6', 1.0, 0.32), 0.074, 0.62),
    (st(tone(NOTE['D3'], 0.12, ((1, 1), (2, 0.3)), 0.002, 0.04)), 0, 0.3),
)
put('confirm', verb(conf, 0.3, 1.6, 6500, 0.02), 0.003)

pan_ = seg(ps, 0.35, 0.85)
put('panel', verb(fade(lp(hp(pan_, 500), 6500), 0.03, 0.2), 0.15, 0.8), 0.0, -9, refine=False)

# 5 · memory: the chart is drawn in (paper, a warm chord rising), sealed (a soft close), kept.
pre = 0.75
slide = fade(lp(hp(seg(ps, 0.25, 1.05), 300), 4200), 0.1, 0.12)
chord = sum(st(tone(NOTE[n], pre + 0.25, ((1, 1), (2, 0.25), (3, 0.08)), pre * 0.85, 9, 0.0012, i)) for i, n in enumerate(('D4', 'F#4', 'A4', 'E5')))
chord = sat(chord * 0.5, 1.8)
chord = fade(lp(chord, 2200), 0.05, 0.25)
book = lp(at_transient(load(862316), 0, 0.002, 0.25, 0.3), 3200)
warm = sum(st(tone(NOTE[n], 1.6, ((1, 1), (2, 0.15)), 0.01, 0.45)) for n in ('D5', 'A5'))
mem = mix(
    (slide, 0, 0.55),
    (chord, 0.0, 0.35),
    (norm(book, -1), pre, 0.8),
    (st(tone(np.linspace(130, 98, secs(0.2)), 0.2, ((1, 1),), 0.002, 0.07)), pre, 0.5),
    (lp(warm, 3000), pre + 0.01, 0.2),
    (glass('A5', 0.8, 0.25), pre + 0.06, 0.18),
)
put('memory', verb(mem, 0.28, 1.9, 4200, 0.02), pre)

# voice: a camera-button click, a gentle rising activation, then a held dyad that fades.
cb = at_transient(load(738232), 0, 0.002, 0.08)
sweep = tone(np.geomspace(300, 900, secs(0.2)), 0.2, ((1, 1), (2, 0.2)), 0.02, 0.15)
dy = sum(st(tone(NOTE[n], 1.0, ((1, 1),), 0.12, 0.45)) for n in ('D5', 'A5'))
vo = mix((hp(cb, 300), 0, 1.0), (bp(st(sweep), 250, 3000), 0.04, 0.22), (dy, 0.16, 0.1))
put('voice-on', verb(vo, 0.25, 1.4, 6000), 0.002, refine=False)

# the waveform: restrained band noise in syllable-like bursts, no voice of its own
vt_d = 2.0
t = np.arange(secs(vt_d)) / SR
syll = np.clip(np.sin(2 * np.pi * 4.3 * t) * 0.5 + np.sin(2 * np.pi * 2.7 * t + 1) * 0.5, 0, 1) ** 1.5
grain = bp(noise(vt_d), 900, 3800) * (0.3 + 0.7 * syll)[:, None]
carrier = st(tone(NOTE['D5'], vt_d, ((1, 1), (3, 0.2)), 0.2, 9)) * (0.4 + 0.6 * syll)[:, None]
put('voice-texture', fade(widen(mix((grain, 0, 0.05), (carrier, 0, 0.05)), 10, 0.6), 0.2, 0.4), 0.0, -10, refine=False)

# transitions: a soft spatial swell into the cut, a low impact on it.
tw = 0.55
sw = noise(tw) * np.linspace(0, 1, secs(tw))[:, None] ** 3
sw = widen(onepole_lp(sw, np.geomspace(250, 2600, secs(tw))), 14, 0.8)
sub = dk(lp(at_transient(load(263895), 0, 0.002, 1.2), 140), 0.35)
put('transition', fade(mix((sw, 0, 0.035), (sub, tw, 0.9), (lp(at_transient(load(339437), 0, 0.001, 0.2), 120), tw, 0.3)), 0.05, 0.3), tw, -4)

put('card-tap', verb(mix((knob(), 0, 0.8), (hp(at_transient(load(766639), 1, 0.002, 0.06, 0.3), 400), 0, 0.4)), 0.12, 0.6), 0.001, -6)

# 7 · close -------------------------------------------------------------------------------------
gw = 0.7
cg = at_transient(load(198385), 0, 0.002, gw)
gather = mix((hp(cg[::-1], 900), 0, 0.12), (onepole_lp(noise(gw) * np.linspace(0, 1, secs(gw))[:, None] ** 2, np.geomspace(300, 3000, secs(gw))), 0, 0.02))
xx, hh = magnetic('A5', False, 0.06)
put('assemble', verb(mix((gather, 0, 1), (xx, gw - hh, 0.6)), 0.25, 1.5), gw, -3)

fd = 1.2
rush = lp(load(263892)[: secs(fd)][::-1], 260)
shimr = hp(semis(at_transient(load(198385), 0, 0.002, fd), 3)[::-1], 1500)
fold = mix((rush, 0, 0.9), (shimr, 0, 0.15), (widen(onepole_lp(noise(fd) * np.linspace(0, 1, secs(fd))[:, None] ** 4, np.geomspace(200, 4000, secs(fd))), 12, 0.8), 0, 0.03), length=secs(fd + 0.02))
put('fold', fade(fold, 0.2, 0.015), fd, refine=False)

pg = tone(np.geomspace(NOTE['A5'], NOTE['D5'], secs(0.5)), 0.5, ((1, 1), (2, 0.1)), 0.002, 0.16)
put('point-out', verb(st(pg), 0.3, 1.6, 5000), 0.0, -6, refine=False)

# the reveal: a deep impact, a boom under it, a tonal stab on top, one long dark tail, then nothing.
di = load(665093)
di_on = transient(di, 0, 0.3)
di_pk = di_on + int(np.argmax(env_follow(di[di_on: di_on + secs(0.3)], 3)))  # start at its peak: no slow rise before the frame
impact = mix(
    (fade(lp(di[di_pk - secs(0.008):], 2400), 0.004, 0.01), 0, 1.0),
    (lp(at_transient(load(201571), 0, 0.002, 4.0), 420), 0, 0.7),
    (hp(at_transient(load(736850), 0, 0.002, 3.0), 300), 0, 0.3),
    (lp(at_transient(boom, 0, 0.002, 1.6), 120), 0, 0.5),
    (st(tone(np.geomspace(62, 36, secs(1.6)), 1.6, ((1, 1), (2, 0.15)), 0.004, 0.55)), 0, 0.55),
    (sum(st(tone(NOTE[n], 3.2, ((1, 1), (2, 0.12)), 0.03, 0.9)) for n in ('D3', 'A3', 'D4', 'F#4')), 0.0, 0.05),
)
impact = verb(impact, 0.42, 3.4, 2600, 0.025, 120)
impact = impact[: secs(3.0)] * np.minimum(1, np.linspace(3.0, 0, secs(3.0)) / 1.2)[:, None] ** 1.5  # a controlled tail to silence by 3.0 s
put('reveal-impact', fade(impact, 0.001, 0.05), 0.006, refine=False)

# ---- write sfx with frame-aligned hits ------------------------------------------------------

manifest = {}
for name, (x, hit) in SOUNDS.items():
    x = trim_tail(x, -72)
    pad_ = (-hit) % SPF  # pad so the hit lands on a frame boundary
    x = np.concatenate([np.zeros((pad_, 2)), x])
    hit_frames = (hit + pad_) // SPF
    write(os.path.join(OUT, 'sfx', f'{name}.wav'), x)
    manifest[name] = {'file': f'audio/sfx/{name}.wav', 'hitFrames': int(hit_frames), 'frames': int(math.ceil(len(x) / SPF))}
json.dump(manifest, open(os.path.join(ROOT, 'src', 'audio', 'sfx-manifest.json'), 'w'), indent=1)
print(f'{len(manifest)} sounds → public/audio/sfx  (glass f0 {GLASS_F0:.1f} Hz)')

# ---- score ------------------------------------------------------------------------------------

cues = json.load(open(os.path.join(ROOT, 'audio', 'cues.json')))
M = cues['markers']
F = lambda fr: fr / FPS  # frame → seconds
DUR = M['duration'] / FPS
N = secs(DUR) + secs(4)
BEAT = 0.5  # 120 BPM: one beat is exactly 15 frames

def place(buf, x, t, g=1.0):
    x = st(x)
    i = secs(t)
    j = min(len(buf), i + len(x))
    if j > i and i >= 0:
        buf[i:j] += x[: j - i] * g

def pad_voice(freqs, t0, t1, att, rel, level, bright=1800.0, seed=0):
    """An airy pad: detuned sine stacks with soft harmonics, low-passed."""
    d = t1 - t0 + rel
    t = np.arange(secs(d)) / SR
    y = np.zeros((len(t), 2))
    g = np.random.default_rng(seed)
    for f in freqs:
        for k, det in enumerate((-0.0025, 0.0, 0.0031)):
            ph = g.random() * 6.28
            v = np.sin(2 * np.pi * f * (1 + det) * t + ph + 0.002 * np.sin(2 * np.pi * 0.21 * t + k)) + 0.22 * np.sin(4 * np.pi * f * (1 + det) * t + ph) + 0.06 * np.sin(6 * np.pi * f * t + ph)
            y[:, k % 2] += v * (0.7 if k == 1 else 0.5)
    e = np.minimum(t / att, 1) * np.where(t > (t1 - t0), np.exp(-(t - (t1 - t0)) / (rel / 4)), 1)
    y = lp(y * e[:, None], bright)
    return y * level / max(1, len(freqs))

def pluck(f, dur=0.9, bright=1.0):
    t = np.arange(secs(dur)) / SR
    mod = np.sin(2 * np.pi * f * 2 * t) * 1.4 * bright * np.exp(-t / 0.08)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 0.28) * np.minimum(t / 0.002, 1)
    return y

def kick(level=1.0):
    t = np.arange(secs(0.35)) / SR
    f = 46 + 70 * np.exp(-t / 0.03)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.11) * np.minimum(t / 0.001, 1) * level

def hat(level=1.0):
    return hp(rng.standard_normal(secs(0.05)), 7500)[:, 0] * np.exp(-np.arange(secs(0.05)) / SR / 0.012) * level

dry = np.zeros((N, 2))
send = np.zeros((N, 2))  # goes to the long reverb

CHORDS = [  # D – Bm – G – A(sus), each two bars (4 s)
    (['D3', 'A3', 'E4', 'F#4'], 'D2'),
    (['B3', 'D4', 'F#4', 'A4'], 'B1'),
    (['G3', 'B3', 'D4', 'F#4'], 'D2'),
    (['A3', 'D4', 'E4', 'A4'], 'A2'),
]
ROOTS = [73.42, 61.74, 49.0, 55.0]
ARP = [['D5', 'A4', 'E5', 'F#5'], ['D5', 'B4', 'F#5', 'A5'], ['D5', 'B4', 'G4', 'F#5'], ['E5', 'A4', 'D5', 'C#5']]

# A · problem: a low, uneasy drone with a busy filtered tick; it stops dead on the freeze.
t_freeze = F(M['freeze'])
dr_ = pad_voice([NOTE['D2'] * 2, NOTE['A2'] * 2, NOTE['A2'] * 2 * 1.06], 0, t_freeze, 1.2, 0.05, 0.5, 600, 3)
place(dry, dr_[: secs(t_freeze)], 0, 0.5)
for k in range(int(t_freeze / 0.25)):
    place(dry, st(hat(0.03 + 0.012 * (k % 2))), k * 0.25)

# C · reveal: the chord blooms with the point and opens with the field.
t_pt = F(M['point'])
t_grab = F(M['grab'])
bloom = pad_voice([NOTE[n] for n in ('D3', 'A3', 'E4', 'F#4')], t_pt, t_grab + 0.2, 2.6, 1.0, 0.9, 1300, 7)
bloom_b = pad_voice([NOTE[n] for n in ('A4', 'D5', 'E5')], F(M['lock']) - 0.6, t_grab + 0.2, 0.8, 1.0, 0.35, 3800, 9)
place(dry, bloom, t_pt, 0.8)
place(send, bloom, t_pt, 0.5)
place(dry, bloom_b, F(M['lock']) - 0.6, 0.5)
place(send, bloom_b, F(M['lock']) - 0.6, 0.6)
place(dry, st(tone(NOTE['D2'], t_grab - t_pt + 1, ((1, 1), (2, 0.2)), 3.0, 9)), t_pt, 0.08)

# D–H · the canvas: rhythm enters and grows, scene by scene, toward the close.
t_fold = F(M['fold'])
t_gone = F(M['gone'])
sections = [  # (start, end, layers)
    (F(M['grab']), F(M['radial']), dict(pad=0.55, arp=0.05, kick=0.0, hat=0.0, bass=0.0, bright=1500)),
    (F(M['radial']), F(M['act']), dict(pad=0.6, arp=0.07, kick=0.22, hat=0.0, bass=0.0, bright=1700)),
    (F(M['act']), F(M['next']), dict(pad=0.65, arp=0.08, kick=0.3, hat=0.035, bass=0.18, bright=2000)),
    (F(M['next']), F(M['close']), dict(pad=0.62, arp=0.1, kick=0.36, hat=0.05, bass=0.22, bright=2600)),
    (F(M['close']), t_gone, dict(pad=0.85, arp=0.11, kick=0.42, hat=0.06, bass=0.26, bright=3400)),
]
for s0, s1, L in sections:
    b0 = int(round(s0 / BEAT))
    b1 = int(round(s1 / BEAT))
    for b in range(b0, b1):
        tb = b * BEAT
        ci = (b // 8) % 4  # two bars per chord
        if b % 8 == 0 or b == b0:
            span = min(8 - (b % 8), b1 - b) * BEAT
            pv = pad_voice([NOTE[n] for n in CHORDS[ci][0]], 0, span, 0.6 if b != b0 else 1.2, 1.4, L['pad'], L['bright'], b)
            place(dry, pv, tb, 0.8)
            place(send, pv, tb, 0.5)
            if L['bass']:
                place(dry, st(tone(ROOTS[ci], span + 0.3, ((1, 1), (2, 0.35), (3, 0.08)), 0.03, span * 0.8)), tb, L['bass'])
        for half in (0, 1):  # eighth-note arp
            n = ARP[ci][(b * 2 + half) % 4]
            pl = st(pluck(NOTE[n] * (2 if s0 >= F(M['next']) and half else 1), 0.8, 0.8))
            place(dry, pl, tb + half * BEAT / 2, L['arp'] * (1.0 if half == 0 else 0.7))
            place(send, pl, tb + half * BEAT / 2, L['arp'] * 0.9)
        if L['kick'] and b % 2 == 0:
            place(dry, st(kick()), tb, L['kick'])
        if L['hat']:
            place(dry, pan(hat(), 0.3), tb + BEAT / 2, L['hat'])

# the build into the fold: a rising filtered noise and a rising tone, cut dead at "gone"
rise_d = t_gone - F(M['close'])
rz = noise(rise_d) * np.linspace(0, 1, secs(rise_d))[:, None] ** 3
rz = widen(onepole_lp(rz, np.geomspace(200, 6000, secs(rise_d))), 12, 0.8)
place(dry, rz, F(M['close']), 0.05)
place(dry, st(tone(np.geomspace(NOTE['A3'], NOTE['A4'], secs(rise_d)), rise_d, ((1, 1), (2, 0.2)), rise_d * 0.9, 9)), F(M['close']), 0.05)

# J · after the impact: one low chord, dying with the tail. Then silence.
t_rev = F(M['reveal2'])
end_chord = pad_voice([NOTE[n] for n in ('D2', 'A2', 'D3', 'F#3', 'E4')], t_rev, t_rev + 0.4, 0.05, 2.6, 0.9, 900, 21)
place(dry, end_chord, t_rev, 0.55)
place(send, end_chord, t_rev, 0.4)

# long hall on the send
wet = conv(hp(send, 150)[: N], ir(3.6, 3800, 0.03, True, 5))[: N]
score = dry + wet * 0.5
score = shelf(hp(score, 38, 2), 140, -4.5, high=False)  # keep the score's low end out of the effects' way

# hard silences: nothing between the freeze and the point, nothing between "gone" and the impact
def gate(t0, t1, fade_s=0.01):
    a = secs(t0)
    b = secs(t1)
    score[a:b] = 0
    f = secs(fade_s)
    score[max(0, a - f):a] *= np.linspace(1, 0, min(f, a))[:, None]

gate(t_freeze + 0.01, t_pt - 0.05, 0.02)
gate(t_gone, t_rev, 0.03)

# duck under the interactions that matter
duck = np.ones(N)
key = {'ui-click', 'snap', 'lock', 'radial-open', 'radial-open-short', 'confirm', 'memory', 'voice-on', 'tone-explain', 'tone-remember', 'tone-voice', 'reveal-impact'}
for c in cues['cues']:
    if c['sound'] not in key:
        continue
    i = secs(F(c['frame']))
    att = secs(0.03)
    rel = secs(0.45)
    depth = db(-5 if c['sound'] in ('radial-open', 'confirm', 'memory') else -3.5)
    seg_ = np.concatenate([np.linspace(1, depth, att), np.full(secs(0.12), depth), np.linspace(depth, 1, rel)])
    lo = max(0, i - att)
    hi_ = min(N, lo + len(seg_))
    duck[lo:hi_] = np.minimum(duck[lo:hi_], seg_[: hi_ - lo])
score *= duck[:, None]
score = score[: secs(DUR)]
score = fade(score, 0.5, 0.05)
score = norm(score, -3)
write(os.path.join(OUT, 'score.wav'), score)
print(f'score {DUR:.2f} s → public/audio/score.wav')
