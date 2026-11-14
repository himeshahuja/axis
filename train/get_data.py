"""Fetch the EMNIST "balanced" split into train/data/.

EMNIST ships as one 560 MB zip of every split. Only four small files are
needed, so this reads just those out of the zip over HTTP range requests
(about 25 MB) instead of downloading all of it.

    python3 train/get_data.py
"""

import io
import pathlib
import urllib.request
import zipfile

URL = "https://biometrics.nist.gov/cs_links/EMNIST/gzip.zip"
WANT = [f"gzip/emnist-balanced-{part}-{kind}-idx{n}-ubyte.gz" for part in ("train", "test") for kind, n in (("images", 3), ("labels", 1))]
OUT = pathlib.Path(__file__).parent / "data"
AGENT = {"User-Agent": "air-draw-fetch/1.0"}  # the server turns away Python's default one


class RemoteFile(io.RawIOBase):
    """A read-only, seekable view of a file on a server that accepts ranges."""

    def __init__(self, url):
        self.url = url
        head = urllib.request.urlopen(urllib.request.Request(url, method="HEAD", headers=AGENT))
        self.size = int(head.headers["Content-Length"])
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={**AGENT, "Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req).read()
        self.pos += len(data)
        return data

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def main():
    OUT.mkdir(exist_ok=True)
    todo = [name for name in WANT if not (OUT / pathlib.Path(name).name).exists()]
    if not todo:
        print("already here:", OUT)
        return
    # A large buffer keeps the number of requests small.
    with zipfile.ZipFile(io.BufferedReader(RemoteFile(URL), buffer_size=4 << 20)) as z:
        for name in todo:
            data = z.read(name)
            (OUT / pathlib.Path(name).name).write_bytes(data)
            print(f"{pathlib.Path(name).name}  {len(data) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
