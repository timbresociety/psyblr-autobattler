import { proposeBuild, requestStats, type Build, type ProposalInput } from '../charter/build.js'
import { parseStatWishes } from '../charter/chat.js'
import type { LimitHit } from '../charter/types.js'
import type { GateOutcome } from '../sim/gate.js'
import type { SliceRequest, SliceResult } from '../sim/gate-protocol.js'
import { prepareImage, type PreparedImage } from './common/image-prep.js'

/**
 * Forge and Loadout I/O. Every Forge call has an offline path, so making a hero keeps working without the API (R13):
 * proposals fall back to the Charter's matcher, chat falls back to the keyword parser, and the balance gate always
 * runs locally in workers.
 */

export interface ProposeResponse {
  build: Build
  offline: boolean
  limits: LimitHit[]
}

export interface ChatResponse extends ProposeResponse {
  understood: boolean
}

import type { BuildRecord, HeroSummary } from '../server/store.js'

export type { BuildRecord }
export type HeroResult = HeroSummary

export type UploadFailure = 'too-large' | 'not-an-image' | 'busy' | 'offline' | 'server'

export type UploadResult = { ok: true; url: string } | { ok: false; reason: UploadFailure }

export const UPLOAD_MESSAGES: Record<UploadFailure, string> = {
  'too-large': 'That image is too large to upload, even after shrinking it.',
  'not-an-image': "The server couldn't read that image. Try a JPEG, PNG or WebP.",
  busy: "You've uploaded a lot of images in the last hour. Try again in a little while.",
  offline: "Couldn't reach the server. Check your connection and try again.",
  server: "Couldn't upload that image right now. Try again in a moment.",
}

export interface ForgeDeps {
  propose(hero: ProposalInput & { photoUrls?: string[] }): Promise<ProposeResponse>
  chat(build: Build, message: string): Promise<ChatResponse>
  runGate(build: Build): Promise<GateOutcome>
  /** Decode, shrink and re-encode a reference image before it is uploaded. */
  prepareImage(file: Blob): Promise<PreparedImage>
  uploadPhoto(file: Blob): Promise<UploadResult>
  /** Global loadout search by name (R18). Throws when the API is unreachable. */
  search(query: string): Promise<HeroResult[]>
  /** Add a shared hero for free: a new build copied from the creator's original. */
  addHero(heroId: string): Promise<BuildRecord>
  createHero(build: Build, photoUrls: string[]): Promise<{ heroId: string; buildId: string }>
  saveBuild(id: string, build: Build): Promise<BuildRecord>
  listBuilds(): Promise<BuildRecord[]>
}

/** The Loadout: this device's heroes, the global loadout's search and most used heroes, and removing a hero. */
export interface LoadoutDeps extends Pick<ForgeDeps, 'search' | 'addHero' | 'listBuilds'> {
  popular(): Promise<HeroResult[]>
  removeBuild(id: string): Promise<void>
}

const DEVICE_KEY = 'psyblr.deviceId'
/** A balance check that has not answered by then is treated as failed. */
const GATE_TIMEOUT_MS = 120_000

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

/** Forget a device ID the server no longer knows (its database was reset, say), so the next call is issued a new one. */
function forgetDevice() {
  try {
    localStorage.removeItem(DEVICE_KEY)
  } catch {
    // blocked storage: nothing was kept
  }
  devicePromise = undefined
}

/**
 * Send a request with this device's ID. A 401 means the server doesn't know the ID, so get a new one and send once
 * more: before this, every upload and save failed for good after the dev server's database was reset.
 */
export async function withDevice(send: (id: string | undefined) => Promise<Response>): Promise<Response> {
  const first = await send(await deviceId())
  if (first.status !== 401) return first
  forgetDevice()
  const id = await deviceId()
  return id ? send(id) : first
}

export async function deviceId(): Promise<string | undefined> {
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
  const id = await devicePromise
  // only a success is remembered; after a failure the next call asks again
  if (!id) devicePromise = undefined
  return id
}

const deviceHeader = (id: string | undefined): Record<string, string> => (id ? { 'x-device-id': id } : {})

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await withDevice((id) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...deviceHeader(id) }, body: JSON.stringify(body) }))
  if (!res.ok) throw new Error(`${path} ${res.status}`)
  return (await res.json()) as T
}

export function offlineChat(build: Build, message: string): ChatResponse {
  const goals = parseStatWishes(message)
  if (!Object.keys(goals).length) return { build, offline: true, understood: false, limits: [] }
  const result = requestStats(build, goals)
  return result.ok ? { build: result.build, offline: true, understood: true, limits: result.limits } : { build, offline: true, understood: false, limits: [] }
}

