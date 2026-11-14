// Section 4: how a wrist angle becomes one of three actions. This runs the
// app's actual WristRotationMapper (dead zone, threshold, hysteresis, smoothing,
// stability window) — the gauge draws its real parameters, not illustrations.

import { useEffect, useRef, useState } from 'react'
import { DEFAULT_MAPPER_CONFIG, WristRotationMapper } from '../spatial/radial/WristRotationMapper'
import { ACTION_LABEL, type RadialAction } from '../spatial/radial/types'
import { reducedMotion, useFrame } from './motion'
import { ObjectVisual } from './objects'
import { RadialRing, sectorPath } from './RadialRing'

const C = DEFAULT_MAPPER_CONFIG
const GAUGE_R = 250
/** Wrist degrees → gauge SVG degrees (upper half circle). */
const g = (deg: number) => -90 + deg * 1.15

export function Orientation() {
  const root = useRef<HTMLElement>(null)
  const mapper = useRef(new WristRotationMapper())
  const raw = useRef(0)
  const manualUntil = useRef(0)
  const drag = useRef<{ x: number; a: number } | null>(null)
  const rawNeedle = useRef<SVGGElement>(null)
  const smoothNeedle = useRef<SVGGElement>(null)
  const wrist = useRef<SVGGElement>(null)
  const readRaw = useRef<HTMLElement>(null)
  const readSmooth = useRef<HTMLElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const [action, setAction] = useState<RadialAction>('explain')
  const [confirmed, setConfirmed] = useState<RadialAction | null>(null)
  const [auto, setAuto] = useState(true)
  const still = useRef(false)

  useEffect(() => {
    still.current = reducedMotion()
  }, [])

  useFrame(root, (_dt, t) => {
    const isAuto = t > manualUntil.current && !drag.current && !still.current
    if (isAuto) {
      // Sweep: dwell in each sector long enough to pass the stability window.
      const ph = (t * 0.00042) % (Math.PI * 2)
      raw.current = 58 * Math.sin(ph) * Math.min(1, Math.abs(Math.sin(ph)) * 1.6)
      if (slider.current) slider.current.value = String(Math.round(raw.current))
    }
    if (isAuto !== auto) setAuto(isAuto)
    const m = mapper.current
    const changed = m.update(raw.current, t)
    if (changed) setAction(m.action)
    rawNeedle.current?.setAttribute('transform', `rotate(${g(Math.max(-C.maxDeg - 10, Math.min(C.maxDeg + 10, raw.current))).toFixed(2)})`)
    smoothNeedle.current?.setAttribute('transform', `rotate(${g(m.angle).toFixed(2)})`)
    wrist.current?.setAttribute('transform', `rotate(${(raw.current * 0.9).toFixed(2)})`)
    if (readRaw.current) readRaw.current.textContent = `${raw.current >= 0 ? '+' : '−'}${Math.abs(raw.current).toFixed(1)}°`
    if (readSmooth.current) readSmooth.current.textContent = `${m.angle >= 0 ? '+' : '−'}${Math.abs(m.angle).toFixed(1)}°`
  })

  const setManual = (a: number) => {
    raw.current = Math.max(-90, Math.min(90, a))
    manualUntil.current = performance.now() + 2600
    if (slider.current) slider.current.value = String(Math.round(raw.current))
  }

  const confirm = () => {
    setConfirmed(mapper.current.action)
    window.setTimeout(() => setConfirmed(null), 1400)
  }

  const ticks = []
  for (let d = -80; d <= 80; d += 5) {
    const a = (g(d) * Math.PI) / 180
    const long = d % 25 === 0
    const r0 = GAUGE_R - (long ? 16 : 8)
    ticks.push(<line key={d} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * GAUGE_R} y2={Math.sin(a) * GAUGE_R} className={long ? 'tick long' : 'tick'} />)
  }
  const zone = (a0: number, a1: number, cls: string, r0 = GAUGE_R + 8, r1 = GAUGE_R + 22) => <path className={cls} d={sectorPath(r0, r1, g(a0), g(a1))} />

  return (
    <section ref={root} className="orient" id="actions" aria-label="Contextual action system">
      <div className="orient-copy">
        <div className="section-index mono">
          <span>[04]</span>
          <span>Contextual actions</span>
        </div>
        <h2 className="orient-title" data-reveal>
          Hold.
          <br />
          Turn.
          <br />
          <span className="hot">Release.</span>
        </h2>
        <p className="orient-lede">Pinch an object and keep still. Three actions open around it. Turn your wrist to choose one, and let go to confirm. You never move your hand away from the thing you’re working on.</p>
        <dl className="orient-params mono">
          <div>
            <dt>Dead zone</dt>
            <dd>±{C.deadZoneDeg}°</dd>
          </div>
          <div>
            <dt>Threshold</dt>
            <dd>±{C.thresholdDeg}°</dd>
          </div>
          <div>
            <dt>Hysteresis</dt>
            <dd>{C.hysteresisDeg}°</dd>
          </div>
          <div>
            <dt>Stable for</dt>
            <dd>{C.stableMs} ms</dd>
          </div>
          <div>
            <dt>Clamp</dt>
            <dd>±{C.maxDeg}°</dd>
          </div>
        </dl>
        <p className="provenance mono">Live: the app’s WristRotationMapper with its default config. On the band, the angle is the gyro integrated; here you set it.</p>
      </div>

      <div className="orient-dial">
        <div
          className="dial-touch"
          onPointerDown={(e) => {
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, a: raw.current }
            manualUntil.current = Infinity
          }}
          onPointerMove={(e) => {
            if (drag.current) setManual(drag.current.a + (e.clientX - drag.current.x) * 0.35)
            if (drag.current) manualUntil.current = Infinity
          }}
          onPointerUp={() => {
            if (!drag.current) return
            drag.current = null
            manualUntil.current = performance.now() + 2600
            confirm()
          }}
        >
          <svg viewBox="-330 -330 660 520" className="dial-svg" aria-hidden="true">
            {zone(-C.maxDeg, -C.thresholdDeg, `zone ${action === 'voice' ? 'on' : ''}`)}
            {zone(-C.thresholdDeg, C.thresholdDeg, `zone ${action === 'explain' ? 'on' : ''}`)}
            {zone(C.thresholdDeg, C.maxDeg, `zone ${action === 'remember' ? 'on' : ''}`)}
            {zone(-C.deadZoneDeg, C.deadZoneDeg, 'dead', GAUGE_R + 26, GAUGE_R + 32)}
            {zone(C.thresholdDeg - C.hysteresisDeg, C.thresholdDeg, 'hyst', GAUGE_R + 26, GAUGE_R + 32)}
            {zone(-C.thresholdDeg, -C.thresholdDeg + C.hysteresisDeg, 'hyst', GAUGE_R + 26, GAUGE_R + 32)}
            {ticks}
            {[-C.thresholdDeg, C.thresholdDeg].map((d) => {
              const a = (g(d) * Math.PI) / 180
              return <line key={d} className="thresh" x1={Math.cos(a) * 140} y1={Math.sin(a) * 140} x2={Math.cos(a) * (GAUGE_R + 32)} y2={Math.sin(a) * (GAUGE_R + 32)} />
            })}
            {(['voice', 'explain', 'remember'] as RadialAction[]).map((a) => {
              const d = a === 'voice' ? -50 : a === 'explain' ? 0 : 50
              const ang = (g(d) * Math.PI) / 180
              return (
                <text key={a} x={Math.cos(ang) * (GAUGE_R + 52)} y={Math.sin(ang) * (GAUGE_R + 52)} textAnchor="middle" dominantBaseline="middle" className={`zone-label ${action === a ? 'on' : ''}`}>
                  {ACTION_LABEL[a].toUpperCase()}
                </text>
              )
            })}
            <g ref={rawNeedle} className="needle raw">
              <line x1="140" x2={GAUGE_R + 4} y1="0" y2="0" />
            </g>
            <g ref={smoothNeedle} className="needle smooth">
              <line x1="140" x2={GAUGE_R + 30} y1="0" y2="0" />
              <circle cx={GAUGE_R + 30} cy="0" r="4" />
            </g>
            <g transform="translate(0,168)">
              <g ref={wrist} className="wrist">
                <rect x="-60" y="-9" width="120" height="18" />
                <rect x="-16" y="-14" width="32" height="28" className="pod" />
                <line x1="0" y1="-14" x2="0" y2="-26" className="pod" />
              </g>
              <text y="50" textAnchor="middle" className="zone-label">WRIST · TOP VIEW</text>
            </g>
          </svg>
          <div className="dial-radial">
            <RadialRing active={action} size={300} rIn={78} rOut={116} labels={false} />
            <div className="dial-obj">
              <ObjectVisual visual="chart" />
            </div>
          </div>
          <div className={`dial-confirm mono ${confirmed ? 'show' : ''}`}>Released → {confirmed ? ACTION_LABEL[confirmed] : ''}</div>
        </div>
        <div className="dial-readout mono">
          <div>
            <span>Raw</span>
            <b ref={readRaw}>0°</b>
          </div>
          <div>
            <span>Smoothed</span>
            <b ref={readSmooth}>0°</b>
          </div>
          <div>
            <span>Sector</span>
            <b className="hot">{ACTION_LABEL[action]}</b>
          </div>
          <div>
            <span>Input</span>
            <b>{auto ? 'Auto sweep' : 'You'}</b>
          </div>
        </div>
        <label className="dial-slider mono">
          <span>Wrist angle — drag the dial, or use this slider</span>
          <input
            ref={slider}
            type="range"
            min={-90}
            max={90}
            step={1}
            defaultValue={0}
            onChange={(e) => setManual(Number(e.target.value))}
            onKeyUp={(e) => e.key === 'Enter' && confirm()}
            onPointerUp={confirm}
            aria-label="Wrist angle in degrees"
          />
        </label>
      </div>
    </section>
  )
}
