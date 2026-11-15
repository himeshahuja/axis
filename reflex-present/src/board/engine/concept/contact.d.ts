// Types for contact.js: is the marker on the board, heard by the band's microphone.

export const FRAME: number

/** One 20 ms frame's sound: low and high band energy (dB) and how noise-like the high band is (0..1). */
export function features(frame: Float32Array): { low: number; high: number; flat: number }
