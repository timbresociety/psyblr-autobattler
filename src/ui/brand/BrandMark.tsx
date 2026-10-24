import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Token, Wordmark } from './Brand'
import type { ChromeMarks } from './chrome'

const FPS = 30

/**
 * The top bar's mark in live liquid chrome. The SVG token and wordmark keep the layout (and the wordmark's accessible
 * name); once WebGL is up, a canvas laid over them draws the same marks in 3D and the SVGs fade out. Without WebGL the
 * SVGs simply stay, in a still chrome gradient. The canvas holds a single frame under reduced motion, in a hidden tab,
 * and while `paused` (a match has the GPU).
 */
export function BrandMark({ paused = false, label }: { paused?: boolean; label?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const marks = useRef<ChromeMarks | undefined>(undefined)
  const pausedRef = useRef(paused)
  const wakeRef = useRef<() => void>(() => {})
  const [live, setLive] = useState(false)

  useEffect(() => {
    const el = box.current
    const cv = canvas.current
    if (!el || !cv) return
    let alive = true
    let raf = 0
    let last = 0
    const start = performance.now()
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const running = () => !reduced && !pausedRef.current && !document.hidden
    const seconds = () => (performance.now() - start) / 1000
    const loop = (now: number) => {
      raf = 0
      if (!marks.current || !running()) return
      raf = requestAnimationFrame(loop)
      if (now - last < 1000 / FPS - 2) return
      last = now
      marks.current.frame(seconds())
    }
    const wake = () => {
      if (!marks.current) return
      if (running()) {
        if (!raf) raf = requestAnimationFrame(loop)
      } else marks.current.frame(seconds())
    }
    wakeRef.current = wake
    const measure = () => {
      const m = marks.current
      const token = el.querySelector('.brand-token')
      const word = el.querySelector('.brand-wordmark')
      if (!m || !token || !word) return
      const at = cv.getBoundingClientRect()
      const local = (r: DOMRect) => new DOMRect(r.left - at.left, r.top - at.top, r.width, r.height)
      m.layout({ width: at.width, height: at.height, token: local(token.getBoundingClientRect()), word: local(word.getBoundingClientRect()) })
      m.frame(seconds())
    }
    const theme = () => {
      marks.current?.theme(document.documentElement.dataset.theme !== 'light')
      wake()
    }
    const lost = (e: Event) => {
      e.preventDefault()
      marks.current = undefined
      setLive(false)
    }
    const resize = new ResizeObserver(measure)
    const themes = new MutationObserver(theme)
    import('./chrome')
      .then(({ ChromeMarks }) => {
        if (!alive) return
        marks.current = new ChromeMarks(cv)
        theme()
        measure()
        setLive(true)
        resize.observe(el)
        themes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
        wake()
      })
      .catch(() => {
        // no WebGL here: the SVG marks stay
      })
    document.addEventListener('visibilitychange', wake)
    cv.addEventListener('webglcontextlost', lost)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      resize.disconnect()
      themes.disconnect()
      document.removeEventListener('visibilitychange', wake)
      cv.removeEventListener('webglcontextlost', lost)
      marks.current?.dispose()
      marks.current = undefined
    }
  }, [])

  useEffect(() => {
    pausedRef.current = paused
    wakeRef.current()
  }, [paused])

  // a touch runs a ripple through the metal from the pointer
  const ripple = (e: PointerEvent<HTMLDivElement>) => {
    const cv = canvas.current
    if (!cv || !marks.current) return
    const at = cv.getBoundingClientRect()
    marks.current.pulse(e.clientX - at.left, e.clientY - at.top)
    wakeRef.current()
  }

  return (
    <div ref={box} className={`brand${live ? ' chrome' : ''}`} onPointerEnter={ripple} onPointerDown={ripple}>
      <Token className="brand-token" />
      <span className="brand-word">
        <Wordmark className="brand-wordmark" />
        {label && <small>{label}</small>}
      </span>
      <canvas ref={canvas} className="brand-chrome" aria-hidden="true" />
    </div>
  )
}
