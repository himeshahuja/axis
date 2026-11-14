import { useCallback, useEffect, useRef, useState } from 'react'
import { PresenterActions } from '../components/PresenterActions'
import { LocalMemoryStore } from '../spatial/radial/actions/memory'
import { BandDeepgramProvider, BandGeminiProvider, forgetDeepgramKey, hasDeepgramKey, setDeepgramKey, type VoiceProvider } from '../spatial/radial/actions/voice'
import { isMenuOpen } from '../spatial/radial/types'
import { exposeForDev, SpatialRuntime, useRuntime } from '../spatial/runtime'
import type { SpatialObject } from '../spatial/types'
import { CameraPreview } from '../spatial/ui/CameraPreview'
import { FieldCanvas } from '../site/FieldCanvas'
import { pointer as fieldPointer } from '../site/motion'
import { PitchController, TRANSITION_MS } from './pitchController'
import { EVENT, objectsFor, PRODUCT, SCENES, type PitchObject, type PitchScene } from './scenes'
import { BAND_NUMBER } from '../spatial/wearable/band'
import { matchesPhrase } from './voiceTriggers'
import { clearBand, readFromBand, saveToBand, storageOf, type BandMemoryRow } from './vexoMemory'
import { openChannel, type StageCommand, type StageStatus } from './sync'
import { MemoryGhost, ObjectVisual } from './visuals'

const pct = (v: number) => `${v * 100}%`
/** How far (stage widths) a swipe from the right quarter must travel to advance. */
const SWIPE_MIN = 0.2
/** A swipe may start anywhere empty in the right quarter, or anywhere in this edge strip (no object reaches it). */
const EDGE_X = 0.955
const swipeStart = (p: { x: number; y: number }, hit: unknown) => p.x >= EDGE_X || (p.x >= 0.75 && !hit)
const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---- scene copy (the typography layer) ------------------------------------------------------
function SceneCopy({ scene, done, state }: { scene: PitchScene; done: ReadonlySet<string>; state: 'enter' | 'exit' }) {
  const cls = `pitch-copy copy-${scene.id} is-${state}`
  switch (scene.id) {
    case 'problem':
      return (
        <section className={cls}>
          <h1>
            <span>We think</span>
            <span>with our</span>
            <span className="hot">hands.</span>
          </h1>
          <h2 className={done.has('clear') ? 'struck' : ''}>Our computers don’t.</h2>
        </section>
      )
    case 'product':
      return (
        <section className={cls}>
          <p className="kicker">{scene.kicker}</p>
          <h1 className="wordmark">{PRODUCT}</h1>
          <h2>
            <span>Point.</span> <span>Hold.</span> <span className="hot">Act.</span>
          </h2>
          <p className="lede">A spatial workspace that understands what you point at — and what you want to do with it.</p>
          {!done.has('placed-action') && <p className="hint">Drag each piece into place</p>}
        </section>
      )
    case 'demo':
      return (
        <section className={cls}>
          <p className="kicker">
            {scene.number} — {scene.kicker}
          </p>
          <h1>
            Point at the <span className="hot">information.</span>
          </h1>
          <p className="hint">{done.has('spotlit') ? 'Close your hand · hold · choose · open' : 'Pull the chart into the spotlight'}</p>
        </section>
      )
    case 'compare':
      return (
        <section className={cls}>
          <p className="kicker">
            {scene.number} — {scene.kicker}
          </p>
          <h1>
            Operate the controls, or <span className="hot">say what you mean.</span>
          </h1>
        </section>
      )
    case 'vision':
      return (
        <section className={cls}>
          {!done.has('statement') ? (
            <>
              <p className="kicker">
                {scene.number} — {scene.kicker}
              </p>
              <h1 className="quiet">
                Interfaces that adapt to how <span className="hot">people already communicate.</span>
              </h1>
            </>
          ) : (
            <div className="closing">
              <h1>
                <span>The interface</span>
                <span>
                  is <em className="hot">you.</em>
                </span>
              </h1>
              <p>Computing for the world beyond the keyboard.</p>
              <footer>
                <strong>{PRODUCT}</strong>
                <span>{EVENT}</span>
              </footer>
            </div>
          )}
        </section>
      )
  }
}

/** Scene 05's empty right half: blank until the band hears something, then shows the words. */
function VoiceSpace({ heard, listening }: { heard: string; listening: boolean }) {
  return (
    <div className={`pitch-voice-space ${listening ? 'is-listening' : ''}`} aria-live="polite">
      {heard && <p>“{heard}”</p>}
    </div>
  )
}

