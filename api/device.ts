import { getDb } from '../src/server/db.js'
import { errorResponse, overLimit, tooMany } from '../src/server/http.js'
import { issueDeviceId } from '../src/server/store.js'

/** POST /api/device -> { deviceId }: a server-issued random 128-bit ID the client keeps. */
export async function POST(request: Request): Promise<Response> {
  if (overLimit(request)) return tooMany()
  try {
    return Response.json({ deviceId: await issueDeviceId(await getDb()) })
  } catch (error) {
    return errorResponse(error)
  }
}
