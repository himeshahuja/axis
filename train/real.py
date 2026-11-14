"""Train and test on real recordings from the wrist (made with airwrite.log).

    uv run --with torch --with numpy train/real.py

Does three things:

1. Tests leave-one-person-out: for each person, learn from everyone else and
   test on them. This is the only honest number; a random split would let the
   network see each person's own writing and look better than it is.
   Reported for a nearest-neighbour baseline, for the network trained only on
   simulated readings (no real data at all), and for the network after
   learning from the other people's recordings.
2. Prints what was read as what, for the held-out people together.
3. Trains on everyone and writes model/, ready for airwrite.run.

    --scratch      do not start from the simulated-data network in model/net.pt
    --adapt 10     also show the accuracy after a new person gives this many
                   recordings of each character (the rest of theirs is the test)
"""

import argparse
import pathlib
import sys

import numpy as np
import torch
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "train"))
from airwrite import recordings  # noqa: E402
from airwrite.features import prepare  # noqa: E402
from net import Net, confusion, export, vary  # noqa: E402


def fit(x, y, classes, start, epochs, dev):
    """A network trained on x, y, starting from `start` (a state dict) if given."""
    net = Net(classes).to(dev)
    if start is not None:
        net.load_state_dict(start)
    x, y = x.to(dev), y.to(dev)
    batch = min(64, len(x))
    steps = epochs * max(1, len(x) // batch)
    opt = torch.optim.AdamW(net.parameters(), lr=1e-3, weight_decay=1e-3)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3 if start is None else 1e-3, total_steps=steps)
    for _ in range(steps):
        idx = torch.randint(0, len(x), (batch,), device=dev)
        noisy = vary(x[idx]) + 0.02 * torch.randn(batch, 6, x.shape[2], device=dev)
        loss = F.cross_entropy(net(noisy), y[idx], label_smoothing=0.05)
        opt.zero_grad()
        loss.backward()
        opt.step()
        sched.step()
    return net.eval()


def guess(net, x, dev):
    with torch.no_grad():
        return net(x.to(dev)).argmax(1).cpu()


def nearest(train_x, train_y, test_x, k=3):
    """The baseline: each test reading takes the commonest label among the k
    training readings closest to it."""
    d = torch.cdist(test_x.flatten(1), train_x.flatten(1))
    votes = train_y[d.topk(k, largest=False).indices]
    return torch.mode(votes, 1).values


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--recordings", default=str(recordings.ROOT))
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--scratch", action="store_true")
    ap.add_argument("--adapt", type=int, default=0)
    ap.add_argument("--onnx", action="store_true")
    ap.add_argument("--out", default=str(ROOT / "model"), help="where to write the trained network")
    args = ap.parse_args()

    torch.manual_seed(0)
    dev = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    rows, skipped = [], 0
    for label, person, window, idle in recordings.load_all(args.recordings):
        f = prepare(window, idle)
        if f is None:
            skipped += 1
        else:
            rows.append((label, person, f))
    if not rows:
        raise SystemExit(f"No recordings in {args.recordings}. Make some with: python3 -m airwrite.log --person NAME --port ...")
    labels = "".join(sorted({r[0] for r in rows}))
    people = sorted({r[1] for r in rows})
    x = torch.from_numpy(np.stack([r[2] for r in rows]))
    y = torch.tensor([labels.index(r[0]) for r in rows])
    who = np.array([r[1] for r in rows])
    print(f"{len(rows)} recordings, {len(people)} people ({', '.join(people)}), characters {labels}" + (f"; {skipped} with no movement left out" if skipped else ""))

    # Start from the network trained on simulated readings, if it reads the same characters.
    start = None
    sim = ROOT / "model" / "net.pt"
    if not args.scratch and sim.exists():
        state = torch.load(sim, map_location="cpu")
        if state[[k for k in state if k.endswith("weight")][-1]].shape[0] == len(labels):
            start = state
    print("starting from the simulated-data network" if start is not None else "starting from scratch")

    if len(people) < 2:
        print("Only one person, so there is no one to hold out: skipping the test.")
    else:
        truth, read = [], []
        print(f"\n{'held out':<12}{'n':>5}{'nearest':>10}{'sim only':>10}{'trained':>10}" + (f"{'+' + str(args.adapt) + ' each':>10}" if args.adapt else ""))
        totals = np.zeros(4)
        for person in people:
            test = torch.from_numpy(who == person)
            tx, ty, lx, ly = x[test], y[test], x[~test], y[~test]
            base = (nearest(lx, ly, tx) == ty).float().mean().item()
            zero = float("nan")
            if start is not None:
                sim_net = Net(len(labels)).to(dev)
                sim_net.load_state_dict(start)
                zero = (guess(sim_net.eval(), tx, dev) == ty).float().mean().item()
            net = fit(lx, ly, len(labels), start, args.epochs, dev)
            g = guess(net, tx, dev)
            acc = (g == ty).float().mean().item()
            truth += ty.tolist()
            read += g.tolist()
            line = f"{person:<12}{len(tx):>5}{base:>10.1%}{zero:>10.1%}{acc:>10.1%}"
            adapted = float("nan")
            if args.adapt:
                # The first few of each character go to learning; the rest test.
                mine = np.flatnonzero(who == person)
                seen = {}
                take = [i for i in mine if seen.setdefault(int(y[i]), 0) < args.adapt and not seen.update({int(y[i]): seen[int(y[i])] + 1})]
                rest = [i for i in mine if i not in set(take)]
                if rest:
                    more = fit(torch.cat([lx, x[take].repeat(4, 1, 1)]), torch.cat([ly, y[take].repeat(4)]), len(labels), start, args.epochs, dev)
                    adapted = (guess(more, x[rest], dev) == y[rest]).float().mean().item()
                line += f"{adapted:>10.1%}"
            totals += [base, zero, acc, adapted]
            print(line, flush=True)
        mean = totals / len(people)
        print(f"{'average':<12}{'':>5}{mean[0]:>10.1%}{mean[1]:>10.1%}{mean[2]:>10.1%}" + (f"{mean[3]:>10.1%}" if args.adapt else ""))
        print("\nWhat was read as what, for the held-out people together (rows: written, columns: read):")
        print(confusion(labels, truth, read))
        facts = {"accuracy": round(float(mean[2]), 4), "tested_on": f"leave-one-person-out over {len(people)} people, {len(rows)} recordings"}

    net = fit(x, y, len(labels), start, args.epochs, dev)
    facts = locals().get("facts", {})
    export(net, labels, {"trained_on": f"{len(rows)} wrist recordings from {len(people)} people" + (", starting from simulated readings" if start is not None else ""), **facts}, folder=args.out, onnx=args.onnx)
    print(f"\ntrained on everyone and wrote {args.out}")


if __name__ == "__main__":
    main()
