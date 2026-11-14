import { useCallback, useEffect, useRef, useState } from 'react'
import { demoIdentity, presentationDeck } from '../data/presentationDeck'
import { SpatialRuntime, useRuntime } from '../spatial/runtime'
import type { SpatialObject } from '../spatial/types'
import { CameraPreview } from '../spatial/ui/CameraPreview'
import './PresentationBoard.css'
import { PresenterActions } from './PresenterActions'

const pct = (value: number) => `${value * 100}%`

function SlideCard({ object, active, grabbed }: { object: SpatialObject; active: boolean; grabbed: boolean }) {
  return (
    <div
      className={`presentation-card ${active ? 'is-hovered' : ''} ${grabbed ? 'is-grabbed' : ''} ${object.shape}`}
      style={{ left: pct(object.x), top: pct(object.y), width: pct(object.w), height: pct(object.h), '--card-color': object.color } as React.CSSProperties}
    >
      {object.label.split('\n').map((line, i) => <span key={i}>{line}</span>)}
    </div>
  )
}

export function PresentationBoard() {
  const [runtime] = useState(() => new SpatialRuntime(presentationDeck[0].objects))
  useRuntime(runtime)
  const [slideIndex, setSlideIndex] = useState(0)
  const [showCamera, setShowCamera] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [startingCalibration, setStartingCalibration] = useState(false)
  const [calibrationError, setCalibrationError] = useState<string | null>(null)
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return
      if (runtime.radial.capturesInput && runtime.onKey(event)) { event.preventDefault(); return }
      if (event.key === 'ArrowRight') changeSlide(slideIndex + 1)
      else if (event.key === 'ArrowLeft') changeSlide(slideIndex - 1)
      else if (event.key.toLowerCase() === 'c') setShowCamera((value) => !value)
      else if (event.key.toLowerCase() === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      else if (!runtime.onKey(event)) return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    const onRelease = () => runtime.onMouseReleasedElsewhere()
    window.addEventListener('mouseup', onRelease)
    window.addEventListener('blur', onRelease)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mouseup', onRelease); window.removeEventListener('blur', onRelease) }
  }, [runtime, slideIndex])

  const point = (event: React.MouseEvent) => {
    const box = stageRef.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height }
  }

  const beginCalibration = useCallback(async () => {
    setCalibrationError(null)
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

  const triggerAirControl = useCallback((action: string) => {
    if (action === 'mirror') runtime.updateProfile({ mirrorX: !runtime.profile.mirrorX })
    else if (action === 'calibrate') void beginCalibration()
    else if (action === 'camera') void runtime.startCamera()
    else if (action === 'preview') setShowCamera((value) => !value)
    else if (action === 'center') runtime.recenter()
    else if (action === 'next') changeSlide(slideIndex + 1)
    else if (action === 'previous') changeSlide(slideIndex - 1)
    else if (action === 'fullscreen') void (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())
  }, [runtime, beginCalibration, slideIndex])

  // Resolve controls before the interaction engine can grab an object below.
  useEffect(() => {
    runtime.onControlSelect = (p) => {
      if (!p.valid || !stageRef.current) return false
      const bounds = stageRef.current.getBoundingClientRect()
      const target = document.elementFromPoint(bounds.left + p.x * bounds.width, bounds.top + p.y * bounds.height)
      const action = target?.closest<HTMLElement>('[data-air-action]')?.dataset.airAction
      if (!action) return false
      triggerAirControl(action)
      return true
    }
    return () => { runtime.onControlSelect = null }
  }, [runtime, triggerAirControl])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !pointer.valid || calibration.kind !== 'none') { setHoverControl(null); return }
    const bounds = stage.getBoundingClientRect()
    const target = document.elementFromPoint(bounds.left + pointer.x * bounds.width, bounds.top + pointer.y * bounds.height)
    setHoverControl(target?.closest<HTMLElement>('[data-air-action]')?.dataset.airAction ?? null)
  }, [pointer, calibration.kind])

  return (
    <main className="presentation-shell">
      <header className="workspace-header">
        <div><span className="workspace-mark">↗</span><span>{demoIdentity.event}<small>Gesture presentation prototype</small></span></div>
        <span className="demo-name">{demoIdentity.name}<small>Working title</small></span>
      </header>
      <div
        ref={stageRef}
        className="presentation-stage"
        style={{ '--accent': slide.accent } as React.CSSProperties}
        onMouseMove={(event) => { const p = point(event); runtime.onMouseMove(p.x, p.y) }}
        onMouseDown={(event) => { const p = point(event); runtime.onMouseButton(true, p.x, p.y) }}
        onMouseUp={(event) => { const p = point(event); runtime.onMouseButton(false, p.x, p.y) }}
      >
        <div className="presentation-glow" />
        {showCamera && <div className="presenter-mirror"><CameraPreview rt={runtime} width={1280} fill /></div>}
        <header className="presentation-header">
          <span className="brand">{demoIdentity.event}</span>
          <span>{String(slideIndex + 1).padStart(2, '0')} / {String(presentationDeck.length).padStart(2, '0')}</span>
        </header>
        <div className="stage-controls" data-hover={hoverControl} aria-label="Hand-controlled presentation tools" onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
          <button data-air-action="previous" aria-label="Previous slide" onClick={() => triggerAirControl('previous')}>←</button>
          <span className="toolbar-page">{slideIndex + 1} / {presentationDeck.length}</span>
          <button data-air-action="next" aria-label="Next slide" onClick={() => triggerAirControl('next')}>→</button>
          <i />
          <button data-air-action="calibrate" onClick={() => triggerAirControl('calibrate')}>{startingCalibration ? 'Starting…' : 'Calibrate'}</button>
          <button data-air-action="mirror" aria-pressed={runtime.profile.mirrorX} className={runtime.profile.mirrorX ? 'active' : ''} onClick={() => triggerAirControl('mirror')}>Mirror</button>
          <button data-air-action="center" onClick={() => triggerAirControl('center')}>Center</button>
          <button data-air-action="preview" onClick={() => triggerAirControl('preview')}>{showCamera ? 'Hide me' : 'Show me'}</button>
          <button data-air-action="fullscreen" aria-label="Fullscreen" onClick={() => triggerAirControl('fullscreen')}>⤢</button>
        </div>
        <section className="presentation-copy">
          <p>{slide.eyebrow}</p>
          <h1>{slide.title}</h1>
          <h2>{slide.subtitle}</h2>
        </section>
        <div className="presentation-objects">
          {ix.objects.map((object) => <SlideCard key={object.id} object={object} active={ix.hoverId === object.id} grabbed={ix.grabbedId === object.id} />)}
        </div>
        {calibration.kind === 'none' && <PresenterActions rt={runtime} />}
        {pointer.valid && <div className={`presentation-cursor ${runtime.detector.engaged || ix.grabbedId ? 'is-grasped' : ''}`} style={{ left: pct(pointer.x), top: pct(pointer.y) }} />}
        <div className="presentation-footer">
          <span className={rawPointer ? 'tracking-live' : ''}>{runtime.tracker.status === 'loading' ? 'Starting camera…' : runtime.tracker.status === 'error' ? 'Camera unavailable' : runtime.tracker.status === 'running' ? rawPointer ? 'Hand tracked' : 'Raise a hand into view' : 'Mouse demo ready'}</span>
          <span>Close to grab · Hold for actions · Open to release</span>
        </div>
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

      <aside className="presentation-dock">
        {presentationDeck.map((item, index) => <button key={item.id} className={`slide-thumbnail ${index === slideIndex ? 'selected' : ''}`} onClick={() => changeSlide(index)} aria-label={`Open slide ${index + 1}: ${item.eyebrow}`} aria-current={index === slideIndex ? 'step' : undefined}><span style={{ color: item.accent }}>{String(index + 1).padStart(2, '0')}</span><strong>{item.eyebrow}</strong><small>{item.title.replace('\n', ' ')}</small></button>)}
      </aside>
      {calibrationError && (
        <div className="presentation-error" role="alert">
          <strong>Calibration needs the camera.</strong>
          <span>{calibrationError}</span>
          <button onClick={() => void beginCalibration()}>Try camera again</button>
          <button className="quiet" onClick={() => setCalibrationError(null)}>Dismiss</button>
        </div>
      )}
      <footer className="workspace-footer"><span>← → slides <kbd>F</kbd> fullscreen <kbd>Space</kbd> grab</span><div><button onClick={() => setShowNotes((v) => !v)}>{showNotes ? 'Hide' : 'Speaker'} notes</button><a href="/marketing/creative-brief.md" download>Creative brief ↗</a><a href="/marketing/concept-board.png" download>Concept art ↗</a><button onClick={() => runtime.tracker.status === 'running' ? runtime.stopCamera() : void runtime.startCamera()}>{runtime.tracker.status === 'running' ? 'Pause camera' : 'Start camera'}</button></div></footer>
      {showNotes && <section className="speaker-notes"><span>Slide {slideIndex + 1}</span><p>{slide.note}</p></section>}
    </main>
  )
}
