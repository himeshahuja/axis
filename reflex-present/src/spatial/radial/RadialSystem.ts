// Wires the radial menu into the spatial runtime: picks the rotation source,
// runs the controller each frame, routes gestures while the menu is open,
// executes confirmed actions, and owns the band connection + gyro calibration.

import type { HandFeatures } from '../camera/handGeometry'
import type { GestureEvent, PointerEstimate, SpatialObject } from '../types'
import { BAND_NUMBER } from '../wearable/band'
import { VexoBandAdapter, type BandLink } from '../wearable/vexoBandAdapter'
import { LocalMemoryStore } from './actions/memory'
import { BandDeepgramProvider, BandGeminiProvider, BrowserSpeechProvider, TypedProvider, type VoiceProvider } from './actions/voice'
import { RadialActionExecutor } from './RadialActionExecutor'
import { RadialMenuController, type RadialContext, type RadialOutput } from './RadialMenuController'
import {
  detectTwistAxis,
  estimateBias,
  loadGyroCalibration,
  saveGyroCalibration,
  type BiasEstimate,
  type GyroCalibration,
  type GyroSample,
} from './RotationCalibration'
import { CameraTiltRotation, pickRotation, SimulatorRotation, VexoGyroRotation, type ActiveRotation } from './rotationSources'
import type { RadialAction } from './types'

export type GyroCalibrationStep =
  | { phase: 'idle' }
  | { phase: 'still'; untilMs: number; samples: GyroSample[] }
  | { phase: 'twist'; untilMs: number; samples: GyroSample[]; bias: BiasEstimate }
  | { phase: 'done'; cal: GyroCalibration }
  | { phase: 'failed'; message: string }

const STILL_MS = 2000
const TWIST_MS = 4000

export interface RadialTimings {
  pinchMs: number | null
  openedMs: number | null
  releaseMs: number | null
  confirmedMs: number | null
  resultMs: number | null
}

export class RadialSystem {
  readonly controller = new RadialMenuController()
  readonly vexo = new VexoGyroRotation()
  readonly camera = new CameraTiltRotation()
  readonly simulator = new SimulatorRotation()
  readonly executor: RadialActionExecutor
  readonly voiceProviders: VoiceProvider[]
  band: VexoBandAdapter | null = null
  gyroCalibration: GyroCalibrationStep = { phase: 'idle' }
  active: ActiveRotation | null = null
  timings: RadialTimings = { pinchMs: null, openedMs: null, releaseMs: null, confirmedMs: null, resultMs: null }
  private lastCtx: RadialContext | null = null
  private lastWheelMs = 0
  private unsubBand: (() => void) | null = null
  private objects: () => SpatialObject[]
  private notify: () => void
  private onOpened: (tMs: number) => void

  constructor(objects: () => SpatialObject[], notify: () => void, onOpened: (tMs: number) => void) {
    this.objects = objects
    this.notify = notify
    this.onOpened = onOpened
    this.executor = new RadialActionExecutor(new LocalMemoryStore(), notify)
    this.vexo.setCalibration(loadGyroCalibration(BAND_NUMBER))
    // The band's microphone → Gemini comes first: Voice uses the band by default.
    this.voiceProviders = [new BandGeminiProvider(() => this.band, notify), new BandDeepgramProvider(() => this.band), new BrowserSpeechProvider(), new TypedProvider()]
  }

  get state() {
    return this.controller.state
  }

  get capturesInput() {
    return this.controller.capturesInput
  }

  // ---- band -----------------------------------------------------------------------------
  /** Call from a click handler. */
  connectBand(link: BandLink) {
    this.disconnectBand()
    const adapter = new VexoBandAdapter(link, () => {
      this.vexo.connected = adapter.connected
      this.notify()
    })
    this.band = adapter
    this.unsubBand = adapter.subscribe((o) => {
      if (!o.angularVelocity || o.deviceTMs === undefined) return
      const s: GyroSample = { x: o.angularVelocity.x, y: o.angularVelocity.y, z: o.angularVelocity.z, deviceTMs: o.deviceTMs }
      this.vexo.feed(s, performance.now())
      const c = this.gyroCalibration
      if (c.phase === 'still' || c.phase === 'twist') c.samples.push(s)
    })
    void adapter.start()
  }

