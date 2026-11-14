import { ACTION_ORDER, type RadialAction } from './types'

export interface MapperConfig {
  /** |angle| below this reads as 0 (absorbs tremor and slow drift). */
  deadZoneDeg: number
  /** Clockwise beyond +threshold → Remember; counter-clockwise beyond −threshold → Voice. */
  thresholdDeg: number
  /** Leaving an outer sector needs the angle to come back this far inside the threshold. */
  hysteresisDeg: number
  /** Exponential smoothing time constant; 0 = off. */
  smoothingMs: number
  sensitivity: number
  invert: boolean
  /** A new sector must hold this long before the highlight moves. */
  stableMs: number
  /** Angles beyond this are clamped: three fixed positions, never a spinning wheel. */
  maxDeg: number
}

export const DEFAULT_MAPPER_CONFIG: MapperConfig = {
  deadZoneDeg: 6,
  thresholdDeg: 25,
  hysteresisDeg: 6,
  smoothingMs: 60,
  sensitivity: 1,
  invert: false,
  stableMs: 120,
  maxDeg: 75,
}

/** The angle that sits in the middle of each sector, used to rebase without a jump. */
export const centerOf = (a: RadialAction, cfg: MapperConfig) =>
  a === 'explain' ? 0 : (a === 'remember' ? 1 : -1) * Math.min(cfg.maxDeg, cfg.thresholdDeg + 15)

export class WristRotationMapper {
  config: MapperConfig
  action: RadialAction = 'explain'
  /** Smoothed, clamped, dead-zoned angle (what the orientation indicator shows). */
  angle = 0
  private smoothed: number | null = null
  private lastT: number | null = null
  private candidate: RadialAction | null = null
  private candidateSince = 0

  constructor(config: Partial<MapperConfig> = {}) {
    this.config = { ...DEFAULT_MAPPER_CONFIG, ...config }
  }

  reset(action: RadialAction = 'explain') {
    this.action = action
    this.angle = 0
    this.smoothed = null
    this.lastT = null
    this.candidate = null
  }

  /** The sector an angle belongs in, given the sector we are in now (hysteresis). */
  classify(a: number, current: RadialAction): RadialAction {
    const { thresholdDeg: th, hysteresisDeg: h } = this.config
    if (a >= th) return 'remember'
    if (a <= -th) return 'voice'
    if (current === 'remember' && a > th - h) return 'remember'
    if (current === 'voice' && a < -(th - h)) return 'voice'
    return 'explain'
  }

  /** Feed a relative angle (deg, clockwise positive). Returns true if the highlight moved. */
  update(rawDeg: number, tMs: number): boolean {
    const c = this.config
    let a = rawDeg * c.sensitivity * (c.invert ? -1 : 1)
    a = Math.max(-c.maxDeg, Math.min(c.maxDeg, a))
    if (this.smoothed === null || this.lastT === null || c.smoothingMs <= 0) this.smoothed = a
    else {
      const k = 1 - Math.exp(-Math.max(0, tMs - this.lastT) / c.smoothingMs)
      this.smoothed += k * (a - this.smoothed)
    }
    this.lastT = tMs
    this.angle = Math.abs(this.smoothed) < c.deadZoneDeg ? 0 : this.smoothed

    const target = this.classify(this.angle, this.action)
    if (target === this.action) {
      this.candidate = null
      return false
    }
    if (this.candidate !== target) {
      this.candidate = target
      this.candidateSince = tMs
    }
    if (tMs - this.candidateSince >= c.stableMs) {
      this.action = target
      this.candidate = null
      return true
    }
    return false
  }

  /** Discrete inputs (arrow keys, wheel, click) move one step, immediately. */
  step(dir: -1 | 1): RadialAction {
    const i = ACTION_ORDER.indexOf(this.action)
    this.action = ACTION_ORDER[Math.max(0, Math.min(ACTION_ORDER.length - 1, i + dir))]
    this.candidate = null
    return this.action
  }

  force(action: RadialAction) {
    this.action = action
    this.candidate = null
  }
}
