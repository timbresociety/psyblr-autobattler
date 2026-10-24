import type { ContentFlags } from '../types.js'

/**
 * Every external generator sits behind one interface per capability (KTD2). Adapters never throw for
 * provider-side problems: they return an outcome, and the router decides whether to fall through.
 */
export type Capability = 'director' | 'image' | 'mesh' | 'rig' | 'retarget' | 'moderation'

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'declined' | 'failed'; reason: string }
  | { ok: 'pending'; taskId: string }

export interface ProviderBase {
  id: string
  capability: Capability
  /** False when its key or base URL is missing; the router skips it. */
  available(): boolean
}

export interface DirectorRequest {
  system: string
  /** Player text is passed only as data inside delimited fields (KTD4). */
  input: Record<string, unknown>
  schema: Record<string, unknown>
}

export interface DirectorProvider extends ProviderBase {
  capability: 'director'
  complete(request: DirectorRequest): Promise<Outcome<unknown>>
}

export interface ImageRequest {
  kind: 'sheet' | 'front' | 'effect'
  prompt: string
  references?: string[]
  /** Effects only: the mechanic's shape and size the art must match (R18). */
  shape?: { delivery: string; range: number; radius?: number }
}

export interface ImageProvider extends ProviderBase {
  capability: 'image'
  generate(request: ImageRequest): Promise<Outcome<{ urls: string[] }>>
}

export interface Asset {
  url: string
  format: 'glb' | 'fbx' | 'png' | 'webp' | 'svg'
}

/** Asynchronous 3D steps: start returns a task, poll returns the asset when done. */
export interface TaskProvider<Req> extends ProviderBase {
  start(request: Req): Promise<Outcome<Asset>>
  poll(taskId: string): Promise<Outcome<Asset>>
}

export interface MeshRequest {
  imageUrl: string
  quad: boolean
  faceLimit: number
}

export interface RigRequest {
  modelUrl: string
  skeleton: 'mixamo'
}

export interface RetargetRequest {
  riggedUrl: string
  /** Up to 5 Tripo presets per call. */
  presets: string[]
}

export type MeshProvider = TaskProvider<MeshRequest> & { capability: 'mesh' }
export type RigProvider = TaskProvider<RigRequest> & { capability: 'rig' }
export type RetargetProvider = TaskProvider<RetargetRequest> & { capability: 'retarget' }

export interface ModerationProvider extends ProviderBase {
  capability: 'moderation'
  classify(request: { text?: string; imageUrl?: string }): Promise<Outcome<ContentFlags>>
}

export type AnyProvider = DirectorProvider | ImageProvider | MeshProvider | RigProvider | RetargetProvider | ModerationProvider

export type Env = Record<string, string | undefined>
