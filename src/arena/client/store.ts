/**
 * A small store between the game loop and React (KTD15): the loop writes match state every tick, and React hears
 * about it at most `hz` times a second, so the HUD never re-renders at frame rate.
 */
export interface Store<T> {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
  /** Notify now, ignoring the rate (staging changes, pause, match end). */
  flush: () => void
}

export function createStore<T>(initial: T, hz = 10, now: () => number = () => performance.now()): Store<T> {
  let value = initial
  let last = -Infinity
  let pending = false
  const listeners = new Set<() => void>()
  const emit = () => {
    last = now()
    pending = false
    for (const l of listeners) l()
  }
  return {
    get: () => value,
    set: (next) => {
      value = next
      if (now() - last >= 1000 / hz) emit()
      else pending = true
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    flush: () => (pending || true) && emit(),
  }
}
