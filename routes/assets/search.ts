import { PIECE_KINDS, type PieceKind } from '../../src/charter/look.js'
import { searchAssets, searchBuiltIns } from '../../src/server/assets.js'
import { getDb } from '../../src/server/db.js'
import { errorResponse } from '../../src/server/http.js'

/**
 * GET /api/assets/search?q=hat&kind=head -> { pieces }: the built-in pieces that match, then the community's, the most
 * worn first. Without a query it lists the most worn community pieces. Wearing any of them is free.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const q = params.get('q') ?? ''
    const raw = params.get('kind') ?? ''
    const kind = (PIECE_KINDS as readonly string[]).includes(raw) ? (raw as PieceKind) : undefined
    const community = await searchAssets(await getDb(), q, kind)
    return Response.json({ pieces: [...(q ? searchBuiltIns(q, kind) : []), ...community] })
  } catch (error) {
    return errorResponse(error)
  }
}
