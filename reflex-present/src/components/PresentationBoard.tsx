import { useCallback, useEffect, useRef, useState } from 'react'
import { demoIdentity, presentationDeck } from '../data/presentationDeck'
import { defaultProfile, type CalibrationProfile } from '../spatial/calibration'
import type { Zone } from '../spatial/interaction'
import { parseAskAction } from '../spatial/radial/actions/explain'
import { SpatialRuntime, useRuntime } from '../spatial/runtime'
import type { SpatialObject } from '../spatial/types'
import { CameraPreview } from '../spatial/ui/CameraPreview'
import './PresentationBoard.css'
import { PresenterActions } from './PresenterActions'
import { PresenterActionTray } from './PresenterActionTray'
import './PresenterTheme.css'
import { BAND_NUMBER } from '../spatial/wearable/band'

const pct = (value: number) => `${value * 100}%`
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))
const CONTROL_MAGNET_RADIUS = 56
/** Bottom-right corner of the slide: let go of anything here to delete it. */
const TRASH: Zone = { x: 0.895, y: 0.79, w: 0.08, h: 0.15 }
const NOTE_W = 0.24
const DEFAULT_RANGE = defaultProfile().region

/** True until the hand range has been calibrated on this camera. */
const isDefaultRange = (p: CalibrationProfile) =>
  !p.affine && p.region.x0 === DEFAULT_RANGE.x0 && p.region.y0 === DEFAULT_RANGE.y0 && p.region.x1 === DEFAULT_RANGE.x1 && p.region.y1 === DEFAULT_RANGE.y1

/** Pasted text as a slide object, sized roughly to its words; it moves and trashes like any card. */
function transcriptNote(text: string): SpatialObject {
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 34)), 0)
  return { id: `transcript-${Date.now()}`, label: text, color: '#202123', shape: 'card', variant: 'transcript', x: 0, y: 0, w: NOTE_W, h: Math.min(0.46, 0.06 + lines * 0.033), content: { kind: 'note', text } }
}

const overlaps = (a: Zone, b: Zone) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** The first free spot beside `near` (left, below, above, right), on the slide and clear of the trash. */
function besideObject(note: SpatialObject, near: SpatialObject, others: SpatialObject[]) {
  const gap = 0.02
  const spots = [
    { x: near.x - gap - note.w, y: near.y },
    { x: near.x, y: near.y + near.h + gap },
    { x: near.x, y: near.y - gap - note.h },
    { x: near.x + near.w + gap, y: near.y },
  ].map((p) => ({ ...note, x: clamp(p.x, 0.01, 0.99 - note.w), y: clamp(p.y, 0.02, 0.98 - note.h) }))
  return spots.find((spot) => !overlaps(spot, TRASH) && others.every((o) => !overlaps(spot, o))) ?? spots[0]
}

function airActionNear(stage: HTMLElement, x: number, y: number, preferred: string | null = null) {
  const exact = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-air-action]')
  if (exact && stage.contains(exact)) return exact.dataset.airAction ?? null

  const candidates = [...stage.querySelectorAll<HTMLElement>('[data-air-action]')]
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      return { action: element.dataset.airAction ?? '', distance: Math.hypot(dx, dy) }
    })
    .filter((item) => item.action)
    .sort((a, b) => a.distance - b.distance)

  const nearest = candidates[0]
  if (!nearest || nearest.distance > CONTROL_MAGNET_RADIUS) return null
  const stable = candidates.find((item) => item.action === preferred)
  return stable && stable.distance <= CONTROL_MAGNET_RADIUS + 12 && stable.distance <= nearest.distance + 12
    ? stable.action
    : nearest.action
}

function SlideCard({ object, active, grabbed, trashing }: { object: SpatialObject; active: boolean; grabbed: boolean; trashing: boolean }) {
  return (
    <div
      className={`presentation-card ${active ? 'is-hovered' : ''} ${grabbed ? 'is-grabbed' : ''} ${trashing ? 'is-trashing' : ''} ${object.variant === 'transcript' ? 'is-transcript' : ''} ${object.shape}`}
      style={{ left: pct(object.x), top: pct(object.y), width: pct(object.w), height: pct(object.h), '--card-color': object.color } as React.CSSProperties}
    >
      {object.variant === 'transcript' ? <span>{object.label}</span> : object.label.split('\n').map((line, i) => <span key={i}>{line}</span>)}
    </div>
  )
}

