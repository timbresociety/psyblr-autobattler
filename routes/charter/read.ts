import { InputError } from '../../src/server/propose.js'
import { requestKeys } from '../../src/server/rate-limit.js'
import { readHero } from '../../src/server/reading.js'

/**
 * POST /api/charter/read
 *   { prompt, heroName?, photoUrls?, faceFound?, note?, previous? } -> { reading } | 422 { error, refused: true }
 * The Forge's reading of a hero before it builds (src/server/reading.ts): the look, the gear, the kit and its questions.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown
  try {
    const text = await request.text()
    // a correction carries the last reading back, a few kilobytes at most
    if (text.length > 40_000) return Response.json({ error: 'request too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 })
  }
  try {
    const result = await readHero(body, { keys: requestKeys(request) })
    if (result.refused) return Response.json({ error: result.refused, refused: true }, { status: 422 })
    return Response.json({ reading: result.reading })
  } catch (error) {
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 400 })
    throw error
  }
}
