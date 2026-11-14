// Gesture timing and menu state for Reflex Actions. Pure: no DOM, no sensors.
//
//   IDLE → OBJECT_SELECTED → HOLDING → MENU_OPEN → ACTION_HIGHLIGHTED → (CONFIRMING) → CONFIRMED
//   plus CANCELLED, TRACKING_LOST, DEVICE_DISCONNECTED.
//
// A pinch that moves more than `holdMaxMove` before `holdMs` is a drag and is
// left entirely to the interaction engine. Once open, the object is frozen,
// pointer motion is ignored, and only rotation (or discrete keys) moves the
// highlight.

import { centerOf, WristRotationMapper, type MapperConfig } from './WristRotationMapper'
import { isMenuOpen, type RadialAction, type RadialActionEvent, type RadialMenuState, type RotationSourceKind, type SelectionSource } from './types'

export interface RadialConfig {
  holdMs: number
  /** Before this, a pinch shows as OBJECT_SELECTED only (no hold ring yet). */
  selectFeedbackMs: number
  /** Max pointer travel during the hold (canvas-height units, aspect-corrected). */
  holdMaxMove: number
  /** A camera release only confirms if the hand was tracked this long without a gap. */
  confirmGuardMs: number
  /**
   * After a camera release, wait this long: if the hand shows an open palm in that
   * window it was a cancel, not a release. Opening the palm always ends the pinch
   * first, so without this window an open-palm cancel would confirm.
   */
  openPalmWindowMs: number
  /** Menu open with no tracking for this long → cancelled. */
  lostCancelMs: number
  /** How long CONFIRMED / CANCELLED stay before IDLE. */
  transientMs: number
}

export const DEFAULT_RADIAL_CONFIG: RadialConfig = {
  holdMs: 600,
  selectFeedbackMs: 150,
  holdMaxMove: 0.025,
  confirmGuardMs: 250,
  openPalmWindowMs: 180,
  lostCancelMs: 2000,
  transientMs: 350,
}

export interface RotationInput {
  /** Current angle from the active source (absolute or integrated), degrees, clockwise positive. */
  angle: number
  source: RotationSourceKind
}

export interface RadialContext {
  tMs: number
  /** Canvas width / height. */
  aspect: number
  pointer: { x: number; y: number; valid: boolean }
  /** The interaction engine's grabbed object (a pinch or mouse button is down on it). */
  grabbedId: string | null
  /** null = no continuous rotation source; keys, wheel and clicks still work. */
  rotation: RotationInput | null
  /** The camera currently sees an open palm (instantaneous, no hold). */
  openPalm?: boolean
}

export type RadialOutput =
  | { kind: 'opened'; objectId: string; tMs: number }
  | { kind: 'confirmed'; event: RadialActionEvent }
  | { kind: 'cancelled'; reason: string; tMs: number }

export interface RadialTransition {
  tMs: number
  from: RadialMenuState['status']
  to: RadialMenuState['status']
  reason: string
}

export class RadialMenuController {
  config: RadialConfig
  readonly mapper: WristRotationMapper
  state: RadialMenuState = {
    status: 'IDLE',
    objectId: null,
    activeAction: 'explain',
    rotationDegrees: 0,
    inputSource: 'none',
    holdProgress: 0,
    openedAtMs: null,
  }
  transitions: RadialTransition[] = []
  /** Set while a camera release waits out the open-palm window. */
  pendingConfirmSince: number | null = null
  private holdStart: { tMs: number; x: number; y: number; objectId: string } | null = null
  private dragged = false
  private neutral = 0
  private lastSource: RotationSourceKind | null = null
  private lostSince: number | null = null
  private trackedSince: number | null = null
  private beforeLost: RadialMenuState['status'] | null = null
  private transientSince: number | null = null
  private nextId = 1
  private pendingSource: SelectionSource = 'none'

  constructor(config: Partial<RadialConfig> = {}, mapper: Partial<MapperConfig> = {}) {
    this.config = { ...DEFAULT_RADIAL_CONFIG, ...config }
    this.mapper = new WristRotationMapper(mapper)
  }

  /** When the current pinch started, while a hold is being watched. */
  get holdStartedAt() {
    return this.holdStart?.tMs ?? null
  }

  get neutralAngle() {
    return this.neutral
  }

  get isOpen() {
    return isMenuOpen(this.state.status)
  }

  /** Whether gestures should go to the menu instead of the interaction engine. */
  get capturesInput() {
    return this.isOpen
  }

  private go(to: RadialMenuState['status'], tMs: number, reason: string) {
    if (to === this.state.status) return
    this.transitions.push({ tMs, from: this.state.status, to, reason })
    if (this.transitions.length > 100) this.transitions.shift()
    this.state.status = to
    this.transientSince = to === 'CONFIRMED' || to === 'CANCELLED' ? tMs : null
  }

