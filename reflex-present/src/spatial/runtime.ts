import { useSyncExternalStore } from 'react'
import {
  CALIBRATION_TARGETS,
  cameraToCanvas,
  fitAffine,
  loadProfile,
  orient,
  recenter,
  regionFromCorners,
  saveProfile,
  type CalibrationProfile,
} from './calibration'
import { GestureDetector } from './camera/gestureDetector'
import type { HandFeatures } from './camera/handGeometry'
import { HandTracker, type TrackerFrame } from './camera/handTracker'
import { SensorFusion, type CalibratedCameraPointer } from './fusion'
import { InteractionEngine } from './interaction'
import type {
  CalibrationSample,
  CameraObservation,
  GestureEvent,
  InteractionEvent,
  Point2,
  PointerEstimate,
  PointerSource,
  SensorFusionMode,
  SpatialObject,
  WearableObservation,
} from './types'
import { RadialSystem } from './radial/RadialSystem'
import type { WearableAdapter } from './wearable/adapter'
import { MockWearableAdapter } from './wearable/mockWearable'
import { SteadyPoint } from './steadyPoint'
import { GraspCursor } from './graspCursor'

class Rolling {
  private v: number[] = []
  private max: number
  constructor(max = 300) {
    this.max = max
  }
  push(x: number) {
    this.v.push(x)
    if (this.v.length > this.max) this.v.shift()
  }
  stats() {
    if (!this.v.length) return null
    const s = [...this.v].sort((a, b) => a - b)
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
    return { n: s.length, p50: q(0.5), p95: q(0.95), last: this.v[this.v.length - 1] }
  }
  clear() {
    this.v = []
  }
}

export type CalibrationStep =
  | { kind: 'none' }
  | { kind: 'region'; corners: Point2[] }
  | { kind: 'points'; index: number; samples: CalibrationSample[] }

export interface AccuracyResult {
  target: Point2
  pointer: Point2
  /** Aspect-corrected error in canvas-height units. */
  errorCanvas: number
  errorPx: number
  source: PointerSource
}

export const ACCURACY_TARGETS: Point2[] = [0.15, 0.5, 0.85].flatMap((y) => [0.15, 0.5, 0.85].map((x) => ({ x, y })))

const CALIBRATION_HOLD_MS = 300

export class SpatialRuntime {
  readonly tracker: HandTracker
  readonly detector = new GestureDetector()
  readonly fusion = new SensorFusion('CAMERA_FALLBACK')
  readonly interaction: InteractionEngine
  profile: CalibrationProfile
  wearable: WearableAdapter | null = null
  latestCamera: CameraObservation | null = null
  latestFeatures: HandFeatures | null = null
  latestWearable: WearableObservation | null = null
  pointer: PointerEstimate = { tMs: 0, x: 0.5, y: 0.5, valid: false, source: 'none', confidence: 0, observationAgeMs: Infinity }
  gestureLog: GestureEvent[] = []
  anchor: 'palm' | 'indexTip' = 'palm'
  mouseFallback = true
  calibration: CalibrationStep = { kind: 'none' }
  accuracy = { active: false, index: 0, results: [] as AccuracyResult[] }
  notice: { text: string; tMs: number } | null = null
  canvasPx = { w: 1920, h: 1080 }
  readonly latency = {
    detect: new Rolling(),
    captureToPointer: new Rolling(),
    captureToPaint: new Rolling(),
  }