  disconnectBand() {
    this.unsubBand?.()
    this.unsubBand = null
    this.band?.stop()
    this.band = null
    this.vexo.connected = false
  }

  // ---- gyro calibration -----------------------------------------------------------------
  startGyroCalibration() {
    if (!this.vexo.streaming(performance.now())) {
      this.gyroCalibration = { phase: 'failed', message: `No gyro data from band ${BAND_NUMBER}: connect it first.` }
      return this.notify()
    }
    this.gyroCalibration = { phase: 'still', untilMs: performance.now() + STILL_MS, samples: [] }
    this.notify()
  }

  clearGyroCalibration() {
    this.vexo.setCalibration(null)
    try {
      localStorage.removeItem(`reflex.radial.gyro-calibration.v1:band${BAND_NUMBER}`)
    } catch {
      // nothing stored
    }
    this.gyroCalibration = { phase: 'idle' }
    this.notify()
  }

  /** Debug, pretend band only: play a doorknob twist on its gyro (clockwise first). */
  pretendTwist(axis: 'gx' | 'gy' | 'gz' = 'gz', peakDps = 150) {
    this.band?.sim?.playMotion((s) => ({ [axis]: peakDps * Math.sin((2 * Math.PI * s) / 1.2) }), { seconds: 3.6 })
  }

  private stepGyroCalibration(now: number) {
    const c = this.gyroCalibration
    if (c.phase === 'still' && now >= c.untilMs) {
      const est = estimateBias(c.samples)
      if (!est) this.gyroCalibration = { phase: 'failed', message: 'Too few gyro samples arrived while holding still.' }
      else if (!est.still) this.gyroCalibration = { phase: 'failed', message: `The band moved while it should be still (noise ${est.noiseDps.toFixed(1)}°/s). Try again, arm resting.` }
      else this.gyroCalibration = { phase: 'twist', untilMs: now + TWIST_MS, samples: [], bias: est }
    } else if (c.phase === 'twist' && now >= c.untilMs) {
      const axis = detectTwistAxis(c.samples, c.bias.bias)
      if (!axis) this.gyroCalibration = { phase: 'failed', message: 'No clear twist seen. Turn the wrist like a doorknob, clockwise first, at least 20°.' }
      else {
        const cal: GyroCalibration = { version: 1, ...axis, bias: c.bias.bias, noiseDps: c.bias.noiseDps, calibratedAt: Date.now() }
        this.vexo.setCalibration(cal)
        saveGyroCalibration(BAND_NUMBER, cal)
        this.gyroCalibration = { phase: 'done', cal }
      }
    }
  }

  // ---- per frame ------------------------------------------------------------------------
  tick(now: number, p: { pointer: PointerEstimate; grabbedId: string | null; aspect: number; features: HandFeatures | null; mirrored: boolean; graspMode?: boolean }) {
    this.stepGyroCalibration(now)
    if (p.features) this.camera.feed(p.features.handRollDeg, p.mirrored, now)
    else this.camera.lost()

    const prev = this.active?.source ?? null
    const vexoBefore = prev === 'vexo'
    let active = pickRotation(now, this.simulator, this.vexo, this.camera, this.controller.neutralAngle)
    if (active?.source === 'vexo' && !vexoBefore && this.controller.isOpen) {
      // The band is (back) in charge mid-menu: restart integration from here.
      this.vexo.begin()
      active = pickRotation(now, this.simulator, this.vexo, this.camera, this.controller.neutralAngle)
    }
    this.active = active

    const ctx: RadialContext = {
      tMs: now,
      aspect: p.aspect,
      pointer: { x: p.pointer.x, y: p.pointer.y, valid: p.pointer.valid },
      grabbedId: p.grabbedId,
      rotation: active ? { angle: active.angle, source: active.source } : null,
      openPalm: !p.graspMode && (p.features?.openPalm ?? false),
    }
    this.lastCtx = ctx
    const before = this.controller.state.status
    const outputs = this.controller.update(ctx)
    if (before === 'IDLE' && this.controller.state.status === 'OBJECT_SELECTED') {
      this.timings = { pinchMs: now, openedMs: null, releaseMs: null, confirmedMs: null, resultMs: null }
    }
    this.handle(outputs)
  }

