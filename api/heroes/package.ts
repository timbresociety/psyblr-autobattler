import { getDb } from '../../src/server/db.js'
import { loadHeroPackage } from '../../src/server/forge-publish.js'
import { errorResponse } from '../../src/server/http.js'

/** GET /api/heroes/package?id= -> the hero package of a forged hero (R22). Public, like the loadout. */
export async function GET(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get('id') ?? ''
    // a package is written once at publish and never changes
    return Response.json(await loadHeroPackage(await getDb(), id), { headers: { 'cache-control': 'public, max-age=300, s-maxage=86400' } })
  } catch (error) {
    return errorResponse(error)
  }
}
