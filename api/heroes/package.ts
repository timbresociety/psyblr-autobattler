import { getDb } from '../../src/server/db'
import { loadHeroPackage } from '../../src/server/forge-publish'
import { errorResponse } from '../../src/server/http'

/** GET /api/heroes/package?id= -> the hero package of a forged hero (R22). Public, like the loadout. */
export async function GET(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    return Response.json(await loadHeroPackage(await getDb(), id))
  } catch (error) {
    return errorResponse(error)
  }
}
