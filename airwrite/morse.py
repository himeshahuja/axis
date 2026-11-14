"""Text as Morse code on the vibration motor."""

DOT = 120  # ms; everything else is a multiple of it

CODE = {
    "A": ".-", "B": "-...", "C": "-.-.", "D": "-..", "E": ".", "F": "..-.", "G": "--.", "H": "....", "I": "..", "J": ".---",
    "K": "-.-", "L": ".-..", "M": "--", "N": "-.", "O": "---", "P": ".--.", "Q": "--.-", "R": ".-.", "S": "...", "T": "-",
    "U": "..-", "V": "...-", "W": ".--", "X": "-..-", "Y": "-.--", "Z": "--..",
    "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
}

# The other things the wrist says.
ACCEPTED = [100]                 # one short buzz: character taken
RETRY = [100, 120, 100]          # two short buzzes: not sure, write it again
SENT = [600]                     # one long buzz: message sent
CLEARED = [100, 80, 100, 80, 100]  # three quick buzzes: message cleared


def pattern(text, dot=DOT):
    """`text` as on, off, on, ... milliseconds: a dot is one unit and a dash
    three, with one unit between symbols, three between letters and four
    between words. Characters with no Morse code are skipped."""
    out = []
    for w, word in enumerate(text.upper().split()):
        if w and out:
            out[-1] = 4 * dot
        for letter in word:
            if letter not in CODE:
                continue
            for symbol in CODE[letter]:
                out += [dot if symbol == "." else 3 * dot, dot]
            out[-1] = 3 * dot
    return out[:-1]  # no gap after the last symbol