/**
 * The balance gate in the browser: its decisions run here, and every measurement is spread over a pool of workers,
 * each playing some turns of the field. Skirmishes cost about three duels each, so one worker alone would be too slow.
 */
async function localGate(build: Build): Promise<GateOutcome> {
  if (typeof Worker === 'undefined') {
    const { handleGateMessage } = await import('../sim/gate-protocol.js')
    return new Promise((resolve) => setTimeout(() => resolve(handleGateMessage({ build })), 0))
  }
  const [{ runGateAsync }, { ROLE_IDS }] = await Promise.all([import('../sim/gate.js'), import('../charter/roles.js')])
  const size = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))
  const workers = Array.from({ length: size }, () => new Worker(new URL('../sim/gate.worker.ts', import.meta.url), { type: 'module' }))
  let failed: ((e: Error) => void) | undefined
  const failure = new Promise<never>((_, reject) => (failed = reject))
  const timer = setTimeout(() => failed?.(new Error('balance check timed out')), GATE_TIMEOUT_MS)
  // one job per build and turn of the field; idle workers take the next job
  const measure = (builds: Build[]): Promise<number[]> =>
    new Promise((resolve, reject) => {
      const jobs: SliceRequest[] = builds.flatMap((b, i) => ROLE_IDS.map((_, turn) => ({ slice: i, build: b, turns: [turn] })))
      const totals = builds.map(() => ({ score: 0, fights: 0 }))
      let next = 0
      let done = 0
      const feed = (w: Worker) => {
        if (next < jobs.length) w.postMessage(jobs[next++])
      }
      for (const w of workers) {
        w.onmessage = (event: MessageEvent<SliceResult>) => {
          const r = event.data
          totals[r.slice].score += r.score
          totals[r.slice].fights += r.fights
          if (++done === jobs.length) resolve(totals.map((t) => t.score / Math.max(1, t.fights)))
          else feed(w)
        }
        w.onerror = (event) => reject(new Error(event.message || 'balance check failed'))
        w.onmessageerror = () => reject(new Error('balance check returned an unreadable result'))
        feed(w)
      }
    })
  try {
    return await Promise.race([runGateAsync(build, measure), failure])
  } finally {
    clearTimeout(timer)
    for (const w of workers) w.terminate()
  }
}

async function searchHeroes(path: string): Promise<HeroResult[]> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`search ${res.status}`)
  return ((await res.json()) as { heroes: HeroResult[] }).heroes
}

export const liveDeps: ForgeDeps & LoadoutDeps = {
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
  search: (query) => searchHeroes(`/api/heroes/search?q=${encodeURIComponent(query)}`),
  popular: () => searchHeroes('/api/heroes/search?popular=1'),
  addHero: (heroId) => post<BuildRecord>('/api/heroes', { addHeroId: heroId }),
  createHero: (build, photoUrls) => post<{ heroId: string; buildId: string }>('/api/heroes', { build, photoUrls }),
  async saveBuild(id, build) {
    const res = await withDevice((device) => fetch('/api/builds', { method: 'PUT', headers: { 'content-type': 'application/json', ...deviceHeader(device) }, body: JSON.stringify({ id, build }) }))
    if (!res.ok) throw new Error(`save ${res.status}`)
    return (await res.json()) as BuildRecord
  },
  async removeBuild(id) {
    const res = await withDevice((device) => fetch(`/api/builds?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: deviceHeader(device) }))
    if (!res.ok) throw new Error(`remove ${res.status}`)
  },
  async listBuilds() {
    const device = await deviceId()
    if (!device) return []
    const res = await fetch('/api/builds', { headers: { 'x-device-id': device } })
    if (!res.ok) return []
    return ((await res.json()) as { builds: BuildRecord[] }).builds
  },
  prepareImage: (file) => prepareImage(file),
  async uploadPhoto(file) {
    try {
      const res = await withDevice((id) => fetch('/api/photos/upload', { method: 'POST', headers: { ...deviceHeader(id), 'content-type': file.type || 'application/octet-stream' }, body: file }))
      if (res.ok) return { ok: true, url: ((await res.json()) as { url: string }).url }
      return { ok: false, reason: res.status === 413 ? 'too-large' : res.status === 400 ? 'not-an-image' : res.status === 429 ? 'busy' : 'server' }
    } catch {
      return { ok: false, reason: 'offline' }
    }
  },
}
