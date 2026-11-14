import type { GestureEvent } from '../types'
import type { HandFeatures } from './handGeometry'

export interface GestureConfig {
  /** Pinch engages below this thumb–index / palm-width ratio… */
  pinchOn: number
  /** …and releases only above this one (hysteresis band in between). */
  pinchOff: number
  /** Consecutive frames a new pinch/point state must hold before it counts. */
  minFrames: number
  /** How long an open palm must be held to count as cancel. */
  openPalmHoldMs: number
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  pinchOn: 0.35,
  pinchOff: 0.55,
  minFrames: 2,
  openPalmHoldMs: 350,
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/**
 * Turns per-frame hand features into discrete gesture events. When tracking
 * is invalid or the key landmarks leave the image, no transitions are
 * emitted at all: an engaged pinch stays engaged until the hand is seen
 * again and visibly opens, so losing the hand can never drop an object.
 */
export class GestureDetector {
  mode: 'pinch' | 'grasp' = 'pinch'
  grasped = false
  get engaged() { return this.mode === 'grasp' ? this.grasped : this.pinched }
  private graspCandidate: number | null = null
  private graspFrames = 0
  private lastGraspFrame = -Infinity
  config: GestureConfig
  pinched = false
  pointing = false
  private pinchCandidateFrames = 0
  private pointCandidateFrames = 0
  private openPalmSince: number | null = null
  private openPalmFired = false

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_GESTURE_CONFIG, ...config }
  }

  update(features: HandFeatures | null, tMs: number, sensorConfidence: number): GestureEvent[] {
    if (!features || !features.keyInFrame) {
      this.pinchCandidateFrames = 0
      this.pointCandidateFrames = 0
      this.openPalmSince = null
      this.graspCandidate = null
      this.graspFrames = 0
      return []
    }
    const { pinchOn, pinchOff, minFrames, openPalmHoldMs } = this.config
    const out: GestureEvent[] = []
    const emit = (kind: GestureEvent['kind'], classificationConfidence: number) =>
      out.push({ tMs, kind, source: 'camera', classificationConfidence, sensorConfidence })

    if (this.mode === 'grasp') {
      if (tMs - this.lastGraspFrame > 180) { this.graspCandidate = null; this.graspFrames = 0 }
      this.lastGraspFrame = tMs
      const fingers = Object.values(features.fingers)
      const curled = fingers.filter((f) => f === 'curled').length
      const extended = fingers.filter((f) => f === 'extended').length
      // A full fist engages. Opening at least two fingers releases. The band
      // between those poses holds state rather than flickering while moving.
      const wantsToggle = this.grasped ? extended >= 2 : curled === 4
      if (wantsToggle && sensorConfidence >= 0.6) {
        this.graspCandidate ??= tMs
        this.graspFrames++
        if (this.graspFrames >= 3 && tMs - this.graspCandidate >= (this.grasped ? 90 : 120)) {
          this.grasped = !this.grasped
          this.graspCandidate = null
          this.graspFrames = 0
          emit(this.grasped ? 'grasp_start' : 'grasp_end', 0.9)
        }
      } else { this.graspCandidate = null; this.graspFrames = 0 }
      return out
    }

    const r = features.pinchRatio
    const wantsToggle = this.pinched ? r > pinchOff : r < pinchOn
    this.pinchCandidateFrames = wantsToggle ? this.pinchCandidateFrames + 1 : 0
    if (this.pinchCandidateFrames >= minFrames) {
      this.pinched = !this.pinched
      this.pinchCandidateFrames = 0
      if (this.pinched) emit('pinch_start', clamp01((pinchOn - r) / pinchOn + 0.5))
      else emit('pinch_end', clamp01((r - pinchOff) / pinchOff + 0.5))
    }

    const pointToggle = features.pointing !== this.pointing
    this.pointCandidateFrames = pointToggle ? this.pointCandidateFrames + 1 : 0
    if (this.pointCandidateFrames >= minFrames + 1) {
      this.pointing = features.pointing
      this.pointCandidateFrames = 0
      emit(this.pointing ? 'point_start' : 'point_end', 0.8)
    }

    if (features.openPalm && !this.pinched) {
      this.openPalmSince ??= tMs
      if (!this.openPalmFired && tMs - this.openPalmSince >= openPalmHoldMs) {
        this.openPalmFired = true
        emit('open_palm', 0.8)
      }
    } else {
      this.openPalmSince = null
      this.openPalmFired = false
    }
    return out
  }

  reset() {
    this.grasped = false
    this.graspCandidate = null
    this.graspFrames = 0
    this.lastGraspFrame = -Infinity
    this.pinched = false
    this.pointing = false
    this.pinchCandidateFrames = 0
    this.pointCandidateFrames = 0
    this.openPalmSince = null
    this.openPalmFired = false
  }
}
