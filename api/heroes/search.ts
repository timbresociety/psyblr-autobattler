import { getDb } from '../../src/server/db'
import { errorResponse } from '../../src/server/http'
import { searchHeroes } from '../../src/server/store'

/** GET /api/heroes/search?q=jen -> { heroes: [{ id, name, roleId, photo, useCount }] } */
export async function GET(request: Request): Promise<Response> {
  try {
    const q = new URL(request.url).searchParams.get('q') ?? ''
    return Response.json({ heroes: await searchHeroes(await getDb(), q) })
  } catch (error) {
    return errorResponse(error)
  }
}
