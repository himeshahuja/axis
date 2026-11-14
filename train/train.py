"""Train the character reader and write it out for the page.

    python3 train/get_data.py
    uv run --with torch --with numpy train/train.py

Reads digits and capital letters (36 classes) from EMNIST "balanced", trains a
small convolutional network, and writes:

    model/weights.bin   every weight, float32, in the order listed in model.json
    model/model.json    the layers, the labels, and the accuracy reached
    tests/vectors.json  a few test images with the scores the network gives them,
                        so the JavaScript copy of the network can be checked
"""

import gzip
import json
import pathlib

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).parent.parent
DATA = ROOT / "train" / "data"
LABELS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"  # the first 36 classes of the balanced split
EPOCHS = 14


def load(part):
    with gzip.open(DATA / f"emnist-balanced-{part}-images-idx3-ubyte.gz") as f:
        images = np.frombuffer(f.read(), np.uint8, offset=16).reshape(-1, 28, 28)
    with gzip.open(DATA / f"emnist-balanced-{part}-labels-idx1-ubyte.gz") as f:
        labels = np.frombuffer(f.read(), np.uint8, offset=8)
    keep = labels < len(LABELS)
    # EMNIST stores each image on its side: swap rows and columns to stand it up.
    return torch.from_numpy(images[keep].transpose(0, 2, 1).copy()), torch.from_numpy(labels[keep].astype(np.int64))


class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv1 = nn.Conv2d(1, 24, 3, padding=1)
        self.conv2 = nn.Conv2d(24, 48, 3, padding=1)
        self.conv3 = nn.Conv2d(48, 64, 3, padding=1)
        self.fc1 = nn.Linear(64 * 3 * 3, 128)
        self.fc2 = nn.Linear(128, len(LABELS))
        self.drop = nn.Dropout(0.3)

    def forward(self, x):
        x = F.max_pool2d(F.relu(self.conv1(x)), 2)  # 28 -> 14
        x = F.max_pool2d(F.relu(self.conv2(x)), 2)  # 14 -> 7
        x = F.max_pool2d(F.relu(self.conv3(x)), 2)  # 7 -> 3
        x = self.drop(F.relu(self.fc1(x.flatten(1))))
        return self.fc2(x)


def vary(x):
    """Make each training image a little different every time it is seen, in
    the ways a character drawn with a cursor differs from a scanned one: a
    different pen width, size, slant and place in the frame."""
    n = x.shape[0]
    dev = x.device
    # Thicker or thinner strokes.
    pick = torch.rand(n, 1, 1, 1, device=dev)
    thick = F.max_pool2d(x, 3, 1, 1)
    thin = -F.max_pool2d(-x, 3, 1, 1)
    x = torch.where(pick < 0.25, thick, torch.where(pick > 0.8, thin, x))
    # Turn, resize, slant and shift.
    angle = (torch.rand(n, device=dev) - 0.5) * 0.5
    scale = 0.85 + torch.rand(n, device=dev) * 0.4
    shear = (torch.rand(n, device=dev) - 0.5) * 0.5
    cos, sin = torch.cos(angle) * scale, torch.sin(angle) * scale
    theta = torch.zeros(n, 2, 3, device=dev)
    theta[:, 0, 0] = cos
    theta[:, 0, 1] = -sin + shear
    theta[:, 1, 0] = sin
    theta[:, 1, 1] = cos
    theta[:, :, 2] = (torch.rand(n, 2, device=dev) - 0.5) * 0.2
    grid = F.affine_grid(theta, x.shape, align_corners=False)
    return F.grid_sample(x, grid, align_corners=False)


def main():
    torch.manual_seed(0)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    train_x, train_y = load("train")
    test_x, test_y = load("test")
    print(f"{len(train_x)} training images, {len(test_x)} test images, on {dev}")
    train_x = (train_x.float() / 255).unsqueeze(1).to(dev)
    train_y = train_y.to(dev)
    test_xf = (test_x.float() / 255).unsqueeze(1).to(dev)

    net = Net().to(dev)
    steps = EPOCHS * (len(train_x) // 256 + 1)
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-3, total_steps=steps)

    def score():
        net.eval()
        with torch.no_grad():
            out = torch.cat([net(test_xf[i : i + 2000]) for i in range(0, len(test_xf), 2000)]).cpu()
        net.train()
        return out

    for epoch in range(EPOCHS):
        order = torch.randperm(len(train_x), device=dev)
        total = 0.0
        for i in range(0, len(order), 256):
            idx = order[i : i + 256]
            loss = F.cross_entropy(net(vary(train_x[idx])), train_y[idx], label_smoothing=0.05)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item() * len(idx)
        acc = (score().argmax(1) == test_y).float().mean().item()
        print(f"epoch {epoch + 1:2d}  loss {total / len(order):.3f}  test accuracy {acc:.4f}")

    out = score()
    guess = out.argmax(1)
    acc = (guess == test_y).float().mean().item()
    # The pairs it mixes up most.
    pairs = {}
    for t, g in zip(test_y.tolist(), guess.tolist()):
        if t != g:
            key = "/".join(sorted((LABELS[t], LABELS[g])))
            pairs[key] = pairs.get(key, 0) + 1
    worst = sorted(pairs.items(), key=lambda kv: -kv[1])[:8]
    print("accuracy", round(acc, 4), "most confused:", worst)

    net.cpu().eval()
    names = ["conv1", "conv2", "conv3", "fc1", "fc2"]
    layers, blobs = [], []
    for name in names:
        layer = getattr(net, name)
        for kind in ("weight", "bias"):
            w = getattr(layer, kind).detach().numpy().astype("<f4")
            layers.append({"name": f"{name}.{kind}", "shape": list(w.shape)})
            blobs.append(w.tobytes())
    (ROOT / "model").mkdir(exist_ok=True)
    (ROOT / "model" / "weights.bin").write_bytes(b"".join(blobs))
    (ROOT / "model" / "model.json").write_text(json.dumps({
        "labels": LABELS,
        "input": [28, 28],
        "layers": layers,
        "accuracy": round(acc, 4),
        "tested_on": len(test_y),
        "most_confused": [{"pair": k, "count": v} for k, v in worst],
    }, indent=2) + "\n")

    with torch.no_grad():
        pick = list(range(0, len(test_x), len(test_x) // 12))[:12]
        scores = net((test_x[pick].float() / 255).unsqueeze(1))
    (ROOT / "tests" / "vectors.json").write_text(json.dumps([
        {"label": LABELS[test_y[i]], "pixels": test_x[i].flatten().tolist(), "scores": [round(v, 4) for v in s.tolist()]}
        for i, s in zip(pick, scores)
    ]) + "\n")
    print("wrote model/weights.bin, model/model.json, tests/vectors.json")


if __name__ == "__main__":
    main()
