// Speech capture for the Voice action. Three providers, chosen by the user:
//   band     — the Vexo band's microphone (Opus) → Deepgram, via the kit's own
//              deepgramLink. Needs the team's Deepgram key typed into the page;
//              it lives in memory only, never in storage, the URL or a file.
//   browser  — this computer's microphone through the browser's speech
//              recognition. In Chrome the audio is sent to Google to transcribe.
//   typed    — no microphone at all.
// Every provider that sends sound off the computer says so before it starts.

//   band-gemini — the Vexo band's microphone, recorded until you stop or go quiet, then
//              sent as one WAV to Google Gemini through this laptop's dev server
//              (server/geminiVoice.ts holds the key). Gemini returns the transcript
//              and a reply about the selected object. The default for Voice.

import { BandAudio, AUDIO_RATE } from '../../wearable/vexoKit'
import { BAND_NUMBER } from '../../wearable/band'
import type { VexoBandAdapter } from '../../wearable/vexoBandAdapter'
import { askGemini, type GeminiContext } from './gemini'
import { encodeWav, rms, toBase64 } from './wav'

export { askGemini, GeminiError, type GeminiAnswer } from './gemini'

export type VoiceProviderId = 'band-gemini' | 'band' | 'browser' | 'typed'

export interface VoiceCallbacks {
  onText(text: string, final: boolean): void
  onState(state: 'listening' | 'thinking' | 'stopped'): void
  onError(message: string): void
  /** A spoken reply to what was said (band-gemini only). */
  onReply?(reply: { text: string; model: string }): void
  /** Microphone loudness 0..1, about 50 times a second while recording. */
  onLevel?(level: number): void
}

/** What the request is about, so a reply can use the object's real data. */
export interface VoiceContext extends GeminiContext {
  /** 'transcribe' (dictation) asks Gemini only for the words, no reply. */
  mode?: 'answer' | 'transcribe'
}

export interface VoiceProvider {
  id: VoiceProviderId
  label: string
  /** What leaves the computer, shown before listening starts. */
  notice: string
  /** null when ready, else why not. */
  unavailable(): string | null
  start(cb: VoiceCallbacks, ctx?: VoiceContext): void
  stop(): void
  /** Records first and sends when done (band-gemini): stop recording and send now. */
  finish?(): void
}

// ---- browser speech recognition ---------------------------------------------------------
interface SRResult {
  isFinal: boolean
  0: { transcript: string }
}
interface SR extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<SRResult> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}
const SRCtor = () => {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SR) | undefined
}

export class BrowserSpeechProvider implements VoiceProvider {
  id = 'browser' as const
  label = 'This computer’s microphone (browser speech recognition)'
  notice = 'Uses this computer’s microphone. In Chrome, the audio is sent to Google’s servers to be transcribed.'
  private rec: SR | null = null

  unavailable() {
    return SRCtor() ? null : 'This browser has no speech recognition (use Chrome or Edge).'
  }

  start(cb: VoiceCallbacks) {
    const Ctor = SRCtor()
    if (!Ctor) return cb.onError(this.unavailable()!)
    const rec = new Ctor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let text = ''
      let final = true
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
        if (!e.results[i].isFinal) final = false
      }
      cb.onText(text.trim(), final)
    }
    rec.onerror = (e) => cb.onError(e.error === 'not-allowed' ? 'Microphone permission was refused.' : e.error === 'no-speech' ? 'No speech was heard. Try again a little closer to the microphone.' : `Speech recognition error: ${e.error}`)
    rec.onend = () => cb.onState('stopped')
    this.rec = rec
    rec.start()
    cb.onState('listening')
  }

  stop() {
    this.rec?.stop()
    this.rec = null
  }
}

// ---- band microphone → Deepgram -------------------------------------------------------------
let deepgramKey = '' // memory only; gone on reload

export const setDeepgramKey = (k: string) => {
  deepgramKey = k.trim()
}
export const hasDeepgramKey = () => deepgramKey.length > 0
export const forgetDeepgramKey = () => {
  deepgramKey = ''
}

