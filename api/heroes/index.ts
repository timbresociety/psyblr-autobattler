import { getDb } from '../../src/server/db'
import { errorResponse, knownDeviceId, needDevice, overLimit, readJson, tooMany } from '../../src/server/http'
import { addHero, createHero } from '../../src/server/store'

/**
 * POST /api/heroes
 *   { build, photoUrls } -> { heroId, buildId }   create a new shared hero from a gated build
 *   { addHeroId }        -> { id, heroId, build } add an existing hero from the global loadout
 */
export async function POST(request: Request): Promise<Response> {
  if (overLimit(request)) return tooMany()
  try {
    const db = await getDb()
    const device = await knownDeviceId(request, db)
    if (!device) return needDevice()
    const body = await readJson(request)
    if (typeof body.addHeroId === 'string') return Response.json(await addHero(db, device, body.addHeroId))
    const photos = Array.isArray(body.photoUrls) ? body.photoUrls.filter((u): u is string => typeof u === 'string') : []
    return Response.json(await createHero(db, device, body.build, photos))
  } catch (error) {
    return errorResponse(error)
  }
}
