import { MAX_PHOTO_BYTES, uploadPhoto } from '../../src/server/blob'
import { deviceId, errorResponse, needDevice, overLimit, tooMany } from '../../src/server/http'
import { RateLimiter } from '../../src/server/rate-limit'

const uploads = new RateLimiter({ limit: 15, windowMs: 60 * 60 * 1000 })

/** POST /api/photos/upload (raw image body) -> { url }. Size-capped, type-checked by content, re-encoded. */
export async function POST(request: Request): Promise<Response> {
  if (!deviceId(request)) return needDevice()
  if (overLimit(request, uploads)) return tooMany()
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_PHOTO_BYTES) return Response.json({ error: 'photo too large' }, { status: 413 })
  try {
    return Response.json(await uploadPhoto(new Uint8Array(await request.arrayBuffer())))
  } catch (error) {
    return errorResponse(error)
  }
}
