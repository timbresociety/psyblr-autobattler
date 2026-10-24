import { ITEM_SLOTS, type ItemSlot } from '../../src/kit/wear/item.js'
import { searchItems, searchLibrary } from '../../src/server/assets.js'
import { getDb } from '../../src/server/db.js'
import { errorResponse } from '../../src/server/http.js'

/**
 * GET /api/assets/items?q=kimono&slot=full -> { items }: the wardrobe's built-in items that match, then the community's
 * garments and pieces, the most worn first. Without a query it lists the most worn community items. Wearing any of
 * them is free.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams
    const q = params.get('q') ?? ''
    const raw = params.get('slot') ?? ''
    const slot = (ITEM_SLOTS as readonly string[]).includes(raw) ? (raw as ItemSlot) : undefined
    const community = await searchItems(await getDb(), q, slot)
    return Response.json({ items: [...(q ? searchLibrary(q, slot) : []), ...community] })
  } catch (error) {
    return errorResponse(error)
  }
}
