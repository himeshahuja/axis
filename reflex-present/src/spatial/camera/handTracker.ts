import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import type { CameraObservation, Handedness } from '../types'
import { computeHandFeatures, type HandFeatures } from './handGeometry'

const LOCAL_WASM = '/mediapipe/wasm'
const LOCAL_MODEL = '/mediapipe/hand_landmarker.task'
const REMOTE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type TrackerStatus = 'off' | 'loading' | 'running' | 'error'

export interface TrackerFrame {
  observation: CameraObservation
  features: HandFeatures | null
}

let landmarkerPromise: Promise<HandLandmarker> | null = null

async function reachable(url: string) {
  try {
    const r = await fetch(url, { method: 'HEAD' })
    return r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')
  } catch {
    return false
  }
}

async function createLandmarker(): Promise<HandLandmarker> {
  const local = await reachable(LOCAL_MODEL)
  const vision = await FilesetResolver.forVisionTasks(local ? LOCAL_WASM : REMOTE_WASM)
  const options = (delegate: 'GPU' | 'CPU') => ({
    baseOptions: { modelAssetPath: local ? LOCAL_MODEL : REMOTE_MODEL, delegate },
    runningMode: 'VIDEO' as const,
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  })
  try {
    return await HandLandmarker.createFromOptions(vision, options('GPU'))
  } catch {
    return await HandLandmarker.createFromOptions(vision, options('CPU'))
  }
}

type VideoFrameMeta = { captureTime?: number; mediaTime: number }
type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number
  cancelVideoFrameCallback?: (id: number) => void
}

/** Webcam + MediaPipe Hand Landmarker. Emits one observation per video frame. */
export class HandTracker {
  status: TrackerStatus = 'off'
  error: string | null = null
  readonly video: RVFCVideo
  deviceKey = 'default'
  /** True when the browser reports real capture timestamps for frames. */
  hasCaptureTime = false
  private stream: MediaStream | null = null
  private landmarker: HandLandmarker | null = null
  private loopHandle: number | null = null
  private lastTs = 0
  private frameId = 0
  private running = false
  private generation = 0
  private starting: Promise<void> | null = null
  private onFrame: (f: TrackerFrame) => void
  private onStatus: () => void

  constructor(onFrame: (f: TrackerFrame) => void, onStatus: () => void) {
    this.onFrame = onFrame
    this.onStatus = onStatus
    this.video = document.createElement('video') as RVFCVideo
    this.video.playsInline = true
    this.video.muted = true
  }

  private setStatus(s: TrackerStatus, error: string | null = null) {
    this.status = s
    this.error = error
    this.onStatus()
  }

  start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.running) return Promise.resolve()
    const generation = ++this.generation
    const pending = this.open(generation)
    this.starting = pending
    void pending.finally(() => { if (this.starting === pending) this.starting = null })
    return pending
  }

  private async open(generation: number) {
    this.running = true
    this.setStatus('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, facingMode: 'user' },
        audio: false,
      })
      if (generation !== this.generation) { stream.getTracks().forEach((t) => t.stop()); return }
      this.stream = stream
      const track = this.stream.getVideoTracks()[0]
      this.deviceKey = track.getSettings().deviceId || track.label || 'default'
      track.addEventListener('ended', () => { if (generation === this.generation) this.stop('camera disconnected') })
      this.video.srcObject = this.stream
      await this.video.play()
      if (generation !== this.generation) return
      landmarkerPromise ??= createLandmarker()
      this.landmarker = await landmarkerPromise
      if (generation !== this.generation || !this.running) return
      this.setStatus('running')
      this.schedule()
    } catch (err) {
      if (generation !== this.generation) return
      landmarkerPromise = null
      this.running = false
      this.releaseStream()
      this.setStatus('error', err instanceof Error ? `${err.name}: ${err.message}` : String(err))
    }
  }

  private schedule() {
    if (!this.running) return
    if (this.video.requestVideoFrameCallback) {
      this.loopHandle = this.video.requestVideoFrameCallback((_now, meta) => this.process(meta.captureTime))
    } else {
      this.loopHandle = requestAnimationFrame(() => this.process(undefined))
    }
  }

  private process(captureTime: number | undefined) {
    if (!this.running || !this.landmarker || this.video.readyState < 2) return this.schedule()
    const t0 = performance.now()
    const ts = Math.max(t0, this.lastTs + 0.001) // detectForVideo needs strictly increasing timestamps
    this.lastTs = ts
    const res = this.landmarker.detectForVideo(this.video, ts)
    const tMs = performance.now()
    if (captureTime !== undefined) this.hasCaptureTime = true

    const W = this.video.videoWidth
    const H = this.video.videoHeight
    const lm = res.landmarks[0] ?? []
    const hand = res.handedness[0]?.[0]
    const features = lm.length === 21 ? computeHandFeatures(lm, W, H) : null
    const observation: CameraObservation = {
      tMs,
      captureTMs: captureTime,
      frameId: ++this.frameId,
      imageWidth: W,
      imageHeight: H,
      trackingValid: !!features,
      landmarks: lm.map((l) => ({ x: l.x, y: l.y, z: l.z })),
      // MediaPipe's label, unchanged. Its docs say mirroring the input inverts it; we feed the
      // raw (unmirrored) frame. Check against a known hand on the real camera before relying on it.
      handedness: hand ? (hand.categoryName as Handedness) : 'Unknown',
      sensorConfidence: hand?.score ?? 0,
      inFrameFraction: features?.inFrameFraction ?? 0,
      palm: features ? { ...features.palm, frame: 'camera' } : undefined,
      indexTip: features ? { ...features.indexTip, frame: 'camera' } : undefined,
      pinchRatio: features?.pinchRatio,
      detectMs: tMs - t0,
    }
    this.onFrame({ observation, features })
    this.schedule()
  }

  private releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
  }

  stop(reason: string | null = null) {
    this.generation++
    this.starting = null
    this.running = false
    if (this.loopHandle !== null) {
      if (this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.loopHandle)
      else cancelAnimationFrame(this.loopHandle)
    }
    this.loopHandle = null
    this.releaseStream()
    this.setStatus(reason ? 'error' : 'off', reason)
  }
}

export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS
