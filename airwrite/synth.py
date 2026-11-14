"""Simulated readings: what a sensor on the wrist would read while the hand
writes a character in the air. Used to train before real recordings exist,
and to test everything without the hardware.

The page (js/wrist.js) does the same sums, and tests/read.mjs checks the two
agree, so a change here needs the same change there.

Axes: x right, y up, z toward the writer. Units: metres, seconds, m/s^2, rad/s.
"""

import numpy as np

from .features import RATE, REST, STEPS, features  # noqa: F401  (re-exported)

G = 9.80665
DT = 1 / RATE
SMOOTH = 3.0        # samples: a hand cannot move faster than this blur allows


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([o, z, z], -1), np.stack([z, c, -s], -1), np.stack([z, s, c], -1)], -2)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([c, z, s], -1), np.stack([z, o, z], -1), np.stack([-s, z, c], -1)], -2)


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    o, z = np.ones_like(a), np.zeros_like(a)
    return np.stack([np.stack([c, -s, z], -1), np.stack([s, c, z], -1), np.stack([z, z, o], -1)], -2)


def blur(path, sigma=SMOOTH):
    """Gaussian blur along time, holding the ends where they are."""
    half = int(np.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma) ** 2)
    k /= k.sum()
    padded = np.concatenate([np.repeat(path[:1], half, 0), path, np.repeat(path[-1:], half, 0)])
    return np.stack([np.convolve(padded[:, i], k, mode="valid") for i in range(path.shape[1])], 1)


def wrist(path, pose, arm, twist=0.0):
    """Sensor readings for a hand moving along `path`.

    path   (n, 3) positions, one per sample, already smooth
    pose   (roll, pitch, yaw) of the sensor at the first sample, radians
    arm    metres from the wrist to the joint the arm swings about
    twist  how much the forearm rolls as the hand moves sideways

    The forearm swings about its joint, so moving the hand also turns the
    sensor: sideways movement turns it about the vertical, up-and-down
    movement tips it. Returns (n, 6): accelerometer x y z, gyroscope x y z.
    """
    n = len(path)
    rel = path - path[0]
    base = rot_y(np.float64(pose[2])) @ rot_x(np.float64(pose[1])) @ rot_z(np.float64(pose[0]))
    turn = base @ rot_y(-rel[:, 0] / arm) @ rot_x(rel[:, 1] / arm) @ rot_z(twist * rel[:, 0] / arm)  # sensor -> world
    # Acceleration from the positions either side, plus the push that holds
    # the sensor up against gravity; then into the sensor's own axes.
    ext = np.concatenate([path[:1], path, path[-1:]])
    acc = (ext[2:] - 2 * ext[1:-1] + ext[:-2]) / DT**2
    acc[:, 1] += G
    accel = np.einsum("nji,nj->ni", turn, acc)
    # Turn rate from the turn made since the last sample.
    prev = np.concatenate([turn[:1], turn[:-1]])
    step = np.einsum("nji,njk->nik", prev, turn)
    gyro = np.stack([step[:, 2, 1] - step[:, 1, 2], step[:, 0, 2] - step[:, 2, 0], step[:, 1, 0] - step[:, 0, 1]], 1) / (2 * DT)
    assert accel.shape == (n, 3)
    return np.concatenate([accel, gyro], 1)


# ---- Writing a character: from pen strokes to a hand moving through the air ----

