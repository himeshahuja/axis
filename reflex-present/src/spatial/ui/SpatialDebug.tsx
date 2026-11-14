import { useEffect, useState } from 'react'
import { exposeForDev, SpatialRuntime, useRuntime } from '../runtime'
import { CameraPreview } from './CameraPreview'
import { Controls, fmtStat, StatusRows } from './Controls'
import { RadialDebugPanel } from '../radial/ui/RadialDebugPanel'
import { SpatialCanvas } from './SpatialCanvas'
import { TEST_OBJECTS } from './testObjects'
import '../radial/ui/radial.css'
import './spatial.css'

const n = (v: number | undefined | null, d = 3) => (v === undefined || v === null || !Number.isFinite(v) ? '—' : v.toFixed(d))

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div className="kv">
      {rows.map(([k, v]) => [<span key={k + 'k'}>{k}</span>, <span key={k + 'v'}>{v}</span>])}
    </div>
  )
}

export function SpatialDebug() {
  const [rt] = useState(() => new SpatialRuntime(TEST_OBJECTS))
  useRuntime(rt)
  useEffect(() => {
    rt.start()
    exposeForDev(rt)
    return () => rt.dispose()
  }, [rt])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON') return
      if (rt.onKey(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rt])

  const cam = rt.latestCamera
  const f = rt.latestFeatures
  const w = rt.latestWearable
  const d = rt.fusion.diagnostics
  const g = rt.detector.config
  const prof = rt.profile
  const now = performance.now()
  const ratio = cam?.pinchRatio

  return (
    <div className="sp-debug">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: '0 0 12px', fontFamily: 'system-ui' }}>Reflex Spatial — sensor diagnostics</h2>
        <a href="/spatial-test" style={{ color: '#5b8dee' }}>
          test view →
        </a>
      </div>
      <section style={{ marginBottom: 12 }}>
        <h3>Canvas (same as /spatial-test) — pinch or mouse-hold an object 0.6 s for the actions menu</h3>
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#07080c', borderRadius: 8, overflow: 'hidden', fontFamily: 'system-ui' }}>
          <SpatialCanvas rt={rt} />
        </div>
      </section>
      <div className="grid">
        <RadialDebugPanel rt={rt} />
        <section>
          <h3>Camera</h3>
          <CameraPreview rt={rt} width={320} />
        </section>

        <section className="sp-hud" style={{ position: 'static', width: 'auto', maxHeight: 'none', fontFamily: 'system-ui' }}>
          <h3>Controls</h3>
          <StatusRows rt={rt} />
          <Controls rt={rt} />
        </section>

        <section>
          <h3>Camera observation</h3>
          <KV
            rows={[
              ['frame', cam ? `#${cam.frameId} ${cam.imageWidth}×${cam.imageHeight}` : '—'],
              ['age', cam ? `${(now - cam.tMs).toFixed(0)} ms` : '—'],
              ['capture timestamps', rt.tracker.hasCaptureTime ? 'yes (sensor-based latency)' : 'no (latency from frame delivery)'],
              ['tracking valid', String(cam?.trackingValid ?? false)],
              ['handedness (raw MP)', cam?.handedness ?? '—'],
              ['sensor confidence', n(cam?.sensorConfidence, 2)],
              ['in frame', cam ? `${Math.round(cam.inFrameFraction * 100)}%` : '—'],
              ['key lm in frame', f ? String(f.keyInFrame) : '—'],
              ['palm (raw)', f ? `${n(f.palm.x)}, ${n(f.palm.y)}` : '—'],
              ['index tip (raw)', f ? `${n(f.indexTip.x)}, ${n(f.indexTip.y)}` : '—'],
              ['fingers', f ? `I:${f.fingers.index[0]} M:${f.fingers.middle[0]} R:${f.fingers.ring[0]} P:${f.fingers.pinky[0]} T:${f.thumbExtended ? 'e' : 'c'}` : '—'],
              ['pointing / open palm', f ? `${f.pointing} / ${f.openPalm}` : '—'],
              ['detect', fmtStat(rt.latency.detect.stats())],
            ]}
          />
        </section>

        <section>
          <h3>Pinch ratio (thumb–index / palm width)</h3>
          <div style={{ position: 'relative', height: 26, background: '#1b1e27', borderRadius: 6, margin: '6px 0 10px' }}>
            {[g.pinchOn, g.pinchOff].map((t, i) => (
              <div key={i} style={{ position: 'absolute', left: `${(t / 1.5) * 100}%`, top: 0, bottom: 0, width: 2, background: i ? '#5bf0a5' : '#ff5a36' }} />
            ))}
            {ratio !== undefined && (
              <div style={{ position: 'absolute', left: `${Math.min(1, ratio / 1.5) * 100}%`, top: 3, width: 10, height: 20, marginLeft: -5, borderRadius: 3, background: rt.detector.pinched ? '#ff5a36' : '#e8e9ee' }} />
            )}
          </div>
          <KV
            rows={[
              ['ratio', n(ratio)],
              ['state', rt.detector.pinched ? 'PINCHED' : 'open'],
              ['pinchOn (red)', <input key="on" type="range" min={0.1} max={0.8} step={0.01} value={g.pinchOn} onChange={(e) => rt.setGestureConfig({ pinchOn: Math.min(+e.target.value, g.pinchOff - 0.02) })} />],
              ['pinchOff (green)', <input key="off" type="range" min={0.2} max={1.2} step={0.01} value={g.pinchOff} onChange={(e) => rt.setGestureConfig({ pinchOff: Math.max(+e.target.value, g.pinchOn + 0.02) })} />],
              ['thresholds', `${g.pinchOn.toFixed(2)} / ${g.pinchOff.toFixed(2)}`],
              ['debounce frames', <input key="mf" type="range" min={1} max={6} step={1} value={g.minFrames} onChange={(e) => rt.setGestureConfig({ minFrames: +e.target.value })} />],
              ['', `${g.minFrames} frames`],
            ]}
          />
        </section>

        <section>
          <h3>Wearable observation</h3>
          <KV
            rows={[
              ['adapter', rt.wearable?.name ?? 'none'],
              ['status (fusion)', d.wearableStatus],
              ['age', w ? `${(now - w.tMs).toFixed(0)} ms` : '—'],
              ['pointer', w?.pointer ? `${n(w.pointer.x)}, ${n(w.pointer.y)} [${w.pointer.frame}]` : '—'],
              ['integrated (drifts)', String(w?.pointerIsIntegrated ?? '—')],
              ['orientation', w?.orientation ? `y ${n(w.orientation.yaw, 1)} p ${n(w.orientation.pitch, 1)} r ${n(w.orientation.roll, 1)} ${w.orientation.units}` : '—'],
              ['sensor confidence', n(w?.sensorConfidence, 2)],
              ['learned bias', `${n(d.wearableBias.x)}, ${n(d.wearableBias.y)}`],
            ]}
          />
        </section>

        <section>
          <h3>Fusion / pointer</h3>
          <KV
            rows={[
              ['mode', d.mode],
              ['active source', d.activeSource],
              ['camera status / age', `${d.cameraStatus} / ${d.cameraAgeMs === null ? '—' : d.cameraAgeMs.toFixed(0) + ' ms'}`],
              ['wearable status / age', `${d.wearableStatus} / ${d.wearableAgeMs === null ? '—' : d.wearableAgeMs.toFixed(0) + ' ms'}`],
              ['weights cam / wear', `${n(d.weights.camera, 2)} / ${n(d.weights.wearable, 2)}`],
              ['handoff offset', n(d.handoffOffset)],
              ['pointer', `${n(rt.pointer.x)}, ${n(rt.pointer.y)} ${rt.pointer.valid ? '' : '(invalid)'}`],
              ['pointer source', rt.pointer.source],
              ['position confidence', n(rt.pointer.confidence, 2)],
              ['capture→pointer', fmtStat(rt.latency.captureToPointer.stats())],
              [
                'smoothing',
                <span key="sm" style={{ display: 'flex', gap: 6 }}>
                  <input type="range" min={0.1} max={5} step={0.1} value={rt.fusion.config.smoothing.minCutoff} onChange={(e) => rt.fusion.setSmoothing(+e.target.value, rt.fusion.config.smoothing.beta)} />
                  <input type="range" min={0} max={40} step={1} value={rt.fusion.config.smoothing.beta} onChange={(e) => rt.fusion.setSmoothing(rt.fusion.config.smoothing.minCutoff, +e.target.value)} />
                </span>,
              ],
              ['minCutoff / beta', `${rt.fusion.config.smoothing.minCutoff.toFixed(1)} Hz / ${rt.fusion.config.smoothing.beta}`],
            ]}
          />
        </section>

        <section>
          <h3>Calibration profile</h3>
          <KV
            rows={[
              ['device key', rt.tracker.deviceKey.slice(0, 18)],
              ['mirror X / flip Y', `${prof.mirrorX} / ${prof.flipY}`],
              ['mapping', prof.affine ? '5-point affine' : 'region'],
              ['region', `${n(prof.region.x0, 2)},${n(prof.region.y0, 2)} → ${n(prof.region.x1, 2)},${n(prof.region.y1, 2)}`],
              ['fit residual', prof.fitRms === undefined ? '—' : `${(prof.fitRms * 100).toFixed(2)}% canvas`],
              ['recenter offset', `${n(prof.offset.x)}, ${n(prof.offset.y)}`],
              ['samples (w/ wearable)', `${prof.samples.length} (${prof.samples.filter((s) => s.wearable).length})`],
            ]}
          />
        </section>

        <section>
          <h3>Interaction · {rt.interaction.state}</h3>
          <div className="log">
            {rt.interaction.transitions
              .slice(-14)
              .reverse()
              .map((t) => `${(t.tMs / 1000).toFixed(2)}s  ${t.from} → ${t.to}  ${t.reason}`)
              .join('\n') || 'no transitions yet'}
          </div>
        </section>

        <section>
          <h3>Gesture events</h3>
          <div className="log">
            {rt.gestureLog
              .slice(-14)
              .reverse()
              .map((e) => `${(e.tMs / 1000).toFixed(2)}s  ${e.kind.padEnd(11)} ${e.source.padEnd(8)} cls ${e.classificationConfidence.toFixed(2)} sens ${e.sensorConfidence.toFixed(2)}`)
              .join('\n') || 'no gestures yet'}
          </div>
        </section>
      </div>
    </div>
  )
}
