import type { SpatialRuntime } from '../runtime'
import type { SensorFusionMode } from '../types'
import { MockWearableAdapter, type MockPattern } from '../wearable/mockWearable'

const MODES: SensorFusionMode[] = ['WEARABLE_PRIMARY', 'FUSED', 'CAMERA_FALLBACK']

export const fmtStat = (s: { n: number; p50: number; p95: number } | null) => (s ? `p50 ${s.p50.toFixed(0)} / p95 ${s.p95.toFixed(0)} ms (n=${s.n})` : '—')

const cls = (ok: boolean, warn = false) => (ok ? 'sp-ok' : warn ? 'sp-warn' : 'sp-bad')

export function StatusRows({ rt }: { rt: SpatialRuntime }) {
  const d = rt.fusion.diagnostics
  const cam = rt.latestCamera
  const p = rt.pointer
  return (
    <>
      <div className="row">
        <span>Camera</span>
        <span className={cls(rt.tracker.status === 'running', rt.tracker.status === 'loading')}>
          {rt.tracker.status}
          {rt.tracker.error ? ` (${rt.tracker.error})` : ''}
        </span>
      </div>
      <div className="row">
        <span>Hand</span>
        <span className={cls(!!rt.latestFeatures, false)}>
          {rt.latestFeatures ? `${cam?.handedness} · conf ${(cam?.sensorConfidence ?? 0).toFixed(2)} · ${Math.round((cam?.inFrameFraction ?? 0) * 100)}% in frame` : 'not tracked'}
        </span>
      </div>
      <div className="row">
        <span>Fusion mode</span>
        <span>{d.mode}</span>
      </div>
      <div className="row">
        <span>Pointer source</span>
        <span className={cls(p.valid)}>{p.valid ? p.source : 'none (lost)'}</span>
      </div>
      <div className="row">
        <span>Camera / wearable</span>
        <span>
          <span className={cls(d.cameraStatus === 'ok', d.cameraStatus === 'off')}>{d.cameraStatus}</span> /{' '}
          <span className={cls(d.wearableStatus === 'ok', d.wearableStatus === 'off')}>{d.wearableStatus}</span>
        </span>
      </div>
      <div className="row">
        <span>Interaction</span>
        <span>
          {rt.interaction.state}
          {rt.interaction.grabbedId ? ` · ${rt.interaction.grabbedId}` : rt.interaction.hoverId ? ` · ${rt.interaction.hoverId}` : ''}
        </span>
      </div>
      <div className="row">
        <span>Pinch</span>
        <span>
          {rt.detector.pinched ? 'engaged' : 'open'}
          {cam?.pinchRatio !== undefined ? ` · ratio ${cam.pinchRatio.toFixed(2)}` : ''}
        </span>
      </div>
      <div className="row">
        <span>Capture→pointer</span>
        <span>{fmtStat(rt.latency.captureToPointer.stats())}</span>
      </div>
    </>
  )
}

export function Controls({ rt }: { rt: SpatialRuntime }) {
  const mock = rt.mockWearable
  const setMock = (pattern: MockPattern | 'off') => {
    if (pattern === 'off') rt.setWearable(null)
    else rt.setWearable(new MockWearableAdapter({ pattern }))
  }
  return (
    <>
      <div className="group">
        <button className={rt.tracker.status === 'running' ? 'on' : ''} onClick={() => (rt.tracker.status === 'running' || rt.tracker.status === 'loading' ? rt.stopCamera() : void rt.startCamera())}>
          {rt.tracker.status === 'running' ? 'Camera on' : rt.tracker.status === 'loading' ? 'Camera loading…' : 'Camera off'}
        </button>
        <select value={rt.fusion.mode} onChange={(e) => rt.setMode(e.target.value as SensorFusionMode)}>
          {MODES.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="group">
        <span style={{ opacity: 0.6, width: '100%' }}>Mock wearable (synthetic data)</span>
        <select value={mock ? mock.options.pattern : 'off'} onChange={(e) => setMock(e.target.value as MockPattern | 'off')}>
          <option value="off">off</option>
          <option value="orbit">orbit (autonomous)</option>
          <option value="mouse">follows mouse</option>
        </select>
        {mock && (
          <button className={mock.connected ? '' : 'on'} onClick={() => mock.setConnected(!mock.connected)}>
            {mock.connected ? 'Drop link' : 'Link dropped'}
          </button>
        )}
        {mock && <button onClick={() => mock.emitGesture('select')}>Wearable select</button>}
      </div>
      <div className="group">
        <button onClick={() => rt.startCalibration('region')}>Calibrate region</button>
        <button onClick={() => rt.startCalibration('points')}>5-point calibration</button>
        <button onClick={() => rt.recenter()}>Recenter (R)</button>
        <button onClick={() => rt.resetCalibration()}>Reset</button>
        <button onClick={() => rt.startAccuracy()}>Accuracy test</button>
      </div>
      <div className="group">
        <label>
          <input type="checkbox" checked={rt.profile.mirrorX} onChange={(e) => rt.updateProfile({ mirrorX: e.target.checked })} /> mirror X
        </label>
        <label>
          <input type="checkbox" checked={rt.profile.flipY} onChange={(e) => rt.updateProfile({ flipY: e.target.checked })} /> flip Y
        </label>
        <label>
          <input type="checkbox" checked={rt.mouseFallback} onChange={(e) => rt.setMouseFallback(e.target.checked)} /> mouse fallback
        </label>
        <select value={rt.anchor} onChange={(e) => rt.setAnchor(e.target.value as 'palm' | 'indexTip')}>
          <option value="palm">cursor: palm</option>
          <option value="indexTip">cursor: index tip</option>
        </select>
      </div>
    </>
  )
}
