import { put } from '@vercel/blob'
import { fakeDirectorBrain } from '../forge/director/fake'
import { createRegistry } from '../forge/providers/registry'
import { isProduction, type Registry } from '../forge/providers/router'
import type { FetchLike } from '../forge/providers/live/http'
import type { Env } from '../forge/providers/types'
import { bump } from './accounts'
import type { Db } from './db'
import { publishForge } from './forge-publish'
import type { CopyFn, RunnerDeps } from './forge-runner'

/** Wiring for the forge API: providers, the Blob copier, and the durable rate limit. */

export function serverRegistry(env: Env, fetchImpl?: FetchLike): Registry {
  return createRegistry(env, { fetch: fetchImpl, fakes: { director: fakeDirectorBrain as (input: Record<string, unknown>) => unknown } })
}

export const MAX_ASSET_BYTES = 60 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', glb: 'model/gltf-binary', fbx: 'application/octet-stream', json: 'application/json' }

async function readSource(url: string, fetchImpl: FetchLike): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    const meta = url.slice(5, comma)
    const body = url.slice(comma + 1)
    return meta.endsWith(';base64') ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body))
  }
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`asset download failed: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_ASSET_BYTES) throw new Error('asset too large')
  return bytes
}

/**
 * With a Blob token, outputs are copied into our store (provider URLs expire). Without one, development keeps
 * the provider URL; production refuses to run without a store.
 */
export function pickCopier(env: Env, fetchImpl: FetchLike = fetch): CopyFn | undefined {
  if (env.BLOB_READ_WRITE_TOKEN) {
    return async (pathname, sourceUrl) => {
      if (!/^(https:|data:)/.test(sourceUrl)) return sourceUrl
      const bytes = await readSource(sourceUrl, fetchImpl)
      const ext = pathname.split('.').pop() ?? ''
      const { url } = await put(pathname, Buffer.from(bytes), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: CONTENT_TYPES[ext] })
      return url
    }
  }
  return isProduction(env) ? undefined : async (_pathname, sourceUrl) => sourceUrl
}

/** The forge needs a Blob store in production; without one its routes answer 503. */
export const forgeUnavailable = () => Response.json({ error: 'the forge is not configured on this deployment' }, { status: 503 })

export function forgeDeps(db: Db, env: Env = process.env): RunnerDeps | undefined {
  const copy = pickCopier(env)
  return copy ? { db, registry: serverRegistry(env), copy, publish: publishForge } : undefined
}

/** Forge API limits per minute, durable across instances (U9). Polls count too. */
export const FORGE_LIMITS = { perAccount: 90, perIp: 180 }

export async function forgeLimited(db: Db, accountId: string, ip: string, now = new Date()): Promise<boolean> {
  const minute = now.toISOString().slice(0, 16)
  const [a, i] = await Promise.all([bump(db, `forge-acct:${accountId}`, minute), bump(db, `forge-ip:${ip}`, minute)])
  return a > FORGE_LIMITS.perAccount || i > FORGE_LIMITS.perIp
}
