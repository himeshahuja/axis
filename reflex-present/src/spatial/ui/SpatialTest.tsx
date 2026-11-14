import { useEffect, useRef, useState } from 'react'
import { CALIBRATION_TARGETS } from '../calibration'
import { ACCURACY_TARGETS, SpatialRuntime, useRuntime } from '../runtime'
import type { PointerSource, SpatialObject } from '../types'
import { CameraPreview } from './CameraPreview'
import { Controls, StatusRows } from './Controls'
import { TEST_OBJECTS } from './testObjects'
import './spatial.css'

const SOURCE_COLOR: Record<PointerSource, string> = {
  camera: '#5bf0a5',
  wearable: '#c77dff',
  fused: '#5b8dee',
  mouse: '#ffd23f',
  none: '#8a8f9c',
}

const pct = (v: number) => `${v * 100}%`

function ObjectView({ o, hover, grabbed, frozen, dragging }: { o: SpatialObject; hover: boolean; grabbed: boolean; frozen: boolean; dragging: boolean }) {
  const radius = o.shape === 'circle' ? '50%' : o.shape === 'pill' ? '999px' : '14px'
  const classes = ['sp-obj', hover && 'hover', grabbed && 'grabbed', frozen && 'frozen', dragging && 'dragging'].filter(Boolean).join(' ')
  return (
    <div className={classes} style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(o.h), background: o.color, borderRadius: radius }}>
      {o.label}
    </div>
  )
}

export function SpatialTest() {
  const [rt] = useState(() => new SpatialRuntime(TEST_OBJECTS))
  useRuntime(rt)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [hudOpen, setHudOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)

  useEffect(() => {
    rt.start()
    return () => rt.dispose()
  }, [rt])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => rt.setCanvasSize(e.contentRect.width, e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [rt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key.toLowerCase() === 'h') setHudOpen((v) => !v)
      else if (e.key.toLowerCase() === 'd') setPreviewOpen((v) => !v)
      else if (e.key.toLowerCase() === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
      else if (!rt.onKey(e)) return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rt])

  // Latency: measured until the first animation frame after this commit (an upper bound on paint).
  useEffect(() => {
    const id = requestAnimationFrame(() => rt.markPainted(performance.now()))
    return () => cancelAnimationFrame(id)
  })

  const toCanvas = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const { interaction: ix, pointer: p, calibration: cal, accuracy: acc } = rt
  const showNotice = rt.notice && performance.now() - rt.notice.tMs < 4000
  const pointerHidden = cal.kind === 'points'

  return (
    <div className="sp-root">
      <div
        ref={canvasRef}
        className="sp-canvas"
        onMouseMove={(e) => {
          const c = toCanvas(e)
          rt.onMouseMove(c.x, c.y)
        }}
        onMouseDown={(e) => {
          const c = toCanvas(e)
          rt.onMouseButton(true, c.x, c.y)
        }}
        onMouseUp={(e) => {
          const c = toCanvas(e)
          rt.onMouseButton(false, c.x, c.y)
        }}
      >
        {ix.objects.map((o) => (
          <ObjectView
            key={o.id}
            o={o}
            hover={ix.hoverId === o.id && !ix.grabbedId}
            grabbed={ix.grabbedId === o.id}
            frozen={ix.grabbedId === o.id && ix.state === 'TRACKING_LOST'}
            dragging={ix.grabbedId === o.id}
          />
        ))}
        {!pointerHidden && (
          <div
            className={`sp-pointer ${rt.detector.pinched || ix.grabbedId ? 'pinched' : ''} ${p.valid ? '' : 'invalid'}`}
            style={{ left: pct(p.x), top: pct(p.y), color: SOURCE_COLOR[p.source] }}
          />
        )}
      </div>

      {cal.kind !== 'none' && (
        <div className="sp-overlay">
          {cal.kind === 'points' && (
            <div className="sp-target" style={{ left: pct(CALIBRATION_TARGETS[cal.index].x), top: pct(CALIBRATION_TARGETS[cal.index].y) }} />
          )}
          <div className="msg">
            {cal.kind === 'region'
              ? cal.corners.length === 0
                ? 'Move your hand to the TOP-LEFT of a comfortable movement area, hold still, then pinch (or press Space)'
                : 'Now the BOTTOM-RIGHT of that area, hold still, then pinch (or Space)'
              : `Target ${cal.index + 1} of ${CALIBRATION_TARGETS.length}: move your hand to where it should be for this spot, hold still, pinch (or Space)`}
            <div style={{ fontSize: '0.7em', opacity: 0.7, marginTop: 8 }}>
              Hand {rt.latestFeatures ? <span className="sp-ok">tracked</span> : <span className="sp-bad">not tracked</span>} · open palm or Esc to cancel
            </div>
          </div>
        </div>
      )}

      {acc.active && (
        <div className="sp-overlay" style={{ background: 'rgba(4,5,8,0.35)', pointerEvents: 'none' }}>
          <div className="sp-target" style={{ left: pct(ACCURACY_TARGETS[acc.index].x), top: pct(ACCURACY_TARGETS[acc.index].y) }} />
          <div className="msg">
            Accuracy target {acc.index + 1} of {ACCURACY_TARGETS.length}: put the cursor on the dot, then pinch (or Space)
          </div>
        </div>
      )}
      {!acc.active && acc.results.length > 0 && <AccuracyResults rt={rt} />}

      {showNotice && <div className="sp-toast">{rt.notice!.text}</div>}

      {hudOpen && (
        <div className="sp-hud" onMouseMove={(e) => e.stopPropagation()}>
          <h2>Reflex Spatial — test</h2>
          <StatusRows rt={rt} />
          <Controls rt={rt} />
          <div className="group" style={{ opacity: 0.6, display: 'block', lineHeight: 1.6 }}>
            Pinch / Space grab·release · open palm / Esc cancel · ⌘Z undo · R recenter · H HUD · D camera · F fullscreen ·{' '}
            <a href="/spatial-debug" style={{ color: '#5b8dee' }}>
              debug view
            </a>
          </div>
        </div>
      )}
      {previewOpen && (
        <div className="sp-preview">
          <CameraPreview rt={rt} width={280} />
        </div>
      )}
    </div>
  )
}

function AccuracyResults({ rt }: { rt: SpatialRuntime }) {
  const r = rt.accuracy.results
  const px = r.map((x) => x.errorPx).sort((a, b) => a - b)
  const mean = px.reduce((a, b) => a + b, 0) / px.length
  return (
    <div className="sp-results" style={{ zIndex: 35 }}>
      <strong>Cursor error, measured just now</strong>
      <div style={{ opacity: 0.7, marginTop: 4 }}>
        {r.length} targets · mean {mean.toFixed(0)}px · median {px[Math.floor(px.length / 2)].toFixed(0)}px · max {px[px.length - 1].toFixed(0)}px · canvas{' '}
        {Math.round(rt.canvasPx.w)}×{Math.round(rt.canvasPx.h)}
      </div>
      <table>
        <thead>
          <tr>
            <th>target</th>
            <th>error px</th>
            <th>% height</th>
            <th>source</th>
          </tr>
        </thead>
        <tbody>
          {r.map((x, i) => (
            <tr key={i}>
              <td>
                ({x.target.x.toFixed(2)}, {x.target.y.toFixed(2)})
              </td>
              <td>{x.errorPx.toFixed(0)}</td>
              <td>{(x.errorCanvas * 100).toFixed(1)}</td>
              <td>{x.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button style={{ marginTop: 12 }} onClick={() => rt.clearAccuracy()}>
        Close
      </button>
    </div>
  )
}
