// Shared contracts for the spatial interaction stack.
//
// TIME: every `tMs` is a DOMHighResTimeStamp in the page's performance.now()
// domain (monotonic ms since page load). Sources with their own clock (e.g. a
// wearable's firmware ms counter) convert via ClockAligner before emitting.
//
// COORDINATES: each 2D point carries the frame it lives in. Only points in
// the 'canvas' frame may be fused or used for interaction; 'camera' and
// 'device' frames must pass through a calibration first.
//   camera — MediaPipe normalized image coords: x 0..1 left→right of the raw
//            (unmirrored) frame, y 0..1 top→bottom.
//   canvas — normalized presentation canvas: x 0..1 left→right, y 0..1
//            top→bottom, independent of display resolution.
//   device — whatever the wearable reports before calibration (opaque here).

export type CoordinateFrame = 'camera' | 'canvas' | 'device'

export interface Point2 {
  x: number
  y: number
}

export interface FramedPoint extends Point2 {
  frame: CoordinateFrame
}

export interface Landmark3 {
  x: number
  y: number
  z: number
}

export type Handedness = 'Left' | 'Right' | 'Unknown'

export interface CameraObservation {
  tMs: number
  /** Capture time of the video frame, when the browser reports it. */
  captureTMs?: number
  frameId: number
  imageWidth: number
  imageHeight: number
  trackingValid: boolean
  /** 21 landmarks in the camera frame; empty when no hand is tracked. */
  landmarks: Landmark3[]
  handedness: Handedness
  /** MediaPipe's handedness score. The task API exposes no per-frame
   * tracking score, so this is the best available proxy for sensor confidence. */
  sensorConfidence: number
  /** Fraction of the 21 landmarks inside the image (partial-occlusion proxy). */
  inFrameFraction: number
  /** Stable cursor anchor: palm centre (mean of wrist and the four MCPs). */
  palm?: FramedPoint
  indexTip?: FramedPoint
  /** Thumb–index tip distance divided by palm width (index MCP → pinky MCP). */
  pinchRatio?: number
  detectMs?: number
}

export interface WearableObservation {
  tMs: number
  connected: boolean
  /** 0..1, as reported/derived by the wearable adapter. */
  sensorConfidence: number
  /**
   * A pointer estimate, if the wearable side produces one. Only a 'canvas'
   * frame pointer is fused; a 'device' frame pointer is reported in
   * diagnostics and kept for joint calibration, never fused.
   */
  pointer?: FramedPoint
  /** True if `pointer` comes from integrating motion (drifts over time). */
  pointerIsIntegrated?: boolean
  /** Optional raw-ish quantities; units declared by the adapter. */
  orientation?: { yaw: number; pitch: number; roll: number; units: 'rad' | 'deg' }
  angularVelocity?: { x: number; y: number; z: number; units: 'rad/s' | 'deg/s' }
  acceleration?: { x: number; y: number; z: number; units: 'm/s2' | 'g' }
  gesture?: { kind: WearableGestureKind; confidence: number }
}

export type WearableGestureKind = 'select' | 'cancel' | 'next' | 'previous' | 'recenter'

export type PointerSource = 'camera' | 'wearable' | 'fused' | 'mouse' | 'none'

export interface PointerEstimate {
  tMs: number
  /** Always in the canvas frame. */
  x: number
  y: number
  valid: boolean
  source: PointerSource
  /** 0..1 — confidence in the position, not in any gesture. */
  confidence: number
  /** Age of the newest observation that produced this estimate. */
  observationAgeMs: number
  /** Capture time of the camera frame behind this estimate, for latency. */
  captureTMs?: number
}

export type GestureKind = 'grasp_start' | 'grasp_end' | 'pinch_start' | 'pinch_end' | 'point_start' | 'point_end' | 'open_palm' | 'select' | 'cancel' | 'recenter'

export interface GestureEvent {
  tMs: number
  kind: GestureKind
  source: 'camera' | 'wearable' | 'keyboard' | 'mouse'
  /** Confidence in the gesture classification (separate from sensor confidence). */
  classificationConfidence: number
  sensorConfidence: number
}

export interface CalibrationSample {
  tMs: number
  /** Where the target was drawn. */
  target: Point2 & { frame: 'canvas' }
  /** Averaged camera observation (mirror applied) while the target was held. */
  camera?: Point2 & { frame: 'camera' }
  /** Wearable reading paired at the same moment, for joint calibration. */
  wearable?: WearableObservation
}

export type SensorFusionMode = 'WEARABLE_PRIMARY' | 'FUSED' | 'CAMERA_FALLBACK'

export type InteractionEvent =
  | { type: 'pointer'; pointer: PointerEstimate }
  | { type: 'grab'; tMs: number; source: GestureEvent['source'] }
  | { type: 'release'; tMs: number; source: GestureEvent['source'] }
  | { type: 'cancel'; tMs: number; source: GestureEvent['source'] }
  | { type: 'undo'; tMs: number }

export type InteractionStateName = 'IDLE' | 'HOVER' | 'GRABBED' | 'DRAGGING' | 'RELEASED' | 'CANCELLED' | 'TRACKING_LOST'

export interface SpatialObject {
  id: string
  label: string
  color: string
  shape: 'card' | 'circle' | 'pill'
  /** Top-left and size in the canvas frame. */
  x: number
  y: number
  w: number
  h: number
}
