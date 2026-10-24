import { requestStats, type Build } from '../charter/build.js'
import { parseStatWishes } from '../charter/chat.js'
import type { LookColor, PieceKind, WearSlot } from '../charter/look.js'
import { floorBreach, offlineReading, readingText, type Reading, type ReadInput } from '../forge/reading.js'
import type { LimitHit } from '../charter/types.js'
import type { PieceEntry } from '../kit/pieces.js'
import type { LibraryEntry } from '../kit/wear/library.js'
import type { GateOutcome } from '../sim/gate.js'
import type { SliceRequest, SliceResult } from '../sim/gate-protocol.js'
import { prepareImage, type PreparedImage } from './common/image-prep.js'
import type { FaceFinding } from './forge/face/find.js'

/**
 * Forge and Loadout I/O. Every Forge call has an offline path, so making a hero keeps working without the API (R13):
 * a reading falls back to the offline parser, chat falls back to the keyword parser, and the balance gate always runs
 * locally in workers.
 */

export interface ReadRequest extends ReadInput {
  photoUrls?: string[]
}

/** A reading, or the content floor's reason for refusing one. */
export type ReadResponse = { reading: Reading; refused?: undefined } | { refused: string; reading?: undefined }

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

/** Signed in or not; generating a piece needs an account, everything else in the Forge doesn't. */
export interface SessionView {
  signedIn: boolean
  email?: string
}

export interface CreditsView {
  balance: number
  freeGrant: number
  freeClaimed: boolean
  packs: { id: string; credits: number; amountCents: number; currency: string }[]
}

/** What starting a sign-in returns. Only the local dev server adds `devLink`, since it sends no real email. */
export interface SignInStart {
  devLink?: string
}

/** A piece or garment being generated into the asset repository, and what it made once it's there. */
export interface PieceJob {
  id: string
  /** A piece's kind, or a garment's slot. */
  kind: PieceKind | WearSlot
  /** Set for a garment job. */
  slot?: WearSlot
  name: string
  status: 'running' | 'done' | 'failed'
  error?: string
  piece?: PieceEntry
  /** The finished garment, as the wardrobe lists it. */
  item?: LibraryEntry
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** The asset repository from the Forge: search it free, and generate what it lacks (signed in, for credits). */
export interface PieceDeps {
  searchPieces(query: string, kind?: PieceKind): Promise<PieceEntry[]>
  /** Whether generating is switched on for this deployment. */
  generationReady(): Promise<boolean>
  session(): Promise<SessionView>
  startSignIn(email: string): Promise<SignInStart | void>
  verifySignIn(token: string): Promise<void>
  credits(): Promise<CreditsView>
  claimFree(): Promise<number>
  purchase(pack: string): Promise<{ url: string }>
  /** A piece of gear for a kind, or with a slot instead, a garment for that wardrobe slot. */
  startPiece(input: { prompt: string; kind?: PieceKind; slot?: WearSlot; name?: string; imageUrl?: string }): Promise<{ job: PieceJob; balance: number }>
  pollPiece(id: string): Promise<{ job: PieceJob; balance: number }>
}

export interface ForgeDeps {
  /** The Forge's reading of a hero before it builds: its look, gear, kit and questions (src/forge/reading.ts). */
  read(input: ReadRequest): Promise<ReadResponse>
  /** The outfit's colours on a prepared image, read away from the face; empty when it can't be read. */
  outfitColours(image: Blob, face?: FaceFinding): Promise<Partial<Record<LookColor, string>>>
  chat(build: Build, message: string): Promise<ChatResponse>
  runGate(build: Build): Promise<GateOutcome>
  /** Decode, shrink and re-encode a reference image before it is uploaded. */
  prepareImage(file: Blob): Promise<PreparedImage>
  /** The face on a prepared image, with its landmarks and colours; undefined when there is none or it can't be read. */
  findFace(image: Blob): Promise<FaceFinding | undefined>
  uploadPhoto(file: Blob): Promise<UploadResult>
  /** Global loadout search by name (R18). Throws when the API is unreachable. */
  search(query: string): Promise<HeroResult[]>
  /** Add a shared hero for free: a new build copied from the creator's original. */
  addHero(heroId: string): Promise<BuildRecord>
  createHero(build: Build, photoUrls: string[]): Promise<{ heroId: string; buildId: string }>
  saveBuild(id: string, build: Build): Promise<BuildRecord>
  listBuilds(): Promise<BuildRecord[]>
  pieces: PieceDeps
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

/** A JSON call with this device's ID and the session cookie; a refusal throws with the server's own words. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const device = await deviceId()
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...deviceHeader(device), ...init.headers },
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(json.error ?? `request failed (${res.status})`, res.status)
  return json
}

const send = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const livePieceDeps: PieceDeps = {
  async searchPieces(query, kind) {
    const params = new URLSearchParams({ q: query, ...(kind ? { kind } : {}) })
    return (await call<{ pieces: PieceEntry[] }>(`/api/assets/search?${params}`)).pieces
  },
  generationReady: async () => (await call<{ ready: boolean }>('/api/pieces')).ready,
  session: () => call<SessionView>('/api/auth/session'),
  startSignIn: (email) => send<SignInStart>('/api/auth/start', { email }),
  verifySignIn: (token) => send('/api/auth/verify', { token }),
  credits: () => call<CreditsView>('/api/credits'),
  claimFree: async () => (await send<{ balance: number }>('/api/credits', {})).balance,
  purchase: (pack) => send<{ url: string }>('/api/credits/purchase', { pack }),
  startPiece: (input) => send<{ job: PieceJob; balance: number }>('/api/pieces', input),
  pollPiece: (id) => call<{ job: PieceJob; balance: number }>(`/api/pieces?id=${encodeURIComponent(id)}`),
}

async function searchHeroes(path: string): Promise<HeroResult[]> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`search ${res.status}`)
  return ((await res.json()) as { heroes: HeroResult[] }).heroes
}

export const liveDeps: ForgeDeps & LoadoutDeps = {
  pieces: livePieceDeps,
  async read(input) {
    try {
      const res = await withDevice((id) => fetch('/api/charter/read', { method: 'POST', headers: { 'content-type': 'application/json', ...deviceHeader(id) }, body: JSON.stringify(input) }))
      if (res.status === 422) return { refused: ((await res.json()) as { error: string }).error }
      if (!res.ok) throw new Error(`read ${res.status}`)
      return (await res.json()) as { reading: Reading }
    } catch {
      // the server can't be reached: read offline, behind the same floor
      const reading = offlineReading(input)
      const breach = floorBreach(`${input.prompt}\n${input.note ?? ''}\n${readingText(reading)}`, false)
      return breach ? { refused: breach } : { reading }
    }
  },
  async outfitColours(image, face) {
    const { outfitColours } = await import('./forge/outfit.js')
    return outfitColours(image, face).catch(() => ({}))
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
  // MediaPipe loads only here, the first time a photo comes in
  findFace: (image) => import('./forge/face/find.js').then((m) => m.findFace(image)).catch(() => undefined),
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
