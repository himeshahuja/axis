"""Collect labelled recordings from the wrist.

    python3 -m airwrite.log --person ana --port /dev/ttyUSB0
    python3 -m airwrite.log --person ana --labels 0123456789 --reps 30 --port ...

For each character asked for: hold the wrist still, click, write it in the
air, click again. One short buzz means it was saved. A long press throws away
the one just saved, to do it again. Characters come in a shuffled order so
no one writes the same one thirty times in a row.

    --fake    no hardware: a pretend wrist writes each character for you
"""

import argparse
import random
import time

from . import morse, recordings
from .features import prepare
from .link import Clicks, open_link, record


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--person", required=True, help="who is writing (used as the folder name)")
    ap.add_argument("--labels", default="0123456789")
    ap.add_argument("--reps", type=int, default=30, help="recordings of each character")
    ap.add_argument("--port", help="serial port of the wrist unit")
    ap.add_argument("--fake", action="store_true", help="use a pretend wrist")
    ap.add_argument("--fake-person", type=int, default=0, help="which pretend person writes")
    ap.add_argument("--speed", type=float, default=1.0, help="how fast the pretend wrist's clock runs")
    ap.add_argument("--out", default=str(recordings.ROOT))
    args = ap.parse_args()

    link = open_link(args.port, args.fake, person=args.fake_person, speed=args.speed, labels=args.labels)
    clicks = Clicks(link)
    todo = [c for _ in range(args.reps) for c in args.labels]
    random.Random(args.person).shuffle(todo)
    saved, last = 0, None
    print(f"{len(todo)} recordings to make for {args.person}. Hold still, click, write, click. Long press: redo the last one.")
    try:
        while saved < len(todo):
            label = todo[saved]
            print(f"[{saved + 1}/{len(todo)}]  write  {label}", flush=True)
            if args.fake:
                link.write(label)
            gesture = None
            while gesture is None:
                gesture = clicks.next()
            kind, start = gesture
            if kind == "long":
                if last:
                    last.unlink()
                    saved -= 1
                    last = None
                    print("      threw the last one away")
                    link.buzz(morse.CLEARED)
                continue
            if kind != "click":
                continue
            window, idle, _ = record(link, clicks, start)
            if prepare(window, idle) is None:
                print("      nothing moved between the clicks; again")
                link.buzz(morse.RETRY)
                continue
            last = recordings.save(args.person, label, window, idle, args.out)
            saved += 1
            link.buzz(morse.ACCEPTED)
            print(f"      saved {last.name}  ({len(window) / 100:.1f} s)")
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        link.close()
        time.sleep(0.05)
    print(f"{saved} recordings in {args.out}/{args.person}")


if __name__ == "__main__":
    main()
