import { useState } from 'react'
import type { SpatialRuntime } from '../../runtime'
import { BAND_NUMBER } from '../../wearable/band'
import { ACTION_LABEL, isMenuOpen } from '../types'

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d))
const ms = (a: number | null, b: number | null) => (a !== null && b !== null ? `${Math.round(b - a)} ms` : '—')

function Slider({ label, min, max, step, value, onChange, unit = '' }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <>
      <span>{label}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
        <span style={{ minWidth: 52 }}>
          {value}
          {unit}
        </span>
      </span>
    </>
  )
}

export function RadialDebugPanel({ rt }: { rt: SpatialRuntime }) {
  const r = rt.radial
  const c = r.controller
  const s = c.state
  const m = c.mapper.config
  const band = r.band
  const now = performance.now()
  const raw = r.vexo.latest
  const obs = r.active?.observation
  const [target, setTarget] = useState(rt.interaction.objects[0]?.id ?? '')
  const t = r.timings
  const last = r.executor.last
  const holdStarted = c.holdStartedAt

  const sourceText = (src: string | undefined) =>
    src === 'vexo' ? (band?.link === 'sim' ? `Vexo PRETEND band ${BAND_NUMBER} (simulated gyro)` : `Vexo band ${BAND_NUMBER} gyro (real)`) : src === 'camera' ? 'Camera hand tilt (approximation)' : src === 'simulator' ? 'SIMULATOR (not real input)' : 'none'

  return (
    <>
      <section>
        <h3>Vexo band {BAND_NUMBER} · rotation data</h3>
        <div className="kv">
          <span>connection</span>
          <span>
            {band ? `${band.status} (${band.link === 'sim' ? 'PRETEND band — simulated gyro' : band.link})` : 'not connected'}
            {band?.error ? ` — ${band.error}` : ''}
          </span>
          <span>gyro streaming</span>
          <span>{r.vexo.streaming(now) ? `yes (${band?.sensors}, 100 Hz)` : 'no'}</span>
          <span>raw ω x / y / z</span>
          <span>{raw ? `${n(raw.x)} / ${n(raw.y)} / ${n(raw.z)} °/s` : '—'}</span>
          <span>calibrated axis</span>
          <span>{r.vexo.cal ? `${r.vexo.cal.sign > 0 ? '+' : '−'}${r.vexo.cal.axis} · ${Math.round(r.vexo.cal.axisShare * 100)}% of twist energy` : 'not calibrated (band rotation not used)'}</span>
          <span>bias / noise</span>
          <span>{r.vexo.cal ? `${n(r.vexo.cal.bias.x, 2)}, ${n(r.vexo.cal.bias.y, 2)}, ${n(r.vexo.cal.bias.z, 2)} °/s · ±${n(r.vexo.cal.noiseDps, 2)}` : '—'}</span>
          <span>rate on axis</span>
          <span>{r.vexo.cal ? `${n(r.vexo.rateDps())} °/s` : '—'}</span>
          <span>integration gaps</span>
          <span>{r.vexo.gaps()}</span>
        </div>
        <div className="sp-hud" style={{ position: 'static', width: 'auto', maxHeight: 'none', fontFamily: 'system-ui', padding: 0, background: 'none', border: 'none', marginTop: 8 }}>
          <div className="group" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
            {!band || band.status === 'error' || band.status === 'closed' ? (
              <>
                <button onClick={() => r.connectBand('ble')}>Connect Bluetooth</button>
                <button onClick={() => r.connectBand('serial')}>USB</button>
                <button onClick={() => r.connectBand('sim')}>Pretend band</button>
              </>
            ) : (
              <button onClick={() => r.disconnectBand()}>Disconnect</button>
            )}
            <button onClick={() => r.startGyroCalibration()} disabled={!r.vexo.streaming(now)}>
              Calibrate twist
            </button>
            {band?.sim && <button onClick={() => r.pretendTwist()}>Pretend twist (sim)</button>}
            {r.vexo.cal && <button onClick={() => r.clearGyroCalibration()}>Forget calibration</button>}
          </div>
          <div style={{ marginTop: 6 }}>
            {r.gyroCalibration.phase === 'still' && 'Hold the band still…'}
            {r.gyroCalibration.phase === 'twist' && 'Twist like a doorknob, clockwise first, back and forth…'}
            {r.gyroCalibration.phase === 'failed' && <span className="sp-bad">{r.gyroCalibration.message}</span>}
            {r.gyroCalibration.phase === 'done' && <span className="sp-ok">Calibrated and saved for band {BAND_NUMBER}.</span>}
          </div>
        </div>
      </section>

      <section>
        <h3>Radial menu · {s.status}</h3>
        <div className="kv">
          <span>selection source</span>
          <span>{isMenuOpen(s.status) ? (s.inputSource === 'simulator' ? 'SIMULATOR (not real input)' : s.inputSource) : '—'}</span>
          <span>rotation source now</span>
          <span>{sourceText(r.active?.source)}</span>
          <span>relative angle</span>
          <span>{obs?.angleDegrees !== undefined ? `${n(obs.angleDegrees)}°` : '—'}</span>
          <span>mapped angle</span>
          <span>{n(s.rotationDegrees)}°</span>
          <span>neutral reference</span>
          <span>{n(c.neutralAngle)}°</span>
          <span>active sector</span>
          <span>{ACTION_LABEL[s.activeAction]}</span>
          <span>pinch held</span>
          <span>{holdStarted !== null ? `${Math.round(now - holdStarted)} ms / ${c.config.holdMs}` : '—'}</span>
          <span>object</span>
          <span>{s.objectId ?? '—'}</span>
          <span>last action</span>
          <span>{last ? `${ACTION_LABEL[last.event.action]} on ${last.objectTitle} (via ${last.event.selectionSource})` : '—'}</span>
          <span>pinch → menu</span>
          <span>{ms(t.pinchMs, t.openedMs)}</span>
          <span>menu → release</span>
          <span>{ms(t.openedMs, t.releaseMs)}</span>
          <span>release → confirm</span>
          <span>{ms(t.releaseMs, t.confirmedMs)}</span>
          <span>confirm → result</span>
          <span>{last ? ms(t.confirmedMs, last.resultAtMs) : '—'}</span>
        </div>
        <div className="log" style={{ marginTop: 8, maxHeight: 140 }}>
          {c.transitions
            .slice(-10)
            .reverse()
            .map((x) => `${(x.tMs / 1000).toFixed(2)}s  ${x.from} → ${x.to}  ${x.reason}`)
            .join('\n') || 'no transitions yet'}
        </div>
      </section>

      <section>
        <h3>Simulator (debug only)</h3>
        <div className="kv">
          <span>use simulator</span>
          <span>
            <input
              type="checkbox"
              checked={r.simulator.enabled}
              onChange={(e) => {
                r.simulator.enabled = e.target.checked
              }}
            />{' '}
            overrides band and camera; labelled SIMULATOR everywhere
          </span>
          <Slider label="wrist angle" min={-90} max={90} step={1} value={r.simulator.value} unit="°" onChange={(v) => (r.simulator.value = v)} />
          <span>object</span>
          <span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {rt.interaction.objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="sp-hud" style={{ position: 'static', width: 'auto', maxHeight: 'none', fontFamily: 'system-ui', padding: 0, background: 'none', border: 'none' }}>
          <div className="group">
            <button onClick={() => r.forceOpen(target)}>Force-open menu</button>
            <button onClick={() => r.recenter()}>Recenter</button>
            <button onClick={() => r.simulateRelease()}>Simulate pinch release</button>
            <button className={r.vexo.simulatedDisconnect ? 'on' : ''} onClick={() => (r.vexo.simulatedDisconnect = !r.vexo.simulatedDisconnect)}>
              {r.vexo.simulatedDisconnect ? 'Band "disconnected" (sim)' : 'Simulate band disconnect'}
            </button>
          </div>
        </div>
      </section>

      <section>
        <h3>Tuning</h3>
        <div className="kv">
          <Slider label="hold" min={300} max={1200} step={50} value={c.config.holdMs} unit=" ms" onChange={(v) => (c.config.holdMs = v)} />
          <Slider label="hold max move" min={0.005} max={0.08} step={0.005} value={c.config.holdMaxMove} onChange={(v) => (c.config.holdMaxMove = v)} />
          <Slider label="dead zone" min={0} max={15} step={1} value={m.deadZoneDeg} unit="°" onChange={(v) => (m.deadZoneDeg = Math.min(v, m.thresholdDeg - 2))} />
          <Slider label="threshold" min={10} max={45} step={1} value={m.thresholdDeg} unit="°" onChange={(v) => (m.thresholdDeg = Math.max(v, m.deadZoneDeg + 2))} />
          <Slider label="hysteresis" min={0} max={15} step={1} value={m.hysteresisDeg} unit="°" onChange={(v) => (m.hysteresisDeg = Math.min(v, m.thresholdDeg - m.deadZoneDeg - 1))} />
          <Slider label="smoothing" min={0} max={200} step={10} value={m.smoothingMs} unit=" ms" onChange={(v) => (m.smoothingMs = v)} />
          <Slider label="stable for" min={0} max={300} step={10} value={m.stableMs} unit=" ms" onChange={(v) => (m.stableMs = v)} />
          <Slider label="sensitivity" min={0.5} max={3} step={0.1} value={m.sensitivity} unit="×" onChange={(v) => (m.sensitivity = v)} />
          <span>invert direction</span>
          <span>
            <input type="checkbox" checked={m.invert} onChange={(e) => (m.invert = e.target.checked)} />
          </span>
          <Slider label="open-palm window" min={0} max={400} step={20} value={c.config.openPalmWindowMs} unit=" ms" onChange={(v) => (c.config.openPalmWindowMs = v)} />
        </div>
      </section>
    </>
  )
}
