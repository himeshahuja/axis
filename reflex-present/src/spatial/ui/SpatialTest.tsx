import { useEffect, useState } from 'react'
import { at } from '../../base'
import { CALIBRATION_TARGETS } from '../calibration'
import { ACCURACY_TARGETS, exposeForDev, SpatialRuntime, useRuntime } from '../runtime'
import { CameraPreview } from './CameraPreview'
import { BandControls, Controls, StatusRows } from './Controls'
import { SpatialCanvas } from './SpatialCanvas'
import { TEST_OBJECTS } from './testObjects'
import '../radial/ui/radial.css'
import './spatial.css'

const pct = (v: number) => `${v * 100}%`

export function SpatialTest() {
  const [rt] = useState(() => new SpatialRuntime(TEST_OBJECTS))
  useRuntime(rt)
  const [hudOpen, setHudOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)

  useEffect(() => {
    rt.start()
    exposeForDev(rt)
    return () => rt.dispose()
  }, [rt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'SELECT' || tag === 'INPUT') return
      if (!rt.radial.capturesInput && e.key.toLowerCase() === 'h') setHudOpen((v) => !v)
      else if (!rt.radial.capturesInput && e.key.toLowerCase() === 'd') setPreviewOpen((v) => !v)
      else if (!rt.radial.capturesInput && e.key.toLowerCase() === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())
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

  const { calibration: cal, accuracy: acc } = rt
  const showNotice = rt.notice && performance.now() - rt.notice.tMs < 4000

  return (
    <div className="sp-root">
      <SpatialCanvas rt={rt} pointerHidden={cal.kind === 'points'} />

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
          <BandControls rt={rt} />
          <div className="group" style={{ opacity: 0.6, display: 'block', lineHeight: 1.6 }}>
            Pinch-hold 0.6s = actions menu (M) · rotate wrist / ← → / wheel · release to run · Pinch / Space grab·release · open palm / Esc cancel · ⌘Z undo · R recenter · H HUD · D camera · F fullscreen ·{' '}
            <a href={at('/spatial-debug')} style={{ color: '#5b8dee' }}>
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
