"""Air-writing trainer: live IMU view + guided data collection + online training.

IMU input (one CSV line per sample, units: accel in g, gyro in deg/s):
    ax,ay,az,gx,gy,gz[,btn]
btn (optional 7th field) is a level; each 0->1 edge toggles start/stop.
The UI also toggles with the Space bar, so a button is optional.

Sources:  --source sim | serial | udp
"""
import argparse, asyncio, json, os, queue, random, socket, threading, time
import numpy as np
import torch, torch.nn as nn
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

HZ = 100
N_STEPS = 64
MIN_SAMPLES = 30                      # ignore recordings shorter than 0.3 s
SCALE = np.array([1, 1, 1, 100, 100, 100], dtype=np.float32)  # g, deg/s


# ---------------------------------------------------------------- preprocessing
def preprocess(raw, gyro_bias):
    """raw (T,6) -> (N_STEPS,6) float32. Accel relative to start pose, gyro bias removed."""
    x = np.asarray(raw, dtype=np.float32).copy()
    x[:, :3] -= x[:5, :3].mean(0)
    x[:, 3:] -= gyro_bias
    t_old = np.linspace(0, 1, len(x))
    t_new = np.linspace(0, 1, N_STEPS)
    x = np.stack([np.interp(t_new, t_old, x[:, c]) for c in range(6)], 1)
    return (x / SCALE).astype(np.float32)


# ---------------------------------------------------------------- model
class Net(nn.Module):
    def __init__(self, n_classes):
        super().__init__()
        self.f = nn.Sequential(
            nn.Conv1d(6, 32, 5, padding=2), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, 5, padding=2), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(64, 64, 3, padding=1), nn.ReLU(), nn.AdaptiveAvgPool1d(4))
        self.head = nn.Sequential(nn.Flatten(), nn.Dropout(0.3), nn.Linear(256, n_classes))

    def forward(self, x):                 # x: (B, 6, T)
        return self.head(self.f(x))


class Trainer:
    def __init__(self, n_classes):
        torch.set_num_threads(2)
        self.net = Net(n_classes)
        self.opt = torch.optim.Adam(self.net.parameters(), lr=3e-3, weight_decay=1e-4)
        self.lock = threading.Lock()
        self.trained_on = 0               # dataset size at last training run

    def predict(self, x):                 # x (N_STEPS,6) -> probs (C,)
        with self.lock:
            self.net.eval()
            with torch.no_grad():
                t = torch.from_numpy(x.T[None].copy())
                return torch.softmax(self.net(t), -1)[0].numpy()

    def fit(self, X, y, epochs=30):
        Xt = torch.from_numpy(np.stack(X).transpose(0, 2, 1).copy())
        yt = torch.tensor(y)
        n, loss_val = len(yt), 0.0
        for _ in range(epochs):
            with self.lock:
                self.net.train()
                perm = torch.randperm(n)
                for i in range(0, n, 32):
                    idx = perm[i:i + 32]
                    xb = Xt[idx]
                    # augmentation: amplitude jitter, noise, small time shift
                    xb = xb * (0.85 + 0.3 * torch.rand(len(idx), 1, 1))
                    xb = xb + 0.01 * torch.randn_like(xb)
                    xb = torch.roll(xb, shifts=int(np.random.randint(-3, 4)), dims=2)
                    loss = nn.functional.cross_entropy(self.net(xb), yt[idx])
                    self.opt.zero_grad(); loss.backward(); self.opt.step()
                    loss_val = float(loss)
        self.trained_on = n
        return loss_val