function TrashZone({ ready, armed }: { ready: boolean; armed: boolean }) {
  return (
    <div className={`trash-zone ${ready ? 'is-ready' : ''} ${armed ? 'is-armed' : ''}`} style={{ left: pct(TRASH.x), top: pct(TRASH.y), width: pct(TRASH.w), height: pct(TRASH.h) }} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
      </svg>
      <span>{armed ? 'Let go to delete' : 'Trash'}</span>
    </div>
  )
}

export function PresentationBoard() {
  const [runtime] = useState(() => new SpatialRuntime(presentationDeck[0].objects))
  useRuntime(runtime)
  const [slideIndex, setSlideIndex] = useState(0)
  const [showCamera, setShowCamera] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [showSlides, setShowSlides] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [showActionTray, setShowActionTray] = useState(false)
  const [placingTranscript, setPlacingTranscript] = useState<string | null>(null)
  const [startingCalibration, setStartingCalibration] = useState(false)
  const [calibrateHint, setCalibrateHint] = useState(true)
  const [hintExpired, setHintExpired] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
  const [bandConnectHint, setBandConnectHint] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const slideLayouts = useRef(new Map<string, SpatialObject[]>())
  const [hoverControl, setHoverControl] = useState<string | null>(null)
  const slide = presentationDeck[slideIndex]
  const ix = runtime.interaction
  const pointer = runtime.pointer
  const calibration = runtime.calibration
  const rawPointer = runtime.calibrationPointer
  const firstCorner = calibration.kind === 'region' ? calibration.corners[0] : null
  const rangeOrigin = firstCorner ? { x: runtime.profile.mirrorX ? 1 - firstCorner.x : firstCorner.x, y: runtime.profile.flipY ? 1 - firstCorner.y : firstCorner.y } : null
  const notice = runtime.notice && performance.now() - runtime.notice.tMs < 5000 ? runtime.notice.text : null
  // Like air-draw's calibration on connect: ask for a range before the hand takes over.
  const uncalibrated = isDefaultRange(runtime.profile)
  const showCalibrateHint = calibrateHint && calibration.kind === 'none' && !placingTranscript && (uncalibrated || !hintExpired)

  useEffect(() => {
    runtime.start()
    runtime.autoRangeCapture = true
    runtime.detector.mode = 'grasp'
    runtime.detector.reset()
    // The presenter is intended for a selfie camera: always start mirrored,
    // then re-apply it after the per-camera profile has loaded.
    void runtime.startCamera().then(() => runtime.updateProfile({ mirrorX: true }))
    return () => runtime.dispose()
  }, [runtime])

  useEffect(() => {
    const timer = window.setTimeout(() => setHintExpired(true), 9000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const ix = runtime.interaction
    ix.trash = TRASH
    ix.onTrashed = (object) => {
      const executor = runtime.radial.executor
      if (executor.explainCards.has(object.id)) executor.closeExplain(object.id)
      if (executor.voice?.objectId === object.id) executor.closeVoice()
      const name = object.label.split('\n')[0]
      runtime.say(`Deleted “${name.length > 40 ? `${name.slice(0, 40)}…` : name}” · ⌘Z to undo`)
    }
    return () => {
      ix.trash = null
      ix.onTrashed = null
    }
  }, [runtime])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => runtime.setCanvasSize(entry.contentRect.width, entry.contentRect.height))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [runtime])

  const changeSlide = (next: number) => {
    const index = (next + presentationDeck.length) % presentationDeck.length
    if (index === slideIndex) return
    runtime.radial.controller.cancel(performance.now(), 'slide changed')
    // Keep rearranged objects when revisiting a slide during the presentation.
    slideLayouts.current.set(slide.id, runtime.interaction.objects.map((o) => ({ ...o })))
    setSlideIndex(index)
    runtime.setObjects(slideLayouts.current.get(presentationDeck[index].id) ?? presentationDeck[index].objects)
  }

  const beginCalibration = useCallback(async () => {
    setCalibrationError(null)
    setCalibrateHint(false)
    setStartingCalibration(true)
    try {
      if (runtime.tracker.status !== 'running') await runtime.startCamera()
      // The selected physical movement range *is* the sensitivity setting:
      // a smaller range maps to the entire slide with a larger gain.
      if (runtime.tracker.status === 'running') runtime.startCalibration('region')
      else setCalibrationError(runtime.tracker.error || 'Camera permission is needed before calibration can begin.')
    } catch {
      setCalibrationError('Camera permission is needed before calibration can begin.')
    } finally {
      setStartingCalibration(false)
    }
  }, [runtime])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape' && placingTranscript) { setPlacingTranscript(null); event.preventDefault(); return }
      if (event.key === 'Escape' && showActionTray) { setShowActionTray(false); event.preventDefault(); return }
      if (event.key === 'Escape' && showTools) { setShowTools(false); event.preventDefault(); return }
      if (runtime.radial.capturesInput && runtime.onKey(event)) { event.preventDefault(); return }
      if (event.key === 'ArrowRight') changeSlide(slideIndex + 1)
      else if (event.key === 'ArrowLeft') changeSlide(slideIndex - 1)
      else if (event.key.toLowerCase() === 'c') setShowCamera((value) => !value)
      else if (event.key.toLowerCase() === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      else if (event.key.toLowerCase() === 'k' && !event.metaKey && !event.ctrlKey) void beginCalibration()
      else if (!runtime.onKey(event)) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const onRelease = () => runtime.onMouseReleasedElsewhere()
    window.addEventListener('mouseup', onRelease)
    window.addEventListener('blur', onRelease)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onRelease); window.removeEventListener('blur', onRelease) }
  }, [runtime, beginCalibration, slideIndex, showTools, placingTranscript, showActionTray])

  const point = (event: React.MouseEvent) => {
    const box = stageRef.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const placeTranscript = (x: number, y: number) => {
    if (!placingTranscript) return
    const note = transcriptNote(placingTranscript)
    runtime.interaction.add({ ...note, x: clamp(x - note.w / 2, 0.01, 0.99 - note.w), y: clamp(y - note.h / 2, 0.02, 0.98 - note.h) })
    setPlacingTranscript(null)
  }

  const triggerAirControl = useCallback((action: string) => {
    if (action === 'mirror') runtime.updateProfile({ mirrorX: !runtime.profile.mirrorX })
    else if (action === 'calibrate') void beginCalibration()
    else if (action === 'camera') { if (runtime.tracker.status === 'running') runtime.stopCamera(); else void runtime.startCamera() }
    else if (action === 'preview') setShowCamera((value) => !value)
    else if (action === 'center') runtime.recenter()
    else if (action === 'next') changeSlide(slideIndex + 1)
    else if (action === 'previous') changeSlide(slideIndex - 1)
    else if (action === 'fullscreen') void (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())
    else if (action === 'tools') setShowTools((v) => !v)
    else if (action === 'slides') setShowSlides((v) => !v)
    else if (action === 'notes') setShowNotes((v) => !v)
    else if (action === 'actions') {
      runtime.radial.controller.cancel(performance.now(), 'global action tray opened')
      runtime.radial.executor.closeVoice()
      setShowActionTray((open) => !open)
    }
    else if (action === 'voice') {
      const objectId = runtime.interaction.grabbedId ?? runtime.interaction.hoverId ?? runtime.interaction.objects[0]?.id
      if (objectId) {
        runtime.radial.forceOpen(objectId)
        if (action === 'voice') runtime.radial.choose('voice')
      }
    }
    else if (action === 'band-usb') runtime.radial.connectBand('serial')
    else if (action === 'band-bluetooth') runtime.radial.connectBand('ble')
    else if (action === 'band-disconnect') runtime.radial.disconnectBand()
    else if (action === 'band-connect') {
      if (runtime.radial.band?.status === 'connected') setShowTools(true)
      else {
        setBandConnectHint(null)
        runtime.radial.connectBand('serial')
      }
    }
    else if (action.startsWith('close-explain:')) runtime.radial.executor.closeExplain(action.slice('close-explain:'.length))
    else if (action.startsWith('explain-ask:')) {
      const ask = parseAskAction(action)
      if (ask) runtime.radial.executor.askSuggested(ask.objectId, ask.index, runtime.interaction.objects)
    }
    if (action !== 'tools' && action !== 'band-connect') setShowTools(false)
  }, [runtime, beginCalibration, slideIndex])

  // Resolve controls before the interaction engine can grab an object below.
  useEffect(() => {
    runtime.onControlSelect = (p) => {
      if (!p.valid || !stageRef.current) return false
      const bounds = stageRef.current.getBoundingClientRect()
      if (placingTranscript) {
        placeTranscript(p.x, p.y)
        return true
      }
      const action = airActionNear(stageRef.current, bounds.left + p.x * bounds.width, bounds.top + p.y * bounds.height, hoverControl)
      if (!action) return false
      if (action === 'band-connect' || action === 'band-usb' || action === 'band-bluetooth') {
        setBandConnectHint('USB and Bluetooth pickers need a real mouse or trackpad click. Click the connect button directly, then select Vexo-HACK-75.')
        setShowTools(true)
        return true
      }
      triggerAirControl(action)
      return true
    }
    return () => { runtime.onControlSelect = null }
  }, [runtime, triggerAirControl, hoverControl, placingTranscript])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !pointer.valid || calibration.kind !== 'none') { setHoverControl(null); return }
    const bounds = stage.getBoundingClientRect()
    setHoverControl(airActionNear(stage, bounds.left + pointer.x * bounds.width, bounds.top + pointer.y * bounds.height, hoverControl))
  }, [pointer, calibration.kind, hoverControl])

  return (
    <main className="presentation-shell">
      <header className="workspace-header">
        <span className="demo-name">{demoIdentity.name}</span>
        <span className="event-name">{demoIdentity.event}</span>
      </header>
      <div
        ref={stageRef}
        className="presentation-stage"
        style={{ '--accent': slide.accent } as React.CSSProperties}
        onMouseMove={(event) => { const p = point(event); runtime.onMouseMove(p.x, p.y) }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement
          const p = point(event)
          if (placingTranscript && !target.closest('.stage-controls, .presenter-tools, .presenter-action-tray, .placement-banner')) {
            event.preventDefault()
            placeTranscript(p.x, p.y)
            return
          }
          if (!target.closest('.stage-controls, .presenter-tools, .presenter-action-tray')) setShowTools(false)
          runtime.onMouseButton(true, p.x, p.y)
        }}
        onMouseUp={(event) => { const p = point(event); runtime.onMouseButton(false, p.x, p.y) }}
      >
        <div className="presentation-glow" />
        {showCamera && <div className="presenter-mirror"><CameraPreview rt={runtime} width={1280} fill guides={false} /></div>}
        <div className="stage-controls" data-hover={hoverControl} aria-label="Hand-controlled presentation tools" onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
          <button className={hoverControl === 'previous' ? 'proximity-active' : undefined} data-air-action="previous" aria-label="Previous slide" onClick={() => triggerAirControl('previous')}>←</button>
          <span className="toolbar-page">{slideIndex + 1} / {presentationDeck.length}</span>
          <button className={hoverControl === 'next' ? 'proximity-active' : undefined} data-air-action="next" aria-label="Next slide" onClick={() => triggerAirControl('next')}>→</button>
          <button className={hoverControl === 'actions' ? 'proximity-active' : undefined} data-air-action="actions" onClick={() => triggerAirControl('actions')}>Actions</button>
          <button className={hoverControl === 'band-connect' ? 'proximity-active' : undefined} data-air-action="band-connect" title="Connect band 75 over USB. Use a mouse or trackpad click to open the browser port picker." onClick={() => triggerAirControl('band-connect')}>
            {runtime.radial.band?.status === 'connected' ? 'Vexo connected' : runtime.radial.band?.status === 'connecting' ? 'Connecting…' : runtime.radial.band?.status === 'error' ? 'Retry USB' : 'Connect USB'}
          </button>
          <i />
          <span className={`tracking-indicator ${rawPointer ? 'tracked' : ''}`} role="status" aria-label={rawPointer ? 'Hand tracked' : runtime.tracker.status === 'running' ? 'Raise a hand into view' : `Camera ${runtime.tracker.status}`} title={rawPointer ? 'Hand tracked' : runtime.tracker.status === 'running' ? 'Raise a hand into view' : `Camera ${runtime.tracker.status}`} />
          <button className={hoverControl === 'calibrate' ? 'proximity-active' : undefined} data-air-action="calibrate" title="Calibrate your hand range (K)" onClick={() => triggerAirControl('calibrate')}>{startingCalibration ? 'Starting…' : <>Calibrate <kbd className="key-hint">K</kbd></>}</button>
          <button className={hoverControl === 'tools' ? 'proximity-active' : undefined} data-air-action="tools" aria-label="More controls" aria-expanded={showTools} onClick={() => triggerAirControl('tools')}>···</button>
        </div>
        {showTools && <div className="presenter-tools" data-hover={hoverControl} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
          <button className={hoverControl === 'mirror' ? 'proximity-active' : undefined} data-air-action="mirror" aria-pressed={runtime.profile.mirrorX} onClick={() => triggerAirControl('mirror')}>Mirror <span>{runtime.profile.mirrorX ? 'On' : 'Off'}</span></button>
          <button className={hoverControl === 'center' ? 'proximity-active' : undefined} data-air-action="center" onClick={() => triggerAirControl('center')}>Recenter cursor <span>R</span></button>
          <button className={hoverControl === 'preview' ? 'proximity-active' : undefined} data-air-action="preview" onClick={() => triggerAirControl('preview')}>Camera view <span>{showCamera ? 'On' : 'Off'}</span></button>
          <button className={hoverControl === 'fullscreen' ? 'proximity-active' : undefined} data-air-action="fullscreen" onClick={() => triggerAirControl('fullscreen')}>Fullscreen <span>F</span></button>
          <hr />
          <button className={hoverControl === 'slides' ? 'proximity-active' : undefined} data-air-action="slides" onClick={() => triggerAirControl('slides')}>Slide overview <span>{showSlides ? 'Hide' : 'Show'}</span></button>
          <button className={hoverControl === 'notes' ? 'proximity-active' : undefined} data-air-action="notes" onClick={() => triggerAirControl('notes')}>Speaker notes <span>{showNotes ? 'Hide' : 'Show'}</span></button>
          <button className={hoverControl === 'camera' ? 'proximity-active' : undefined} data-air-action="camera" onClick={() => triggerAirControl('camera')}>{runtime.tracker.status === 'running' ? 'Pause' : 'Start'} tracking</button>
          <hr />
          <div className="presenter-band-status">Vexo band {BAND_NUMBER} · {runtime.radial.band ? `${runtime.radial.band.status}${runtime.radial.band.link === 'sim' ? ' · pretend' : ` · ${runtime.radial.band.link}`}` : 'not connected'}{runtime.radial.band?.error ? ` · ${runtime.radial.band.error}` : ''}</div>
          {bandConnectHint && <div className="presenter-band-status presenter-band-hint">{bandConnectHint}</div>}
          {!runtime.radial.band || runtime.radial.band.status === 'error' || runtime.radial.band.status === 'closed' ? <>
            <button className={hoverControl === 'band-usb' ? 'proximity-active' : undefined} data-air-action="band-usb" onClick={() => triggerAirControl('band-usb')}>Connect Vexo over USB</button>
            <button className={hoverControl === 'band-bluetooth' ? 'proximity-active' : undefined} data-air-action="band-bluetooth" onClick={() => triggerAirControl('band-bluetooth')}>Connect Vexo over Bluetooth</button>
          </> : <button className={hoverControl === 'band-disconnect' ? 'proximity-active' : undefined} data-air-action="band-disconnect" onClick={() => triggerAirControl('band-disconnect')}>Disconnect Vexo</button>}
          <hr />
          <a href="/marketing/creative-brief.md" download>Creative brief ↗</a><a href="/marketing/concept-board.png" download>Concept art ↗</a>
        </div>}
        <section className="presentation-copy">
          <p>{slide.eyebrow}</p>
          <h1>{slide.title}</h1>
          <h2>{slide.subtitle}</h2>
        </section>
        <div className="presentation-objects">
          {ix.objects.map((object) => <SlideCard key={object.id} object={object} active={ix.hoverId === object.id && !runtime.radial.capturesInput} grabbed={ix.grabbedId === object.id} trashing={ix.grabbedId === object.id && ix.overTrash} />)}
        </div>
        {calibration.kind === 'none' && <TrashZone ready={!!ix.grabbedId} armed={ix.overTrash} />}
        {calibration.kind === 'none' && <PresenterActions rt={runtime} hoverAction={hoverControl} onPaste={(text, near) => runtime.interaction.add(besideObject(transcriptNote(text), near, runtime.interaction.objects))} />}
        {calibration.kind === 'none' && showActionTray && <PresenterActionTray providers={runtime.radial.voiceProviders} onClose={() => setShowActionTray(false)} onConnectBand={(link) => runtime.radial.connectBand(link)} onPlace={(text) => { setPlacingTranscript(text); setShowActionTray(false) }} />}
        {placingTranscript && <div className="placement-banner" onMouseDown={(event) => event.stopPropagation()}>
          <span>Move the cursor to where the transcript should go, then close your hand or click to place it.</span>
          <button onClick={() => setPlacingTranscript(null)}>Cancel · Esc</button>
        </div>}
        {showCalibrateHint && <button className={`calibrate-hint ${hoverControl === 'calibrate' ? 'proximity-active' : ''}`} data-air-action="calibrate" onMouseDown={(event) => event.stopPropagation()} onClick={() => void beginCalibration()}>
          <kbd>K</kbd>{uncalibrated ? 'Calibrate your hand range before you start' : 'Press K to recalibrate your hand range'}
        </button>}
        {pointer.valid && <div className={`presentation-cursor ${runtime.detector.engaged || ix.grabbedId ? 'is-grasped' : ''} ${placingTranscript ? 'is-placement' : ''}`} style={{ left: pct(pointer.x), top: pct(pointer.y) }} />}
        {calibration.kind === 'region' && (
          <div className="range-setup">
            <CameraPreview rt={runtime} width={1280} fill />
            {rangeOrigin && rawPointer && <div className="range-rectangle" style={{ left: pct(Math.min(rangeOrigin.x, rawPointer.x)), top: pct(Math.min(rangeOrigin.y, rawPointer.y)), width: pct(Math.abs(rawPointer.x - rangeOrigin.x)), height: pct(Math.abs(rawPointer.y - rangeOrigin.y)) }} />}
            {rawPointer && <div className="range-hand" style={{ left: pct(rawPointer.x), top: pct(rawPointer.y) }}><span>YOUR HAND</span></div>}
            {calibration.corners[0] && <div className="range-first" style={{ left: pct(runtime.profile.mirrorX ? 1 - calibration.corners[0].x : calibration.corners[0].x), top: pct(runtime.profile.flipY ? 1 - calibration.corners[0].y : calibration.corners[0].y) }}>1</div>}
            <section className="range-instructions">
              <span>HAND RANGE · {calibration.corners.length + 1} / 2</span>
              <strong>{!rawPointer ? 'Raise one hand so the camera can see it.' : calibration.corners.length === 0 ? 'Move your palm to your comfortable upper-left. Hold still.' : 'Move your palm down and right. Hold still to save.'}</strong>
              <p>Keep your palm relaxed. Hold for one second to capture automatically.<br />Choose a smaller rectangle for faster movement; a larger one for finer control.</p>
              <progress max={1} value={runtime.calibrationProgress} aria-label="Hand hold progress" />
              <button onClick={() => runtime.cancelCalibration()}>Cancel · Esc</button>
              <button onClick={() => runtime.startCalibration('region')}>Start over</button>
            </section>
          </div>
        )}
        {calibration.kind === 'none' && notice && <div className="presenter-notice" role="status">{notice}</div>}
      </div>

      {showSlides && <aside className="presentation-dock">
        {presentationDeck.map((item, index) => <button key={item.id} className={`slide-thumbnail ${index === slideIndex ? 'selected' : ''}`} onClick={() => changeSlide(index)} aria-label={`Open slide ${index + 1}: ${item.eyebrow}`} aria-current={index === slideIndex ? 'step' : undefined}><span style={{ color: item.accent }}>{String(index + 1).padStart(2, '0')}</span><strong>{item.eyebrow}</strong><small>{item.title.replace('\n', ' ')}</small></button>)}
      </aside>}
      {calibrationError && (
        <div className="presentation-error" role="alert">
          <strong>Calibration needs the camera.</strong>
          <span>{calibrationError}</span>
          <button onClick={() => void beginCalibration()}>Try camera again</button>
          <button className="quiet" onClick={() => setCalibrationError(null)}>Dismiss</button>
        </div>
      )}
      {showNotes && <section className="speaker-notes"><span>Slide {slideIndex + 1}</span><p>{slide.note}</p></section>}
    </main>
  )
}