// ---- the stage ------------------------------------------------------------------------------
export function PitchStage() {
  const [rt] = useState(() => new SpatialRuntime(objectsFor(SCENES[0], [])))
  const [ctl] = useState(() => new PitchController(SCENES, performance.now()))
  useRuntime(rt)
  const stageRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'presentation' | 'rehearsal'>(() => (new URLSearchParams(location.search).get('mode') === 'rehearsal' ? 'rehearsal' : 'presentation'))
  const [exiting, setExiting] = useState<number | null>(null)
  const [ghost, setGhost] = useState<{ o: SpatialObject; key: string } | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const applied = useRef(-1)
  const seenMoves = useRef(new WeakSet<object>())
  const dwell = useRef<{ id: string | null; since: number }>({ id: null, since: 0 })
  const lastAction = useRef<number | null>(null)
  const baseHold = useRef<number | null>(null)
  // Swipe-to-advance: grab empty space in the right quarter and pull it across.
  const mousePressed = useRef(false)
  const wasPressed = useRef(false)
  const swipe = useRef<{ startX: number; x: number } | null>(null)
  const commandRef = useRef<(c: StageCommand) => void>(() => {})
  // Memory on the band.
  const [memOpen, setMemOpen] = useState(false)
  const [memRows, setMemRows] = useState<{ rows: BandMemoryRow[]; from: 'band' | 'browser'; at: number } | null>(null)
  const [memToast, setMemToast] = useState<{ text: string; ok: boolean; key: number } | null>(null)
  const [heard, setHeard] = useState('')
  const [listen, setListen] = useState<{ state: 'off' | 'listening' | 'thinking' | 'unavailable' | 'error'; via?: string; note?: string }>({ state: 'off' })
  const [gemTick, setGemTick] = useState(0)
  const [voice] = useState(() => ({
    gemini: new BandGeminiProvider(() => rt.radial.band, () => setGemTick((t) => t + 1)),
    deepgram: new BandDeepgramProvider(() => rt.radial.band),
  }))

  const scene = ctl.scene
  const done = ctl.done

  // One runtime for the whole pitch: camera, calibration and tracking survive every scene change.
  useEffect(() => {
    rt.start()
    exposeForDev(rt)
    // Captured once: in dev StrictMode this effect runs twice, after the first run disabled holds.
    baseHold.current ??= rt.radial.controller.config.holdMs
    const hold = baseHold.current
    rt.detector.mode = 'grasp'
    rt.detector.reset()
    rt.autoRangeCapture = true
    // A camera cursor wobbles more than a mouse while the hand is held closed: allow it.
    rt.radial.controller.config.holdMaxMove = 0.05
    void rt.startCamera().then(() => rt.updateProfile({ mirrorX: true }))
    const off = ctl.onChange((c) => {
      if (c.kind !== 'scene') return
      const next = ctl.scenes[c.to]
      rt.radial.controller.cancel(performance.now(), 'scene changed')
      rt.radial.controller.config.holdMs = next.radial ? hold : 1e9
      if (!c.keepCanvas) {
        for (const id of [...rt.radial.executor.explainCards.keys()]) rt.radial.executor.closeExplain(id)
        rt.radial.executor.closeVoice()
      }
      dwell.current = { id: null, since: 0 }
      setExiting(c.from)
      window.setTimeout(() => setExiting((v) => (v === c.from ? null : v)), TRANSITION_MS + 150)
    })
    rt.radial.controller.config.holdMs = ctl.scene.radial ? hold : 1e9
    return () => {
      off()
      rt.dispose()
    }
  }, [rt, ctl])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => rt.setCanvasSize(e.contentRect.width, e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [rt])

  // ---- commands (keys, console, air buttons share these) ----------------------------------------
  const calibrate = useCallback(async () => {
    if (rt.tracker.status !== 'running') await rt.startCamera()
    if (rt.tracker.status === 'running') rt.startCalibration('region')
  }, [rt])

  const command = useCallback(
    (c: StageCommand) => {
      const now = performance.now()
      if (c.cmd === 'next') ctl.next(now)
      else if (c.cmd === 'nextScene') ctl.nextScene(now)
      else if (c.cmd === 'previous') ctl.previous(now)
      else if (c.cmd === 'goto') ctl.goto(c.index, now, 'console')
      else if (c.cmd === 'reset') ctl.reset(now)
      else if (c.cmd === 'resetLayout') ctl.resetLayout()
      else if (c.cmd === 'toggleGestures') rt.cameraGesturesEnabled = !rt.cameraGesturesEnabled
      else if (c.cmd === 'camera') {
        if (rt.tracker.status === 'running' || rt.tracker.status === 'loading') rt.stopCamera()
        else void rt.startCamera().then(() => rt.updateProfile({ mirrorX: true }))
      } else if (c.cmd === 'calibrate') void calibrate()
      else if (c.cmd === 'toggleMode') setMode((m) => (m === 'presentation' ? 'rehearsal' : 'presentation'))
      else if (c.cmd === 'recenter') rt.recenter()
      else if (c.cmd === 'openMenu') {
        const id = rt.interaction.hoverId ?? rt.interaction.grabbedId ?? (scene.radial ? scene.objects[0].id : null)
        if (id && scene.radial) {
          rt.interaction.yieldGrab(now, 'radial reopened')
          rt.radial.forceOpen(id)
        }
      }
    },
    [ctl, rt, calibrate, scene],
  )

  commandRef.current = command

  // Grasping an on-stage control (data-air-action) runs it instead of grabbing what is under it.
  useEffect(() => {
    rt.onControlSelect = (p) => {
      if (!p.valid || !stageRef.current || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false
      const b = stageRef.current.getBoundingClientRect()
      if (b.width <= 0 || b.height <= 0) return false
      const action = document.elementFromPoint(b.left + p.x * b.width, b.top + p.y * b.height)?.closest<HTMLElement>('[data-air-action]')?.dataset.airAction
      // The right edge strip belongs to the swipe: don't let the grab land on a nearby object.
      if (!action) return p.x >= EDGE_X
      if (action === 'next') command({ type: 'cmd', cmd: 'next' })
      else if (action === 'memory') setMemOpen((v) => !v)
      else if (action.startsWith('close-explain:')) rt.radial.executor.closeExplain(action.slice('close-explain:'.length))
      else return false
      return true
    }
    return () => {
      rt.onControlSelect = null
    }
  }, [rt, command])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return
      if (rt.calibration.kind !== 'none') {
        if (e.key === 'Escape') {
          rt.cancelCalibration()
          e.preventDefault()
        }
        return
      }
      if (rt.radial.capturesInput && rt.onKey(e)) return e.preventDefault()
      const k = e.key.toLowerCase()
      const run = (cmd: Exclude<StageCommand, { cmd: 'goto' }>['cmd']) => command({ type: 'cmd', cmd })
      if (e.key === 'ArrowRight' || e.key === 'PageDown') run(e.shiftKey ? 'nextScene' : 'next')
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') run('previous')
      else if (e.key === 'Home') run('reset')
      else if (k === 'd' && !e.metaKey) run('toggleMode')
      else if (k === 'g') run('toggleGestures')
      else if (k === 'k') run('calibrate')
      else if (k === 'c' && !e.metaKey) run('camera')
      else if (k === 'x') run('resetLayout')
      else if (k === 'v') setShowCamera((v) => !v)
      else if (k === 'm' && !e.metaKey) run('openMenu')
      else if (k === 'p') window.open('/pitch?view=presenter', 'axis-presenter', 'popup,width=1180,height=760')
      else if (k === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      else if (!rt.onKey(e)) return
      e.preventDefault()
    }
    const onUp = () => {
      mousePressed.current = false
      rt.onMouseReleasedElsewhere()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
  }, [rt, command])

  // ---- console channel -------------------------------------------------------------------------
  const statusRef = useRef<() => StageStatus>(() => ({}) as StageStatus)
  statusRef.current = () => ({
    type: 'state',
    sentAt: Date.now(),
    stageNow: performance.now(),
    ...ctl.snapshot(),
    camera: rt.tracker.status,
    cameraError: rt.tracker.error,
    handTracked: !!rt.latestFeatures,
    band: rt.radial.band ? `${rt.radial.band.status}${rt.radial.band.link === 'sim' ? ' (pretend)' : ''}` : 'not connected',
    gesturesEnabled: rt.cameraGesturesEnabled,
    gestureMode: rt.detector.mode,
    mode,
    radialStatus: rt.radial.state.status,
    memoryCount: rt.radial.executor.memory.list().length,
  })
  useEffect(() => {
    const ch = openChannel()
    if (!ch) return
    ch.onmessage = (e: MessageEvent<StageCommand | { type: 'clearMemory' }>) => {
      if (e.data?.type === 'cmd') command(e.data)
      else if (e.data?.type === 'clearMemory') {
        const m = rt.radial.executor.memory
        if (m instanceof LocalMemoryStore) m.clear()
      }
    }
    const id = window.setInterval(() => ch.postMessage(statusRef.current()), 250)
    return () => {
      window.clearInterval(id)
      ch.close()
    }
  }, [command, rt])

  // ---- scene 05: wait for the spoken question, through the band's own microphone ------------------
  const waiting = scene.id === 'compare' && !done.has('asked')
  const bandReady = !!rt.radial.band?.connected
  const keyReady = hasDeepgramKey()
  useEffect(() => {
    if (!waiting) {
      setListen({ state: 'off' })
      setHeard('')
      return
    }
    // Gemini (key on this laptop's dev server) if it is set up, else Deepgram (key typed in rehearsal).
    const gemini = voice.gemini.status !== null && !voice.gemini.unavailable()
    const provider: VoiceProvider | null = gemini ? voice.gemini : !voice.deepgram.unavailable() ? voice.deepgram : null
    if (!provider) {
      setListen({ state: 'unavailable', note: voice.gemini.unavailable() ?? voice.deepgram.unavailable() ?? '' })
      return
    }
    const via = gemini ? 'mic → Gemini' : 'mic → Deepgram'
    const note = gemini ? 'listening · what it hears is sent to Google Gemini' : 'listening · what it hears is sent to Deepgram'
    let alive = true
    let timer = 0
    const begin = () => {
      if (!alive) return
      provider.start({
        onText: (t) => {
          if (!alive) return
          setHeard(t)
          ctl.onVoice(t, matchesPhrase, performance.now())
        },
        onState: (st) => {
          if (!alive) return
          setListen({ state: st === 'stopped' ? 'off' : st, via, note })
          // Keep listening until the question is asked (Gemini returns one utterance at a time).
          if (st === 'stopped') timer = window.setTimeout(begin, 350)
        },
        onError: (m) => {
          if (!alive) return
          setListen({ state: 'error', via, note: m })
          timer = window.setTimeout(begin, 2500)
        },
      })
    }
    begin()
    return () => {
      alive = false
      window.clearTimeout(timer)
      provider.stop()
    }
  }, [waiting, bandReady, keyReady, gemTick, voice, ctl])

  // ---- per frame: feed the controller from the live engine ---------------------------------------
  useEffect(() => {
    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      frame()
    }
    // Dev only: step the runtime and the pitch by hand (scripted QA in throttled windows).
    if (import.meta.env.DEV) (window as unknown as { __pitchStep?: () => void; __pitch?: PitchController }).__pitchStep = () => (rt.tick(performance.now()), frame())
    if (import.meta.env.DEV) (window as unknown as { __pitch?: PitchController }).__pitch = ctl
    const frame = () => {
      const now = performance.now()
      ctl.tick(now)
      const ix = rt.interaction
      if (ctl.layoutVersion !== applied.current) {
        applied.current = ctl.layoutVersion
        rt.setObjects(objectsFor(ctl.scene, ctl.done))
      }
      const move = ix.undoStack.at(-1)
      if (move && !seenMoves.current.has(move)) {
        seenMoves.current.add(move)
        ctl.onDrop(move.id, move.from, move.to, ix.objects, ix.aspect, now)
      }
      const focus = ix.grabbedId ?? ix.hoverId
      if (focus !== dwell.current.id) dwell.current = { id: focus, since: now }
      if (focus && (ix.grabbedId || now - dwell.current.since > 450)) ctl.onActivate(focus)
      const last = rt.radial.executor.last
      if (last && last.event.id !== lastAction.current) {
        lastAction.current = last.event.id
        if (last.event.action === 'remember') {
          const o = ix.objects.find((x) => x.id === last.event.objectId)
          if (o) setGhost({ o: { ...o }, key: `${o.id}-${last.event.id}` })
          const entry = rt.radial.executor.lastSaved
          const store = rt.radial.band?.connected ? storageOf(rt.radial.band.band) : null
          if (entry && store) {
            saveToBand(store, entry)
              .then((key) => setMemToast({ text: `Saved to Vexo band ${BAND_NUMBER} · storage key ${key}`, ok: true, key: Date.now() }))
              .catch((err: unknown) => setMemToast({ text: `Band didn’t save it (${err instanceof Error ? err.message : String(err)}) — kept in this browser`, ok: false, key: Date.now() }))
          } else if (entry) {
            setMemToast({ text: `Saved in this browser — connect band ${BAND_NUMBER} to save it on the wristband`, ok: false, key: Date.now() })
          }
        }
        ctl.onAction(last.event.action, now)
      }
      // Swipe: a press that starts on empty space in the right quarter, released after
      // pulling at least a fifth of the stage to the left, is "next".
      const pressed = mousePressed.current || (rt.detector.engaged && rt.pointer.source !== 'mouse')
      const pt = rt.pointer
      if (pressed && !wasPressed.current && pt.valid && swipeStart(pt, ix.hitTest(pt)) && !ix.grabbedId && !rt.radial.controller.isOpen && rt.calibration.kind === 'none') {
        swipe.current = { startX: pt.x, x: pt.x }
      }
      if (swipe.current && pt.valid) swipe.current.x = pt.x
      if (!pressed && wasPressed.current && swipe.current) {
        if (swipe.current.startX - swipe.current.x >= SWIPE_MIN) commandRef.current({ type: 'cmd', cmd: 'next' })
        swipe.current = null
      }
      wasPressed.current = pressed

      // The background field follows the hand as it follows a mouse.
      const p = rt.pointer
      const el = stageRef.current
      if (el && p.valid && p.source !== 'mouse') {
        const b = el.getBoundingClientRect()
        fieldPointer.x = b.left + p.x * b.width
        fieldPointer.y = b.top + p.y * b.height
        fieldPointer.active = true
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [rt, ctl])

  // Memory is read back from the band (on connect, after each save, and when opened),
  // so what it shows — and the count on the tab — is what the wristband really holds.
  useEffect(() => {
    if (!memOpen && !bandReady) return
    let alive = true
    const store = rt.radial.band?.connected ? storageOf(rt.radial.band.band) : null
    if (store) {
      readFromBand(store)
        .then((rows) => alive && setMemRows({ rows, from: 'band', at: Date.now() }))
        .catch(() => alive && setMemRows({ rows: [], from: 'band', at: 0 }))
    } else {
      const rows = rt.radial.executor.memory.list().map((e, i) => ({ key: -1 - i, title: e.title, type: e.type, summary: '', at: Math.floor(new Date(e.createdAt).getTime() / 1000) }))
      setMemRows({ rows, from: 'browser', at: Date.now() })
    }
    return () => {
      alive = false
    }
  }, [memOpen, memToast, bandReady, rt])

  useEffect(() => {
    if (!memToast) return
    const id = window.setTimeout(() => setMemToast(null), 3200)
    return () => window.clearTimeout(id)
  }, [memToast])

  useEffect(() => {
    if (!ghost) return
    const id = window.setTimeout(() => setGhost(null), 1000)
    return () => window.clearTimeout(id)
  }, [ghost])

  // ---- render --------------------------------------------------------------------------------------
  const ix = rt.interaction
  const p = rt.pointer
  const now = performance.now()
  // Render in the scene's own order: the engine puts a grabbed object last (to hit-test it
  // first), and moving its DOM node would restart its entrance animation (it vanished).
  const sceneOrder = new Map(scene.objects.map((o, i) => [o.id, i]))
  const orderedObjects = [...(ix.objects as PitchObject[])].sort((a, b) => (sceneOrder.get(a.id) ?? 0) - (sceneOrder.get(b.id) ?? 0))
  const grabbedObj = ix.grabbedId ? ix.objects.find((o) => o.id === ix.grabbedId) : null
  const overZone = (z: { x: number; y: number; w: number; h: number }) => {
    if (!grabbedObj) return false
    const cx = grabbedObj.x + grabbedObj.w / 2
    const cy = grabbedObj.y + grabbedObj.h / 2
    return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h
  }
  const zoneFilled = (zoneId: string) => scene.beats.some((b) => b.trigger.kind === 'drop_in_zone' && b.trigger.zoneId === zoneId && done.has(b.id))
  const holdP = rt.radial.state.status === 'HOLDING' ? rt.radial.state.holdProgress : null
  const radialOpen = isMenuOpen(rt.radial.state.status)
  const calibrating = rt.calibration.kind === 'region'
  const toStage = (e: React.MouseEvent) => {
    const b = stageRef.current!.getBoundingClientRect()
    // A zero-size stage (window being resized, or hidden) must not turn into NaN pointers.
    return { x: b.width > 0 ? (e.clientX - b.left) / b.width : 0.5, y: b.height > 0 ? (e.clientY - b.top) / b.height : 0.5 }
  }
  const discarding = scene.id === 'problem' && done.has('clear')
  const closing = scene.id === 'vision' && done.has('statement')
  const assembled = scene.id === 'vision' && done.has('assemble')
  const sceneElapsed = now - ctl.sceneEnteredAt
  const status = !rt.cameraGesturesEnabled
    ? 'Gestures paused · mouse and keys active'
    : rt.tracker.status === 'error'
      ? 'Camera unavailable · mouse and keys active'
      : rt.tracker.status === 'running' && !rt.latestFeatures
        ? 'Hand not in view'
        : rt.tracker.status === 'loading'
          ? 'Starting camera'
          : null

  return (
    <div className="pitch-root" data-mode={mode}>
      <div
        ref={stageRef}
        className={`pitch-stage scene-${scene.id} ${ctl.phase === 'transition' ? 'in-transition' : ''} ${closing ? 'is-closing' : ''} ${assembled ? 'is-assembled' : ''}`}
        onMouseMove={(e) => {
          const s = toStage(e)
          rt.onMouseMove(s.x, s.y)
        }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('.pitch-chrome-btn, .pitch-rehearsal, .pitch-calibrate, .pitch-memory')) return
          const s = toStage(e)
          mousePressed.current = true
          rt.onMouseButton(true, s.x, s.y)
        }}
        onMouseUp={(e) => {
          const s = toStage(e)
          mousePressed.current = false
          rt.onMouseButton(false, s.x, s.y)
        }}
      >
        <FieldCanvas className="pitch-field" spacing={34} radius={260} intensity={scene.id === 'product' || scene.id === 'vision' ? 1 : 0.6} />
        {showCamera && (
          <div className="pitch-mirror">
            <CameraPreview rt={rt} width={1280} fill guides={false} />
          </div>
        )}

        {exiting !== null && exiting !== ctl.sceneIndex && <SceneCopy key={`x-${SCENES[exiting].id}`} scene={SCENES[exiting]} done={new Set()} state="exit" />}
        <SceneCopy key={scene.id} scene={scene} done={done} state="enter" />

        {scene.id === 'product' && done.has('converge') && <div className="pitch-pipeline" aria-hidden="true" />}

        {(scene.zones ?? []).map((z) =>
          zoneFilled(z.id) ? null : (
            <div key={z.id} className={`pitch-zone ${overZone(z) ? 'is-over' : ''}`} style={{ left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h) }}>
              {z.index && <span className="zi">{z.index}</span>}
              <span className="zl">{z.label}</span>
            </div>
          ),
        )}

        <div className={`pitch-objects ${discarding ? 'is-discarding' : ''}`}>
          {orderedObjects.map((o, i) => {
            const hovered = ix.hoverId === o.id && !ix.grabbedId && !radialOpen
            const grabbed = ix.grabbedId === o.id
            const lit = scene.id === 'product' ? ctl.activated.has(o.id) || hovered || grabbed : hovered || grabbed
            const menu = radialOpen && rt.radial.state.objectId === o.id
            return (
              <div
                key={o.id}
                className={`pitch-obj v-${o.visual} ${hovered ? 'is-hover' : ''} ${grabbed ? 'is-grabbed' : ''} ${lit ? 'is-lit' : ''} ${menu ? 'is-menu' : ''}`}
                style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(o.h), '--tilt': `${assembled ? 0 : (o.tilt ?? 0)}deg`, '--i': i } as React.CSSProperties}
              >
                <ObjectVisual o={o} lit={lit} />
              </div>
            )
          })}
        </div>

        {scene.radial && !calibrating && <PresenterActions rt={rt} />}
        {ghost && <MemoryGhost key={ghost.key} o={ghost.o} stage={rt.canvasPx} />}
        {scene.id === 'compare' && !done.has('asked') && <VoiceSpace heard={heard} listening={listen.state === 'listening' || listen.state === 'thinking'} />}

        {/* chrome: deliberately sparse */}
        <div className="pitch-chrome">
          <span className="brand">{PRODUCT}</span>
          <span className="count">
            {scene.number} <i>/ {String(SCENES.length).padStart(2, '0')}</i>
          </span>
          <div className="progress">
            {SCENES.map((s, i) => (
              <b key={s.id} className={i < ctl.sceneIndex ? 'past' : i === ctl.sceneIndex ? 'now' : ''}>
                {i === ctl.sceneIndex && <i style={{ width: `${Math.min(100, (sceneElapsed / (s.targetSeconds * 1000)) * 100)}%` }} />}
              </b>
            ))}
          </div>
          {status && <span className="status">{status}</span>}
          <button className="pitch-chrome-btn air-next" data-air-action="next" onClick={() => command({ type: 'cmd', cmd: 'next' })} aria-label="Next">
            Next <span>→</span>
          </button>
        </div>

        {/* swipe affordance: the page edge you can grab */}
        {!calibrating && (() => {
          const sw = swipe.current
          const pull = sw ? Math.max(0, sw.startX - sw.x) : 0
          const nearEdge = !sw && p.valid && swipeStart(p, ix.hitTest(p)) && !ix.grabbedId && !radialOpen
          if (!sw && !nearEdge) return null
          return (
            <div className={`pitch-swipe ${sw ? 'is-pulling' : ''} ${pull >= SWIPE_MIN ? 'is-armed' : ''}`} style={{ width: pct(Math.min(0.6, 0.018 + pull)) }}>
              <span>{sw ? (pull >= SWIPE_MIN ? 'Let go — next' : 'Keep pulling') : 'Grab & pull ←'}</span>
            </div>
          )
        })()}

        {memToast && (
          <div key={memToast.key} className={`pitch-memtoast ${memToast.ok ? 'ok' : ''}`}>
            <b>{memToast.ok ? '✓' : '•'}</b> {memToast.text}
          </div>
        )}
        {scene.radial && (
          <button className="pitch-chrome-btn pitch-memtab" data-air-action="memory" onClick={() => setMemOpen((v) => !v)}>
            Memory <span>{memRows?.from === 'band' && bandReady ? memRows.rows.length : rt.radial.executor.memory.list().length}</span>
          </button>
        )}
        {memOpen && (
          <aside className="pitch-memory" onMouseUp={(e) => e.stopPropagation()}>
            <header>
              <strong>Memory</strong>
              <button className="pitch-chrome-btn" data-air-action="memory" onClick={() => setMemOpen(false)}>
                Close
              </button>
            </header>
            <p className={`src ${memRows?.from === 'band' ? 'ok' : ''}`}>
              {memRows?.from === 'band' ? `Saved on Vexo band ${BAND_NUMBER} — read back from the wristband just now` : `In this browser only — band ${BAND_NUMBER} is not connected`}
            </p>
            {memRows && memRows.rows.length === 0 && <p className="empty">Nothing remembered yet. Hold an object and choose Remember.</p>}
            <ul>
              {memRows?.rows.map((r) => (
                <li key={r.key}>
                  <strong>{r.title}</strong>
                  <span>
                    {r.type}
                    {r.key > 0 ? ` · key ${r.key}` : ''} · {r.at ? new Date(r.at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                  {r.summary && <p>{r.summary}</p>}
                </li>
              ))}
            </ul>
            {memRows?.from === 'band' && (
              <button
                className="pitch-chrome-btn"
                onClick={() => {
                  const store = rt.radial.band?.connected ? storageOf(rt.radial.band.band) : null
                  if (store && window.confirm(`Delete the pitch’s memory entries from band ${BAND_NUMBER}? This cannot be undone.`)) void clearBand(store).then(() => setMemRows({ rows: [], from: 'band', at: Date.now() }))
                }}
              >
                Clear from band…
              </button>
            )}
          </aside>
        )}

        {p.valid && !calibrating && (
          <div className={`pitch-cursor ${rt.detector.engaged || ix.grabbedId ? 'is-engaged' : ''} ${ix.hoverId ? 'is-over' : ''} ${holdP !== null ? 'is-holding' : ''}`} style={{ left: pct(p.x), top: pct(p.y) }}>
            {holdP !== null && (
              <svg className="pitch-hold-ring" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" className="track" />
                <circle cx="50" cy="50" r="44" className="fill" style={{ strokeDashoffset: `${276.5 * (1 - Math.min(1, holdP))}` }} />
              </svg>
            )}
          </div>
        )}

        {(listen.state === 'listening' || listen.state === 'thinking') && <div className="pitch-mic">Vexo band {listen.via} · {listen.note}</div>}
        {calibrating && <CalibrationOverlay rt={rt} />}
        {mode === 'rehearsal' && <Rehearsal rt={rt} ctl={ctl} onCommand={command} listen={listen} heard={heard} />}
      </div>
    </div>
  )
}

