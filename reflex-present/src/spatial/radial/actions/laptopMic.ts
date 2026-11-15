// laptop-gemini — this computer's microphone, recorded until you stop or go quiet, then sent
// as one 16 kHz WAV to Google Gemini through this laptop's dev server (server/geminiVoice.ts
// holds the key). The same path as the band's microphone, for when no band is connected:
// Gemini transcribes (and, in 'answer' mode, replies), no browser speech service involved.

import { askGemini, fetchGeminiStatus, type GeminiStatus } from './gemini'
import type { VoiceCallbacks, VoiceContext, VoiceProvider } from './voice'
import { encodeWav, resample, rms, toBase64 } from './wav'

const RATE = 16000
const MAX_RECORD_S = 15
const MIN_RECORD_S = 0.4
/** Nothing loud enough in this much recorded sound: send anyway (Gemini says it heard nothing). */
const NO_SPEECH_S = 8
/** After speech, this much quiet ends the recording. */
const QUIET_STOP_MS = 1200

// Hands each block of microphone samples to the page (AudioWorklet: runs off the main thread).
const WORKLET = `
class AxisMicTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(2048); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('axis-mic-tap', AxisMicTap)
`

interface Recording {
  cb: VoiceCallbacks
  ctx?: VoiceContext
  chunks: Float32Array[]
  samples: number
  rate: number
  heardAt: number | null
  lastLoudAt: number
  /** Running estimate of the room's noise level. */
  floor: number
  cleanup: () => void
}

export class LaptopGeminiProvider implements VoiceProvider {
  id = 'laptop-gemini' as const
  label = 'This computer’s microphone → Google Gemini'
  notice = 'Records this computer’s microphone. When you stop, or go quiet, the recording is sent to Google Gemini (generativelanguage.googleapis.com) through this laptop to be transcribed.'
  status: GeminiStatus | null = null
  private rec: Recording | null = null
  private abort: AbortController | null = null
  private onStatus: () => void

  constructor(onStatus: () => void = () => {}) {
    this.onStatus = onStatus
    void this.refresh()
  }

  refresh(): Promise<void> {
    return fetchGeminiStatus().then((s) => {
      this.status = s
      this.onStatus()
    })
  }

  unavailable() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'This browser cannot use the microphone (open the app on localhost or https).'
    if (typeof AudioWorkletNode !== 'function') return 'This browser cannot record audio here: use a current Chrome or Edge.'
    if (this.status?.offline) return 'The Gemini endpoint is not running: start the app with npm run dev.'
    if (this.status && !this.status.configured) return 'No Gemini key on this laptop: put GEMINI_API_KEY=... in reflex-present/.env, then restart npm run dev.'
    return null
  }

  get recording() {
    return this.rec !== null
  }

  start(cb: VoiceCallbacks, ctx?: VoiceContext) {
    const why = this.unavailable()
    if (why) return cb.onError(why)
    this.stop()
    const rec: Recording = { cb, ctx, chunks: [], samples: 0, rate: RATE, heardAt: null, lastLoudAt: 0, floor: 0.01, cleanup: () => {} }
    this.rec = rec
    void this.open(rec).catch((e: unknown) => {
      if (this.rec !== rec) return
      this.stop()
      const name = e instanceof DOMException ? e.name : ''
      cb.onError(name === 'NotAllowedError' ? 'Microphone permission was refused (allow it in the address bar).' : name === 'NotFoundError' ? 'No microphone found on this computer.' : `Could not open the microphone: ${e instanceof Error ? e.message : String(e)}`)
      cb.onState('stopped')
    })
  }

  private async open(rec: Recording) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const ac = new AudioContext()
    let closed = false
    rec.cleanup = () => {
      if (closed) return
      closed = true
      stream.getTracks().forEach((t) => t.stop())
      void ac.close().catch(() => {})
    }
    if (this.rec !== rec) return rec.cleanup()
    rec.rate = ac.sampleRate
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }))
    try {
      await ac.audioWorklet.addModule(url)
    } finally {
      URL.revokeObjectURL(url)
    }
    if (this.rec !== rec) return rec.cleanup()
    const source = ac.createMediaStreamSource(stream)
    const tap = new AudioWorkletNode(ac, 'axis-mic-tap')
    const mute = ac.createGain()
    mute.gain.value = 0 // keeps the tap in the rendered graph without playing the mic back
    source.connect(tap).connect(mute).connect(ac.destination)
    tap.port.onmessage = (e: MessageEvent<Float32Array>) => this.onSamples(rec, e.data)
    if (ac.state === 'suspended') await ac.resume()
    rec.cb.onState('listening')
  }

  private onSamples(rec: Recording, s: Float32Array) {
    if (this.rec !== rec) return
    rec.chunks.push(s)
    rec.samples += s.length
    const level = rms(s)
    const now = performance.now()
    rec.cb.onLevel?.(Math.min(1, level * 10))
    // Speech is loud relative to the room; the floor follows the quietest recent blocks.
    rec.floor = Math.min(level, rec.floor * 0.98 + level * 0.02)
    if (level > Math.max(0.012, rec.floor * 3)) {
      rec.heardAt ??= now
      rec.lastLoudAt = now
    }
    const seconds = rec.samples / rec.rate
    const doneTalking = rec.heardAt !== null && now - rec.lastLoudAt > QUIET_STOP_MS && now - rec.heardAt > 400
    // Counted in recorded sound, not wall time, so a slow microphone start cannot end it early.
    const neverTalked = rec.heardAt === null && seconds > NO_SPEECH_S
    if (seconds >= MAX_RECORD_S || doneTalking || neverTalked) this.finish()
  }

  /** Stop recording and send what was heard to Gemini. */
  finish() {
    const rec = this.rec
    if (!rec) return
    this.rec = null
    rec.cleanup()
    const { cb, ctx } = rec
    if (rec.samples / rec.rate < MIN_RECORD_S) {
      cb.onState('stopped')
      return cb.onError('Nothing was recorded (under half a second of sound).')
    }
    // Silence is not sent: given a recording with no speech, Gemini can invent a sentence.
    if (rec.heardAt === null) {
      cb.onState('stopped')
      return cb.onError('No speech was heard. Try again, a little closer to the microphone.')
    }
    const all = new Float32Array(rec.samples)
    let at = 0
    for (const c of rec.chunks) {
      all.set(c, at)
      at += c.length
    }
    const audio = toBase64(encodeWav(resample(all, rec.rate, RATE), RATE))
    cb.onState('thinking')
    const abort = new AbortController()
    this.abort = abort
    askGemini({ audio }, ctx, abort.signal, ctx?.mode)
      .then((a) => {
        if (abort.signal.aborted) return
        cb.onText(a.transcript || '(no speech heard)', true)
        if (a.reply) cb.onReply?.({ text: a.reply, model: a.model })
        cb.onState('stopped')
      })
      .catch((e: unknown) => {
        if (abort.signal.aborted) return
        cb.onError(e instanceof Error ? e.message : String(e))
        cb.onState('stopped')
      })
      .finally(() => this.abort === abort && (this.abort = null))
  }

  /** Stop without sending anything. */
  stop() {
    const rec = this.rec
    this.rec = null
    rec?.cleanup()
    this.abort?.abort()
    this.abort = null
  }
}
