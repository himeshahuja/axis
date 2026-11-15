// Scene progression for the pitch. Pure: the page feeds it drops, activations,
// completed actions and key presses; it decides what (if anything) changes.
//
// Rules that keep a live demo safe:
//  - grabbing or dropping an object never advances a scene unless the current
//    beat's trigger names that interaction;
//  - while a transition plays, further advances are ignored (no double skips);
//  - "next" first completes a pending beat whose fallback is allowed, so a
//    clicker always reproduces the gesture's result deterministically.

import type { RadialAction } from '../spatial/radial/types'
import type { Point2, SpatialObject } from '../spatial/types'
import type { PitchScene, SceneBeat } from './scenes'

export const TRANSITION_MS = 900

export interface PitchSnapshot {
  sceneIndex: number
  beatsDone: number
  doneBeats: string[]
  phase: 'live' | 'transition'
  sceneEnteredAt: number
  startedAt: number | null
  /** Bumped whenever objects must be re-laid out from scene data. */
  layoutVersion: number
  /** Why the last change happened (for rehearsal and the console). */
  lastReason: string
}

export type PitchChange =
  | { kind: 'scene'; from: number; to: number; keepCanvas: boolean }
  | { kind: 'beat'; scene: number; beat: SceneBeat }

interface Scheduled {
  at: number
  kind: 'advance_scene' | 'complete_next_beat'
  scene: number
}

export class PitchController {
  readonly scenes: PitchScene[]
  sceneIndex = 0
  /** Ids of the current scene's completed beats. */
  done = new Set<string>()
  phase: 'live' | 'transition' = 'live'
  sceneEnteredAt: number
  startedAt: number | null = null
  layoutVersion = 0
  lastReason = 'start'
  /** Objects activated (hovered long enough or grabbed) in the current scene. */
  activated = new Set<string>()
  private transitionUntil = 0
  private scheduled: Scheduled | null = null
  private listeners = new Set<(c: PitchChange) => void>()

  constructor(scenes: PitchScene[], now: number) {
    this.scenes = scenes
    this.sceneEnteredAt = now
  }