// ---- hand-range calibration (uses the runtime's automatic two-corner capture) ------------------
function CalibrationOverlay({ rt }: { rt: SpatialRuntime }) {
  const cal = rt.calibration
  const raw = rt.calibrationPointer
  const corners = cal.kind === 'region' ? cal.corners : []
  const first = corners[0] ? { x: rt.profile.mirrorX ? 1 - corners[0].x : corners[0].x, y: rt.profile.flipY ? 1 - corners[0].y : corners[0].y } : null
  return (
    <div className="pitch-calibrate">
      <CameraPreview rt={rt} width={1280} fill />
      {first && raw && <div className="range" style={{ left: pct(Math.min(first.x, raw.x)), top: pct(Math.min(first.y, raw.y)), width: pct(Math.abs(raw.x - first.x)), height: pct(Math.abs(raw.y - first.y)) }} />}
      {raw && <div className="hand" style={{ left: pct(raw.x), top: pct(raw.y) }} />}
      <section>
        <span>Hand range · {corners.length + 1} / 2</span>
        <strong>{!raw ? 'Raise one hand so the camera can see it.' : corners.length === 0 ? 'Palm to your comfortable upper-left. Hold still.' : 'Now lower-right. Hold still.'}</strong>
        <progress max={1} value={rt.calibrationProgress} />
        <button className="pitch-chrome-btn" onClick={() => rt.cancelCalibration()}>
          Cancel · Esc
        </button>
      </section>
    </div>
  )
}

