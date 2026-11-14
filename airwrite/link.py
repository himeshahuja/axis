"""The line to the wrist unit.

Text lines, one per event, in both directions:

    wrist -> Pi   I <ms> <ax> <ay> <az> <gx> <gy> <gz>   a reading (m/s^2, rad/s)
                  B <ms> <1|0>                            button went down (1) or up (0)
    Pi -> wrist   V <on ms> <off ms> <on ms> ...          run the motor in this pattern

All timing downstream uses the wrist's own clock (the <ms> field), so nothing
depends on how promptly lines arrive.

`SerialLink` talks to the real unit (USB serial, or Bluetooth serial bound to
a port). `FakeLink` stands in for it with simulated readings, for testing
everything without the hardware.
"""

import collections
import queue
import threading
import time

import numpy as np

from .features import RATE

KEEP = 120 * RATE  # readings remembered: two minutes


class Link:
    def __init__(self):
        self.readings = collections.deque(maxlen=KEEP)  # (ms, ax, ay, az, gx, gy, gz)
        self.buttons = queue.Queue()                    # (ms, down?)
        self.lock = threading.Lock()
        self.now = 0.0                                  # the wrist's clock, ms, at the latest reading

    def _line(self, line):
        part = line.split()
        try:
            if part[0] == "I" and len(part) == 8:
                row = tuple(float(v) for v in part[1:])
                with self.lock:
                    self.readings.append(row)
                self.now = row[0]
            elif part[0] == "B" and len(part) == 3:
                self.buttons.put((float(part[1]), part[2] == "1"))
        except (ValueError, IndexError):
            pass  # a garbled line: drop it

    def window(self, start_ms, stop_ms):
        """The readings between two times on the wrist's clock, as (n, 6)."""
        with self.lock:
            rows = [r[1:] for r in self.readings if start_ms <= r[0] <= stop_ms]
        return np.array(rows, np.float64).reshape(-1, 6)

    def wait_until(self, ms, timeout=5.0):
        """Block until readings up to `ms` on the wrist's clock have arrived."""
        end = time.time() + timeout
        while self.now < ms and time.time() < end:
            time.sleep(0.002)

    def buzz(self, pattern):
        """Run the motor: `pattern` is on, off, on, ... in milliseconds."""
        raise NotImplementedError

    def close(self):
        pass


class SerialLink(Link):
    def __init__(self, port, baud=115200):
        super().__init__()
        import serial  # pyserial

        self.port = serial.Serial(port, baud, timeout=1)
        self.alive = True
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        while self.alive:
            try:
                line = self.port.readline().decode("ascii", "ignore").strip()
            except Exception:
                break
            if line:
                self._line(line)

    def buzz(self, pattern):
        # The wrist unit has a small input buffer: send a few steps at a time
        # and wait while they play.
        pattern = [int(p) for p in pattern]
        for i in range(0, len(pattern), 8):
            chunk = pattern[i : i + 8]
            self.port.write(("V " + " ".join(map(str, chunk)) + "\n").encode())
            self.port.flush()
            time.sleep(sum(chunk) / 1000)

    def close(self):
        self.alive = False
        self.port.close()


