// The real Vexo band, through vexo-open-kit's own library (not edited).
// Verified against vexo-open-kit/docs/api.md and AGENTS.md:
//   - motion: `{ t, gx, gy, gz }` with gyro in degrees/second, `t` on the band's clock (ms)
//   - no fused orientation: only coarse `orientation` events (which face points up)
//   - audio: raw Opus packets (`{ seq, opus }`) for speech-to-text
//   - storage: a small, non-private key-value store; no memory API
// This adapter gives raw gyro (no pointer), so pointer fusion reports it as
// uncalibrated and never fuses it. It is used for wrist rotation and the mic.

import { Band, ClockAligner, SimTransport } from './vexoKit'
import type { WearableObservation } from '../types'
import type { WearableAdapter } from './adapter'
import { BAND_NUMBER } from './band'

export type BandLink = 'ble' | 'serial' | 'sim'
export type BandStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error' | 'closed'

const MOTION_HZ = 100

export class VexoBandAdapter implements WearableAdapter {
  readonly name = `vexo-band-${BAND_NUMBER}`
  readonly link: BandLink
  status: BandStatus = 'idle'
  error: string | null = null
  band: Band | null = null
  /** Only for link 'sim': the pretend band, which can be told to twist. */
  sim: SimTransport | null = null
  sensors: 'gyro' | 'both' = 'gyro'
  private clock = new ClockAligner()
  private subs = new Set<(o: WearableObservation) => void>()
  private last: WearableObservation | null = null
  private onStatus: () => void

  constructor(link: BandLink, onStatus: () => void) {
    this.link = link
    this.onStatus = onStatus
  }

  private set(status: BandStatus, error: string | null = null) {
    this.status = status
    this.error = error
    this.onStatus()
  }

  /** Must run inside a click handler (Web Bluetooth / Web Serial need a user gesture). */
  async start() {
    if (this.status === 'connecting' || this.status === 'connected') return
    this.set('connecting')
    try {
      this.sim = this.link === 'sim' ? new SimTransport(BAND_NUMBER) : null
      const band = await Band.connect(BAND_NUMBER, { transport: this.sim ?? this.link, autoReconnect: true })
      if (band.number !== BAND_NUMBER) {
        await band.disconnect()
        throw new Error(`Connected band reports number ${band.number}, not ${BAND_NUMBER}: disconnected, nothing changed.`)
      }
      this.band = band
      band.on('motion', (m) => {
        if (m.gx === null || m.gy === null || m.gz === null) return
        const now = performance.now()
        const obs: WearableObservation = {
          tMs: this.clock.toLocal(m.t, now),
          deviceTMs: m.t,
          connected: true,
          // Raw readings are present; the band gives no quality figure of its own.
          sensorConfidence: 1,
          angularVelocity: { x: m.gx, y: m.gy, z: m.gz, units: 'deg/s' },
        }
        this.last = obs
        for (const s of this.subs) s(obs)
      })
      band.on('disconnect', () => {
        this.last = null
        this.set('closed')
      })
      band.on('reconnecting', () => {
        this.last = null
        this.set('reconnecting')
      })
      band.on('reconnected', () => {
        this.clock.reset()
        this.set('connected')
      })
      try {
        await band.configure({ motion: MOTION_HZ, sensors: 'gyro' })
        this.sensors = 'gyro'
      } catch {
        await band.configure({ motion: MOTION_HZ, sensors: 'both' })
        this.sensors = 'both'
      }
      this.set('connected')
    } catch (err) {
      this.band = null
      this.set('error', err instanceof Error ? err.message : String(err))
    }
  }

  stop() {
    void this.band?.disconnect()
    this.band = null
    this.last = null
    this.set('closed')
  }

  subscribe(cb: (o: WearableObservation) => void) {
    this.subs.add(cb)
    return () => {
      this.subs.delete(cb)
    }
  }

  latest() {
    return this.last
  }

  get connected() {
    return this.status === 'connected'
  }
}
