import { keywordFlags } from '../../keywords.js'
import { PIECE_KINDS, type PieceKind } from '../../../charter/look.js'
import type { Asset, DirectorProvider, ImageProvider, MeshProvider, ModerationProvider, Outcome, PieceProvider, RetargetProvider, RigProvider } from '../types.js'
import { placeholderPiece } from './piece-model.js'

/**
 * Deterministic fakes (KTD3): the offline path and every test. Same input, same output. Assets are tiny
 * data URLs or fake:// URLs the viewer understands as "show the placeholder mannequin".
 */

export function hash(text: string): string {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16).padStart(8, '0')
}

const svg = (label: string, color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${color}"/><text x="128" y="136" font-size="14" text-anchor="middle" fill="#fff">${label.replace(/[<&>]/g, '')}</text></svg>`)}`

const COLORS = ['#3b2f6b', '#6b2f3b', '#2f6b4a', '#6b5a2f', '#2f4f6b']

export interface FakeScript {
  /** Decline any request whose prompt matches. */
  decline?: RegExp
  /** Fail any request whose prompt matches. */
  fail?: RegExp
  /** Fake director answers are produced by this function (wired to the director's offline brain). */
  director?: (input: Record<string, unknown>) => unknown
}

function scripted(prompt: string, script: FakeScript): Outcome<never> | undefined {
  if (script.decline?.test(prompt)) return { ok: false, kind: 'declined', reason: 'fake decline' }
  if (script.fail?.test(prompt)) return { ok: false, kind: 'failed', reason: 'fake failure' }
  return undefined
}

export function fakeDirector(script: FakeScript = {}): DirectorProvider {
  return {
    id: 'fake-director',
    capability: 'director',
    available: () => true,
    async complete(request) {
      const blocked = scripted(JSON.stringify(request.input), script)
      if (blocked) return blocked
      if (!script.director) return { ok: false, kind: 'failed', reason: 'no fake director brain wired' }
      return { ok: true, value: script.director(request.input) }
    },
  }
}

export function fakeImage(script: FakeScript = {}, id = 'fake-image'): ImageProvider {
  return {
    id,
    capability: 'image',
    available: () => true,
    async generate(request) {
      const blocked = scripted(request.prompt, script)
      if (blocked) return blocked
      const h = hash(`${request.kind}:${request.prompt}`)
      const count = request.kind === 'sheet' ? 4 : request.kind === 'effect' ? 3 : 1
      const urls = Array.from({ length: count }, (_, i) => svg(`${request.kind} ${h.slice(0, 4)} ${i + 1}`, COLORS[(parseInt(h, 16) + i) % COLORS.length]))
      return { ok: true, value: { urls } }
    },
  }
}

/** A fake async 3D step: start returns a task, the first poll completes it. */
function fakeTask<Req>(id: string, capability: 'mesh' | 'rig' | 'retarget', asset: (req: Req, h: string) => Asset, script: FakeScript, keyOf: (req: Req) => string) {
  const tasks = new Map<string, Asset>()
  return {
    id,
    capability,
    available: () => true,
    async start(request: Req): Promise<Outcome<Asset>> {
      const key = keyOf(request)
      const blocked = scripted(key, script)
      if (blocked) return blocked
      const h = hash(`${capability}:${key}`)
      tasks.set(`${capability}-${h}`, asset(request, h))
      return { ok: 'pending', taskId: `${capability}-${h}` }
    },
    async poll(taskId: string): Promise<Outcome<Asset>> {
      const done = tasks.get(taskId)
      // a fresh process (or another test) may poll a task this instance did not start: rebuild it from the id
      return done ? { ok: true, value: done } : { ok: true, value: { url: `fake://${capability}/${taskId}.glb`, format: 'glb' } }
    },
  }
}

export function fakeMesh(script: FakeScript = {}): MeshProvider {
  return fakeTask('fake-mesh', 'mesh', (_r, h) => ({ url: `fake://mesh/${h}.fbx`, format: 'fbx' }), script, (r: { imageUrl: string }) => r.imageUrl) as MeshProvider
}

export function fakeRig(script: FakeScript = {}): RigProvider {
  return fakeTask('fake-rig', 'rig', (_r, h) => ({ url: `fake://rig/${h}.glb`, format: 'glb' }), script, (r: { modelUrl: string }) => r.modelUrl) as RigProvider
}

export function fakeRetarget(script: FakeScript = {}): RetargetProvider {
  return fakeTask('fake-retarget', 'retarget', (r, h) => ({ url: `fake://motion/${h}-${(r as { presets: string[] }).presets.join('+')}.glb`, format: 'glb' }), script, (r: { riggedUrl: string; presets: string[] }) => `${r.riggedUrl}|${r.presets.join(',')}`) as RetargetProvider
}

/**
 * A fake piece: the task id carries its kind and prompt, so any instance can finish it (a serverless poll rarely lands
 * on the instance that started it). The first poll returns a stand-in model for the kind and a labelled preview.
 */
export function fakePiece(script: FakeScript = {}): PieceProvider {
  return {
    id: 'fake-piece',
    capability: 'piece',
    available: () => true,
    async start(request) {
      const blocked = scripted(request.prompt, script)
      if (blocked) return blocked
      return { ok: 'pending', taskId: `piece-${request.kind}-${hash(`${request.kind}:${request.prompt}:${request.imageUrl ?? ''}`)}-${encodeURIComponent(request.prompt.slice(0, 40))}` }
    },
    async poll(taskId) {
      const [, kind, h, label = ''] = /^piece-([a-z]+)-([0-9a-f]{8})-?(.*)$/.exec(taskId) ?? []
      if (!(PIECE_KINDS as readonly string[]).includes(kind)) return { ok: false, kind: 'failed', reason: 'unknown fake piece task' }
      const glb = await placeholderPiece(kind as PieceKind)
      const url = `data:model/gltf-binary;base64,${Buffer.from(glb).toString('base64')}`
      return { ok: true, value: { url, format: 'glb', preview: svg(decodeURIComponent(label) || kind, COLORS[parseInt(h, 16) % COLORS.length]) } }
    },
  }
}

export { keywordFlags }

export function fakeModeration(): ModerationProvider {
  return {
    id: 'fake-moderation',
    capability: 'moderation',
    available: () => true,
    async classify(request) {
      return { ok: true, value: keywordFlags(request.text ?? '') }
    },
  }
}

export function allFakes(script: FakeScript = {}) {
  return [fakeDirector(script), fakeImage(script), fakeMesh(script), fakeRig(script), fakeRetarget(script), fakeModeration(), fakePiece(script)]
}
