import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { put } from '@vercel/blob'
import sharp from 'sharp'
import type { Env } from '../forge/providers/types.js'
import { DEV_STORE_DIR, DEV_STORE_PATH, devStoreActive } from './dev-store.js'

/**
 * Reference photo upload (U10). The real type is read from the content bytes, the size is capped, and the image is
 * re-encoded here (which drops its metadata, camera GPS included) and stored under a random server-made name. The
 * browser already shrinks and re-encodes what it sends; the server does it again because it can't trust the browser.
 */

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024

export class PhotoError extends Error {}

export type ImageType = 'jpeg' | 'png' | 'webp'

export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  const at = (i: number, ...values: number[]) => values.every((v, j) => bytes[i + j] === v)
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png'
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp'
  return undefined
}

export type PutFn = (pathname: string, body: Uint8Array) => Promise<{ url: string }>

export type EncodeFn = (bytes: Uint8Array) => Promise<Uint8Array>

/** At most 1,024 px on its longest side, upright, WebP, and nothing kept but the pixels. */
export const reencode: EncodeFn = async (bytes) => {
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  } catch {
    throw new PhotoError("that image couldn't be read")
  }
}

const blobPut: PutFn = (pathname, body) => put(pathname, Buffer.from(body), { access: 'public', contentType: 'image/webp', addRandomSuffix: false })

export async function uploadPhoto(bytes: Uint8Array, deps: { put?: PutFn; encode?: EncodeFn } = {}): Promise<{ url: string }> {
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError(`photos must be ${MAX_PHOTO_BYTES / 1024 / 1024} MB or smaller`)
  if (!detectImageType(bytes)) throw new PhotoError('only JPEG, PNG or WebP photos are accepted')
  const webp = await (deps.encode ?? reencode)(bytes)
  const { url } = await (deps.put ?? blobPut)(`heroes/${randomUUID()}.webp`, webp)
  return { url }
}

/**
 * The local dev server only: with fakes on and no Blob token, a photo is written to the dev store and served back from
 * the dev server, so reference photos and saving work end to end without Vercel. Production never takes this path.
 */
export const devPut =
  (dir = DEV_STORE_DIR): PutFn =>
  async (pathname, body) => {
    const file = join(dir, pathname)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, body)
    return { url: `${DEV_STORE_PATH}${pathname}` }
  }

/** Where uploads go: Vercel Blob when it is configured, else the dev store on the local dev server, else Blob (which fails). */
export function pickPut(env: Env, dir?: string): PutFn | undefined {
  return devStoreActive(env) ? devPut(dir) : undefined
}
