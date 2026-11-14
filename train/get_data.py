"""Fetch UJI Pen Characters (version 2) into train/data/.

11,640 characters written on a tablet by 60 people, kept as pen strokes
(2.3 MB). From the UCI Machine Learning Repository.

    python3 train/get_data.py
"""

import io
import pathlib
import urllib.request
import zipfile

URL = "https://archive.ics.uci.edu/static/public/177/uji+pen+characters+version+2.zip"
OUT = pathlib.Path(__file__).parent / "data"


def main():
    OUT.mkdir(exist_ok=True)
    target = OUT / "ujipenchars2.txt"
    if target.exists():
        print("already here:", target)
        return
    req = urllib.request.Request(URL, headers={"User-Agent": "air-draw-fetch/1.0"})
    with zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req).read())) as z:
        for name in ("ujipenchars2.txt", "uji2.names"):
            (OUT / name).write_bytes(z.read(name))
            print(name)


if __name__ == "__main__":
    main()