const PROBLEM: Record<string, string> = {
  'no-key': 'Needs your team’s Deepgram key (type it in the key field).',
  refused: 'Deepgram refused the connection (check the key and the network).',
  closed: 'The connection to Deepgram closed.',
  reported: 'Deepgram reported an error.',
  'no-socket': 'This browser cannot open a WebSocket.',
}

export class BandDeepgramProvider implements VoiceProvider {
  id = 'band' as const
  label = 'Vexo band microphone → Deepgram'
  notice = 'The band’s microphone records everyone near it (its light turns solid blue). While listening, the sound is sent to Deepgram, an online speech-to-text company.'
  private adapter: () => VexoBandAdapter | null
  private stopLink: (() => void) | null = null

  constructor(adapter: () => VexoBandAdapter | null) {
    this.adapter = adapter
  }

  unavailable() {
    const a = this.adapter()
    if (!a?.band || !a.connected) return 'Connect band first.'
    if (a.link === 'sim') return 'The pretend band has no microphone (it sends silence).'
    if (!hasDeepgramKey()) return PROBLEM['no-key']
    return null
  }

  start(cb: VoiceCallbacks) {
    const why = this.unavailable()
    if (why) return cb.onError(why)
    const band = this.adapter()!.band!
    void import('vexo-speech/deepgram.js').then(async ({ deepgramLink }) => {
      const link = deepgramLink({ key: deepgramKey })
      let off: (() => void) | null = null
      link.start({
        onText: ({ text, final }) => cb.onText(text, final),
        onState: (s) => cb.onState(s === 'listening' ? 'listening' : 'stopped'),
        onError: (p) => {
          cb.onError(PROBLEM[p] ?? 'Speech-to-text stopped.')
          off?.()
          void band.configure({ audio: false })
        },
      })
      off = band.on('audio', (a) => link.packet(a.opus))
      try {
        await band.configure({ audio: true })
      } catch (err) {
        cb.onError(err instanceof Error ? err.message : String(err))
      }
      this.stopLink = () => {
        link.stop()
        off?.()
        void band.configure({ audio: false })
      }
    })
  }

  stop() {
    this.stopLink?.()
    this.stopLink = null
  }
}

// ---- band microphone → Google Gemini ------------------------------------------------------
const MAX_RECORD_S = 12
const MIN_RECORD_S = 0.5
const SPEECH_RMS = 0.02 // louder than this counts as speech
const QUIET_STOP_MS = 1400 // after speech, this much quiet ends the recording

interface GeminiStatus {
  configured: boolean
  model: string
  offline?: boolean
}

interface Recording {
  cb: VoiceCallbacks
  ctx?: VoiceContext
  chunks: Float32Array[]
  samples: number
  heardAt: number | null
  lastLoudAt: number
  cleanup: () => void
}

export class BandGeminiProvider implements VoiceProvider {
  id = 'band-gemini' as const
  label = 'Vexo band microphone → Google Gemini'
  notice =
    'Records the Vexo band’s microphone, which hears everyone near it (its light turns solid blue). When you stop, or go quiet, the recording and the selected object’s data are sent to Google Gemini (generativelanguage.googleapis.com) through this laptop to be transcribed and answered.'
  status: GeminiStatus | null = null
  private adapter: () => VexoBandAdapter | null
  private rec: Recording | null = null
  private abort: AbortController | null = null
  private onStatus: () => void

  constructor(adapter: () => VexoBandAdapter | null, onStatus: () => void = () => {}) {
    this.adapter = adapter
    this.onStatus = onStatus
    void this.refresh()
  }

  /** Asks the dev server whether it has a Gemini key (the key itself never comes back). */
  refresh(): Promise<void> {
    if (typeof fetch !== 'function' || typeof location === 'undefined') return Promise.resolve()
    return fetch('/api/voice/gemini/status')
      .then((r) => (r.ok ? (r.json() as Promise<GeminiStatus>) : Promise.reject(new Error(String(r.status)))))
      .then((s) => (this.status = s))
      .catch(() => (this.status = { configured: false, model: '', offline: true }))
      .then(() => this.onStatus())
  }

