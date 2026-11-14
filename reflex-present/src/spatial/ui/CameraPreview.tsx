import { useEffect, useRef } from 'react'
import { HAND_CONNECTIONS } from '../camera/handTracker'
import type { SpatialRuntime } from '../runtime'

/** Webcam frame + landmarks + active region, drawn as the user sees themself (mirror per profile). */
export function CameraPreview({ rt, width = 320 }: { rt: SpatialRuntime; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const height = Math.round((width * 3) / 4)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = ref.current
      const ctx = c?.getContext('2d')
      if (!c || !ctx) return
      const { mirrorX, flipY, region } = rt.profile
      const W = c.width
      const H = c.height
      const sx = (x: number) => (mirrorX ? 1 - x : x) * W
      const sy = (y: number) => y * H
      ctx.fillStyle = '#05060a'
      ctx.fillRect(0, 0, W, H)
      const v = rt.tracker.video
      if (rt.tracker.status === 'running' && v.readyState >= 2) {
        ctx.save()
        if (mirrorX) {
          ctx.translate(W, 0)
          ctx.scale(-1, 1)
        }
        ctx.globalAlpha = 0.55
        ctx.drawImage(v, 0, 0, W, H)
        ctx.restore()
      } else {
        ctx.fillStyle = '#8a8f9c'
        ctx.font = '13px system-ui'
        ctx.fillText(rt.tracker.status === 'error' ? `camera error: ${rt.tracker.error}` : `camera ${rt.tracker.status}`, 10, 20)
      }

      // Active region is stored in oriented coords: x already mirrored, y flipped if flipY.
      const ry0 = flipY ? 1 - region.y1 : region.y0
      const ry1 = flipY ? 1 - region.y0 : region.y1
      ctx.strokeStyle = rt.profile.affine ? 'rgba(120,200,255,0.25)' : 'rgba(120,200,255,0.8)'
      ctx.setLineDash([5, 4])
      ctx.strokeRect(region.x0 * W, ry0 * H, (region.x1 - region.x0) * W, (ry1 - ry0) * H)
      ctx.setLineDash([])

      const lm = rt.latestCamera?.landmarks ?? []
      if (lm.length === 21) {
        const pinched = rt.detector.pinched
        ctx.strokeStyle = pinched ? '#ff5a36' : '#5bf0a5'
        ctx.lineWidth = 2
        for (const { start, end } of HAND_CONNECTIONS) {
          ctx.beginPath()
          ctx.moveTo(sx(lm[start].x), sy(lm[start].y))
          ctx.lineTo(sx(lm[end].x), sy(lm[end].y))
          ctx.stroke()
        }
        lm.forEach((l, i) => {
          ctx.fillStyle = i === 4 || i === 8 ? '#ffd23f' : '#e8e9ee'
          ctx.beginPath()
          ctx.arc(sx(l.x), sy(l.y), i === 4 || i === 8 ? 4 : 2.5, 0, Math.PI * 2)
          ctx.fill()
        })
        const f = rt.latestFeatures
        if (f) {
          ctx.strokeStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(sx(f.palm.x), sy(f.palm.y), 7, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [rt])

  return <canvas ref={ref} width={width} height={height} style={{ width, height, borderRadius: 8, display: 'block', border: '1px solid #262a35' }} />
}
