import { getDb } from '../../src/server/db'
import { balance } from '../../src/server/credits'
import { forgeDeps, forgeLimited } from '../../src/server/forge-env'
import { ForgeError, advance, startForge } from '../../src/server/forge-runner'
import { listForges, loadForge } from '../../src/server/forge-store'
import { clientIp, errorResponse, knownDeviceId, readJson, tooMany } from '../../src/server/http'
import { requireAccount } from '../../src/server/sessions'

const unavailable = () => Response.json({ error: 'the forge is not configured on this deployment' }, { status: 503 })

/** GET /api/forge -> your forges; GET /api/forge?id= -> that forge, advanced as far as it can go (KTD1). */
export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    if (await forgeLimited(db, accountId, clientIp(request))) return tooMany()
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return Response.json({ forges: await listForges(db, accountId) })
    const deps = forgeDeps(db)
    if (!deps) return unavailable()
    const forge = await advance(deps, await loadForge(db, id, accountId))
    return Response.json({ forge, balance: await balance(db, accountId) })
  } catch (error) {
    if (error instanceof ForgeError) return Response.json({ error: error.message }, { status: error.status })
    return errorResponse(error)
  }
}

/** POST /api/forge { prompt?, referenceUrls?, referenceHeroId? } -> a new forge (R1, R2). */
export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    if (await forgeLimited(db, accountId, clientIp(request))) return tooMany()
    const deps = forgeDeps(db)
    if (!deps) return unavailable()
    const body = await readJson(request, 10_000)
    const forge = await startForge(deps, accountId, await knownDeviceId(request, db), {
      prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
      referenceUrls: Array.isArray(body.referenceUrls) ? body.referenceUrls.filter((u): u is string => typeof u === 'string') : undefined,
      referenceHeroId: typeof body.referenceHeroId === 'string' ? body.referenceHeroId : undefined,
    })
    return Response.json({ forge, balance: await balance(db, accountId) })
  } catch (error) {
    if (error instanceof ForgeError) return Response.json({ error: error.message }, { status: error.status })
    return errorResponse(error)
  }
}
