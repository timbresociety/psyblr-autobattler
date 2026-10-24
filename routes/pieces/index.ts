import { PIECE_KINDS, type PieceKind, type WearSlot } from '../../src/charter/look.js'
import { createRegistry } from '../../src/forge/providers/registry.js'
import { balance } from '../../src/server/credits.js'
import { getDb } from '../../src/server/db.js'
import { clientIp, errorResponse, readJson, tooMany } from '../../src/server/http.js'
import { generationReady, pickPieceStore, pieceLimited, pollPiece, startPiece, type PieceDeps } from '../../src/server/pieces.js'
import type { Db } from '../../src/server/db.js'
import { requireAccount } from '../../src/server/sessions.js'

function deps(db: Db): PieceDeps | undefined {
  const store = pickPieceStore(process.env)
  return store ? { db, registry: createRegistry(process.env), store } : undefined
}

const unavailable = () => Response.json({ error: "generating pieces isn't switched on for this deployment yet" }, { status: 503 })

/**
 * POST /api/pieces { prompt, kind, name?, imageUrl? } -> a new piece job and the balance after its hold. With a slot in
 * place of the kind ({ prompt, slot, ... }), the job makes a garment for that wardrobe slot.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    if (await pieceLimited(db, accountId, clientIp(request))) return tooMany()
    const d = deps(db)
    if (!d) return unavailable()
    const body = await readJson(request, 4_000)
    // startPiece turns away a missing kind or an unknown slot
    const slot = typeof body.slot === 'string' && body.slot ? (body.slot as WearSlot) : undefined
    const kind = (PIECE_KINDS as readonly string[]).includes(body.kind as string) ? (body.kind as PieceKind) : undefined
    const job = await startPiece(d, accountId, {
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      ...(slot ? { slot } : { kind }),
      name: typeof body.name === 'string' ? body.name : undefined,
      imageUrl: typeof body.imageUrl === 'string' && body.imageUrl ? body.imageUrl : undefined,
    })
    return Response.json({ job, balance: await balance(db, accountId) })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * GET /api/pieces -> { ready }: whether generating is switched on here. GET /api/pieces?id= -> that job, moved along as
 * far as it can go, and the piece or garment once it's in the repository.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get('id')
    if (id === null) return Response.json({ ready: generationReady(process.env, createRegistry(process.env)) })
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    if (await pieceLimited(db, accountId, clientIp(request))) return tooMany()
    const d = deps(db)
    if (!d) return unavailable()
    return Response.json({ job: await pollPiece(d, accountId, id), balance: await balance(db, accountId) })
  } catch (error) {
    return errorResponse(error)
  }
}
