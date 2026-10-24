import { del } from '@vercel/blob'
import { timingSafeEqual } from 'node:crypto'
import { getDb } from '../../src/server/db.js'
import { errorResponse, readJson } from '../../src/server/http.js'
import { hideAsset } from '../../src/server/assets.js'
import { clearHeroPhotos, hideHero } from '../../src/server/store.js'

/**
 * POST /api/admin/hide { heroId } or { assetId } with x-admin-secret: the owner's takedown path. Hides the hero and
 * deletes its photos, or hides a community piece and deletes its model and thumbnail.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ADMIN_SECRET ?? ''
  const given = request.headers.get('x-admin-secret') ?? ''
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  const ok = secret.length >= 16 && a.length === b.length && timingSafeEqual(a, b)
  if (!ok) return Response.json({ error: 'forbidden' }, { status: 403 })
  try {
    const body = await readJson(request)
    const db = await getDb()
    if (typeof body.assetId === 'string') {
      const files = await hideAsset(db, body.assetId)
      const stored = files.filter((url) => url.startsWith('https://'))
      if (stored.length) await del(stored)
      return Response.json({ hidden: files.length > 0, filesDeleted: stored.length })
    }
    const heroId = String(body.heroId ?? '')
    const photos = await hideHero(db, heroId)
    if (photos.length) await del(photos)
    await clearHeroPhotos(db, heroId)
    return Response.json({ hidden: true, photosDeleted: photos.length })
  } catch (error) {
    return errorResponse(error)
  }
}
