// Wrist pronation/supination from a raw gyroscope. The band reports angular
// velocity about its own axes; which axis the doorknob twist lands on depends
// on how the band is worn, so it is measured, never assumed:
//   1. hold still  → per-axis bias and noise,
//   2. twist       → the axis carrying most of the bias-corrected energy, and
//                    its sign (the user starts clockwise, so the first
//                    excursion defines "clockwise = positive").
// The angle is then integrated with real sample timestamps, only for the few
// seconds a menu is open, so drift stays small.

export type Axis = 'x' | 'y' | 'z'
export const AXES: Axis[] = ['x', 'y', 'z']

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** One gyro reading: deg/s on each axis, time on the device's clock (ms). */
export interface GyroSample extends Vec3 {
  deviceTMs: number
}

export interface GyroCalibration {
  version: 1
  axis: Axis
  sign: 1 | -1
  bias: Vec3
  /** Largest per-axis standard deviation while still (deg/s). */
  noiseDps: number
  /** Share of twist energy on the chosen axis, 0..1 (how clean the twist was). */
  axisShare: number
  calibratedAt: number
}

export interface BiasEstimate {
  bias: Vec3
  noiseDps: number
  still: boolean
}

/** Mean and spread per axis. `still` if no axis moved more than `maxNoiseDps`. */
export function estimateBias(samples: GyroSample[], maxNoiseDps = 3): BiasEstimate | null {
  if (samples.length < 10) return null
  const mean = { x: 0, y: 0, z: 0 }
  for (const s of samples) for (const a of AXES) mean[a] += s[a] / samples.length
  let noise = 0
  for (const a of AXES) {
    const v = samples.reduce((acc, s) => acc + (s[a] - mean[a]) ** 2, 0) / samples.length
    noise = Math.max(noise, Math.sqrt(v))
  }
  return { bias: mean, noiseDps: noise, still: noise <= maxNoiseDps }
}

export interface AxisEstimate {
  axis: Axis
  sign: 1 | -1
  axisShare: number
}

/**
 * Picks the twist axis from a recording of the user twisting back and forth,
 * starting clockwise. Returns null when the twist was too small to tell.
 */
export function detectTwistAxis(samples: GyroSample[], bias: Vec3, minExcursionDeg = 10): AxisEstimate | null {
  if (samples.length < 10) return null
  const energy = { x: 0, y: 0, z: 0 }
  for (const s of samples) for (const a of AXES) energy[a] += (s[a] - bias[a]) ** 2
  const total = energy.x + energy.y + energy.z
  if (total <= 0) return null
  const axis = AXES.reduce((best, a) => (energy[a] > energy[best] ? a : best), 'x' as Axis)

  let angle = 0
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].deviceTMs - samples[i - 1].deviceTMs) / 1000
    if (dt <= 0 || dt > 0.1) continue
    angle += (samples[i][axis] - bias[axis]) * dt
    if (Math.abs(angle) >= minExcursionDeg) {
      return { axis, sign: angle > 0 ? 1 : -1, axisShare: energy[axis] / total }
    }
  }
  return null
}

export interface IntegratorOptions {
  /** A longer gap between samples is skipped, not integrated (lost samples, a paused stream). */
  maxDtMs: number
  /** Hard limit on the integrated angle, so drift or a spin cannot run away. */
  clampDeg: number
}

/** Integrates the calibrated axis with trapezoids over the samples' own timestamps. */
export class GyroAngleIntegrator {
  cal: GyroCalibration
  options: IntegratorOptions
  angle = 0
  gaps = 0
  rateDps = 0
  private last: GyroSample | null = null

  constructor(cal: GyroCalibration, options: Partial<IntegratorOptions> = {}) {
    this.cal = cal
    this.options = { maxDtMs: 100, clampDeg: 120, ...options }
  }

  private rate(s: GyroSample) {
    return this.cal.sign * (s[this.cal.axis] - this.cal.bias[this.cal.axis])
  }

  reset() {
    this.angle = 0
    this.gaps = 0
    this.last = null
  }

  feed(s: GyroSample): number {
    const r = this.rate(s)
    this.rateDps = r
    if (this.last) {
      const dtMs = s.deviceTMs - this.last.deviceTMs
      if (dtMs > 0 && dtMs <= this.options.maxDtMs) {
        this.angle += ((this.rate(this.last) + r) / 2) * (dtMs / 1000)
        const c = this.options.clampDeg
        this.angle = Math.max(-c, Math.min(c, this.angle))
      } else if (dtMs > this.options.maxDtMs) {
        this.gaps++
      }
    }
    this.last = s
    return this.angle
  }
}

const storageKey = (band: number) => `reflex.radial.gyro-calibration.v1:band${band}`

export function loadGyroCalibration(band: number): GyroCalibration | null {
  try {
    const raw = localStorage.getItem(storageKey(band))
    const parsed = raw ? (JSON.parse(raw) as GyroCalibration) : null
    return parsed?.version === 1 ? parsed : null
  } catch {
    return null
  }
}

export function saveGyroCalibration(band: number, cal: GyroCalibration) {
  try {
    localStorage.setItem(storageKey(band), JSON.stringify(cal))
  } catch {
    // storage blocked: the calibration still works for this page
  }
}
