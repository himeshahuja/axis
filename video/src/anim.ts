// Frame-based animation helpers. Everything is a pure function of the frame number,
// so any frame renders the same on its own (no state carried between frames).

import { Easing, interpolate } from 'remotion'
import { EASE } from './theme'

export const ease = Easing.bezier(...EASE)
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1)
export const easeIn = Easing.bezier(0.5, 0, 0.75, 0)

/** 0→1 over [start, start+dur], eased, clamped. */
export function prog(frame: number, start: number, dur: number, e: (t: number) => number = ease) {
  return interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: e })
}

/** Fade in over [a, a+inDur], hold, fade out over [b-outDur, b]. */
export function fade(frame: number, a: number, b: number, inDur = 10, outDur = 10) {
  return Math.min(prog(frame, a, inDur), 1 - prog(frame, b - outDur, outDur, easeInOut))
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** A damped spring response 0→1 (overshoots slightly), from frame `start`. */
export function springy(frame: number, start: number, fps = 30, stiffness = 170, damping = 16) {
  const t = Math.max(0, frame - start) / fps
  if (t <= 0) return 0
  const w0 = Math.sqrt(stiffness)
  const z = damping / (2 * w0)
  if (z >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
  const wd = w0 * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
}

/** Piecewise path through keyframes [frame, x, y], eased between each pair. */
export function path(frame: number, keys: [number, number, number][], e: (t: number) => number = easeInOut): [number, number] {
  if (frame <= keys[0][0]) return [keys[0][1], keys[0][2]]
  for (let i = 1; i < keys.length; i++) {
    const [f1, x1, y1] = keys[i]
    const [f0, x0, y0] = keys[i - 1]
    if (frame <= f1) {
      const t = e((frame - f0) / Math.max(1, f1 - f0))
      return [lerp(x0, x1, t), lerp(y0, y1, t)]
    }
  }
  const last = keys[keys.length - 1]
  return [last[1], last[2]]
}

/** Small deterministic noise in [-1, 1] for hand tremor and drift. */
export function wobble(frame: number, seed: number) {
  return Math.sin(frame * 0.071 + seed * 1.7) * 0.6 + Math.sin(frame * 0.163 + seed * 3.1) * 0.4
}
