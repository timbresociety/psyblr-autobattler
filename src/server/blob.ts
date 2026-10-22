import { randomUUID } from 'node:crypto'
import { putImage } from '@vercel/blob'

/**
 * Reference photo upload (U10). The real type is read from the content bytes, the size is capped, and the
 * image is re-encoded by Vercel Image Optimization (which drops metadata) under a random server-made name.
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

const vercelPut: PutFn = (pathname, body) =>
  putImage(pathname, Buffer.from(body), { access: 'public', optimizeImage: { width: 1024, quality: 82, format: 'webp' } })

export async function uploadPhoto(bytes: Uint8Array, deps: { put?: PutFn } = {}): Promise<{ url: string }> {
  if (bytes.length > MAX_PHOTO_BYTES) throw new PhotoError(`photos must be ${MAX_PHOTO_BYTES / 1024 / 1024} MB or smaller`)
  if (!detectImageType(bytes)) throw new PhotoError('only JPEG, PNG or WebP photos are accepted')
  const { url } = await (deps.put ?? vercelPut)(`heroes/${randomUUID()}.webp`, bytes)
  return { url }
}