  private handle(outputs: (RadialOutput | null)[]) {
    for (const o of outputs) {
      if (!o) continue
      if (o.kind === 'opened') {
        // The band's integration window starts with the menu, so drift stays small.
        if (this.active?.source === 'vexo') {
          this.vexo.begin()
          if (this.lastCtx) this.controller.recenter({ ...this.lastCtx, rotation: { angle: this.vexo.angle(), source: 'vexo' } })
        }
        this.timings.openedMs = o.tMs
        this.onOpened(o.tMs)
      } else if (o.kind === 'confirmed') {
        this.timings.confirmedMs = o.event.tMs
        this.executor.execute(o.event, this.objects())
        this.timings.resultMs = this.executor.last?.resultAtMs ?? null
      }
    }
    this.notify()
  }

  /** Gestures while the menu is open (the runtime routes them here instead of the engine). */
  onGesture(g: GestureEvent) {
    const c = this.controller
    if (g.kind === 'pinch_end' || g.kind === 'grasp_end' || g.kind === 'select') {
      this.timings.releaseMs = g.tMs
      this.handle([c.release(g.tMs, g.source === 'camera')])
    } else if (g.kind === 'cancel' || g.kind === 'open_palm') {
      this.handle([c.cancel(g.tMs, `${g.kind} (${g.source})`)])
    } else if (g.kind === 'recenter' && this.lastCtx) {
      c.recenter(this.lastCtx)
    }
  }

  // ---- discrete / debug inputs -------------------------------------------------------------
  step(dir: -1 | 1, source: 'keyboard' | 'wheel') {
    this.controller.step(dir, source, this.active?.angle ?? null)
    this.notify()
  }

  wheel(deltaY: number) {
    const now = performance.now()
    if (!this.capturesInput || Math.abs(deltaY) < 4 || now - this.lastWheelMs < 180) return
    this.lastWheelMs = now
    this.step(deltaY > 0 ? 1 : -1, 'wheel')
  }

  choose(action: RadialAction) {
    this.timings.releaseMs = performance.now()
    this.handle([this.controller.choose(action, performance.now(), 'click')])
  }

  /** Close the open menu without running anything (the menu's centre, Esc). */
  cancel(reason = 'cancelled from the menu') {
    this.handle([this.controller.cancel(performance.now(), reason)])
  }

  recenter() {
    if (this.active?.source === 'vexo') this.vexo.begin()
    if (this.lastCtx) this.controller.recenter({ ...this.lastCtx, rotation: this.active ? { angle: this.active.source === 'vexo' ? this.vexo.angle() : this.active.angle, source: this.active.source } : null })
    this.notify()
  }

  forceOpen(objectId: string) {
    const tMs = performance.now()
    const ctx: RadialContext = this.lastCtx
      ? { ...this.lastCtx, tMs }
      : { tMs, aspect: 16 / 9, pointer: { x: 0.5, y: 0.5, valid: false }, grabbedId: null, rotation: this.active ? { angle: this.active.angle, source: this.active.source } : null }
    this.timings = { pinchMs: null, openedMs: null, releaseMs: null, confirmedMs: null, resultMs: null }
    this.handle([this.controller.forceOpen(objectId, ctx)])
  }

  /** Debug: a release that did not come from a sensor. */
  simulateRelease() {
    this.onGesture({ tMs: performance.now(), kind: 'pinch_end', source: 'mouse', classificationConfidence: 1, sensorConfidence: 1 })
  }
}
