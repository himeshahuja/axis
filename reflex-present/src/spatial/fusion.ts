// State-based sensor fusion. Deliberately simple and explainable:
//   1. reject stale / disconnected / uncalibrated observations,
//   2. pick (or confidence-weight) sources according to the mode,
//   3. blend any source switch out over `handoffMs` so the cursor never jumps,
//   4. smooth the result.
// No Kalman filter: we have no measured process/measurement noise to justify one.

import { OneEuro2D } from './filters'
import type { PointerEstimate, PointerSource, SensorFusionMode, WearableObservation } from './types'

/** A camera pointer already mapped into the canvas frame by calibration. */
export interface CalibratedCameraPointer {
  /** Already filtered once per camera frame (e.g. grasp pose stabilization). */
  smoothed?: boolean
  tMs: number
  captureTMs?: number
  x: number
  y: number
  trackingValid: boolean
  confidence: number
}

export type CameraStatus = 'ok' | 'stale' | 'lost' | 'off'
export type WearableStatus = 'ok' | 'stale' | 'disconnected' | 'uncalibrated' | 'off'

export interface FusionDiagnostics {
  mode: SensorFusionMode
  activeSource: PointerSource
  cameraStatus: CameraStatus
  wearableStatus: WearableStatus
  cameraAgeMs: number | null
  wearableAgeMs: number | null
  /** Remaining blend offset from the last source switch (canvas units). */
  handoffOffset: number
  /** Learned correction applied to an integrated wearable pointer. */
  wearableBias: { x: number; y: number }
  weights: { camera: number; wearable: number }
}

export interface FusionConfig {
  cameraMaxAgeMs: number
  wearableMaxAgeMs: number
  handoffMs: number
  /** Within this gap a re-acquired pointer is blended; beyond it, it snaps. */
  reacquireBlendMs: number
  /** Per-second rate at which camera evidence pulls an integrated wearable pointer back (drift correction). */
  driftCorrectionPerS: number
  smoothing: { minCutoff: number; beta: number }
}

