// Speech capture for the Voice action. Three providers, chosen by the user:
//   band     — the Vexo band's microphone (Opus) → Deepgram, via the kit's own
//              deepgramLink. Needs the team's Deepgram key typed into the page;
//              it lives in memory only, never in storage, the URL or a file.
//   browser  — this computer's microphone through the browser's speech
//              recognition. In Chrome the audio is sent to Google to transcribe.
//   typed    — no microphone at all.
// Every provider that sends sound off the computer says so before it starts.

import type { VexoBandAdapter } from '../../wearable/vexoBandAdapter'

export type VoiceProviderId = 'band' | 'browser' | 'typed'

export interface VoiceCallbacks {
  onText(text: string, final: boolean): void
  onState(state: 'listening' | 'stopped'): void
  onError(message: string): void
}

export interface VoiceProvider {
  id: VoiceProviderId
  label: string
  /** What leaves the computer, shown before listening starts. */
  notice: string
  /** null when ready, else why not. */
  unavailable(): string | null
  start(cb: VoiceCallbacks): void
  stop(): void
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
    rec.onerror = (e) => cb.onError(e.error === 'not-allowed' ? 'Microphone permission was refused.' : `Speech recognition error: ${e.error}`)
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
