import { MAX_PHOTO_BYTES, pickPut, uploadPhoto } from '../../src/server/blob'
import { getDb } from '../../src/server/db'
import { errorResponse, knownDeviceId, needDevice, overLimit, tooMany } from '../../src/server/http'
import { RateLimiter } from '../../src/server/rate-limit'

const uploads = new RateLimiter({ limit: 15, windowMs: 60 * 60 * 1000 })

/** POST /api/photos/upload (raw image body) -> { url }. Size-capped, type-checked by content, re-encoded. */
export async function POST(request: Request): Promise<Response> {
  if (overLimit(request, uploads)) return tooMany()
  try {
    if (!(await knownDeviceId(request, await getDb()))) return needDevice()
  } catch (error) {
    return errorResponse(error)
  }
  // require a declared size, so an unbounded chunked body is never buffered
  const length = Number(request.headers.get('content-length') ?? NaN)
  if (!Number.isFinite(length)) return Response.json({ error: 'content-length required' }, { status: 411 })
  if (length > MAX_PHOTO_BYTES) return Response.json({ error: 'photo too large' }, { status: 413 })
  try {
    return Response.json(await uploadPhoto(new Uint8Array(await request.arrayBuffer()), { put: pickPut(process.env) }))
  } catch (error) {
    return errorResponse(error)
  }
}
