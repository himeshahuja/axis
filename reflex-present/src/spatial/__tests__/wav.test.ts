import { describe, expect, it } from 'vitest'
import { encodeWav, rms, toBase64 } from '../radial/actions/wav'

describe('WAV encoding of band audio', () => {
  it('writes a 16 kHz mono 16-bit PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16000)
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.subarray(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(8)
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32767, 32767])
    expect(wav.length).toBe(52)
  })

  it('base64 round-trips for large buffers', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => i % 251)
    expect(Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0))).toEqual(bytes)
  })

  it('rms', () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5)
    expect(rms(new Float32Array())).toBe(0)
  })
})
