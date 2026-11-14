// Continuous rotation sources for the radial menu, in priority order:
//   simulator (only when switched on in the debug view) > Vexo gyro > camera hand tilt.
// Each gives an angle in degrees, clockwise positive; the controller works
// relative to the angle captured when the menu opens.

import { estimateBias, GyroAngleIntegrator, type GyroCalibration, type GyroSample } from './RotationCalibration'
import type { RotationObservation, RotationSourceKind } from './types'

const STALE_MS = 200

/** The band's gyro, integrated on the calibrated axis while a menu is open. */
export class VexoGyroRotation {
  cal: GyroCalibration | null = null
  private integrator: GyroAngleIntegrator | null = null
  /** Last second of raw samples (for bias refresh and the debug view). */
  recent: GyroSample[] = []
  latest: GyroSample | null = null
  lastLocalMs = -Infinity
  connected = false
  /** Debug: pretend the link dropped without touching the band. */
  simulatedDisconnect = false

  setCalibration(cal: GyroCalibration | null) {
    this.cal = cal
    this.integrator = cal ? new GyroAngleIntegrator(cal) : null
  }

  feed(s: GyroSample, localMs: number) {
    this.latest = s
    this.lastLocalMs = localMs
    this.recent.push(s)
    while (this.recent.length && s.deviceTMs - this.recent[0].deviceTMs > 1000) this.recent.shift()
    this.integrator?.feed(s)
  }

  streaming(nowMs: number) {
    return this.connected && !this.simulatedDisconnect && nowMs - this.lastLocalMs < STALE_MS
  }

  available(nowMs: number) {
    return this.streaming(nowMs) && !!this.integrator
  }

  /**
   * Start a session: zero the integrated angle. If the wrist was still for the
   * last 400 ms (it is, during a hold), refresh the bias on the twist axis first.
   */
  begin() {
    if (!this.cal || !this.integrator) return
    const last = this.latest?.deviceTMs ?? 0
    const window = this.recent.filter((s) => last - s.deviceTMs <= 400)
    const est = estimateBias(window, Math.max(3, this.cal.noiseDps * 2))
    if (est?.still) {
      const bias = { ...this.cal.bias, [this.cal.axis]: est.bias[this.cal.axis] }
      this.cal = { ...this.cal, bias }
      this.integrator.cal = this.cal
    }
    this.integrator.reset()
  }

  angle() {
    return this.integrator?.angle ?? 0
  }

  rateDps() {
    return this.integrator?.rateDps ?? 0
  }

  gaps() {
    return this.integrator?.gaps ?? 0
  }
}

/**
 * Camera fallback: roll of the index-MCP → pinky-MCP line in the image. This is
 * hand tilt as the camera sees it, which follows pronation only when the forearm
 * points roughly at the camera. It is an approximation and is labelled as one.
 */
export class CameraTiltRotation {
  private unwrapped: number | null = null
  private lastRaw = 0
  lastMs = -Infinity

  feed(rollDeg: number | null, mirrored: boolean, tMs: number) {
    if (rollDeg === null) return
    const raw = mirrored ? -rollDeg : rollDeg
    if (this.unwrapped === null) this.unwrapped = raw
    else {
      let d = raw - this.lastRaw
      if (d > 180) d -= 360
      if (d < -180) d += 360
      this.unwrapped += d
    }
    this.lastRaw = raw
    this.lastMs = tMs
  }

  lost() {
    this.unwrapped = null
  }

  available(nowMs: number) {
    return this.unwrapped !== null && nowMs - this.lastMs < STALE_MS
  }

  angle() {
    return this.unwrapped ?? 0
  }
}

/** Debug slider. Never shown or reported as Vexo input. */
export class SimulatorRotation {
  enabled = false
  value = 0
  available() {
    return this.enabled
  }
  angle() {
    return this.value
  }
}

export interface ActiveRotation {
  source: RotationSourceKind
  angle: number
  observation: RotationObservation
}

export function pickRotation(
  nowMs: number,
  sim: SimulatorRotation,
  vexo: VexoGyroRotation,
  cam: CameraTiltRotation,
  relativeTo: number,
): ActiveRotation | null {
  if (sim.available()) {
    return { source: 'simulator', angle: sim.angle(), observation: { source: 'simulator', tMs: nowMs, angleDegrees: sim.angle() - relativeTo, calibrated: true } }
  }
  if (vexo.available(nowMs)) {
    return {
      source: 'vexo',
      angle: vexo.angle(),
      observation: { source: 'vexo', tMs: nowMs, angleDegrees: vexo.angle() - relativeTo, angularVelocityDps: vexo.rateDps(), calibrated: true, confidence: vexo.cal?.axisShare },
    }
  }
  if (cam.available(nowMs)) {
    return { source: 'camera', angle: cam.angle(), observation: { source: 'camera', tMs: nowMs, angleDegrees: cam.angle() - relativeTo, calibrated: false, confidence: 0.5 } }
  }
  return null
}
