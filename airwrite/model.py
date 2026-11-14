"""The trained network, run with nothing but numpy (so the Pi needs no
PyTorch or ONNX runtime). Reads model/model.json and model/weights.bin, the
same two files the web page uses.

    from airwrite.model import Model
    guesses = Model().read(features)   # [(label, probability), ...] surest first
"""

import json
import pathlib

import numpy as np

DEFAULT = pathlib.Path(__file__).parent.parent / "model"


class Model:
    def __init__(self, folder=DEFAULT):
        folder = pathlib.Path(folder)
        meta = json.loads((folder / "model.json").read_text())
        blob = np.frombuffer((folder / "weights.bin").read_bytes(), "<f2" if meta.get("format") == "float16" else "<f4").astype(np.float32)
        self.labels, self.plan, self.meta = meta["labels"], meta["plan"], meta
        self.w, at = {}, 0
        for layer in meta["layers"]:
            n = int(np.prod(layer["shape"]))
            self.w[layer["name"]] = blob[at : at + n].reshape(layer["shape"])
            at += n

    def scores(self, x):
        """Raw score per label for one (6, STEPS) feature array."""
        x = np.asarray(x, np.float32)
        for i, step in enumerate(self.plan):
            if step["type"] == "conv":
                w, b = self.w[f"{i}.weight"], self.w[f"{i}.bias"]  # (out, in, width)
                pad = w.shape[2] // 2
                padded = np.pad(x, ((0, 0), (pad, pad)))
                # Every window of the input, laid side by side: (in, length, width).
                windows = np.lib.stride_tricks.sliding_window_view(padded, w.shape[2], axis=1)
                x = np.maximum(np.einsum("clk,ock->ol", windows, w) + b[:, None], 0)
            elif step["type"] == "pool":
                n = x.shape[1] // 2
                x = x[:, : n * 2].reshape(x.shape[0], n, 2).max(2)
            elif step["type"] == "gather":
                x = np.concatenate([x.max(1), x.mean(1)])
            else:
                x = self.w[f"{i}.weight"] @ x + self.w[f"{i}.bias"]
        return x

    def read(self, x):
        """Every label with its probability, surest first."""
        s = self.scores(x)
        p = np.exp(s - s.max())
        p /= p.sum()
        return sorted(zip(self.labels, p.tolist()), key=lambda lp: -lp[1])
