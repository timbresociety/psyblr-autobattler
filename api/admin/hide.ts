import { del } from '@vercel/blob'
import { timingSafeEqual } from 'node:crypto'
import { getDb } from '../../src/server/db'
import { errorResponse, readJson } from '../../src/server/http'
import { hideHero } from '../../src/server/store'

/** POST /api/admin/hide { heroId } with x-admin-secret: the owner's takedown path. Hides the hero and deletes its photos. */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ADMIN_SECRET ?? ''
  const given = request.headers.get('x-admin-secret') ?? ''
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  if (!ok) return Response.json({ error: 'forbidden' }, { status: 403 })
  try {
    const body = await readJson(request)
    const photos = await hideHero(await getDb(), String(body.heroId ?? ''))
    if (photos.length) await del(photos)
    return Response.json({ hidden: true, photosDeleted: photos.length })
  } catch (error) {
    return errorResponse(error)
  }
}
