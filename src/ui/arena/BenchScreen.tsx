import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LOAD, NO_LOAD, runBench, type BenchReport } from '../../arena/client/bench'
import { forceWebGLFlag } from '../../arena/client/render/renderer'

/** `?bench` opens the performance bench (U1). Add `&webgl` to force WebGL2, `&noload` to drop the simulated game load. */
export function BenchScreen() {
  const host = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<BenchReport>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!host.current) return
    // a fresh canvas per run: StrictMode mounts twice, and a disposed renderer loses its canvas's context
    const el = document.createElement('canvas')
    el.style.cssText = 'width:100%;height:100%;display:block'
    host.current.append(el)
    const search = window.location.search
    let stop: (() => void) | undefined
    let cancelled = false
    runBench(el, { forceWebGL: forceWebGLFlag(search), load: new URLSearchParams(search).has('noload') ? NO_LOAD : DEFAULT_LOAD, onReport: setReport })
      .then((s) => (cancelled ? s() : (stop = s)))
      .catch((e: unknown) => {
        console.error(e)
        ;(window as unknown as { __benchError?: string }).__benchError = e instanceof Error ? e.stack : String(e)
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      stop?.()
      el.remove()
    }
  }, [])

  const ok = report && report.medianMs > 0 && report.medianMs <= 16.7
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#10141c' }}>
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, left: 12, padding: '10px 14px', background: 'rgba(0,0,0,0.7)', color: '#e8eef8', font: '13px/1.5 ui-monospace, monospace', borderRadius: 8 }}>
        {error ? (
          <div>Bench failed: {error}</div>
        ) : report ? (
          <>
            <div style={{ color: ok ? '#7dffa0' : '#ff8a7d' }}>
              median {report.medianMs.toFixed(1)} ms ({report.fps.toFixed(0)} fps) · 1% low {report.onePercentLowMs.toFixed(1)} ms
            </div>
            <div>
              {report.backend} · {report.heroes} heroes · {report.particles.toLocaleString()} particles
            </div>
            <div>
              {report.drawCalls} draw calls · {report.triangles.toLocaleString()} triangles
            </div>
          </>
        ) : (
          <div>Warming up…</div>
        )}
      </div>
    </div>
  )
}
