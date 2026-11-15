import { useEffect, useRef, useState } from 'react'
import { isMenuOpen, type RadialMenuState } from '../radial/types'
import { ExplainPanel, MemoryPanel, SavedToast, VoiceCapturePanel } from '../radial/ui/ActionPanels'
import { HoldRing, RadialActionMenu } from '../radial/ui/RadialActionMenu'
import type { SpatialRuntime } from '../runtime'
import type { PointerSource, SpatialObject } from '../types'

const SOURCE_COLOR: Record<PointerSource, string> = {
  camera: '#5bf0a5',
  wearable: '#c77dff',
  fused: '#5b8dee',
  mouse: '#ffd23f',
  none: '#8a8f9c',
}

const pct = (v: number) => `${v * 100}%`

function Content({ o }: { o: SpatialObject }) {
  const c = o.content
  if (!c) return <>{o.label}</>
  if (c.kind === 'metric') {
    return (
      <div className="sp-metric">
        <div className="sp-metric-v">{c.format === 'percent' ? `${(c.value * 100).toFixed(1)}%` : c.value.toLocaleString('en-US')}</div>
        <div className="sp-metric-l">{o.label}</div>
      </div>
    )
  }
  if (c.kind === 'note') {
    return (
      <div className="sp-note">
        <div className="sp-note-t">{o.label}</div>
        {c.text.split('\n').map((l, i) => (
          <div key={i}>• {l}</div>
        ))}
      </div>
    )
  }
  const max = Math.max(...c.series.map((p) => p.value), 1)
  return (
    <div className="sp-chart">
      <div className="sp-chart-t">{o.label}</div>
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="sp-chart-svg">
        {c.series.map((p, i) => {
          const w = 100 / c.series.length
          const h = (p.value / max) * 50
          return <rect key={p.label} x={i * w + w * 0.18} y={56 - h} width={w * 0.64} height={h} rx={1.5} fill="rgba(11,12,16,0.78)" />
        })}
      </svg>
      <div className="sp-chart-x">
        {c.series.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
    </div>
  )
}

function ObjectView({ o, hover, grabbed, frozen, menu }: { o: SpatialObject; hover: boolean; grabbed: boolean; frozen: boolean; menu: boolean }) {
  const radius = o.shape === 'circle' ? '50%' : o.shape === 'pill' ? '999px' : '14px'
  const classes = ['sp-obj', hover && 'hover', grabbed && 'grabbed', frozen && 'frozen', grabbed && 'dragging', menu && 'menu-target'].filter(Boolean).join(' ')
  return (
    <div className={classes} style={{ left: pct(o.x), top: pct(o.y), width: pct(o.w), height: pct(o.h), background: o.color, borderRadius: radius }}>
      <Content o={o} />
    </div>
  )
}

/** Objects, pointer, radial menu and action results. Sends mouse/wheel input to the runtime. */
export function SpatialCanvas({ rt, pointerHidden = false }: { rt: SpatialRuntime; pointerHidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 1280, h: 720 })
  const [memoryOpen, setMemoryOpen] = useState(false)
  const lastMenu = useRef<{ state: RadialMenuState; object: SpatialObject; closedAt: number | null } | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      rt.setCanvasSize(e.contentRect.width, e.contentRect.height)
      setSize({ w: e.contentRect.width, h: e.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [rt])

  // Wheel needs a non-passive listener to stop the page from scrolling while the menu is open.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!rt.radial.capturesInput) return
      e.preventDefault()
      rt.radial.wheel(e.deltaY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [rt])

  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) rt.onMouseReleasedElsewhere()
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [rt])

  const ex = rt.radial.executor
  const savedId = ex.lastSaved?.id ?? null
  useEffect(() => {
    if (savedId) setMemoryOpen(true)
  }, [savedId])

  const toCanvas = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const { interaction: ix, pointer: p } = rt
  const rs = rt.radial.state
  const byId = (id: string | null) => (id ? ix.objects.find((o) => o.id === id) : undefined)
  const open = isMenuOpen(rs.status)
  const menuObj = byId(rs.objectId)
  const now = performance.now()
  if (open && menuObj) lastMenu.current = { state: { ...rs }, object: menuObj, closedAt: null }
  else if (lastMenu.current && lastMenu.current.closedAt === null) lastMenu.current.closedAt = now
  const closingMenu = !open && lastMenu.current?.closedAt != null && now - lastMenu.current.closedAt < 220 ? lastMenu.current : null
  const holdObj = rs.status === 'HOLDING' ? menuObj : undefined
  const voiceObj = byId(ex.voice?.objectId ?? null)
  const showSaved = ex.lastSaved && Date.now() - new Date(ex.lastSaved.createdAt).getTime() < 2500

  return (
    <div
      ref={ref}
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
          hover={ix.hoverId === o.id && !ix.grabbedId && !open}
          grabbed={ix.grabbedId === o.id}
          frozen={ix.grabbedId === o.id && ix.state === 'TRACKING_LOST'}
          menu={open && rs.objectId === o.id}
        />
      ))}

      {holdObj && <HoldRing object={holdObj} canvas={size} progress={rs.holdProgress} />}

      {[...ex.explainCards.values()].map((card) => {
        const o = byId(card.objectId)
        return o ? <ExplainPanel key={card.objectId} card={card} object={o} thread={ex.explainThreads.get(card.objectId)} onAsk={(q) => ex.ask(card.objectId, q, ix.objects)} onClose={() => ex.closeExplain(card.objectId)} /> : null
      })}

      {ex.voice && voiceObj && (
        <VoiceCapturePanel key={ex.voice.id} session={ex.voice} object={voiceObj} objects={ix.objects} providers={rt.radial.voiceProviders} onClose={() => ex.closeVoice()} />
      )}

      {(open && menuObj ? { state: rs, object: menuObj, closing: false } : closingMenu ? { ...closingMenu, closing: true } : null) && (
        <RadialActionMenu
          state={open ? rs : closingMenu!.state}
          object={open ? menuObj! : closingMenu!.object}
          canvas={size}
          thresholdDeg={rt.radial.controller.mapper.config.thresholdDeg}
          maxDeg={rt.radial.controller.mapper.config.maxDeg}
          closing={!open}
          bandLost={rs.status === 'DEVICE_DISCONNECTED'}
          bandPretend={rt.radial.band?.link === 'sim'}
          onChoose={(a) => rt.radial.choose(a)}
        />
      )}

      {showSaved && <SavedToast entry={ex.lastSaved!} />}
      <MemoryPanel entries={ex.memory.list()} label={ex.memory.label} highlightId={showSaved ? savedId : null} open={memoryOpen} onToggle={() => setMemoryOpen((v) => !v)} />

      {!pointerHidden && !open && (
        <div
          className={`sp-pointer ${rt.detector.pinched || ix.grabbedId ? 'pinched' : ''} ${p.valid ? '' : 'invalid'}`}
          style={{ left: pct(p.x), top: pct(p.y), color: SOURCE_COLOR[p.source] }}
        />
      )}
    </div>
  )
}
