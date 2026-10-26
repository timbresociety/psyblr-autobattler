import { allFakes, type FakeScript } from './fakes'
import { anthropicDirector, anthropicModeration } from './live/anthropic'
import type { FetchLike } from './live/http'
import { openAICompatibleDirector, openAIImage } from './live/openai-compatible'
import { tripoMesh, tripoRetarget, tripoRig } from './live/tripo'
import type { Registry } from './router'
import type { Env } from './types'

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
      anthropicModeration(env, f),
      ...allFakes(options.fakes),
    ],
  }
}
