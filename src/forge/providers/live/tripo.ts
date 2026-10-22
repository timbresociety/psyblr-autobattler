import type { Asset, Env, MeshProvider, Outcome, RetargetProvider, RigProvider } from '../types'
import { getJson, httpFailure, postJson, type FetchLike } from './http'

/**
 * Tripo (KTD3): mesh, rig and retarget. Asynchronous jobs: create a task, poll its status, read the output.
 * Request shapes follow developers.tripo3d.com as of 2026-10; confirm against the docs on the first live key.
 */
export const TRIPO_BASE = 'https://openapi.tripo3d.com/v3'

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

export function tripoMesh(env: Env, fetchImpl: FetchLike = fetch): MeshProvider {
  const t = tripo(env, fetchImpl)
  return {
    id: 'tripo',
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
    id: 'tripo',
    capability: 'rig',
    available: t.available,
    start: (r) => t.create({ type: 'animate_rig', file: { type: 'url', url: r.modelUrl }, spec: r.skeleton, out_format: 'glb', rig_type: 'biped' }),
    poll: (id) => t.poll(id, (o) => asset(o.model, 'glb')),
  }
}

export function tripoRetarget(env: Env, fetchImpl: FetchLike = fetch): RetargetProvider {
  const t = tripo(env, fetchImpl)
  return {
    id: 'tripo',
    capability: 'retarget',
    available: t.available,
    start: (r) => t.create({ type: 'animate_retarget', file: { type: 'url', url: r.riggedUrl }, animations: r.presets.slice(0, 5), out_format: 'glb', animate_in_place: true }),
    poll: (id) => t.poll(id, (o) => asset(o.model, 'glb')),
  }
}