  /** True when the connected band is the kit's pretend band (its microphone plays a sample recording). */
  get pretend() {
    return this.adapter()?.link === 'sim'
  }

  unavailable() {
    const a = this.adapter()
    if (a?.status === 'connecting') return `Connecting to band ${BAND_NUMBER}…`
    if (a?.status === 'reconnecting') return `Band ${BAND_NUMBER} dropped; reconnecting…`
    if (a?.status === 'error' && a.error) return a.error
    // This page holds its own link: a band connected in another tab or app is invisible here.
    if (!a?.band || !a.connected) return `Band ${BAND_NUMBER} isn’t connected on this page. Connect it here (it takes one Bluetooth connection at a time: close other tabs using it).`
    if (typeof AudioDecoder !== 'function') return 'This browser cannot decode the band’s sound: use a current Chrome or Edge.'
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
    const band = this.adapter()!.band!
    const rec: Recording = { cb, ctx, chunks: [], samples: 0, heardAt: null, lastLoudAt: 0, cleanup: () => {} }
    let sound: BandAudio
    try {
      sound = new BandAudio(
        (s) => {
          if (this.rec !== rec) return
          rec.chunks.push(s)
          rec.samples += s.length
          const level = rms(s)
          const now = performance.now()
          cb.onLevel?.(Math.min(1, level * 8))
          if (level > SPEECH_RMS) {
            rec.heardAt ??= now
            rec.lastLoudAt = now
          }
          const seconds = rec.samples / AUDIO_RATE
          const quietAfterSpeech = rec.heardAt !== null && now - rec.lastLoudAt > QUIET_STOP_MS && now - rec.heardAt > 500
          if (seconds >= MAX_RECORD_S || quietAfterSpeech) this.finish()
        },
        { onError: (e) => (this.rec === rec ? (this.stop(), cb.onError(e.message)) : undefined) },
      )
    } catch (e) {
      return cb.onError(e instanceof Error ? e.message : String(e))
    }
    const offAudio = band.on('audio', (a) => sound.push(a))
    const offReconnect = band.on('reconnected', () => sound.restart())
    const offDrop = band.on('disconnect', () => {
      if (this.rec !== rec) return
      if (rec.samples / AUDIO_RATE >= MIN_RECORD_S) this.finish()
      else {
        this.stop()
        cb.onError(`Band ${BAND_NUMBER} disconnected while recording.`)
      }
    })
    rec.cleanup = () => {
      offAudio()
      offReconnect()
      offDrop()
      sound.close()
      if (band.connected) void band.configure({ audio: false }).catch(() => {})
    }
    this.rec = rec
    band
      .configure({ audio: true })
      .then(() => this.rec === rec && cb.onState('listening'))
      .catch((err: unknown) => {
        if (this.rec !== rec) return
        this.stop()
        cb.onError(`Band ${BAND_NUMBER} would not turn its microphone on: ${err instanceof Error ? err.message : String(err)}`)
      })
  }

  /** Stop recording and send what was heard to Gemini. */
  finish() {
    const rec = this.rec
    if (!rec) return
    this.rec = null
    rec.cleanup()
    const { cb, ctx } = rec
    if (rec.samples / AUDIO_RATE < MIN_RECORD_S) {
      cb.onState('stopped')
      return cb.onError('Nothing was recorded from the band (under half a second of sound).')
    }
    const all = new Float32Array(rec.samples)
    let at = 0
    for (const c of rec.chunks) {
      all.set(c, at)
      at += c.length
    }
    const audio = toBase64(encodeWav(all, AUDIO_RATE))
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

export class TypedProvider implements VoiceProvider {
  id = 'typed' as const
  label = 'Type the request'
  notice = 'Nothing is recorded or sent.'
  unavailable() {
    return null
  }
  start() {}
  stop() {}
}
