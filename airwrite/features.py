"""From raw sensor readings to what the network takes. Needs only numpy, so
it runs on the Pi as it does in training.

Readings are (n, 6) arrays: accelerometer x y z in m/s^2 (gravity included),
then gyroscope x y z in rad/s, at RATE samples a second.
"""

import numpy as np

RATE = 100          # samples per second
STEPS = 96          # every character is stretched or squeezed to this many steps for the network
REST = 8            # samples of stillness kept either side of a character


def features(imu):
    """Readings for one character, as the (6, STEPS) array the network takes.

    However the sensor is strapped on, gravity says which way is up: the
    readings are turned so that up is the same axis every time. Gravity and
    any steady offset are then taken out of the accelerometer, and the whole
    thing is resampled to a fixed length.
    """
    imu = np.asarray(imu, np.float64)
    up = imu[:, :3].mean(0)
    up /= np.linalg.norm(up) + 1e-12
    # The shortest turn taking `up` onto the y axis (Rodrigues' formula).
    axis = np.array([up[2], 0.0, -up[0]])  # up x y
    s, c = np.linalg.norm(axis), up[1]
    if s < 1e-9:
        level = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:
        k = axis / s
        K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
        level = np.eye(3) + s * K + (1 - c) * K @ K
    accel = imu[:, :3] @ level.T
    gyro = imu[:, 3:] @ level.T
    accel = (accel - accel.mean(0)) / 4.0
    gyro = gyro / 1.0
    x = np.concatenate([accel, gyro], 1)
    # Average over a window as wide as the step being taken, then sample.
    n = len(x)
    w = max(1, int(np.floor(n / STEPS + 0.5)))
    if w > 1:
        lead = (w - 1) // 2
        padded = np.concatenate([np.repeat(x[:1], lead, 0), x, np.repeat(x[-1:], w - 1 - lead, 0)])
        csum = np.concatenate([np.zeros((1, 6)), np.cumsum(padded, 0)])
        x = (csum[w:] - csum[:-w]) / w
    at = np.linspace(0, n - 1, STEPS)
    lo = np.floor(at).astype(int)
    hi = np.minimum(lo + 1, n - 1)
    f = (at - lo)[:, None]
    return (x[lo] * (1 - f) + x[hi] * f).T.astype(np.float32)


def prepare(window, idle=None):
    """A button-to-button recording, made ready for the network.

    window  (n, 6) readings between the start and stop clicks
    idle    (m, 6) readings from just before the start click, wrist held
            still: whatever the gyroscope reads then is its bias

    Takes the bias out, cuts the stillness off both ends (people pause for
    different lengths of time before and after writing), and returns the
    (6, STEPS) features, or None if nothing in the window moved.
    """
    window = np.array(window, np.float64)
    if idle is not None and len(idle) >= 20:
        window[:, 3:] -= np.asarray(idle, np.float64)[:, 3:].mean(0)
    turning = np.linalg.norm(window[:, 3:], axis=1)
    pushing = np.linalg.norm(window[:, :3] - np.median(window[:, :3], axis=0), axis=1)
    k = np.ones(5) / 5
    moving = (np.convolve(turning, k, "same") > 0.12) | (np.convolve(pushing, k, "same") > 0.5)
    where = np.flatnonzero(moving)
    if len(where) < 15:
        return None
    lo, hi = max(0, where[0] - REST), min(len(window), where[-1] + 1 + REST)
    return features(window[lo:hi])
