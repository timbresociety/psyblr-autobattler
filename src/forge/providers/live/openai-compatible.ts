import type { DirectorProvider, Env, ImageProvider, Outcome } from '../types'
import { httpFailure, postJson, type FetchLike } from './http'

/**
 * OpenAI-compatible chat and image endpoints (KTD3). One adapter covers any compatible host — including less
 * restricted ones such as Kimi or a self-hosted model — by base URL and model name.
 */

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: string; refusal?: string | null } }[]
}

export function openAICompatibleDirector(env: Env, fetchImpl: FetchLike = fetch): DirectorProvider {
  const base = env.FORGE_LLM_BASE_URL
  const key = env.FORGE_LLM_API_KEY
  const model = env.FORGE_LLM_MODEL
  return {
    id: 'openai-compatible',
    capability: 'director',
    available: () => !!(base && key && model),
    async complete(request): Promise<Outcome<unknown>> {
      const { status, json } = await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: request.system },
            // player text is data, not instructions (KTD4)
            { role: 'user', content: `<player_input>\n${JSON.stringify(request.input)}\n</player_input>` },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'forge', schema: request.schema, strict: true } },
        },
        { authorization: `Bearer ${key}` },
      )
      if (status !== 200) return httpFailure(status, json)
      const choice = (json as ChatResponse).choices?.[0]
      if (!choice) return { ok: false, kind: 'failed', reason: 'no choices returned' }
      if (choice.finish_reason === 'content_filter' || choice.message?.refusal) return { ok: false, kind: 'declined', reason: choice.message?.refusal ?? 'content filter' }
      try {
        return { ok: true, value: JSON.parse(choice.message?.content ?? '') }
      } catch {
        return { ok: false, kind: 'failed', reason: 'model did not return JSON' }
      }
    },
  }
}

interface ImagesResponse {
  data?: { url?: string; b64_json?: string }[]
  error?: { code?: string; message?: string }
}

export function openAIImage(env: Env, fetchImpl: FetchLike = fetch): ImageProvider {
  const base = env.FORGE_IMAGE_BASE_URL
  const key = env.FORGE_IMAGE_API_KEY
  const model = env.FORGE_IMAGE_MODEL
  return {
    id: 'openai-image',
    capability: 'image',
    available: () => !!(base && key && model),
    async generate(request): Promise<Outcome<{ urls: string[] }>> {
      const shape = request.shape ? ` The effect's shape is a ${request.shape.delivery} reaching ${request.shape.range} m${request.shape.radius ? ` with a ${request.shape.radius} m radius` : ''}.` : ''
      const { status, json } = await postJson(
        fetchImpl,
        `${base}/images/generations`,
        { model, prompt: `${request.prompt}${shape}`, n: request.kind === 'sheet' ? 4 : 1, size: '1024x1024' },
        { authorization: `Bearer ${key}` },
      )
      const body = json as ImagesResponse
      if (body.error?.code === 'content_policy_violation' || body.error?.code === 'moderation_blocked') return { ok: false, kind: 'declined', reason: body.error.message ?? 'content policy' }
      if (status !== 200 || !body.data?.length) return httpFailure(status, json)
      return { ok: true, value: { urls: body.data.map((d) => d.url ?? `data:image/png;base64,${d.b64_json}`) } }
    },
  }
}