# ---------------------------------------------------------------- session
class Session:
    def __init__(self, labels, goal, data_dir, person):
        self.labels, self.goal, self.data_dir = labels, goal, data_dir
        self.person, self.mode = person, "collect"
        self.lock = threading.RLock()
        self.recording, self.buf, self.rec_t0 = False, [], 0.0
        self.bias, self.bias_snap = np.zeros(3, dtype=np.float32), np.zeros(3, dtype=np.float32)
        self.last_btn = 0
        self.X, self.y, self.who, self.files = [], [], [], []
        self.preq = []                    # online (prequential) results: (target, pred)
        self.last_loss, self.training = None, False
        self.train_flag = threading.Event()
        self.batch, self.events = [], queue.Queue()
        self.target = None
        self.trainer = Trainer(len(labels))
        self.load_existing()
        self.pick_target()
        threading.Thread(target=self.train_loop, daemon=True).start()
        if len(self.X) >= 10:
            self.train_flag.set()

    # -- persistence
    def load_existing(self):
        os.makedirs(self.data_dir, exist_ok=True)
        for p in sorted(os.listdir(self.data_dir)):
            d = os.path.join(self.data_dir, p)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if not f.endswith(".npz"):
                    continue
                z = np.load(os.path.join(d, f))
                lab = str(z["label"])
                if lab not in self.labels:
                    continue
                self.X.append(preprocess(z["raw"], z["bias"]))
                self.y.append(self.labels.index(lab))
                self.who.append(p); self.files.append(os.path.join(d, f))

    def save_sample(self, raw, label):
        d = os.path.join(self.data_dir, self.person)
        os.makedirs(d, exist_ok=True)
        fn = os.path.join(d, f"{label}_{int(time.time() * 1000)}.npz")
        np.savez(fn, raw=np.asarray(raw, dtype=np.float32), label=label,
                 person=self.person, hz=HZ, bias=self.bias_snap)
        return fn

    # -- helpers
    def counts(self):
        c = [0] * len(self.labels)
        for k in self.y:
            c[k] += 1
        return c

    def pick_target(self):
        c = self.counts()
        m = min(c)
        cands = [i for i, v in enumerate(c) if v == m and self.labels[i] != self.target]
        self.target = self.labels[random.choice(cands or [c.index(m)])]

    def snapshot(self):
        return {"type": "state", "labels": self.labels, "goal": self.goal,
                "counts": self.counts(), "target": self.target, "mode": self.mode,
                "person": self.person, "recording": self.recording,
                "preq": self.preq[-300:], "loss": self.last_loss,
                "training": self.training, "trained_on": self.trainer.trained_on,
                "n": len(self.y)}

    def emit_state(self):
        self.events.put(self.snapshot())

    # -- sensor input (called from the sensor thread)
    def on_imu(self, v, btn=None):
        with self.lock:
            if btn is not None:
                if btn and not self.last_btn:
                    self.toggle()
                self.last_btn = btn
            if self.recording:
                self.buf.append(v)
            else:
                self.bias = 0.98 * self.bias + 0.02 * np.asarray(v[3:], dtype=np.float32)
            self.batch.append([round(float(a), 4) for a in v] + [1 if self.recording else 0])

    def drain(self):
        with self.lock:
            b, self.batch = self.batch, []
        out = [{"type": "imu", "pts": b}] if b else []
        while True:
            try:
                out.append(self.events.get_nowait())
            except queue.Empty:
                return out

    # -- control
    def toggle(self):
        with self.lock:
            if not self.recording:
                self.buf, self.rec_t0 = [], time.time()
                self.bias_snap = self.bias.copy()
                self.recording = True
                self.emit_state()
            else:
                self.recording = False
                self.finish()

    def finish(self):
        raw, self.buf = self.buf, []
        if len(raw) < MIN_SAMPLES:
            self.events.put({"type": "notice", "msg": "Too short, discarded"})
            self.emit_state()
            return
        x = preprocess(raw, self.bias_snap)
        pred, conf = None, None
        if self.trainer.trained_on > 0:
            p = self.trainer.predict(x)
            pred, conf = self.labels[int(p.argmax())], float(p.max())
        msg = {"type": "sample", "x": x.tolist(), "pred": pred, "conf": conf,
               "mode": self.mode, "target": self.target if self.mode == "collect" else None}
        if self.mode == "collect":
            lab = self.target
            if pred is not None:
                self.preq.append([lab, pred])
            self.X.append(x); self.y.append(self.labels.index(lab))
            self.who.append(self.person)
            self.files.append(self.save_sample(raw, lab))
            self.pick_target()
            self.train_flag.set()
        self.events.put(msg)
        self.emit_state()

    def skip(self):
        with self.lock:
            if not self.recording:
                self.pick_target(); self.emit_state()

    def undo(self):
        with self.lock:
            if self.recording or not self.X:
                return
            self.X.pop(); self.y.pop(); self.who.pop()
            f = self.files.pop()
            try:
                os.remove(f)
            except OSError:
                pass
            if self.preq:
                self.preq.pop()
            self.emit_state()

    def set_mode(self, m):
        with self.lock:
            if m in ("collect", "test") and not self.recording:
                self.mode = m; self.emit_state()

    def set_person(self, p):
        with self.lock:
            p = "".join(ch for ch in p if ch.isalnum() or ch in "-_")[:24] or "p1"
            self.person = p; self.emit_state()

    # -- training thread (retrains after every new sample, coalescing requests)
    def train_loop(self):
        while True:
            self.train_flag.wait()
            self.train_flag.clear()
            with self.lock:
                X, y = list(self.X), list(self.y)
            if len(y) < 10:
                continue
            self.training = True; self.emit_state()
            self.last_loss = self.trainer.fit(X, y)
            self.training = False; self.emit_state()


