import { getDb } from '../../src/server/db.js'
import { deviceId, errorResponse, knownDeviceId, needDevice, overLimit, readJson, tooMany } from '../../src/server/http.js'
import { deleteBuild, getBuild, listBuilds, saveBuild } from '../../src/server/store.js'

/**
 * GET /api/builds[?id=] -> this device's builds (or one). PUT /api/builds { id, build } -> saved, re-gated build.
 * DELETE /api/builds?id= -> takes the hero out of this device's loadout.
 */
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
  if (overLimit(request)) return tooMany()
  try {
    const db = await getDb()
    const device = await knownDeviceId(request, db)
    if (!device) return needDevice()
    const body = await readJson(request)
    return Response.json(await saveBuild(db, device, String(body.id ?? ''), body.build))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request): Promise<Response> {
  if (overLimit(request)) return tooMany()
  try {
    const db = await getDb()
    const device = await knownDeviceId(request, db)
    if (!device) return needDevice()
    await deleteBuild(db, device, new URL(request.url).searchParams.get('id') ?? '')
    return Response.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
