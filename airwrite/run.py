"""The live demo: write characters in the air, get an answer on the wrist.

    python3 -m airwrite.run --port /dev/ttyUSB0

    click, write a character, click     reads it: one buzz = taken, two = write it again
    double click                        sends the message to Claude; the reply comes back in Morse
    long press                          clears the message

    --no-llm          do not call Claude: the message itself is buzzed back
    --fake 314        no hardware: a pretend wrist writes 3, 1, 4 and sends
"""

import argparse
import time

from . import morse
from .features import prepare
from .link import Clicks, open_link, record
from .model import Model

SURE = 0.5  # below this the character is not taken


def reply_to(candidates, use_llm):
    """What to buzz back for the message: Claude's answer, or the message as
    read if Claude cannot be reached."""
    raw = "".join(top[0][0] for top in candidates)
    if not use_llm:
        return raw
    try:
        from .llm import ask

        return ask(candidates)
    except Exception as err:  # no key, no network, API trouble: the demo carries on
        print(f"  (Claude unavailable: {type(err).__name__}: {err}; buzzing the message as read)")
        return raw


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", help="serial port of the wrist unit")
    ap.add_argument("--model", default=None, help="folder with model.json and weights.bin")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--fake", metavar="TEXT", help="use a pretend wrist that writes TEXT and sends it")
    ap.add_argument("--fake-person", type=int, default=0)
    ap.add_argument("--speed", type=float, default=1.0, help="how fast the pretend wrist's clock runs")
    args = ap.parse_args()

    model = Model(args.model) if args.model else Model()
    link = open_link(args.port, args.fake is not None, person=args.fake_person, speed=args.speed, labels=model.labels)
    clicks = Clicks(link)
    if args.fake is not None:
        for ch in args.fake:
            link.write(ch)
        link.press("double")
    message = []  # one list of (label, probability) per character taken
    print(f"Reading {model.labels}. Click, write, click. Double click sends; long press clears.")
    try:
        while True:
            gesture = clicks.next()
            if gesture is None:
                continue
            kind, start = gesture
            if kind == "long":
                message = []
                link.buzz(morse.CLEARED)
                print("cleared")
            elif kind == "double":
                if not message:
                    link.buzz(morse.RETRY)
                    continue
                text = "".join(top[0][0] for top in message)
                print(f"sending: {text}")
                link.buzz(morse.SENT)
                reply = reply_to(message, not args.no_llm)
                print(f"reply:   {reply}")
                link.buzz(morse.pattern(reply))
                message = []
                if args.fake is not None:
                    break
            else:
                window, idle, _ = record(link, clicks, start)
                feats = prepare(window, idle)
                guesses = model.read(feats)[:3] if feats is not None else []
                shown = "  ".join(f"{label} {p:.0%}" for label, p in guesses)
                if not guesses or guesses[0][1] < SURE:
                    link.buzz(morse.RETRY)
                    print(f"  ?  not sure ({shown or 'nothing moved'}): write it again")
                else:
                    message.append(guesses)
                    link.buzz(morse.ACCEPTED)
                    print(f"  {guesses[0][0]}  ({shown})   message: {''.join(top[0][0] for top in message)}")
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        link.close()
        time.sleep(0.05)


if __name__ == "__main__":
    main()