export const DEFAULT_FUSION_CONFIG: FusionConfig = {
  cameraMaxAgeMs: 200,
  wearableMaxAgeMs: 150,
  handoffMs: 250,
  reacquireBlendMs: 500,
  driftCorrectionPerS: 0.6,
  smoothing: { minCutoff: 1.2, beta: 8 },
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

export class SensorFusion {
  mode: SensorFusionMode
  config: FusionConfig
  private filter: OneEuro2D
  private lastSource: PointerSource = 'none'
  private lastOut: { x: number; y: number; tMs: number } | null = null
  private handoff = { x: 0, y: 0 }
  private bias = { x: 0, y: 0 }
  private lastUpdateT: number | null = null
  diagnostics: FusionDiagnostics

  constructor(mode: SensorFusionMode = 'CAMERA_FALLBACK', config: Partial<FusionConfig> = {}) {
    this.mode = mode
    this.config = { ...DEFAULT_FUSION_CONFIG, ...config }
    this.filter = new OneEuro2D(this.config.smoothing.minCutoff, this.config.smoothing.beta)
    this.diagnostics = this.emptyDiagnostics()
  }

  private emptyDiagnostics(): FusionDiagnostics {
    return {
      mode: this.mode,
      activeSource: 'none',
      cameraStatus: 'off',
      wearableStatus: 'off',
      cameraAgeMs: null,
      wearableAgeMs: null,
      handoffOffset: 0,
      wearableBias: { ...this.bias },
      weights: { camera: 0, wearable: 0 },
    }
  }

  setSmoothing(minCutoff: number, beta: number) {
    this.config.smoothing = { minCutoff, beta }
    this.filter.setParams(minCutoff, beta)
  }

  resetWearableBias() {
    this.bias = { x: 0, y: 0 }
  }

  resetPointer() {
    this.filter.reset()
    this.lastOut = null
    this.lastSource = 'none'
    this.handoff = { x: 0, y: 0 }
  }

  update(nowMs: number, cam: CalibratedCameraPointer | null, wear: WearableObservation | null): PointerEstimate {
    const cfg = this.config
    const dtS = this.lastUpdateT === null ? 0 : Math.max(0, (nowMs - this.lastUpdateT) / 1000)
    this.lastUpdateT = nowMs

    const cameraAgeMs = cam ? nowMs - cam.tMs : null
    const cameraStatus: CameraStatus = !cam ? 'off' : !cam.trackingValid ? 'lost' : cameraAgeMs! > cfg.cameraMaxAgeMs ? 'stale' : 'ok'
    const camOk = cameraStatus === 'ok'

    const wearableAgeMs = wear ? nowMs - wear.tMs : null
    const wearableStatus: WearableStatus = !wear
      ? 'off'
      : !wear.connected
        ? 'disconnected'
        : wearableAgeMs! > cfg.wearableMaxAgeMs
          ? 'stale'
          : wear.pointer?.frame !== 'canvas'
            ? 'uncalibrated'
            : 'ok'
    const wearOk = wearableStatus === 'ok'

    const wearRaw = wearOk ? { x: wear!.pointer!.x, y: wear!.pointer!.y } : null
    // Drift correction: only an integrated pointer drifts, and only trusted
    // camera evidence is allowed to pull it back.
    if (wearRaw && camOk && wear!.pointerIsIntegrated && this.mode !== 'CAMERA_FALLBACK') {
      const k = Math.min(1, cfg.driftCorrectionPerS * dtS)
      this.bias.x += k * (cam!.x - (wearRaw.x + this.bias.x))
      this.bias.y += k * (cam!.y - (wearRaw.y + this.bias.y))
    }
    const wearPt = wearRaw ? { x: wearRaw.x + this.bias.x, y: wearRaw.y + this.bias.y } : null
    const camPt = camOk ? { x: cam!.x, y: cam!.y } : null

    let raw: { x: number; y: number } | null = null
    let source: PointerSource = 'none'
    let weights = { camera: 0, wearable: 0 }
    let confidence = 0
    if (this.mode === 'WEARABLE_PRIMARY') {
      if (wearPt) [raw, source, weights, confidence] = [wearPt, 'wearable', { camera: 0, wearable: 1 }, wear!.sensorConfidence]
      else if (camPt) [raw, source, weights, confidence] = [camPt, 'camera', { camera: 1, wearable: 0 }, cam!.confidence]
    } else if (this.mode === 'FUSED') {
      if (wearPt && camPt) {
        const wc = Math.max(1e-3, cam!.confidence)
        const ww = Math.max(1e-3, wear!.sensorConfidence)
        const sum = wc + ww
        weights = { camera: wc / sum, wearable: ww / sum }
        raw = { x: camPt.x * weights.camera + wearPt.x * weights.wearable, y: camPt.y * weights.camera + wearPt.y * weights.wearable }
        source = 'fused'
        confidence = Math.max(cam!.confidence, wear!.sensorConfidence)
      } else if (camPt) [raw, source, weights, confidence] = [camPt, 'camera', { camera: 1, wearable: 0 }, cam!.confidence]
      else if (wearPt) [raw, source, weights, confidence] = [wearPt, 'wearable', { camera: 0, wearable: 1 }, wear!.sensorConfidence]
    } else if (camPt) {
      ;[raw, source, weights, confidence] = [camPt, 'camera', { camera: 1, wearable: 0 }, cam!.confidence]
    }

    const decay = Math.exp(-(dtS * 1000) / (cfg.handoffMs / 3))
    this.handoff.x *= decay
    this.handoff.y *= decay

    let estimate: PointerEstimate
    if (raw) {
      const recentlyValid = this.lastOut && nowMs - this.lastOut.tMs <= cfg.reacquireBlendMs
      if (source !== this.lastSource) {
        if (recentlyValid) {
          this.handoff = { x: this.lastOut!.x - raw.x, y: this.lastOut!.y - raw.y }
        } else {
          this.handoff = { x: 0, y: 0 }
          this.filter.reset()
        }
      }
      const blended = { x: raw.x + this.handoff.x, y: raw.y + this.handoff.y }
      const smooth = source === 'camera' && cam?.smoothed ? blended : this.filter.filter(blended.x, blended.y, nowMs)
      const x = clamp01(smooth.x)
      const y = clamp01(smooth.y)
      this.lastOut = { x, y, tMs: nowMs }
      const ages = [source !== 'wearable' ? cameraAgeMs : null, source !== 'camera' ? wearableAgeMs : null].filter((a): a is number => a !== null)
      estimate = {
        tMs: nowMs,
        x,
        y,
        valid: true,
        source,
        confidence,
        observationAgeMs: Math.min(...ages),
        captureTMs: source !== 'wearable' ? cam?.captureTMs : undefined,
      }
    } else {
      estimate = {
        tMs: nowMs,
        x: this.lastOut?.x ?? 0.5,
        y: this.lastOut?.y ?? 0.5,
        valid: false,
        source: 'none',
        confidence: 0,
        observationAgeMs: Infinity,
      }
    }
    this.lastSource = source

    this.diagnostics = {
      mode: this.mode,
      activeSource: source,
      cameraStatus,
      wearableStatus,
      cameraAgeMs,
      wearableAgeMs,
      handoffOffset: Math.hypot(this.handoff.x, this.handoff.y),
      wearableBias: { ...this.bias },
      weights,
    }
    return estimate
  }
}
