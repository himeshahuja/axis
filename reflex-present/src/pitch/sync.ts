// The audience window owns the pitch; a presenter console in another window
// (same browser, same origin) mirrors its state and sends commands.

import type { PitchSnapshot } from './pitchController'

export const CHANNEL = 'axis-pitch'

export interface StageStatus extends PitchSnapshot {
  type: 'state'
  sentAt: number
  /** performance.now() of the audience window when sent, to compute elapsed times locally. */
  stageNow: number
  camera: string
  cameraError: string | null
  handTracked: boolean
  band: string
  gesturesEnabled: boolean
  gestureMode: string
  mode: 'presentation' | 'rehearsal'
  radialStatus: string
  memoryCount: number
}

export type StageCommand =
  | { type: 'cmd'; cmd: 'next' | 'previous' | 'nextScene' | 'reset' | 'resetLayout' | 'toggleGestures' | 'camera' | 'calibrate' | 'toggleMode' | 'recenter' | 'openMenu' }
  | { type: 'cmd'; cmd: 'goto'; index: number }

export function openChannel(): BroadcastChannel | null {
  try {
    return new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
}