  private rawHistory: { tMs: number; p: Point2 }[] = []
  private rangeHold = new SteadyPoint()
  private graspCursor = new GraspCursor()
  private stabilizedCamera: { frameId: number; point: Point2 } | null = null
  autoRangeCapture = false
  onControlSelect: ((pointer: PointerEstimate) => boolean) | null = null
  get calibrationProgress() { return this.rangeHold.progress }
  /** Unmapped camera position, so a bad saved range cannot hide calibration. */
  get calibrationPointer(): Point2 | null {
    if (!this.latestFeatures || !this.latestCamera || performance.now() - this.latestCamera.tMs > 180) return null
    return orient(this.anchor === 'palm' ? this.latestFeatures.palm : this.latestFeatures.indexTip, this.profile)
  }
  /** Gestures since the last tick; `at` pins a gesture to where the pointer was when it happened. */
  private pending: { g: GestureEvent; at?: Point2 }[] = []
  private mouse: { x: number; y: number; tMs: number } | null = null
  /** A held button keeps the mouse in charge (a still, held mouse is not "lost"). */
  private mouseDown = false
  private unsubWearable: (() => void) | null = null
  private lastConsumedFrame = 0
  private paintBase: number | null = null
  private raf: number | null = null
  private version = 0
  private listeners = new Set<() => void>()

  readonly radial: RadialSystem

  constructor(objects: SpatialObject[]) {
    this.interaction = new InteractionEngine(objects)
    this.radial = new RadialSystem(
      () => this.interaction.objects,
      () => this.notify(),
      (tMs) => this.interaction.yieldGrab(tMs, 'radial menu opened'),
    )
    this.profile = loadProfile('default')
    this.tracker = new HandTracker(
      (f) => this.onCameraFrame(f),
      () => this.notify(),
    )
  }

  // ---- lifecycle ----------------------------------------------------------
  start() {
    const loop = () => {
      this.tick(performance.now())
      this.raf = requestAnimationFrame(loop)
    }
    this.raf ??= requestAnimationFrame(loop)
  }

  dispose() {
    if (this.raf !== null) cancelAnimationFrame(this.raf)
    this.raf = null
    this.tracker.stop()
    this.setWearable(null)
    this.radial.disconnectBand()
  }

  async startCamera() {
    const loadCameraProfile = this.tracker.status !== 'running'
    await this.tracker.start()
    if (loadCameraProfile && this.tracker.status === 'running') this.profile = loadProfile(this.tracker.deviceKey)
    this.notify()
  }

  stopCamera() {
    this.graspCursor.reset()
    this.stabilizedCamera = null
    this.tracker.stop()
    this.latestCamera = null
    this.latestFeatures = null
    this.notify()
  }

  setWearable(adapter: WearableAdapter | null) {
    this.unsubWearable?.()
    this.wearable?.stop()
    this.wearable = adapter
    this.latestWearable = null
    this.unsubWearable = adapter?.subscribe((o) => this.onWearable(o)) ?? null
    void adapter?.start()
    this.fusion.resetWearableBias()
    this.notify()
  }

  get mockWearable() {
    return this.wearable instanceof MockWearableAdapter ? this.wearable : null
  }

  setMode(m: SensorFusionMode) {
    this.fusion.mode = m
    this.notify()
  }

  setMouseFallback(on: boolean) {
    this.mouseFallback = on
    if (!on) this.mouse = null
  }

  setAnchor(a: 'palm' | 'indexTip') {
    this.graspCursor.reset()
    this.stabilizedCamera = null
    this.anchor = a
    this.rawHistory = []
  }

  setGestureConfig(patch: Partial<GestureDetector['config']>) {
    Object.assign(this.detector.config, patch)
  }

  clearAccuracy() {
    this.accuracy = { active: false, index: 0, results: [] }
  }

  setCanvasSize(w: number, h: number) {
    this.canvasPx = { w, h }
    this.interaction.aspect = w / Math.max(1, h)
  }

  setObjects(objects: SpatialObject[]) {
    this.interaction.resetObjects(objects)
    this.notify()
  }

  // ---- subscription -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getVersion = () => this.version
  private notify() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  private say(text: string) {
    this.notice = { text, tMs: performance.now() }
  }

