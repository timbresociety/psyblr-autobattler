import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { FloorPoint } from './board-math'
import type { BoardHandlers, BoardScene, BoardState } from './board-scene'

/**
 * The 3D staging board's place in the page (U16): a host for the arena scene (board-scene.ts, loaded on demand with
 * three's WebGPU renderer), a veil while it rises, and a button that puts the camera back. The staging screen talks to
 * it through a handle while a hero is carried in from the row.
 */

export interface Board3DHandle {
  /** A hero carried from the row is at this pointer position; true when that is over the board. */
  carry: (hero: number, clientX: number, clientY: number) => boolean
  /** Let the carried hero go: the floor spot under the pointer, or undefined when it was not over the floor. */
  drop: (clientX: number, clientY: number) => FloorPoint | undefined
  cancelCarry: () => void
  /** Give the renderer back now, before the match makes its own. */
  release: () => Promise<void>
}

/** Can this browser draw the 3D board? Without WebGPU or WebGL2 (tests, old browsers), or with `?flatboard`, the flat board stands in. */
export function canDraw3D(): boolean {
  if (typeof window === 'undefined' || new URLSearchParams(window.location.search).has('flatboard')) return false
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true
  if (typeof WebGL2RenderingContext === 'undefined') return false
  try {
    const gl = document.createElement('canvas').getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}

export interface Board3DProps {
  state: BoardState
  handlers: Omit<BoardHandlers, 'view'>
  /** The scene could not start here (no adapter, a lost device): the flat board takes over. */
  onUnavailable: () => void
  ref?: Ref<Board3DHandle>
}

export function Board3D({ state, handlers, onUnavailable, ref }: Board3DProps) {
  const stage = useRef<HTMLDivElement>(null)
  const scene = useRef<BoardScene | undefined>(undefined)
  const latest = useRef({ state, handlers, onUnavailable })
  latest.current = { state, handlers, onUnavailable }
  const [ready, setReady] = useState(false)
  const [home, setHome] = useState(true)

  // one scene per mount, given back on unmount (or as soon as it exists, if the mount is gone by then)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    let cancelled = false
    let live: BoardScene | undefined
    const relay: BoardHandlers = {
      place: (...a) => latest.current.handlers.place(...a),
      move: (...a) => latest.current.handlers.move(...a),
      remove: (...a) => latest.current.handlers.remove(...a),
      select: (...a) => latest.current.handlers.select(...a),
      dragging: (...a) => latest.current.handlers.dragging(...a),
      view: (atHome) => !cancelled && setHome(atHome),
    }
    import('./board-scene')
      // StrictMode's first mount is gone by the time the module arrives: it builds nothing
      .then(({ createBoardScene }) => (cancelled ? undefined : createBoardScene(el, latest.current.state, () => relay)))
      .then((s) => {
        if (!s) return
        live = s
        if (cancelled) return void s.dispose()
        scene.current = s
        s.update(latest.current.state)
        setReady(true)
      })
      .catch(() => !cancelled && latest.current.onUnavailable())
    return () => {
      cancelled = true
      scene.current = undefined
      void live?.dispose()
    }
  }, [])

  useEffect(() => {
    scene.current?.update(state)
  }, [state])

  useImperativeHandle(
    ref,
    () => ({
      carry: (hero, x, y) => scene.current?.carry(hero, x, y) ?? false,
      drop: (x, y) => scene.current?.drop(x, y),
      cancelCarry: () => scene.current?.cancelCarry(),
      release: async () => {
        const s = scene.current
        scene.current = undefined
        await s?.dispose()
      },
    }),
    [],
  )

  return (
    <div className={`board3d${ready ? ' is-ready' : ''}`} role="application" aria-label="Arena board" aria-roledescription="3D arena">
      <div ref={stage} className="board3d-stage" />
      {!ready && (
        <div className="board3d-veil" aria-hidden="true">
          <span>Raising the arena…</span>
        </div>
      )}
      <button type="button" className="board3d-reset" onClick={() => scene.current?.resetView()} disabled={!ready || home} title="Put the camera back over the whole arena">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.2 6.4A5 5 0 1 1 3 9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M2.6 2.8v3.8h3.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Reset view
      </button>
    </div>
  )
}
