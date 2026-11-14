// Minimal types for the parts of vexo-open-kit (plain JS, not edited) that this app uses.
// Aliased in vite.config.ts: 'vexo-kit' → ../vexo-open-kit/js/src, 'vexo-speech' → ../vexo-open-kit/dashboard/speech.

declare module 'vexo-kit/index.js' {
  export interface MotionEvent {
    /** band milliseconds since it started */
    t: number
    ax: number | null
    ay: number | null
    az: number | null
    /** degrees / second */
    gx: number | null
    gy: number | null
    gz: number | null
    n: number | null
    time: number
  }
  export interface AudioEvent {
    seq: number
    opus: Uint8Array
    time: number
  }
  export class VexoError extends Error {
    code: string
  }
  export class SimTransport {
    constructor(number: number, options?: Record<string, unknown>)
    playMotion(fn: (s: number) => Record<string, number>, options?: { seconds?: number }): void
    stopMotion(): void
    dropLink(seconds?: number): void
  }
  export class Band {
    static connect(number: number, options?: { transport?: 'ble' | 'serial' | 'sim' | SimTransport; autoReconnect?: boolean }): Promise<Band>
    readonly number: number
    readonly name: string
    readonly connected: boolean
    readonly transportKind: string
    readonly info: { firmware: string; features: string[]; capabilities: string[] }
    on(type: 'motion', fn: (e: MotionEvent) => void): () => void
    on(type: 'audio', fn: (e: AudioEvent) => void): () => void
    on(type: 'disconnect' | 'reconnecting' | 'reconnected' | 'stream-taken', fn: (e: Record<string, unknown>) => void): () => void
    configure(options: Record<string, unknown>): Promise<unknown>
    disconnect(): Promise<void>
  }
}

declare module 'vexo-speech/deepgram.js' {
  export interface DeepgramLink {
    start(callbacks: {
      onText: (t: { final: boolean; text: string; end: number | null }) => void
      onState?: (state: 'listening' | 'off') => void
      onError?: (problem: string) => void
    }): void
    packet(opus: Uint8Array): void
    restart(): void
    stop(): void
  }
  export function deepgramLink(options: { key: string }): DeepgramLink
}