  // ---- inputs ---------------------------------------------------------------
  private onCameraFrame({ observation, features }: TrackerFrame) {
    this.latestCamera = observation
    this.latestFeatures = features
    if (observation.detectMs !== undefined) this.latency.detect.push(observation.detectMs)
    const anchor = features ? (this.anchor === 'palm' ? features.palm : features.indexTip) : null
    if (anchor) {
      this.rawHistory.push({ tMs: observation.tMs, p: anchor })
      while (this.rawHistory.length && observation.tMs - this.rawHistory[0].tMs > 1000) this.rawHistory.shift()
    }
    for (const g of this.detector.update(features, observation.tMs, observation.sensorConfidence)) this.queue(g)
    if (features && this.detector.mode === 'grasp' && this.anchor === 'palm' && this.calibration.kind === 'none' && features.keyInFrame) {
      const fingers = Object.values(features.fingers)
      const curled = fingers.filter((f) => f === 'curled').length
      const extended = fingers.filter((f) => f === 'extended').length
      const changing = this.detector.grasped ? extended >= 1 : curled >= 1 || extended < 4
      const wrist = observation.landmarks[0] ?? features.palm
      this.stabilizedCamera = { frameId: observation.frameId, point: this.graspCursor.update(cameraToCanvas(features.palm, this.profile), cameraToCanvas(wrist, this.profile), observation.tMs, this.detector.grasped, changing, this.canvasPx) }
    } else {
      this.graspCursor.reset()
      this.stabilizedCamera = null
    }
    if (this.autoRangeCapture && this.calibration.kind === 'region') {
      const first = this.calibration.corners[0]
      const a = first ? orient(first, this.profile) : null
      const b = anchor ? orient(anchor, this.profile) : null
      // The second corner must be down and right, not another sample of the first.
      const eligible = !a || (b && b.x - a.x >= 0.08 && b.y - a.y >= 0.08)
      const steady = this.rangeHold.update(features?.keyInFrame && eligible ? anchor : null, observation.tMs)
      if (steady) this.captureCalibration(steady)
    }
  }

  private onWearable(o: WearableObservation) {
    this.latestWearable = o
    if (!o.gesture) return
    const kind = o.gesture.kind
    if (kind === 'select' || kind === 'cancel' || kind === 'recenter') {
      this.queue({ tMs: o.tMs, kind, source: 'wearable', classificationConfidence: o.gesture.confidence, sensorConfidence: o.sensorConfidence })
    }
  }

  private queue(g: GestureEvent, at?: Point2) {
    this.pending.push({ g, at })
    this.gestureLog.push(g)
    if (this.gestureLog.length > 100) this.gestureLog.shift()
  }

  private get mouseDrivesMock() {
    return this.mockWearable?.options.pattern === 'mouse'
  }

  onMouseMove(x: number, y: number) {
    if (this.mouseDrivesMock) this.mockWearable!.setTarget({ x, y })
    else if (this.mouseFallback) this.mouse = { x, y, tMs: performance.now() }
  }

  onMouseButton(down: boolean, x: number, y: number) {
    if (!this.mouseFallback && !this.mouseDrivesMock) return
    const tMs = performance.now()
    // With the mock following the mouse, the cursor comes from the wearable, so don't pin to mouse coords.
    const at = this.mouseDrivesMock ? undefined : { x, y }
    if (at) this.mouse = { ...at, tMs }
    this.mouseDown = down
    this.queue({ tMs, kind: down ? 'pinch_start' : 'pinch_end', source: 'mouse', classificationConfidence: 1, sensorConfidence: 1 }, at)
  }

  /** A button released outside the canvas still ends the press. */
  onMouseReleasedElsewhere() {
    if (this.mouseDown && this.mouse) this.onMouseButton(false, this.mouse.x, this.mouse.y)
  }

