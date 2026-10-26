import { getDb } from '../../src/server/db.js'
import { errorResponse } from '../../src/server/http.js'
import { popularHeroes, searchHeroes } from '../../src/server/store.js'

/** GET /api/heroes/search?q=jen -> { heroes: [{ id, name, roleId, photo, useCount }] }; ?popular=1 -> the most used. */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const db = await getDb()
    if (params.has('popular')) return Response.json({ heroes: await popularHeroes(db) })
    return Response.json({ heroes: await searchHeroes(db, params.get('q') ?? '') })
  } catch (error) {
    return errorResponse(error)
  }
}
