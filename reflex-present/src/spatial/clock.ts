/**
 * Maps a source's own millisecond clock (e.g. wearable firmware `millis()`)
 * onto performance.now(). Uses the minimum observed (local − remote) offset:
 * transport delay only ever adds latency, so the smallest offset seen is the
 * closest to the true clock offset. Adapters call `toLocal` on each packet.
 */
export class ClockAligner {
  private offset: number | null = null

  toLocal(remoteMs: number, receivedAtLocalMs: number): number {
    const candidate = receivedAtLocalMs - remoteMs
    if (this.offset === null || candidate < this.offset) this.offset = candidate
    return remoteMs + this.offset
  }

  reset() {
    this.offset = null
  }
}
