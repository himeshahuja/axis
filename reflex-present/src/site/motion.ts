// Shared motion plumbing. Everything that moves per frame writes to the DOM or a
// canvas directly from requestAnimationFrame; React only renders structure.

import { useEffect, useRef, type RefObject } from 'react'

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One window-level pointer, in client pixels. `active` is false until the pointer has moved. */
export const pointer = { x: -9999, y: -9999, active: false, down: false, t: 0 }
let installed = false
export function installPointer() {
  if (installed) return
  installed = true
  const move = (e: PointerEvent) => {
    pointer.x = e.clientX
    pointer.y = e.clientY
    pointer.active = true
    pointer.t = performance.now()
  }
  window.addEventListener('pointermove', move, { passive: true })
  window.addEventListener('pointerdown', (e) => {
    move(e)
    pointer.down = true
  })
  window.addEventListener('pointerup', () => (pointer.down = false))
  document.addEventListener('pointerleave', () => (pointer.active = false))
}

/**
 * Run `frame(dt, t)` every animation frame while `ref` is on screen.
 * The callback is read through a ref, so it may close over fresh state.
 */
export function useFrame(ref: RefObject<Element | null>, frame: (dtMs: number, tMs: number) => void, margin = '120px') {
  const cb = useRef(frame)
  useEffect(() => {
    cb.current = frame
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    let last = 0
    let visible = false
    const loop = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16
      last = t
      cb.current(dt, t)
      raf = requestAnimationFrame(loop)
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !visible) {
          visible = true
          last = 0
          raf = requestAnimationFrame(loop)
        } else if (!e.isIntersecting && visible) {
          visible = false
          cancelAnimationFrame(raf)
        }
      },
      { rootMargin: margin },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [ref, margin])
}

/** 0 when the top of a tall (sticky) section reaches the viewport top, 1 when its bottom reaches the viewport bottom. */
export function stickyProgress(el: Element) {
  const r = el.getBoundingClientRect()
  const span = r.height - window.innerHeight
  return span <= 0 ? 0 : clamp(-r.top / span)
}

/** Size a canvas to its CSS box at device pixel ratio (capped at 2). Returns the CSS size. */
export function fitCanvas(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { w, h, ctx }
}