# ---------------------------------------------------------------- sensor sources
def parse_line(line):
    parts = line.strip().split(",")
    if len(parts) < 6:
        return None
    try:
        v = [float(p) for p in parts[:6]]
        btn = int(float(parts[6])) if len(parts) > 6 and parts[6] != "" else None
    except ValueError:
        return None
    return v, btn


def run_serial(sess, port, baud):
    import serial
    with serial.Serial(port, baud, timeout=1) as s:
        while True:
            r = parse_line(s.readline().decode(errors="ignore"))
            if r:
                sess.on_imu(*r)


def run_udp(sess, port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("0.0.0.0", port))
    while True:
        data, _ = sock.recvfrom(4096)
        for line in data.decode(errors="ignore").splitlines():
            r = parse_line(line)
            if r:
                sess.on_imu(*r)


def run_sim(sess):
    """Fake wristband: each label has its own motion signature (plus noise, per-take variation)."""
    gyro_off = np.array([0.8, -0.5, 0.3])
    while True:
        # idle until a recording starts
        while not sess.recording:
            g = gyro_off + np.random.randn(3) * 0.4
            a = np.array([0, 0, 1.0]) + np.random.randn(3) * 0.01
            sess.on_imu(list(a) + list(g)); time.sleep(1 / HZ)
        lab = sess.target if sess.mode == "collect" else random.choice(sess.labels)
        k = sess.labels.index(lab)
        rng = np.random.RandomState(k * 7 + 1)
        freqs = rng.uniform(0.6, 3.0, (6, 2)); phase = rng.uniform(0, 6.28, (6, 2))
        amp = rng.uniform(0.5, 1.0, (6, 2)) * np.array([0.3] * 3 + [90] * 3)[:, None]
        dur = random.uniform(0.9, 1.3); warp = random.uniform(0.9, 1.1); gain = random.uniform(0.8, 1.2)
        t0 = time.time()
        while sess.recording:
            t = time.time() - t0
            if t < dur:
                u = t / dur; env = np.sin(np.pi * u)
                s = (amp * np.sin(2 * np.pi * freqs * u * warp + phase)).sum(1) * env * gain
            else:
                s = np.zeros(6)
            g = gyro_off + s[3:] + np.random.randn(3) * 0.4
            a = np.array([0, 0, 1.0]) + s[:3] + np.random.randn(3) * 0.01
            sess.on_imu(list(a) + list(g)); time.sleep(1 / HZ)


# ---------------------------------------------------------------- web app
app = FastAPI()
SESSION = None
HERE = os.path.dirname(os.path.abspath(__file__))
clients = set()


@app.get("/")
def index():
    return FileResponse(os.path.join(HERE, "static", "index.html"))


@app.on_event("startup")
async def _startup():
    asyncio.create_task(broadcaster())


async def broadcaster():
    while True:
        await asyncio.sleep(0.04)
        msgs = SESSION.drain()
        if not msgs or not clients:
            continue
        for c in list(clients):
            try:
                for m in msgs:
                    await c.send_text(json.dumps(m))
            except Exception:
                clients.discard(c)


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()
    clients.add(sock)
    await sock.send_text(json.dumps(SESSION.snapshot()))
    try:
        while True:
            m = json.loads(await sock.receive_text())
            cmd = m.get("cmd")
            if cmd == "toggle": SESSION.toggle()
            elif cmd == "skip": SESSION.skip()
            elif cmd == "undo": SESSION.undo()
            elif cmd == "mode": SESSION.set_mode(m.get("value", ""))
            elif cmd == "person": SESSION.set_person(m.get("value", ""))
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(sock)


def main():
    global SESSION
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["sim", "serial", "udp"], default="sim")
    ap.add_argument("--port", default="/dev/ttyUSB0", help="serial device, or UDP port number for --source udp")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--labels", default="0123456789")
    ap.add_argument("--goal", type=int, default=30, help="target samples per label")
    ap.add_argument("--data", default=os.path.join(HERE, "data"))
    ap.add_argument("--person", default="p1")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--http-port", type=int, default=8000)
    a = ap.parse_args()
    SESSION = Session(list(a.labels), a.goal, a.data, a.person)
    if a.source == "sim":
        threading.Thread(target=run_sim, args=(SESSION,), daemon=True).start()
    elif a.source == "serial":
        threading.Thread(target=run_serial, args=(SESSION, a.port, a.baud), daemon=True).start()
    else:
        port = int(a.port) if a.port.isdigit() else 9000
        threading.Thread(target=run_udp, args=(SESSION, port), daemon=True).start()
    uvicorn.run(app, host=a.host, port=a.http_port, log_level="warning")


if __name__ == "__main__":
    main()
