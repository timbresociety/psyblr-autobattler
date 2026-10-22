import { InputError, chatEdit, proposeHero } from '../../src/server/propose'
import { requestKeys } from '../../src/server/rate-limit'
import { hydrateBuild } from '../../src/charter/build'

/**
 * POST /api/charter/propose
 *   { kind: "propose", hero: { heroName, skills, photoUrls?, roleId? } } -> { build, offline, limits }
 *   { kind: "chat", build, message } -> { build, offline, understood, limits }
 */
export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    const text = await request.text()
    if (text.length > 20_000) return Response.json({ error: 'request too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 })
  }
  const keys = requestKeys(request)
  try {
    if (body.kind === 'chat') {
      const hydrated = hydrateBuild(body.build)
      if (!hydrated.ok) return Response.json({ error: 'invalid build', errors: hydrated.errors }, { status: 400 })
      return Response.json(await chatEdit(hydrated.build, String(body.message ?? ''), { keys }))
    }
    return Response.json(await proposeHero(body.hero as never, { keys }))
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 })
    throw error
  }
}
