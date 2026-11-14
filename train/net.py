"""The network, and writing it out in the form the Pi and the page read."""

import json
import pathlib

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ROOT = pathlib.Path(__file__).parent.parent
# The layers in order: ("conv", channels out, kernel width) is followed by
# batch norm and ReLU; "pool" halves the length; "gather" keeps each channel's
# largest and average value; "dense" is the final fully connected layer.
PLAN = [("conv", 32, 7), ("conv", 48, 5), ("pool",), ("conv", 64, 5), ("pool",), ("conv", 96, 3), ("pool",), ("conv", 128, 3), ("gather",), ("dense",)]


class Net(nn.Module):
    def __init__(self, classes):
        super().__init__()
        self.steps = nn.ModuleList()
        channels = 6
        for kind, *arg in PLAN:
            if kind == "conv":
                self.steps.append(nn.Sequential(nn.Conv1d(channels, arg[0], arg[1], padding=arg[1] // 2, bias=False), nn.BatchNorm1d(arg[0]), nn.ReLU()))
                channels = arg[0]
            elif kind == "pool":
                self.steps.append(nn.MaxPool1d(2))
            elif kind == "gather":
                self.steps.append(nn.Identity())
                channels *= 2
            else:
                self.steps.append(nn.Sequential(nn.Dropout(0.3), nn.Linear(channels, classes)))

    def forward(self, x):
        for (kind, *_), step in zip(PLAN, self.steps):
            x = torch.cat([x.amax(2), x.mean(2)], 1) if kind == "gather" else step(x)
        return x


def vary(x):
    """A training batch, each reading a little different every time it is
    seen: a stronger or weaker hand, a start a few steps early or late, a
    wrist turned a little about the vertical, a faster first or second half."""
    n, dev = len(x), x.device
    x = x * (0.8 + 0.4 * torch.rand(n, 1, 1, device=dev))
    # Turn about the vertical (y): mixes x and z, for both sensors.
    a = (torch.rand(n, 1, device=dev) - 0.5) * 0.5
    c, s = torch.cos(a), torch.sin(a)
    x = torch.stack([c * x[:, 0] + s * x[:, 2], x[:, 1], -s * x[:, 0] + c * x[:, 2], c * x[:, 3] + s * x[:, 5], x[:, 4], -s * x[:, 3] + c * x[:, 5]], 1)
    # Warp time: sample along a gently bent line instead of a straight one.
    steps = x.shape[2]
    t = torch.linspace(0, 1, steps, device=dev)[None]
    bend = (torch.rand(n, 1, device=dev) - 0.5) * 0.3
    at = (t + bend * torch.sin(np.pi * t)).clamp(0, 1) * (steps - 1)
    lo = at.floor().long().clamp(max=steps - 2)
    f = (at - lo)[:, None]
    idx = lo[:, None].expand(-1, 6, -1)
    x = torch.gather(x, 2, idx) * (1 - f) + torch.gather(x, 2, idx + 1) * f
    return torch.roll(x, int(torch.randint(-3, 4, (1,))), 2)


def export(net, labels, facts, folder=ROOT / "model", onnx=False):
    """Write weights.bin and model.json. Batch norm is folded into each
    convolution, so a reader only needs weights and biases; float16 halves
    the size. Returns a function that runs the network exactly as written."""
    net = net.cpu().eval()
    layers, blobs, plan, exact = [], [], [], []

    def put(name, tensor):
        a = tensor.detach().numpy().astype("<f2")
        layers.append({"name": name, "shape": list(a.shape)})
        blobs.append(a.tobytes())
        return torch.from_numpy(a.astype(np.float32))

    for (kind, *arg), step in zip(PLAN, net.steps):
        i = len(plan)
        if kind == "conv":
            conv, bn = step[0], step[1]
            gain = bn.weight / torch.sqrt(bn.running_var + bn.eps)
            exact.append((put(f"{i}.weight", conv.weight * gain[:, None, None]), put(f"{i}.bias", bn.bias - bn.running_mean * gain)))
            plan.append({"type": "conv", "in": conv.in_channels, "out": conv.out_channels, "width": arg[1]})
        elif kind == "dense":
            exact.append((put(f"{i}.weight", step[1].weight), put(f"{i}.bias", step[1].bias)))
            plan.append({"type": "dense"})
        else:
            exact.append(None)
            plan.append({"type": kind})

    def run(x):
        with torch.no_grad():
            for p, w in zip(plan, exact):
                if p["type"] == "conv":
                    x = F.relu(F.conv1d(x, w[0], w[1], padding=p["width"] // 2))
                elif p["type"] == "pool":
                    x = F.max_pool1d(x, 2)
                elif p["type"] == "gather":
                    x = torch.cat([x.amax(2), x.mean(2)], 1)
                else:
                    x = F.linear(x, w[0], w[1])
        return x

    folder = pathlib.Path(folder)
    folder.mkdir(exist_ok=True)
    (folder / "weights.bin").write_bytes(b"".join(blobs))
    (folder / "model.json").write_text(json.dumps({"labels": labels, "input": [6, 96], "format": "float16", "plan": plan, "layers": layers, **facts}, indent=2) + "\n")
    torch.save(net.state_dict(), folder / "net.pt")
    if onnx:
        torch.onnx.export(net, torch.zeros(1, 6, 96), str(folder / "model.onnx"), input_names=["features"], output_names=["scores"], dynamic_axes={"features": {0: "batch"}})
    return run


def confusion(labels, truth, guess):
    """A table of what each character was read as, rows true, columns read."""
    n = len(labels)
    m = np.zeros((n, n), int)
    for t, g in zip(truth, guess):
        m[t, g] += 1
    lines = ["     " + " ".join(f"{c:>3}" for c in labels)]
    for i, c in enumerate(labels):
        lines.append(f"  {c}  " + " ".join(f"{v:>3}" if v else "  ." for v in m[i]) + f"   {m[i, i] / max(1, m[i].sum()):.0%}")
    return "\n".join(lines)
