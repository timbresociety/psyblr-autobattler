import { join } from 'node:path'
import { fakeMode } from '../forge/providers/router.js'
import type { Env } from '../forge/providers/types.js'

/**
 * The local dev server's own storage (scripts/dev-api.ts). Uploads and the database live in .dev-store at the repo root,
 * which git, Vercel uploads and Vite's file watcher all ignore, so a restart or a reinstall keeps every hero and device.
 * Never used on Vercel.
 */
export const DEV_STORE_DIR = join(process.cwd(), '.dev-store')

/** Where the dev server serves stored uploads from. */
export const DEV_STORE_PATH = '/dev-store/'

/** The local dev server: fakes on and not on Vercel. Every request there comes from the same address. */
export function localDev(env: Env): boolean {
  return !env.VERCEL && fakeMode(env)
}

/** Uploads go to the dev store only on the local dev server, and only when no Blob store is configured. */
export function devStoreActive(env: Env): boolean {
  return localDev(env) && !env.BLOB_READ_WRITE_TOKEN
}
