"""Check that pitch memory really lands on the team's Vexo band.

Writes one memory entry into the band's storage (key 900, the range /pitch uses),
reads it back from the band, then deletes it so nothing is left behind.

Run it from your own Terminal (macOS asks Terminal for Bluetooth permission the first
time), with the band nearby and nothing else connected to it:

    python3 -m pip install --user bleak
    python3 reflex-present/scripts/check-band-memory.py
"""

import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vexo-open-kit" / "python"))
from vexo_open.sync import Band  # noqa: E402

# The band number lives in one place: src/spatial/wearable/band.ts.
BAND = int(re.search(r"BAND_NUMBER\s*=\s*(\d+)", (ROOT / "reflex-present/src/spatial/wearable/band.ts").read_text()).group(1))
KEY = 900

print(f"Connecting to Vexo-HACK-{BAND:02d} …")
band = Band.connect(BAND)
assert band.number == BAND, f"connected to band {band.number}, not {BAND}"
print("connected:", band.name)
entry = {"v": 1, "t": "Quarterly Revenue", "k": "chart", "s": "Q1 120 · Q2 150 · Q3 180 · Q4 210", "at": int(time.time())}
raw = json.dumps(entry, separators=(",", ":"), ensure_ascii=False)
band.storage.put(KEY, raw)
back = band.storage.get_text(KEY)
print("wrote", len(raw.encode()), "bytes; read back from the band:", back)
print("ROUND TRIP OK" if back and json.loads(back) == entry else "MISMATCH")
band.storage.delete(KEY)
print("cleaned up; key", KEY, "is now", band.storage.get_text(KEY))
band.disconnect()
