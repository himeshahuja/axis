import type { WearableObservation } from '../types'

/**
 * The boundary with the Vexo integration. The wearable teammate implements
 * this; nothing on the camera/fusion side depends on a particular SDK,
 * transport or packet format. Adapter responsibilities:
 *  - stamp `tMs` in the performance.now() domain (see ClockAligner),
 *  - set `connected: false` (or stop emitting) when the link drops,
 *  - mark `pointer.frame` 'canvas' only once the pointer is calibrated to
 *    the presentation canvas; otherwise 'device' (it will not be fused),
 *  - set `pointerIsIntegrated` if the pointer comes from integrating motion.
 */
export interface WearableAdapter {
  readonly name: string
  start(): void | Promise<void>
  stop(): void
  subscribe(cb: (obs: WearableObservation) => void): () => void
  latest(): WearableObservation | null
}