  private resetToIdle(tMs: number, reason: string) {
    this.holdStart = null
    this.state.objectId = null
    this.state.holdProgress = 0
    this.state.openedAtMs = null
    this.pendingConfirmSince = null
    this.lostSince = null
    this.beforeLost = null
    this.go('IDLE', tMs, reason)
  }

  /** Opened by a pointer hold: pointer loss then matters. A forced open (key, debug) has no pointer to lose. */
  private pointerBound = true

  private open(objectId: string, ctx: RadialContext, pointerBound = true): RadialOutput {
    this.pointerBound = pointerBound
    this.holdStart = null
    this.state.objectId = objectId
    this.state.openedAtMs = ctx.tMs
    this.state.holdProgress = 1
    this.state.activeAction = 'explain'
    this.state.inputSource = ctx.rotation?.source ?? 'none'
    this.mapper.reset('explain')
    this.neutral = ctx.rotation?.angle ?? 0
    this.lastSource = ctx.rotation?.source ?? null
    this.trackedSince = ctx.pointer.valid ? (this.trackedSince ?? ctx.tMs) : null
    this.go('MENU_OPEN', ctx.tMs, `hold ${this.config.holdMs}ms on ${objectId}`)
    return { kind: 'opened', objectId, tMs: ctx.tMs }
  }

  /** Open on an object without a hold (debug, keyboard). */
  forceOpen(objectId: string, ctx: RadialContext): RadialOutput | null {
    if (this.isOpen) return null
    return this.open(objectId, ctx, false)
  }

  /** Shift the neutral so the current reading sits in the middle of `action`'s sector. */
  private rebase(angle: number, action: RadialAction) {
    this.neutral = angle - centerOf(action, this.mapper.config) / (this.mapper.config.sensitivity * (this.mapper.config.invert ? -1 : 1))
    this.mapper.reset(action)
  }

  /** Make the current wrist position the neutral (Explain). */
  recenter(ctx: RadialContext) {
    if (!this.isOpen) return
    this.neutral = ctx.rotation?.angle ?? 0
    this.mapper.reset('explain')
    this.state.activeAction = 'explain'
  }

  update(ctx: RadialContext): RadialOutput[] {
    const out: RadialOutput[] = []
    const t = ctx.tMs
    const s = this.state

    if (ctx.pointer.valid) this.trackedSince ??= t
    else this.trackedSince = null

    if ((s.status === 'CONFIRMED' || s.status === 'CANCELLED') && this.transientSince !== null) {
      if (t - this.transientSince >= this.config.transientMs) this.resetToIdle(t, 'settled')
      else return out
    }

    // ---- before the menu: watch the engine's grab for a steady hold --------------------
    if (!this.isOpen) {
      if (!ctx.grabbedId || !ctx.pointer.valid) {
        this.dragged = false
        if (s.status !== 'IDLE') this.resetToIdle(t, ctx.grabbedId ? 'tracking lost during hold' : 'released before hold')
        this.holdStart = null
        return out
      }
      if (this.dragged) return out
      if (!this.holdStart || this.holdStart.objectId !== ctx.grabbedId) {
        this.holdStart = { tMs: t, x: ctx.pointer.x, y: ctx.pointer.y, objectId: ctx.grabbedId }
        s.objectId = ctx.grabbedId
        this.go('OBJECT_SELECTED', t, `pinch on ${ctx.grabbedId}`)
        return out
      }
      const moved = Math.hypot((ctx.pointer.x - this.holdStart.x) * ctx.aspect, ctx.pointer.y - this.holdStart.y)
      if (moved > this.config.holdMaxMove) {
        this.dragged = true
        this.resetToIdle(t, 'moved: drag, not hold')
        return out
      }
      const held = t - this.holdStart.tMs
      const { holdMs, selectFeedbackMs } = this.config
      if (held >= holdMs) {
        out.push(this.open(this.holdStart.objectId, ctx))
        return out
      }
      if (held >= selectFeedbackMs) {
        s.holdProgress = (held - selectFeedbackMs) / (holdMs - selectFeedbackMs)
        this.go('HOLDING', t, 'holding still')
      }
      return out
    }

    // ---- menu open -----------------------------------------------------------------------
    if (!ctx.pointer.valid && this.pointerBound) {
      if (s.status !== 'TRACKING_LOST') {
        this.beforeLost = s.status === 'CONFIRMING' ? 'ACTION_HIGHLIGHTED' : s.status
        this.lostSince = t
        this.pendingConfirmSince = null
        this.go('TRACKING_LOST', t, 'pointer lost: menu held, no confirmation')
      } else if (this.lostSince !== null && t - this.lostSince >= this.config.lostCancelMs) {
        this.go('CANCELLED', t, `tracking lost > ${this.config.lostCancelMs}ms`)
        out.push({ kind: 'cancelled', reason: 'tracking lost', tMs: t })
      }
      return out
    }
    if (s.status === 'TRACKING_LOST') {
      this.lostSince = null
      this.go(this.beforeLost ?? 'ACTION_HIGHLIGHTED', t, 'tracking restored')
    }

    // Rotation source changes: never let the highlight jump; flag a lost band.
    const src = ctx.rotation?.source ?? null
    if (src !== this.lastSource) {
      if (ctx.rotation) this.rebase(ctx.rotation.angle, s.activeAction)
      if (this.lastSource === 'vexo' && src !== 'vexo') this.go('DEVICE_DISCONNECTED', t, `band rotation lost; fallback: ${src ?? 'keys only'}`)
      else if (src === 'vexo' && s.status === 'DEVICE_DISCONNECTED') this.go('ACTION_HIGHLIGHTED', t, 'band rotation back')
      this.lastSource = src
    }

    if (ctx.rotation) {
      const changed = this.mapper.update(ctx.rotation.angle - this.neutral, t)
      s.rotationDegrees = this.mapper.angle
      if (changed) {
        s.activeAction = this.mapper.action
        s.inputSource = ctx.rotation.source
      }
    }
    if (s.status === 'MENU_OPEN') this.go('ACTION_HIGHLIGHTED', t, `highlight ${s.activeAction}`)

    if (this.pendingConfirmSince !== null) {
      if (ctx.openPalm) {
        this.pendingConfirmSince = null
        this.go('CANCELLED', t, 'open palm after release')
        out.push({ kind: 'cancelled', reason: 'open palm', tMs: t })
      } else if (t - this.pendingConfirmSince >= this.config.openPalmWindowMs) {
        this.pendingConfirmSince = null
        out.push(this.confirm(t, this.pendingSource))
      }
    }
    return out
  }

  private confirm(tMs: number, source: SelectionSource): RadialOutput {
    const event: RadialActionEvent = {
      id: this.nextId++,
      action: this.state.activeAction,
      objectId: this.state.objectId!,
      tMs,
      selectionSource: source === 'none' ? this.state.inputSource : source,
    }
    this.go('CONFIRMED', tMs, `confirm ${event.action}`)
    return { kind: 'confirmed', event }
  }

  /**
   * The pinch (or mouse button) was released. `byCamera` releases need steady
   * tracking and survive the open-palm window; others confirm at once.
   * Returns a confirmation only when one happens now.
   */
  release(tMs: number, byCamera: boolean): RadialOutput | null {
    const s = this.state.status
    if (s === 'TRACKING_LOST') {
      this.go('CANCELLED', tMs, 'release while tracking lost')
      return { kind: 'cancelled', reason: 'release while tracking lost', tMs }
    }
    if (!(s === 'MENU_OPEN' || s === 'ACTION_HIGHLIGHTED' || s === 'DEVICE_DISCONNECTED')) return null
    if (this.pendingConfirmSince !== null) return null
    if (byCamera) {
      if (this.trackedSince === null || tMs - this.trackedSince < this.config.confirmGuardMs) {
        this.go('CANCELLED', tMs, 'release right after tracking resumed: not confirmed')
        return { kind: 'cancelled', reason: 'unsteady tracking', tMs }
      }
      this.pendingConfirmSince = tMs
      this.pendingSource = 'none'
      this.go('CONFIRMING', tMs, 'release: checking for open palm')
      return null
    }
    return this.confirm(tMs, 'none')
  }

  cancel(tMs: number, reason: string): RadialOutput | null {
    if (!this.isOpen && this.state.status !== 'HOLDING' && this.state.status !== 'OBJECT_SELECTED') return null
    const wasOpen = this.isOpen
    this.pendingConfirmSince = null
    this.holdStart = null
    this.dragged = true // the pinch that was cancelled must not reopen the menu
    this.go('CANCELLED', tMs, reason)
    return wasOpen ? { kind: 'cancelled', reason, tMs } : null
  }

  /** Arrow keys / wheel: one sector at a time; rotation then continues from there. */
  step(dir: -1 | 1, source: SelectionSource, rotationAngle: number | null) {
    if (!this.isOpen || this.state.status === 'CONFIRMING') return
    const a = this.mapper.step(dir)
    this.state.activeAction = a
    this.state.inputSource = source
    if (rotationAngle !== null) this.rebase(rotationAngle, a)
  }

  /** Click / tap on a sector: select it and confirm. */
  choose(action: RadialAction, tMs: number, source: SelectionSource): RadialOutput | null {
    if (!this.isOpen || this.state.status === 'CONFIRMING' || this.state.status === 'TRACKING_LOST') return null
    this.state.activeAction = action
    this.state.inputSource = source
    this.mapper.force(action)
    return this.confirm(tMs, source)
  }
}
