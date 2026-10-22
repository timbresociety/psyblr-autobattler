import { getDb } from '../../src/server/db'
import { deviceId, errorResponse, needDevice, overLimit, readJson, tooMany } from '../../src/server/http'
import { getBuild, listBuilds, saveBuild } from '../../src/server/store'

/** GET /api/builds[?id=] -> this device's builds (or one). PUT /api/builds { id, build } -> saved, re-gated build. */
export async function GET(request: Request): Promise<Response> {
  const device = deviceId(request)
  if (!device) return needDevice()
  try {
    const id = new URL(request.url).searchParams.get('id')
    const db = await getDb()
    return Response.json(id ? await getBuild(db, device, id) : { builds: await listBuilds(db, device) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PUT(request: Request): Promise<Response> {
  const device = deviceId(request)
  if (!device) return needDevice()
  if (overLimit(request)) return tooMany()
  try {
    const body = await readJson(request)
    return Response.json(await saveBuild(await getDb(), device, String(body.id ?? ''), body.build))
  } catch (error) {
    return errorResponse(error)
  }
}
