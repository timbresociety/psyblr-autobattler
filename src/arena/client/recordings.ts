import type { Recording } from '../engine/replay.js'

/**
 * Where recordings go (owner, 2026-11-03). In development the dev server keeps them in .dev-store/recordings, where a
 * replay page or a script can load them by name. A production build keeps them in memory only: sending playtesters'
 * sessions anywhere waits on the analytics wiring.
 */

export const RECORDINGS_PATH = '/dev-recordings'

/** Save (or save again: one file per match) in development; undefined elsewhere or on failure. */
export async function saveRecording(rec: Recording, keepalive = false): Promise<string | undefined> {
  if (!import.meta.env.DEV) return undefined
  try {
    const res = await fetch(RECORDINGS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rec),
      keepalive,
    })
    return res.ok ? ((await res.json()) as { name: string }).name : undefined
  } catch {
    return undefined
  }
}

export async function listRecordings(): Promise<string[]> {
  const res = await fetch(RECORDINGS_PATH)
  return res.ok ? ((await res.json()) as { names: string[] }).names : []
}

export async function loadRecording(name: string): Promise<Recording> {
  const res = await fetch(`${RECORDINGS_PATH}/${encodeURIComponent(name)}`)
  if (!res.ok) throw new Error(`no recording called ${name}`)
  return (await res.json()) as Recording
}