  /** Keyboard fallback. Returns true if the key was used. */
  onKey(e: KeyboardEvent): boolean {
    const tMs = performance.now()
    const kb = (kind: GestureEvent['kind']) => this.queue({ tMs, kind, source: 'keyboard', classificationConfidence: 1, sensorConfidence: 1 })
    if (this.radial.capturesInput) {
      if (e.key === 'ArrowLeft') this.radial.step(-1, 'keyboard')
      else if (e.key === 'ArrowRight') this.radial.step(1, 'keyboard')
      else if (e.key === 'Enter' || e.key === ' ') kb('select')
      else if (e.key === 'Escape') kb('cancel')
      else if (e.key.toLowerCase() === 'r') this.radial.recenter()
      else return false
      return true
    }
    if (e.key.toLowerCase() === 'm' && !e.metaKey && !e.ctrlKey) {
      const id = this.interaction.grabbedId ?? this.interaction.hoverId
      if (id) {
        this.interaction.yieldGrab(tMs, 'radial menu opened (key M)')
        this.radial.forceOpen(id)
      }
      return true
    }
    if (e.key === ' ') kb('select')
    else if (e.key === 'Escape') kb('cancel')
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') this.interaction.handle({ type: 'undo', tMs })
    else if (e.key.toLowerCase() === 'r' && !e.metaKey && !e.ctrlKey) this.recenter()
    else return false
    return true
  }

  // ---- per-frame pipeline -----------------------------------------------------
  private cameraPointer(): CalibratedCameraPointer | null {
    const obs = this.latestCamera
    if (!obs || this.tracker.status !== 'running') return null
    const f = this.latestFeatures
    const anchor = f ? (this.anchor === 'palm' ? f.palm : f.indexTip) : null
    const stable = this.detector.mode === 'grasp' && this.anchor === 'palm' && this.stabilizedCamera?.frameId === obs.frameId ? this.stabilizedCamera.point : null
    const p = stable ?? (anchor ? cameraToCanvas(anchor, this.profile) : { x: 0, y: 0 })
    return {
      tMs: obs.tMs,
      captureTMs: obs.captureTMs,
      smoothed: !!stable,
      x: p.x,
      y: p.y,
      trackingValid: !!anchor && (!(this.detector.mode === 'grasp' && this.anchor === 'palm' && this.calibration.kind === 'none') || !!stable),
      confidence: obs.sensorConfidence * obs.inFrameFraction,
    }
  }

  tick(now: number) {
    this.latestWearable = this.wearable?.latest() ?? null
    let est = this.fusion.update(now, this.cameraPointer(), this.latestWearable)
    if (this.mouseFallback && !this.mouseDrivesMock && this.calibration.kind === 'none' && this.mouse && (this.mouseDown || !est.valid && now - this.mouse.tMs < 1500)) {
      est = { tMs: now, x: this.mouse.x, y: this.mouse.y, valid: true, source: 'mouse', confidence: 1, observationAgeMs: now - this.mouse.tMs }
    }
    this.pointer = est

    const cam = this.latestCamera
    if (cam && cam.frameId !== this.lastConsumedFrame && (est.source === 'camera' || est.source === 'fused')) {
      this.lastConsumedFrame = cam.frameId
      // With captureTime the chain starts at the sensor; without it, at frame delivery.
      const base = cam.captureTMs ?? cam.tMs - (cam.detectMs ?? 0)
      this.latency.captureToPointer.push(now - base)
      this.paintBase = base
    }

    // Gestures first, against the pointer as it was when they happened (the
    // previous frame's, or a pinned position), then this frame's pointer.
    const modal = this.calibration.kind !== 'none' || this.accuracy.active
    const gestures = this.pending
    this.pending = []
    for (const { g, at } of gestures) {
      // While the radial menu is open it owns every gesture: no drags, no drops.
      if (this.radial.capturesInput && !modal) {
        this.radial.onGesture(g)
        continue
      }
      if (at && !modal) this.interaction.handle({ type: 'pointer', pointer: { ...est, ...at, valid: true, source: 'mouse', tMs: g.tMs } })
      this.dispatch(g, modal)
    }
    if (!modal && !this.radial.capturesInput) this.interaction.handle({ type: 'pointer', pointer: est })

    if (!modal) {
      this.radial.tick(now, {
        pointer: est,
        grabbedId: this.interaction.grabbedId,
        aspect: this.interaction.aspect,
        features: this.tracker.status === 'running' ? this.latestFeatures : null,
        mirrored: this.profile.mirrorX,
        graspMode: this.detector.mode === 'grasp',
      })
    }

    this.interaction.tick(now)
    this.notify()
  }

