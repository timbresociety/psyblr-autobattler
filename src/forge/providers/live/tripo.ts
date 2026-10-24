import type { Asset, Env, MeshProvider, Outcome, PieceProvider, RetargetProvider, RigProvider } from '../types.js'
import { getJson, httpFailure, postJson, type FetchLike } from './http.js'

/**
 * Tripo (KTD3): mesh, rig and retarget. Asynchronous jobs: create a task, poll its status, read the output.
 * Request shapes follow developers.tripo3d.ai as of 2026-10. A key works in one region only, and the wrong region
 * answers 401: this is the international API, where keys from developers.tripo3d.ai (and platform.tripo3d.ai before
 * it) work. A China-mainland key (developers.tripo3d.com) sets TRIPO_BASE_URL=https://openapi.tripo3d.com/v3.
 */
export const TRIPO_BASE = 'https://openapi.tripo3d.ai/v3'

interface TripoTask {
  data?: { task_id?: string; status?: string; output?: Record<string, string>; error?: string }
  code?: number
  message?: string
}

function tripo(env: Env, fetchImpl: FetchLike) {
  const key = env.TRIPO_API_KEY
  const base = env.TRIPO_BASE_URL || TRIPO_BASE
  const headers = { authorization: `Bearer ${key ?? ''}` }

  async function create(body: Record<string, unknown>): Promise<Outcome<Asset>> {
    const { status, json } = await postJson(fetchImpl, `${base}/task`, body, headers)
    const task = json as TripoTask
    if (status !== 200 || !task.data?.task_id) return httpFailure(status, json)
    return { ok: 'pending', taskId: task.data.task_id }
  }

  async function poll(taskId: string, pick: (output: Record<string, string>) => Asset | undefined): Promise<Outcome<Asset>> {
    const { status, json } = await getJson(fetchImpl, `${base}/task/${encodeURIComponent(taskId)}`, headers)
    const task = json as TripoTask
    if (status !== 200 || !task.data) return httpFailure(status, json)
    switch (task.data.status) {
      case 'success': {
        const asset = pick(task.data.output ?? {})
        return asset ? { ok: true, value: asset } : { ok: false, kind: 'failed', reason: 'task succeeded without an output file' }
      }
      case 'failed':
        return { ok: false, kind: 'failed', reason: task.data.error ?? 'Tripo task failed' }
      case 'cancelled':
      case 'banned':
        return { ok: false, kind: 'declined', reason: task.data.error ?? `Tripo task ${task.data.status}` }
      default:
        return { ok: 'pending', taskId }
    }
  }

  return { available: () => !!key, create, poll }
}

const asset = (url: string | undefined, format: Asset['format']): Asset | undefined => (url ? { url, format } : undefined)

/** Tripo's v3 task as its task query returns it. */
interface TripoV3Task {
  code?: number
  message?: string
  data?: { task_id?: string; status?: string; output?: { model_url?: string; rendered_image_url?: string }; error_code?: number; error_message?: string }
}

/** A refusal on content grounds (Tripo's 2008, content policy) is a decline; anything else failed. */
function v3Failure(status: number, json: unknown): Outcome<never> {
  const body = json as TripoV3Task
  if (body?.code === 2008) return { ok: false, kind: 'declined', reason: body.message ?? 'Tripo declined the prompt on content grounds' }
  return httpFailure(status, json)
}

/** The Tripo model version pieces are made with (developers.tripo3d.ai, generation, 2026-10). */
export const TRIPO_PIECE_MODEL = 'v3.1-20260211'

/**
 * A piece of gear from words (text-to-model) or a picture of it (image-to-model), on Tripo's v3 API: create the task,
 * then poll /tasks/{id} until its output carries the GLB and a rendered preview.
 */
export function tripoPiece(env: Env, fetchImpl: FetchLike = fetch): PieceProvider {
  const key = env.TRIPO_API_KEY
  const base = env.TRIPO_BASE_URL || TRIPO_BASE
  const headers = { authorization: `Bearer ${key ?? ''}` }
  return {
    id: 'tripo-piece',
    capability: 'piece',
    available: () => !!key,
    async start(r) {
      const common = { model: TRIPO_PIECE_MODEL, face_limit: r.faceLimit, texture: true, pbr: true }
      const [path, body] = r.imageUrl ? ['image-to-model', { ...common, input: r.imageUrl }] : ['text-to-model', { ...common, prompt: r.prompt.slice(0, 1024) }]
      const { status, json } = await postJson(fetchImpl, `${base}/generation/${path}`, body, headers)
      const task = json as TripoV3Task
      if (status !== 200 || task.code !== 0 || !task.data?.task_id) return v3Failure(status, json)
      return { ok: 'pending', taskId: task.data.task_id }
    },
    async poll(taskId) {
      const { status, json } = await getJson(fetchImpl, `${base}/tasks/${encodeURIComponent(taskId)}`, headers)
      const task = json as TripoV3Task
      if (status !== 200 || task.code !== 0 || !task.data) return v3Failure(status, json)
      switch (task.data.status) {
        case 'success': {
          const out = task.data.output
          return out?.model_url ? { ok: true, value: { url: out.model_url, format: 'glb', preview: out.rendered_image_url } } : { ok: false, kind: 'failed', reason: 'the task finished without a model' }
        }
        case 'failed':
          return task.data.error_code === 2008 ? { ok: false, kind: 'declined', reason: task.data.error_message ?? 'declined on content grounds' } : { ok: false, kind: 'failed', reason: task.data.error_message ?? 'Tripo task failed' }
        case 'cancelled':
        case 'banned':
        case 'expired':
          return { ok: false, kind: 'declined', reason: task.data.error_message ?? `Tripo task ${task.data.status}` }
        default:
          return { ok: 'pending', taskId }
      }
    },
  }
}

export function tripoMesh(env: Env, fetchImpl: FetchLike = fetch): MeshProvider {
  const t = tripo(env, fetchImpl)
  return {
    id: 'tripo-mesh',
    capability: 'mesh',
    available: t.available,
    start: (r) => t.create({ type: 'image_to_model', file: { type: 'url', url: r.imageUrl }, quad: r.quad, face_limit: r.faceLimit, texture: true, pbr: true }),
    // quad output is FBX (KTD9): it is kept as the archival source mesh
    poll: (id) => t.poll(id, (o) => asset(o.model ?? o.pbr_model, 'fbx')),
  }
}

export function tripoRig(env: Env, fetchImpl: FetchLike = fetch): RigProvider {
  const t = tripo(env, fetchImpl)
  return {
    id: 'tripo-rig',
    capability: 'rig',
    available: t.available,
    start: (r) => t.create({ type: 'animate_rig', file: { type: 'url', url: r.modelUrl }, spec: r.skeleton, out_format: 'glb', rig_type: 'biped' }),
    poll: (id) => t.poll(id, (o) => asset(o.model, 'glb')),
  }
}

export function tripoRetarget(env: Env, fetchImpl: FetchLike = fetch): RetargetProvider {
  const t = tripo(env, fetchImpl)
  return {
    id: 'tripo-retarget',
    capability: 'retarget',
    available: t.available,
    start: (r) => t.create({ type: 'animate_retarget', file: { type: 'url', url: r.riggedUrl }, animations: r.presets.slice(0, 5), out_format: 'glb', animate_in_place: true }),
    poll: (id) => t.poll(id, (o) => asset(o.model, 'glb')),
  }
}
