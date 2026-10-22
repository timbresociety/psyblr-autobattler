/**
 * A small store between the game loop and React (KTD15): the loop writes match state every tick, and React hears
 * about it at most `hz` times a second, so the HUD never re-renders at frame rate.
 */
export interface Store<T> {
  get: () => T
  set: (next: T) => void
  subscribe: (listener: () => void) => () => void
  /** Would a `set` now reach listeners? Lets the writer skip building a value nobody will see. */
  due: () => boolean
  /** Notify now, ignoring the rate (staging changes, pause, match end). */
  flush: () => void
}

export function createStore<T>(initial: T, hz = 10, now: () => number = () => performance.now()): Store<T> {
  let value = initial
  let last = -Infinity
  const listeners = new Set<() => void>()
  const emit = () => {
    last = now()
    for (const l of listeners) l()
  }
  return {
    get: () => value,
    set: (next) => {
      value = next
      if (now() - last >= 1000 / hz) emit()
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    due: () => now() - last >= 1000 / hz,
    flush: emit,
  }
}
