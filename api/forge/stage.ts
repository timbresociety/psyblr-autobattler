import { STAGE_ORDER } from '../../src/forge/stages.js'
import type { StageId } from '../../src/forge/types.js'
import { balance } from '../../src/server/credits.js'
import { getDb } from '../../src/server/db.js'
import { forgeDeps, forgeLimited, forgeUnavailable } from '../../src/server/forge-env.js'
import { act, type ForgeAction } from '../../src/server/forge-runner.js'
import { loadForge } from '../../src/server/forge-store.js'
import { clientIp, errorResponse, readJson, tooMany } from '../../src/server/http.js'
import { requireAccount } from '../../src/server/sessions.js'

const isStage = (v: unknown): v is StageId => STAGE_ORDER.includes(v as StageId)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** Parse a client action; only known fields pass through. */
export function parseAction(body: Record<string, unknown>): ForgeAction | undefined {
  const { action, stage } = body
  if (action === 'chat') return { type: 'chat', text: typeof body.text === 'string' ? body.text : '', answers: body.answers ? (Object.fromEntries(Object.entries(obj(body.answers)).filter(([, v]) => typeof v === 'string')) as Record<string, string>) : undefined }
  if (!isStage(stage)) return undefined
  if (action === 'edit') return { type: 'edit', stage, inputs: obj(body.inputs) }
  if (action === 'choose') return { type: 'choose', stage, choice: obj(body.choice) }
  if (action === 'start' || action === 'retry' || action === 'confirm' || action === 'skip') return { type: action, stage }
  return undefined
}

/** POST /api/forge/stage { id, action, stage?, ... } -> the updated forge (R11, R12). */
export async function POST(request: Request): Promise<Response> {
  try {
    const db = await getDb()
    const { accountId } = await requireAccount(request, db)
    if (await forgeLimited(db, accountId, clientIp(request))) return tooMany()
    const deps = forgeDeps(db)
    if (!deps) return forgeUnavailable()
    const body = await readJson(request, 20_000)
    const action = parseAction(body)
    if (!action || typeof body.id !== 'string') return Response.json({ error: 'unknown action' }, { status: 400 })
    const forge = await act(deps, await loadForge(db, body.id, accountId), action)
    return Response.json({ forge, balance: await balance(db, accountId) })
  } catch (error) {
    return errorResponse(error)
  }
}
