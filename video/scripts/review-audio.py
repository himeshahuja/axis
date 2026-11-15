# Objective review of a rendered soundtrack against the audio event map.
#   python3 -I scripts/review-audio.py <mix.wav|film.mp4> [score-stem.wav sfx-stem.wav]
# Reports loudness, true peak, clipping, the onset of every cue relative to its picture
# frame, how far each key cue sits above the score, and whether planned silences are
# silent; writes out/preview/audio-review.png (loudness curve over a spectrogram, cues marked).

import json, os, subprocess, sys
import numpy as np

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SR = 48000
FPS = 30

def load(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)

def ebur128(p):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], capture_output=True, text=True).stderr
    s = r[r.rfind('Summary:'):]
    val = lambda key: float(s.split(key)[1].split()[0])
    return dict(I=val('I:'), LRA=val('LRA:'), TP=val('Peak:'))

def rms_db(x):
    return 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12)

def short_db(x, t, win=0.12):
    a = max(0, int((t - 0.01) * SR))
    return rms_db(x[a: a + int(win * SR)])

mix_p = sys.argv[1]
cues = json.load(open(os.path.join(ROOT, 'audio', 'cues.json')))
mf = json.load(open(os.path.join(ROOT, 'src', 'audio', 'sfx-manifest.json')))
M = cues['markers']
mix = load(mix_p)
st_ = ebur128(mix_p)
clip = int((np.abs(mix) >= 0.999).sum())
print(f"MIX  integrated {st_['I']:.1f} LUFS   LRA {st_['LRA']:.1f} LU   true peak {st_['TP']:.1f} dBTP   clipped samples {clip}   length {len(mix)/SR:.2f} s")

stems = len(sys.argv) >= 4
if stems:
    score = load(sys.argv[2])
    sfx = load(sys.argv[3])
    print(f"stems: score {ebur128(sys.argv[2])['I']:.1f} LUFS, sfx {ebur128(sys.argv[3])['I']:.1f} LUFS")

# Cue onset vs picture frame (measured on the sfx stem when available).
src = sfx if stems else mix
mono = np.abs(src.mean(1))
k = 48  # 1 ms
env = np.convolve(mono, np.ones(k) / k, mode='same')
print('\nCUE ONSETS  (offset = measured transient − picture frame; + is late)')
worst = 0
rows = []
for c in cues['cues']:
    t = c['frame'] / FPS
    a = int((t - 0.1) * SR)
    b = int((t + 0.1) * SR)
    w = env[a:b]
    # the hit: steepest rise of the envelope inside ±100 ms
    d = np.diff(np.convolve(w, np.ones(96) / 96, mode='same'))
    i = int(np.argmax(d))
    off_ms = (a + i - t * SR) / SR * 1000
    above = short_db(sfx, t) - short_db(score, t) if stems else float('nan')
    rows.append((c, off_ms, above))
swell = {'field-swell', 'fold', 'transition', 'assemble', 'memory', 'drag', 'voice-texture', 'hold'}
for c, off, above in rows:
    flag = ''
    if c['sound'] not in swell and abs(off) > 20:
        flag = '  << check'
    if c['sound'] not in swell:
        worst = max(worst, abs(off))
    print(f"{c['frame']:>5} {c['frame']/FPS:6.2f}s {c['sound']:<18} offset {off:+6.1f} ms   above score {above:+5.1f} dB{flag}")
print(f'worst transient offset (excluding swells/textures): {worst:.1f} ms')

# Planned silences.
F = lambda f: f / FPS
for name, t0, t1 in (('after the freeze', F(M['freeze']) + 1.3, F(M['point']) - 0.1), ('point gone → line', F(M['gone']) + 0.6, F(M['reveal2']) - 0.05), ('after the tail', F(M['reveal2']) + 2.95, len(mix) / SR)):
    seg = mix[int(t0 * SR): int(t1 * SR)]
    print(f"silence {name:<18} {t0:5.2f}–{t1:5.2f}s  level {rms_db(seg):6.1f} dBFS  peak {20*np.log10(np.abs(seg).max()+1e-12):6.1f} dBFS")

# Picture: momentary loudness (400 ms) over a spectrogram, scenes and cues marked.
out = os.path.join(ROOT, 'out', 'preview', 'audio-review.png')
W, H = 2400, 900
spec = os.path.join(ROOT, 'out', 'preview', '_spec.png')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mix_p, '-lavfi', f'showspectrumpic=s={W}x{H-300}:legend=0:scale=log:fscale=log:color=magma', '-frames:v', '1', spec], check=True)
# loudness curve as a raw image
m = mix.mean(1)
hop = SR // 50
n = len(m) // hop
blk = (m[: n * hop].reshape(n, hop) ** 2).mean(1)
win = 20
mom = 10 * np.log10(np.convolve(blk, np.ones(win) / win, mode='same') + 1e-12) - 0.691 + 3
img = np.zeros((300, W, 3), np.uint8)
img[:] = 18
def x_of(t):
    return int(t / (len(m) / SR) * (W - 1))
for ref, col in ((-14, (90, 90, 90)), (-24, (50, 50, 50)), (-34, (35, 35, 35))):
    y = int((0 - ref) / 60 * 300)
    img[y, :] = col
for f in (0, 195, 390, 615, 900, 1200, 1350):
    img[:, x_of(f / FPS)] = (70, 70, 120)
for c in cues['cues']:
    xx = x_of(c['frame'] / FPS)
    img[:24, xx] = (255, 90, 31)
xs = np.linspace(0, len(mom) - 1, W).astype(int)
for xx in range(W):
    v = mom[xs[xx]]
    y = int(np.clip((0 - v) / 60 * 300, 0, 299))
    img[y:min(300, y + 3), xx] = (242, 240, 235)
raw = os.path.join(ROOT, 'out', 'preview', '_loud.rgb')
img.tofile(raw)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x300', '-i', raw, '-i', spec, '-filter_complex', '[0][1]vstack', '-frames:v', '1', out], check=True)
os.remove(raw)
os.remove(spec)
print('\n' + out)