  private dispatch(g: GestureEvent, modal: boolean) {
    const engage = g.kind === 'pinch_start' || g.kind === 'grasp_start' || g.kind === 'select'
    const cancel = g.kind === 'open_palm' || g.kind === 'cancel'
    if (g.kind === 'recenter') return this.recenter()
    if (modal) {
      // During automatic range setup an open hand is the expected pose.
      if (this.autoRangeCapture && this.calibration.kind === 'region' && g.source === 'camera') return
      if (engage) {
        if (this.calibration.kind !== 'none') this.captureCalibration()
        else this.captureAccuracy()
      } else if (cancel) {
        this.calibration = { kind: 'none' }
        this.accuracy.active = false
        this.say('cancelled')
      }
      return
    }
    if (engage && this.onControlSelect?.(this.interaction.pointer ?? this.pointer)) return
    let ev: InteractionEvent | null = null
    if (g.kind === 'pinch_start' || g.kind === 'grasp_start') ev = { type: 'grab', tMs: g.tMs, source: g.source }
    else if (g.kind === 'pinch_end' || g.kind === 'grasp_end') ev = { type: 'release', tMs: g.tMs, source: g.source }
    else if (g.kind === 'select') ev = this.interaction.grabbedId ? { type: 'release', tMs: g.tMs, source: g.source } : { type: 'grab', tMs: g.tMs, source: g.source }
    else if (cancel) ev = { type: 'cancel', tMs: g.tMs, source: g.source }
    if (ev) this.interaction.handle(ev)
  }

  /** Call from a rAF after React has committed the frame. */
  markPainted(t: number) {
    if (this.paintBase === null) return
    this.latency.captureToPaint.push(t - this.paintBase)
    this.paintBase = null
  }

  // ---- calibration --------------------------------------------------------------
  updateProfile(patch: Partial<CalibrationProfile>) {
    this.graspCursor.reset()
    this.stabilizedCamera = null
    this.profile = { ...this.profile, ...patch, updatedAt: Date.now() }
    this.fusion.resetPointer()
    saveProfile(this.tracker.deviceKey, this.profile)
    this.notify()
  }

  resetCalibration() {
    const { mirrorX, flipY } = this.profile
    this.updateProfile({ region: { x0: 0.25, y0: 0.2, x1: 0.75, y1: 0.75 }, affine: undefined, fitRms: undefined, offset: { x: 0, y: 0 }, samples: [], mirrorX, flipY })
  }

  startCalibration(kind: 'region' | 'points') {
    this.graspCursor.reset()
    this.stabilizedCamera = null
    this.radial.controller.cancel(performance.now(), 'hand range calibration')
    this.interaction.handle({ type: 'cancel', tMs: performance.now(), source: 'keyboard' })
    this.rangeHold.reset()
    this.rawHistory = []
    this.pending = []
    this.accuracy.active = false
    this.calibration = kind === 'region' ? { kind, corners: [] } : { kind, index: 0, samples: [] }
    this.notify()
  }

  /** Mean raw anchor over the last hold window, or null if the hand wasn't steady in view. */
  private heldRawPoint(): Point2 | null {
    const now = performance.now()
    const recent = this.rawHistory.filter((h) => now - h.tMs <= CALIBRATION_HOLD_MS)
    if (recent.length < 3 || !this.latestFeatures) return null
    return { x: recent.reduce((s, h) => s + h.p.x, 0) / recent.length, y: recent.reduce((s, h) => s + h.p.y, 0) / recent.length }
  }

