import { allFakes, type FakeScript } from './fakes/index.js'
import { anthropicDirector, anthropicModeration } from './live/anthropic.js'
import type { FetchLike } from './live/http.js'
import { openAICompatibleDirector, openAIImage } from './live/openai-compatible.js'
import { tripoMesh, tripoPiece, tripoRetarget, tripoRig } from './live/tripo.js'
import type { Registry } from './router.js'
import type { Env } from './types.js'

/** Every live adapter plus the fakes; the router decides which are used (KTD2, KTD3). */
export function createRegistry(env: Env, options: { fetch?: FetchLike; fakes?: FakeScript } = {}): Registry {
  const f = options.fetch
  return {
    env,
    providers: [
      openAICompatibleDirector(env, f),
      anthropicDirector(env, f),
      openAIImage(env, f),
      tripoMesh(env, f),
      tripoRig(env, f),
      tripoRetarget(env, f),
      tripoPiece(env, f),
      anthropicModeration(env, f),
      ...allFakes(options.fakes),
    ],
  }
}
