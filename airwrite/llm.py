"""Asks Claude what the wearer meant, and for a short answer to it.

The reader is unsure about some characters, so Claude gets the top three
guesses for each with their probabilities, works out the intended message,
and replies in a few words that can be buzzed back in Morse code.

Needs the `anthropic` package and ANTHROPIC_API_KEY in the environment.
"""

import re

MODEL = "claude-haiku-5-5"

SYSTEM = """You are the voice of a wrist-worn device. The wearer writes a short message in the air, one character at a time, and a motion sensor reads each character. The reading is imperfect, so for each character you are given the three most likely readings with their probabilities.

First work out the message the wearer most plausibly meant, using the probabilities and what makes sense as a whole. Then answer it.

Your reply is delivered as Morse code vibrations on the wearer's wrist, which is slow to read. So reply with at most 5 words, using only the capital letters A to Z, the digits 0 to 9 and spaces: no punctuation, no lower case, no explanation. If the message is a number or code with no question in it, reply with the message as you read it."""


def ask(candidates):
    """`candidates` is one list per character of (label, probability), surest
    first. Returns Claude's reply, cleaned to capitals, digits and spaces.
    Raises on any failure; the caller falls back to the raw reading."""
    import anthropic

    lines = [f"{i + 1}. " + ", ".join(f"{label} ({p:.0%})" for label, p in top[:3]) for i, top in enumerate(candidates)]
    client = anthropic.Anthropic(timeout=15.0)
    response = client.messages.create(
        model=MODEL,
        max_tokens=300,
        thinking={"type": "disabled"},        # a five-word reply, wanted quickly
        output_config={"effort": "low"},
        system=SYSTEM,
        messages=[{"role": "user", "content": "The characters, in order:\n" + "\n".join(lines)}],
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("Claude declined to answer")
    text = "".join(block.text for block in response.content if block.type == "text")
    words = re.sub(r"[^A-Z0-9 ]", "", text.upper()).split()
    if not words:
        raise RuntimeError("Claude gave an empty reply")
    return " ".join(words[:5])
