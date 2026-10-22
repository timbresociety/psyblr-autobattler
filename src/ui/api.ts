import { proposeBuild, requestStats, type Build, type ProposalInput } from '../charter/build'
import { parseStatWishes } from '../charter/chat'
import type { LimitHit } from '../charter/types'
import type { GateOutcome } from '../sim/gate'
import type { GateRequest } from '../sim/gate-protocol'

/**
 * Creator I/O. Every call has an offline path, so the creator keeps working without the API (R13):
 * proposals fall back to the Charter's matcher, chat falls back to the keyword parser, and the
 * balance gate always runs locally in a worker.
 */

export interface ProposeResponse {
  build: Build
  offline: boolean
  limits: LimitHit[]
}

export interface ChatResponse extends ProposeResponse {
  understood: boolean
}

export interface CreatorDeps {
  propose(hero: ProposalInput & { photoUrls?: string[] }): Promise<ProposeResponse>
  chat(build: Build, message: string): Promise<ChatResponse>
  runGate(build: Build): Promise<GateOutcome>
  uploadPhoto(file: File): Promise<string | undefined>
}

const DEVICE_KEY = 'psyblr.deviceId'

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private mode or blocked storage: the creator still works, the ID just won't persist
  }
}

let devicePromise: Promise<string | undefined> | undefined

export function deviceId(): Promise<string | undefined> {
  devicePromise ??= (async () => {
    const existing = stored(DEVICE_KEY)
    if (existing) return existing
    try {
      const res = await fetch('/api/device', { method: 'POST' })
      if (!res.ok) return undefined
      const { deviceId: id } = (await res.json()) as { deviceId: string }
      store(DEVICE_KEY, id)
      return id
    } catch {
      return undefined
    }
  })()
  return devicePromise
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const id = await deviceId()
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(id ? { 'x-device-id': id } : {}) }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return (await res.json()) as T
}

export function offlineChat(build: Build, message: string): ChatResponse {
  const goals = parseStatWishes(message)
  if (!Object.keys(goals).length) return { build, offline: true, understood: false, limits: [] }
  const result = requestStats(build, goals)
  return result.ok ? { build: result.build, offline: true, understood: true, limits: result.limits } : { build, offline: true, understood: false, limits: [] }
}

function localGate(build: Build): Promise<GateOutcome> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      import('../sim/gate-protocol').then(({ handleGateMessage }) => setTimeout(() => resolve(handleGateMessage({ build })), 0), reject)
      return
    }
    const worker = new Worker(new URL('../sim/gate.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<GateOutcome>) => {
      resolve(event.data)
      worker.terminate()
    }
    worker.onerror = (event) => {
      reject(new Error(event.message))
      worker.terminate()
    }
    worker.postMessage({ build } satisfies GateRequest)
  })
}

export const liveDeps: CreatorDeps = {
  async propose(hero) {
    try {
      return await post<ProposeResponse>('/api/charter/propose', { kind: 'propose', hero })
    } catch {
      const result = proposeBuild(hero)
      return { build: result.build, offline: true, limits: result.ok ? result.limits : [] }
    }
  },
  async chat(build, message) {
    try {
      const res = await post<ChatResponse>('/api/charter/propose', { kind: 'chat', build, message })
      if (res.offline && !res.understood) return offlineChat(build, message)
      return res
    } catch {
      return offlineChat(build, message)
    }
  },
  runGate: localGate,
  async uploadPhoto(file) {
    const id = await deviceId()
    if (!id) return undefined
    try {
      const res = await fetch('/api/photos/upload', { method: 'POST', headers: { 'x-device-id': id, 'content-type': file.type }, body: file })
      if (!res.ok) return undefined
      return ((await res.json()) as { url: string }).url
    } catch {
      return undefined
    }
  },
}
