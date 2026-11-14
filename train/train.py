"""Train the character reader on simulated wrist readings.

    python3 train/get_data.py
    uv run --with torch --with numpy train/train.py [--labels 0123456789]

This is the starting point before any real recordings exist. Readings are
simulated (airwrite/synth.py) from real pen strokes: UJI Pen Characters, 40
writers to learn from and 20 others to test on. Once there are recordings
from the wrist, train/real.py carries on from the network this leaves.

Writes model/ (weights.bin, model.json, net.pt) and tests/vectors.json, which
lets the JavaScript copies of the simulation, features and network be checked.
"""

import argparse
import json
import pathlib
import sys

import numpy as np
import torch
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "train"))
from airwrite import synth  # noqa: E402
from net import Net, confusion, export, vary  # noqa: E402

BATCH = 256


def simulate(chars, copies, seed):
    rng = np.random.default_rng(seed)
    x = np.stack([synth.features(synth.reading(strokes, rng)) for _, _, strokes, _ in chars for _ in range(copies)])
    y = np.repeat([c[0] for c in chars], copies)
    return torch.from_numpy(x), torch.from_numpy(y.astype(np.int64))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--labels", default="0123456789", help="the characters to read")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--readings", type=int, default=120_000, help="simulated readings to learn from")
    ap.add_argument("--onnx", action="store_true", help="also write model/model.onnx (needs the onnx package)")
    args = ap.parse_args()
    labels = args.labels

    torch.manual_seed(0)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    chars = synth.load_uji(ROOT / "train" / "data" / "ujipenchars2.txt", labels)
    learn, held = [c for c in chars if not c[3]], [c for c in chars if c[3]]
    train_x, train_y = simulate(learn, max(1, args.readings // len(learn)), 1)
    test_x, test_y = simulate(held, 8, 2)
    print(f"{len(learn)} written characters from {len({c[1] for c in learn})} writers -> {len(train_x)} simulated readings to learn from")
    print(f"{len(held)} from {len({c[1] for c in held})} other writers -> {len(test_x)} to test on, on {dev}", flush=True)
    train_x, train_y = train_x.to(dev), train_y.to(dev)

    net = Net(len(labels)).to(dev)
    per_epoch = len(train_x) // BATCH
    opt = torch.optim.AdamW(net.parameters(), lr=2e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=4e-3, total_steps=args.epochs * per_epoch)
    for epoch in range(args.epochs):
        order = torch.randperm(len(train_x), device=dev)
        total = 0.0
        for i in range(per_epoch):
            idx = order[i * BATCH : (i + 1) * BATCH]
            loss = F.cross_entropy(net(vary(train_x[idx])), train_y[idx], label_smoothing=0.05)
            opt.zero_grad()
            loss.backward()
            opt.step()
            sched.step()
            total += loss.item()
        if epoch % 5 == 4 or epoch == args.epochs - 1:
            net.eval()
            with torch.no_grad():
                acc = (net(test_x.to(dev)).argmax(1).cpu() == test_y).float().mean().item()
            net.train()
            print(f"epoch {epoch + 1:2d}  loss {total / per_epoch:.3f}  test accuracy {acc:.4f}", flush=True)

    run = export(net, labels, {}, onnx=args.onnx)  # written once to get the float16 copy to score
    out = run(test_x)
    guess = out.argmax(1)
    acc = (guess == test_y).float().mean().item()
    top3 = (out.topk(3, 1).indices == test_y[:, None]).any(1).float().mean().item()
    print(f"accuracy {acc:.4f}, in the top three {top3:.4f} (simulated readings, writers not learned from)")
    print(confusion(labels, test_y.tolist(), guess.tolist()))
    export(net, labels, {
        "trained_on": "simulated wrist readings of UJI Pen Characters v2 (40 writers); no real recordings yet",
        "accuracy": round(acc, 4),
        "accuracy_top3": round(top3, 4),
        "tested_on": f"{len(test_y)} simulated readings of characters by 20 other writers",
    }, onnx=args.onnx)

    # Checks for the JavaScript copies: the simulation, the features, the network.
    rng = np.random.default_rng(3)
    vectors = {"readings": []}
    path = synth.write(held[40][2], rng)
    pose, arm, twist = (0.3, -0.2, 0.25), 0.55, 0.2
    vectors["wrist"] = {"path": np.round(path, 6).tolist(), "pose": pose, "arm": arm, "twist": twist, "imu": np.round(synth.wrist(path, pose, arm, twist), 5).tolist()}
    for k in range(0, len(held), len(held) // 8):
        imu = np.round(synth.reading(held[k][2], rng), 4)
        feat = synth.features(imu)
        s = run(torch.from_numpy(feat)[None])[0]
        vectors["readings"].append({"label": labels[held[k][0]], "imu": imu.tolist(), "features": np.round(feat, 5).tolist(), "scores": [round(v, 4) for v in s.tolist()]})
    # A few characters as plain strokes, for drawing in tests.
    vectors["strokes"] = [{"label": labels[held[k][0]], "strokes": [np.round(s - np.concatenate(held[k][2]).min(0), 0).tolist() for s in held[k][2]]} for k in range(7, len(held), len(held) // 24)]
    (ROOT / "tests" / "vectors.json").write_text(json.dumps(vectors) + "\n")
    print("wrote model/ and tests/vectors.json")


if __name__ == "__main__":
    main()