class FakeLink(Link):
    """A pretend wrist unit. It idles, and on `write("7")` it clicks the
    button, writes the character (a simulated reading of real pen strokes),
    and clicks again. `speed` runs its clock faster than real time."""

    def __init__(self, person=0, speed=1.0, seed=0, labels="0123456789"):
        super().__init__()
        import pathlib

        from . import synth

        self.synth, self.speed = synth, speed
        self.rng = np.random.default_rng(seed + 1000 * person)
        data = pathlib.Path(__file__).parent.parent / "train" / "data" / "ujipenchars2.txt"
        chars = synth.load_uji(data, labels)
        # Each pretend person writes like a few of the real writers, and wears
        # the sensor their own way.
        writers = sorted({c[1] for c in chars if c[3]})
        mine = set(writers[(person * 4) % len(writers) :][:4])
        self.strokes = collections.defaultdict(list)
        for label, writer, strokes, _ in chars:
            if writer in mine:
                self.strokes[labels[label]].append(strokes)
        self.pose = tuple(self.rng.uniform(-0.4, 0.4, 3))
        self.arm, self.twist = self.rng.uniform(0.45, 0.8), self.rng.uniform(-0.3, 0.3)
        self.bias = np.concatenate([self.rng.normal(0, 0.05, 3), self.rng.normal(0, 0.015, 3)])
        self.rest = synth.wrist(np.zeros((2, 3)), self.pose, self.arm)[0]
        self.buzzed = []          # every pattern asked for, for tests to look at
        self.todo = queue.Queue()
        self.ms = 0.0
        self.alive = True
        threading.Thread(target=self._run, daemon=True).start()

    def _emit(self, rows):
        for row in rows:
            self._line("I %.0f %.4f %.4f %.4f %.4f %.4f %.4f" % (self.ms, *row))
            self.ms += 1000 / RATE
            time.sleep(1 / RATE / self.speed)

    def _idle(self, seconds):
        n = max(1, int(seconds * RATE))
        noise = np.concatenate([self.rng.normal(0, 0.04, (n, 3)), self.rng.normal(0, 0.005, (n, 3))], 1)
        self._emit(self.rest + self.bias + noise)

    def _click(self, held=0.08):
        self._line(f"B {self.ms:.0f} 1")
        self._idle(held)
        self._line(f"B {self.ms:.0f} 0")

    def _run(self):
        while self.alive:
            try:
                action, arg = self.todo.get(timeout=0.02 / self.speed)
            except queue.Empty:
                self._idle(0.05)
                continue
            if action == "write":
                options = self.strokes[arg]
                strokes = options[self.rng.integers(len(options))]
                self._idle(1.2)
                self._click()
                self._idle(0.4)
                self._emit(self.synth.reading(strokes, self.rng, pose=self.pose, arm=self.arm, twist=self.twist, bias=self.bias))
                self._idle(0.4)
                self._click()
                self._idle(0.6)
            elif action == "click":
                self._click()
                self._idle(0.6)
            elif action == "double":
                self._click()
                self._idle(0.12)
                self._click()
                self._idle(0.6)
            elif action == "long":
                self._click(held=1.1)
                self._idle(0.6)

    def write(self, label):
        self.todo.put(("write", label))

    def press(self, kind="click"):
        self.todo.put((kind, None))

    def buzz(self, pattern):
        self.buzzed.append([int(p) for p in pattern])

    def close(self):
        self.alive = False


class Clicks:
    """Turns button downs and ups into gestures, on the wrist's clock:

        "click"   a short press, with nothing following it for GAP ms
        "double"  two short presses within GAP ms
        "long"    a press held for LONG ms or more

    Each comes with the time the (first) press went down.
    """

    GAP, LONG = 350, 800

    def __init__(self, link):
        self.link = link
        self.down_at = None
        self.pending = None  # (down time, up time) of a short press that might become a double

    def next(self, timeout=0.05):
        """The next gesture as (kind, ms), or None if there is none yet."""
        try:
            ms, down = self.link.buttons.get(timeout=timeout)
        except queue.Empty:
            if self.pending and self.down_at is None and self.link.now - self.pending[1] > self.GAP:
                first, self.pending = self.pending[0], None
                return ("click", first)
            return None
        if down:
            self.down_at = ms
            return None
        if self.down_at is None:
            return None
        start, self.down_at = self.down_at, None
        if ms - start >= self.LONG:
            self.pending = None
            return ("long", start)
        if self.pending:
            first, self.pending = self.pending[0], None
            return ("double", first)
        self.pending = (start, ms)
        return None

    def next_down(self, timeout=0.05):
        """The time of the next press, as soon as it goes down (used to stop a
        recording without waiting to see whether it becomes a double)."""
        try:
            ms, down = self.link.buttons.get(timeout=timeout)
        except queue.Empty:
            return None
        if down:
            return ms
        return None

    def drain_release(self):
        """After next_down: let the matching release go by."""
        try:
            self.link.buttons.get(timeout=1.5)
        except queue.Empty:
            pass
        self.down_at, self.pending = None, None


def open_link(port=None, fake=False, **fake_options):
    if fake:
        return FakeLink(**fake_options)
    if not port:
        raise SystemExit("Give --port (for example /dev/ttyUSB0), or --fake to run without the hardware.")
    return SerialLink(port)


def record(link, clicks, start_ms, on_wait=None):
    """Record one character: from a start click (already seen, at start_ms)
    to the next press. Returns (window, idle, stop_ms): the readings between
    the two presses with the jolt of each press cut off, and the still second
    before the first press."""
    stop_ms = None
    while stop_ms is None:
        stop_ms = clicks.next_down()
        if on_wait:
            on_wait()
    clicks.drain_release()
    link.wait_until(stop_ms)
    window = link.window(start_ms + 150, stop_ms - 100)
    idle = link.window(start_ms - 1100, start_ms - 100)
    return window, idle, stop_ms