// ---- rehearsal: timing, the expected steps, and the controls ------------------------------------
type ListenState = { state: 'off' | 'listening' | 'thinking' | 'unavailable' | 'error'; via?: string; note?: string }

function Rehearsal({ rt, ctl, onCommand, listen, heard }: { rt: SpatialRuntime; ctl: PitchController; onCommand: (c: StageCommand) => void; listen: ListenState; heard: string }) {
  const [key, setKey] = useState('')
  const band = rt.radial.band
  const now = performance.now()
  const s = ctl.scene
  const elapsed = now - ctl.sceneEnteredAt
  const over = elapsed > s.targetSeconds * 1000
  return (
    <aside className="pitch-rehearsal" onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
      <header>
        <span>Rehearsal</span>
        <strong>
          {s.number} {s.title}
        </strong>
        <em className={over ? 'over' : ''}>
          {mmss(elapsed)} / {mmss(s.targetSeconds * 1000)}
        </em>
        <small>Total {ctl.startedAt === null ? '0:00' : mmss(now - ctl.startedAt)} · target 2:59</small>
      </header>
      <ol className="steps">
        {s.beats.map((b) => (
          <li key={b.id} className={ctl.done.has(b.id) ? 'done' : ''}>
            {b.step}
            {b.fallback && !ctl.done.has(b.id) && <i> · → does it</i>}
          </li>
        ))}
        <li className="next">→ next scene: {ctl.scenes[ctl.sceneIndex + 1]?.title ?? '—'}</li>
      </ol>
      <div className="notes">
        {s.notes.map((n) => (
          <p key={n}>{n}</p>
        ))}
      </div>
      <div className="state">
        <span>camera {rt.tracker.status}</span>
        <span>{rt.latestFeatures ? 'hand tracked' : 'no hand'}</span>
        <span>gestures {rt.cameraGesturesEnabled ? 'on' : 'paused'}</span>
        <span>radial {rt.radial.state.status}</span>
        <span>last: {ctl.lastReason}</span>
      </div>
      <div className="voice">
        <strong>Voice trigger · scene 05</strong>
        <span>
          Band {band ? `${band.status}${band.link === 'sim' ? ' (pretend)' : ` · ${band.link}`}` : 'not connected'} · {listen.state}
          {listen.note ? ` — ${listen.note}` : ''}
        </span>
        {heard && <span>heard: “{heard}”</span>}
        <div className="btns">
          {(!band || band.status === 'error' || band.status === 'closed') && (
            <>
              <button className="pitch-chrome-btn" onClick={() => rt.radial.connectBand('ble')}>Band · Bluetooth</button>
              <button className="pitch-chrome-btn" onClick={() => rt.radial.connectBand('serial')}>Band · USB</button>
              <button className="pitch-chrome-btn" onClick={() => rt.radial.connectBand('sim')}>Pretend band</button>
            </>
          )}
          {band && band.status === 'connected' && (
            <button className="pitch-chrome-btn" onClick={() => rt.radial.disconnectBand()}>Disconnect band</button>
          )}
        </div>
        {hasDeepgramKey() ? (
          <button className="pitch-chrome-btn" onClick={() => (forgetDeepgramKey(), setKey(''))}>Forget Deepgram key</button>
        ) : (
          <input
            type="password"
            autoComplete="off"
            placeholder="Deepgram key (only if Gemini isn’t set up) · Enter"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                setDeepgramKey(key)
                setKey('')
              }
            }}
          />
        )}
      </div>
      <div className="btns">
        <button className="pitch-chrome-btn" onClick={() => onCommand({ type: 'cmd', cmd: 'previous' })}>← Prev</button>
        <button className="pitch-chrome-btn" onClick={() => onCommand({ type: 'cmd', cmd: 'next' })}>Next →</button>
        <button className="pitch-chrome-btn" onClick={() => onCommand({ type: 'cmd', cmd: 'resetLayout' })}>Reset layout</button>
        <button className="pitch-chrome-btn" onClick={() => onCommand({ type: 'cmd', cmd: 'calibrate' })}>Calibrate</button>
        <button className="pitch-chrome-btn" onClick={() => onCommand({ type: 'cmd', cmd: 'reset' })}>Restart</button>
      </div>
      <p className="keys">→ next · ⇧→ skip · ← back · Home restart · M actions · G gestures · K calibrate · C camera · X layout · ⌘Z undo · P console · D hide</p>
    </aside>
  )
}