  captureCalibration(held?: Point2) {
    const step = this.calibration
    if (step.kind === 'none') return
    const raw = held ?? this.heldRawPoint()
    if (!raw) return this.say('No steady hand in view — hold still in front of the camera and try again')
    if (step.kind === 'region') {
      step.corners.push(raw)
      this.rangeHold.reset()
      if (step.corners.length === 2) {
        const region = regionFromCorners(step.corners[0], step.corners[1], this.profile)
        if (region.x1 - region.x0 < 0.05 || region.y1 - region.y0 < 0.05) {
          this.calibration = { kind: 'region', corners: [] }
          return this.say('Region too small — spread the two corners further apart')
        }
        this.updateProfile({ region, affine: undefined, fitRms: undefined, offset: { x: 0, y: 0 } })
        this.calibration = { kind: 'none' }
        this.say(`Range saved · horizontal gain ${(1 / (region.x1 - region.x0)).toFixed(1)}× · vertical gain ${(1 / (region.y1 - region.y0)).toFixed(1)}×`)
      }
      return
    }
    const o = orient(raw, this.profile)
    step.samples.push({
      tMs: performance.now(),
      target: { ...CALIBRATION_TARGETS[step.index], frame: 'canvas' },
      camera: { ...o, frame: 'camera' },
      wearable: this.latestWearable ?? undefined,
    })
    step.index++
    if (step.index < CALIBRATION_TARGETS.length) return
    const fit = fitAffine(step.samples)
    this.calibration = { kind: 'none' }
    if (!fit) return this.say('Calibration points were degenerate — try again with the hand clearly moved to each target')
    this.updateProfile({ affine: fit.affine, fitRms: fit.rms, offset: { x: 0, y: 0 }, samples: step.samples })
    this.say(`Calibrated: fit residual ${(fit.rms * 100).toFixed(1)}% of canvas height (${Math.round(fit.rms * this.canvasPx.h)}px)`)
  }

  cancelCalibration() {
    this.rangeHold.reset()
    this.calibration = { kind: 'none' }
    this.notify()
  }

  recenter() {
    const raw = this.heldRawPoint() ?? (this.latestFeatures ? (this.anchor === 'palm' ? this.latestFeatures.palm : this.latestFeatures.indexTip) : null)
    if (raw) this.updateProfile({ offset: recenter(this.profile, raw).offset })
    this.mockWearable?.resetDrift()
    this.fusion.resetWearableBias()
    this.say(raw ? 'Recentered' : 'Recentered wearable only (no hand in view)')
  }

  // ---- accuracy test -------------------------------------------------------------
  startAccuracy() {
    this.calibration = { kind: 'none' }
    this.accuracy = { active: true, index: 0, results: [] }
    this.notify()
  }

  captureAccuracy() {
    const p = this.pointer
    if (!p.valid) return this.say('Pointer not valid — no sample recorded')
    const target = ACCURACY_TARGETS[this.accuracy.index]
    const dx = p.x - target.x
    const dy = p.y - target.y
    this.accuracy.results.push({
      target,
      pointer: { x: p.x, y: p.y },
      errorCanvas: Math.hypot(dx * this.interaction.aspect, dy),
      errorPx: Math.hypot(dx * this.canvasPx.w, dy * this.canvasPx.h),
      source: p.source,
    })
    this.accuracy.index++
    if (this.accuracy.index >= ACCURACY_TARGETS.length) this.accuracy.active = false
  }
}

/** Dev builds only: `window.__reflexRuntime` for console debugging and scripted checks. */
export function exposeForDev(rt: SpatialRuntime) {
  if (import.meta.env.DEV) (window as unknown as { __reflexRuntime?: SpatialRuntime }).__reflexRuntime = rt
}

export function useRuntime(rt: SpatialRuntime) {
  useSyncExternalStore(rt.subscribe, rt.getVersion)
  return rt
}