  onChange(fn: (c: PitchChange) => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(c: PitchChange) {
    for (const fn of this.listeners) fn(c)
  }

  get scene() {
    return this.scenes[this.sceneIndex]
  }

  get beatsDone() {
    return this.done.size
  }

  /** The first beat not yet done. */
  get pendingBeat(): SceneBeat | null {
    return this.scene.beats.find((b) => !this.done.has(b.id)) ?? null
  }

  snapshot(): PitchSnapshot {
    return {
      sceneIndex: this.sceneIndex,
      beatsDone: this.beatsDone,
      doneBeats: [...this.done],
      phase: this.phase,
      sceneEnteredAt: this.sceneEnteredAt,
      startedAt: this.startedAt,
      layoutVersion: this.layoutVersion,
      lastReason: this.lastReason,
    }
  }

  // ---- navigation -------------------------------------------------------------------------
  goto(index: number, now: number, reason = 'goto'): boolean {
    if (index < 0 || index >= this.scenes.length || index === this.sceneIndex) return false
    if (now < this.transitionUntil) return false
    const from = this.sceneIndex
    const keepCanvas = !!this.scenes[from].canvasGroup && this.scenes[from].canvasGroup === this.scenes[index].canvasGroup
    this.sceneIndex = index
    this.done = new Set()
    this.activated.clear()
    this.scheduled = null
    this.phase = 'transition'
    this.transitionUntil = now + TRANSITION_MS
    this.sceneEnteredAt = now
    this.startedAt ??= now
    if (!keepCanvas) this.layoutVersion++
    this.lastReason = reason
    this.emit({ kind: 'scene', from, to: index, keepCanvas })
    return true
  }

  /** Clicker / → : finish a pending fallback-able beat, else go to the next scene. */
  next(now: number) {
    if (now < this.transitionUntil) return false
    const beat = this.pendingBeat
    if (beat?.fallback) return this.completeBeat(now, `next key → ${beat.id}`)
    return this.goto(this.sceneIndex + 1, now, 'next key')
  }

  nextScene(now: number) {
    return this.goto(this.sceneIndex + 1, now, 'next scene')
  }

  previous(now: number) {
    return this.goto(this.sceneIndex - 1, now, 'previous')
  }

  /** Back to the opening scene, fresh. */
  reset(now: number) {
    this.transitionUntil = 0
    const from = this.sceneIndex
    this.sceneIndex = 0
    this.done = new Set()
    this.activated.clear()
    this.scheduled = null
    this.phase = 'transition'
    this.transitionUntil = now + TRANSITION_MS
    this.sceneEnteredAt = now
    this.startedAt = null
    this.layoutVersion++
    this.lastReason = 'reset'
    this.emit({ kind: 'scene', from, to: 0, keepCanvas: false })
  }

  /** Re-lay out the current scene's objects from its data (after accidental moves). */
  resetLayout() {
    this.layoutVersion++
    this.lastReason = 'layout reset'
  }

  // ---- beats ----------------------------------------------------------------------------------
  completeBeat(now: number, reason: string, beat: SceneBeat | null = this.pendingBeat): boolean {
    if (!beat || this.done.has(beat.id)) return false
    this.done.add(beat.id)
    if (beat.layout) this.layoutVersion++
    this.lastReason = reason
    if (beat.then) this.scheduled = { at: now + beat.then.delayMs, kind: beat.then.kind, scene: this.sceneIndex }
    this.emit({ kind: 'beat', scene: this.sceneIndex, beat })
    return true
  }

  private live(now: number) {
    return now >= this.transitionUntil
  }

  /**
   * An object was released after a move (from the interaction engine's undo log).
   * Any pending drop-type beat may match, so slots can be filled in any order.
   */
  onDrop(objectId: string, from: Point2, to: Point2, objects: SpatialObject[], aspect: number, now: number) {
    if (!this.live(now)) return false
    for (const beat of this.scene.beats) {
      if (this.done.has(beat.id)) continue
      const t = beat.trigger
      if (t.kind === 'follow_up') break // later beats wait for this one
      if (t.kind === 'any_drop') return this.completeBeat(now, `dropped ${objectId}`, beat)
      if (t.kind === 'object_drop' && t.objectId === objectId) {
        const moved = Math.hypot((to.x - from.x) * aspect, to.y - from.y)
        if (moved >= t.minMove) return this.completeBeat(now, `moved ${objectId} ${moved.toFixed(2)}`, beat)
      }
      if (t.kind === 'drop_in_zone' && (t.objectId === '*' || t.objectId === objectId)) {
        const o = objects.find((x) => x.id === objectId)
        const z = this.scene.zones?.find((x) => x.id === t.zoneId)
        if (!o || !z) continue
        const cx = o.x + o.w / 2
        const cy = o.y + o.h / 2
        const m = 0.03 // a little forgiveness at the edges
        if (cx >= z.x - m && cx <= z.x + z.w + m && cy >= z.y - m && cy <= z.y + z.h + m) return this.completeBeat(now, `${objectId} into ${z.id}`, beat)
      }
    }
    return false
  }

  /**
   * Someone spoke a request into Voice while holding an object. In the pitch the spoken
   * request itself is the cue: the scene's answer (a card, a graph) replaces the model's reply.
   */
  onVoiceReply(objectId: string, transcript: string, now: number) {
    if (!this.live(now) || !transcript.trim()) return false
    const beat = this.scene.beats.find((b) => !this.done.has(b.id) && b.trigger.kind === 'voice_reply' && (!b.trigger.objectId || b.trigger.objectId === objectId))
    return beat ? this.completeBeat(now, `asked about ${objectId}: “${transcript.slice(0, 60)}”`, beat) : false
  }

  /** Whether the current scene turns a spoken request on this object into a scene beat. */
  takesVoiceFor(objectId: string) {
    return this.scene.beats.some((b) => b.trigger.kind === 'voice_reply' && (!b.trigger.objectId || b.trigger.objectId === objectId))
  }

  /** An annotation arrow was drawn on the current scene. */
  onArrow(now: number) {
    if (!this.live(now)) return false
    const beat = this.scene.beats.find((b) => !this.done.has(b.id) && b.trigger.kind === 'arrow')
    return beat ? this.completeBeat(now, 'arrow drawn', beat) : false
  }

  /** An object was pointed at long enough, or grabbed (used for highlighting only). */
  onActivate(objectId: string) {
    this.activated.add(objectId)
  }

  /** A radial action finished executing. Action beats may happen in any order. */
  onAction(action: RadialAction, now: number) {
    const beat = this.scene.beats.find((b) => !this.done.has(b.id) && b.trigger.kind === 'action_complete' && b.trigger.action === action)
    return beat ? this.completeBeat(now, `${action} completed`, beat) : false
  }

  tick(now: number) {
    if (this.phase === 'transition' && now >= this.transitionUntil) this.phase = 'live'
    const s = this.scheduled
    if (!s || now < s.at || s.scene !== this.sceneIndex) return
    this.scheduled = null
    if (s.kind === 'advance_scene') {
      this.transitionUntil = 0
      this.goto(this.sceneIndex + 1, now, 'beat follow-up')
    } else this.completeBeat(now, 'beat follow-up')
  }
}