def _resample(points, m):
    seg = np.linalg.norm(np.diff(points, axis=0), axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    if d[-1] < 1e-9:
        return np.repeat(points[:1], m, 0), 0.0
    at = np.linspace(0, d[-1], m)
    return np.stack([np.interp(at, d, points[:, i]) for i in range(points.shape[1])], 1), d[-1]


def _pace(points, rng):
    """How long the hand spends on each part of a stroke: slower through
    tight bends and at both ends. Returns each point's share of the time, 0 to 1."""
    m = len(points)
    d = np.diff(points, axis=0)
    heading = np.unwrap(np.arctan2(d[:, 1], d[:, 0]))
    bend = np.abs(np.diff(heading, prepend=heading[0]))
    bend = np.convolve(np.pad(bend, 2, mode="edge"), np.ones(5) / 5, mode="valid")
    speed = (bend * rng.uniform(4, 12) + 0.15) ** (-1 / 3)
    i = np.arange(m - 1)
    speed *= np.minimum(1, 0.25 + 5 * np.minimum(i, m - 2 - i) / m)
    t = np.concatenate([[0], np.cumsum(1 / speed)])
    return t / t[-1]


def write(strokes, rng, size=None, seconds=None):
    """A hand writing `strokes` in the air: (n, 3) positions at RATE.

    strokes  list of (k, 2) arrays, x right and y up, any scale
    The hand does not leave the air between strokes, it just travels to where
    the next one starts, so that travel is part of what the sensor feels.
    """
    pts = np.concatenate(strokes)
    lo, hi = pts.min(0), pts.max(0)
    size = size or rng.uniform(0.10, 0.30)                 # metres, the larger side of the character
    scale = size / max((hi - lo).max(), 1e-9)
    strokes = [(s - (lo + hi) / 2) * scale for s in strokes]
    pieces = []
    for i, s in enumerate(strokes):
        if i > 0:
            a, b = strokes[i - 1][-1], s[0]
            # The travel between strokes bows a little, and lifts toward the writer.
            u = np.linspace(0, 1, 12)[:, None]
            line = a + (b - a) * u
            side = np.array([-(b - a)[1], (b - a)[0]]) * rng.uniform(-0.15, 0.15)
            line = line + side * np.sin(np.pi * u)
            lift = rng.uniform(0, 0.12) * size * np.sin(np.pi * u)
            pieces.append((np.concatenate([line, lift], 1), True))
        pieces.append((np.concatenate([s, np.zeros((len(s), 1))], 1), False))
    seconds = seconds or rng.uniform(0.7, 2.6)
    lengths = []
    paths = []
    for p, travel in pieces:
        keep = np.concatenate([[True], np.linalg.norm(np.diff(p, axis=0), axis=1) > 1e-9])
        r, length = _resample(p[keep], 48)
        paths.append(r)
        lengths.append(max(length, 0.02 * size) ** 0.7 * (0.7 if travel else 1.0))
    share = np.array(lengths) / sum(lengths)
    out = [np.repeat(paths[0][:1], REST, 0)]
    for r, part in zip(paths, share):
        n = max(4, int(round(seconds * part * RATE)))
        when = _pace(r[:, :2], rng)
        at = np.linspace(0, 1, n)
        out.append(np.stack([np.interp(at, when, r[:, i]) for i in range(3)], 1))
        if rng.random() < 0.5:
            out.append(np.repeat(out[-1][-1:], rng.integers(1, 7), 0))  # a beat before the next piece
    out.append(np.repeat(out[-1][-1:], REST, 0))
    path = np.concatenate(out)
    # The writing is never quite flat.
    far = np.linspace(0, 1, len(path))
    path[:, 2] += size * rng.uniform(0, 0.06) * np.sin(far * rng.uniform(2, 9) + rng.uniform(0, 6))
    return blur(path)


def vary_strokes(strokes, rng):
    """The same character from a slightly different hand: turned, slanted,
    stretched, each stroke nudged."""
    a = rng.uniform(-0.2, 0.2)
    turn = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    shape = turn @ np.array([[1, rng.uniform(-0.3, 0.3)], [0, 1]]) @ np.diag([rng.uniform(0.8, 1.25), 1])
    span = np.ptp(np.concatenate(strokes), axis=0).max()
    return [s @ shape.T + rng.normal(0, 0.02 * span, 2) for s in strokes]


def reading(strokes, rng, noise=1.0, pose=None, arm=None, twist=None, bias=None):
    """One simulated reading of a character: (n, 6) at RATE. The wrist's pose,
    the arm's length and the sensor's bias are drawn at random unless given."""
    path = write(vary_strokes(strokes, rng), rng)
    pose = pose if pose is not None else (rng.uniform(-0.6, 0.6), rng.uniform(-0.5, 0.5), rng.uniform(-0.45, 0.45))
    imu = wrist(path, pose, arm=arm or rng.uniform(0.4, 0.9), twist=twist if twist is not None else rng.uniform(-0.4, 0.4))
    n = len(imu)
    bias = bias if bias is not None else np.concatenate([rng.normal(0, 0.05 * noise, 3), rng.normal(0, 0.015 * noise, 3)])
    imu[:, :3] += rng.normal(0, rng.uniform(0.02, 0.08) * noise, (n, 3))
    imu[:, 3:] += rng.normal(0, rng.uniform(0.002, 0.01) * noise, (n, 3))
    return imu + bias


def load_uji(path, labels):
    """Characters from ujipenchars2.txt as (label index, writer, strokes, is_test)."""
    out = []
    lines = open(path, encoding="latin-1").read().split("\n")
    i = 0
    while i < len(lines):
        if lines[i].startswith("WORD "):
            _, ch, session = lines[i].split()
            count = int(lines[i + 1].split()[1])
            strokes = []
            for k in range(count):
                nums = np.array(lines[i + 2 + k].split("#")[1].split(), float).reshape(-1, 2)
                nums[:, 1] *= -1  # the tablet's y points down
                strokes.append(nums)
            if ch in labels:
                out.append((labels.index(ch), session.split("-")[0], strokes, session.startswith("tst")))
            i += 2 + count
        else:
            i += 1
    return out
