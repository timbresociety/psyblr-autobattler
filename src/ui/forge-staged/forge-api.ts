import type { Build } from '../../charter/build.js'
import type { SizeClass } from '../../charter/sizes.js'
import { sizeCost, type SizeCost } from '../../forge/sizes.js'
import type { Forge } from '../../forge/types.js'
import type { ForgeAction } from '../../server/forge-runner.js'
import type { ForgeSummary } from '../../server/forge-store.js'
import { deviceId, liveDeps, type BuildRecord, type HeroResult } from '../api.js'

/** Forge I/O (U11). Every call goes to the forge API; sizing runs locally because it is pure. */

export type { ForgeAction, ForgeSummary }

export interface ForgeView {
  forge: Forge
  balance: number
}

export interface CreditsView {
  balance: number
  freeGrant: number
  freeClaimed: boolean
  packs: { id: string; credits: number; amountCents: number; currency: string }[]
}

export interface SessionView {
  signedIn: boolean
  email?: string
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** What starting a sign-in returns. Only the dev server adds `devLink`, since it sends no real email. */
export interface SignInStart {
  devLink?: string
}

export interface ForgeDeps {
  session(): Promise<SessionView>
  startSignIn(email: string): Promise<SignInStart | void>
  verifySignIn(token: string): Promise<void>
  signOut(): Promise<void>
  credits(): Promise<CreditsView>
  claimFree(): Promise<number>
  purchase(pack: string): Promise<{ url: string }>
  create(input: { prompt?: string; referenceHeroId?: string; referenceUrls?: string[] }): Promise<ForgeView>
  get(id: string): Promise<ForgeView>
  list(): Promise<ForgeSummary[]>
  act(id: string, action: ForgeAction): Promise<ForgeView>
  search(query: string): Promise<HeroResult[]>
  addHero(heroId: string): Promise<BuildRecord>
  sizeCost(build: Build, size: SizeClass): Promise<SizeCost>
  /** Reference images for a new forge go through the photo endpoint; without it the prompt takes no images. */
  uploadPhoto?(file: File): Promise<string | undefined>
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const device = await deviceId()
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(device ? { 'x-device-id': device } : {}), ...init.headers },
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new ApiError(json.error ?? `request failed (${res.status})`, res.status)
  return json
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', body: JSON.stringify(body) })

/** The wire form of an action: the stage API takes flat fields. */
function wire(id: string, action: ForgeAction): Record<string, unknown> {
  const { type, ...rest } = action
  return { id, action: type, ...rest }
}

export const liveForgeDeps: ForgeDeps = {
  session: () => call<SessionView>('/api/auth/session'),
  startSignIn: (email) => post<SignInStart>('/api/auth/start', { email }),
  verifySignIn: (token) => post('/api/auth/verify', { token }),
  signOut: () => call('/api/auth/session', { method: 'DELETE' }),
  credits: () => call<CreditsView>('/api/credits'),
  claimFree: async () => (await post<{ balance: number }>('/api/credits', {})).balance,
  purchase: (pack) => post<{ url: string }>('/api/credits/purchase', { pack }),
  create: (input) => post<ForgeView>('/api/forge', input),
  get: (id) => call<ForgeView>(`/api/forge?id=${encodeURIComponent(id)}`),
  list: async () => (await call<{ forges: ForgeSummary[] }>('/api/forge')).forges,
  act: (id, action) => post<ForgeView>('/api/forge/stage', wire(id, action)),
  search: liveDeps.search,
  addHero: liveDeps.addHero,
  uploadPhoto: async (file) => {
    const uploaded = await liveDeps.uploadPhoto(file)
    return uploaded.ok ? uploaded.url : undefined
  },
  // a quick estimate for the size picker; the server gate prices the final build at publish
  sizeCost: async (build, size) => sizeCost(build, size, { duelsPerMember: 2 }),
}
