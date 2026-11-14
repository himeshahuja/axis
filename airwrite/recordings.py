"""Recordings on disk: one CSV per written character.

    recordings/<person>/<label>/<label>_<n>.csv

    # label=7 person=ana rate=100
    part,ax,ay,az,gx,gy,gz
    idle,0.12,9.79,0.31,0.001,-0.002,0.000     <- the still second before the start click
    ...
    write,0.15,9.81,0.29,0.010,0.004,-0.003    <- between the start and stop clicks
    ...

Units are m/s^2 and rad/s, at 100 readings a second.
"""

import pathlib

import numpy as np

from .features import RATE

ROOT = pathlib.Path(__file__).parent.parent / "recordings"


def save(person, label, window, idle, root=ROOT):
    folder = pathlib.Path(root) / person / label
    folder.mkdir(parents=True, exist_ok=True)
    n = 1 + max([int(p.stem.split("_")[-1]) for p in folder.glob(f"{label}_*.csv")], default=0)
    path = folder / f"{label}_{n:03d}.csv"
    with open(path, "w") as f:
        f.write(f"# label={label} person={person} rate={RATE}\npart,ax,ay,az,gx,gy,gz\n")
        for part, rows in (("idle", idle), ("write", window)):
            for r in rows:
                f.write(part + "," + ",".join(f"{v:.4f}" for v in r) + "\n")
    return path


def load(path):
    """One recording as (label, person, window, idle)."""
    lines = pathlib.Path(path).read_text().splitlines()
    facts = dict(kv.split("=") for kv in lines[0].lstrip("# ").split())
    parts = {"idle": [], "write": []}
    for line in lines[2:]:
        part, *values = line.split(",")
        parts[part].append([float(v) for v in values])
    return facts["label"], facts["person"], np.array(parts["write"]).reshape(-1, 6), np.array(parts["idle"]).reshape(-1, 6)


def load_all(root=ROOT):
    return [load(p) for p in sorted(pathlib.Path(root).glob("*/*/*.csv"))]
