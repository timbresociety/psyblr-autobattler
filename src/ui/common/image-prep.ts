/**
 * Reference images, ready to upload. Any picture the browser can read is decoded, shrunk so its longest side is at most
 * 1,024 px, and re-encoded: WebP where the browser can write it, JPEG where it can't. That drops camera metadata, turns
 * a 6 MB phone photo into a few hundred kilobytes, and keeps every upload far under the 4.5 MB request cap Vercel puts
 * on a function.
 */

export const MAX_SIDE = 1024
const MIN_SIDE = 32

export type PrepFailure = 'not-an-image' | 'heic' | 'unreadable' | 'too-small'

export type PreparedImage = { ok: true; blob: Blob; width: number; height: number } | { ok: false; reason: PrepFailure }

export const PREP_MESSAGES: Record<PrepFailure, string> = {
  'not-an-image': "That file isn't an image.",
  heic: "This browser can't read HEIC photos. Export it as a JPEG first, or open the Forge in Safari.",
  unreadable: "This browser can't read that image. Try a JPEG, PNG or WebP.",
  'too-small': 'That image is too small to use. Try one at least 32 px across.',
}

interface Decoded {
  width: number
  height: number
  source: CanvasImageSource
  release(): void
}

export interface PrepDeps {
  decode(file: Blob): Promise<Decoded>
  encode(source: CanvasImageSource, width: number, height: number): Promise<Blob>
}

/** The size to draw at: the longest side capped at `max`, never enlarged. */
export function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function decodeInBrowser(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { width: bitmap.width, height: bitmap.height, source: bitmap, release: () => bitmap.close() }
    } catch {
      // Safari reads some formats (HEIC) only through an image element
    }
  }
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
  return { width: img.naturalWidth, height: img.naturalHeight, source: img, release: () => URL.revokeObjectURL(url) }
}

async function encodeInBrowser(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2D canvas')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  const as = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
  const webp = await as('image/webp', 0.86)
  // a browser that can't write WebP hands back a PNG instead; JPEG is far smaller for a photo
  if (webp?.type === 'image/webp') return webp
  const jpeg = await as('image/jpeg', 0.9)
  if (!jpeg) throw new Error('could not encode the image')
  return jpeg
}

const browser: PrepDeps = { decode: decodeInBrowser, encode: encodeInBrowser }

const isHeic = (file: Blob) => /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name ?? '')

/** Decode, shrink and re-encode one image, or say plainly why it can't be used. */
export async function prepareImage(file: Blob, deps: PrepDeps = browser): Promise<PreparedImage> {
  if (file.type && !file.type.startsWith('image/')) return { ok: false, reason: 'not-an-image' }
  let decoded: Decoded
  try {
    decoded = await deps.decode(file)
  } catch {
    return { ok: false, reason: isHeic(file) ? 'heic' : 'unreadable' }
  }
  try {
    if (Math.min(decoded.width, decoded.height) < MIN_SIDE) return { ok: false, reason: 'too-small' }
    const size = fitSize(decoded.width, decoded.height)
    return { ok: true, blob: await deps.encode(decoded.source, size.width, size.height), ...size }
  } catch {
    return { ok: false, reason: 'unreadable' }
  } finally {
    decoded.release()
  }
}
