import type * as THREE from 'three'
import { GEAR_SLOTS, type GearPiece, type GearSlot } from '../../charter/look.js'
import type { RigKind } from '../../kit/rig/names.js'
import { bodyKit, bodyKitNow } from './body-kit.js'
import { V2_BODIES, type BodyName, type Gltf } from './character-look.js'
import type { BodySockets } from './gear.js'
import { headKit, headKitNow, type HeadKit } from './head/kit.js'

/**
 * What a hero's body needs besides its own file, as the client holds it: the weapons in its hands (each loaded once and
 * shared by every hero who holds it), its body's sockets to hang them on, and the head kit. A piece that fails to load
 * is left out of the hero's hand: a missing piece never stops a fight.
 */

/** The rig a body is on. */
export const bodyRig = (body: string): RigKind => (V2_BODIES.has(body as BodyName) ? 'standard' : 'legacy')

const pieces = new Map<string, Promise<Gltf | undefined>>()
const ready = new Map<string, Gltf | undefined>()

/** A piece, loaded once; undefined when it can't load. */
export function loadPiece(url: string, load: (url: string) => Promise<Gltf>): Promise<Gltf | undefined> {
  let piece = pieces.get(url)
  if (!piece) {
    piece = load(url)
      .catch(() => undefined)
      .then((file) => {
        ready.set(url, file)
        return file
      })
    pieces.set(url, piece)
  }
  return piece
}

/** Everything a hero's body needs drawn: each held piece by URL, the body's sockets, and its head kit. */
export interface LoadedKit {
  pieces: Map<string, Gltf>
  sockets?: BodySockets
  /** The head kit (GAME.md §9.1) for a Psyblr Human body: its face shapes, eyes' parts, teeth, brows and lashes. */
  head?: HeadKit
  /**
   * Each hand socket in its bone's own space, for a generated hero rebound onto our skeleton: its skin is not the body
   * the sockets were measured on, so they ride its hand bones where they ride ours (heroes.ts).
   */
  hands?: Partial<Record<GearSlot, THREE.Matrix4>>
  /**
   * The scale the hero is drawn at in the world: its size class's, with its physique's height (heroes.ts); 1 when
   * unset, and for a generated hero, drawn at its own height. Its weapons are sized to its hands at that scale (fit.ts).
   */
  drawn?: number
}

const heldUrls = (held: Partial<Record<GearSlot, GearPiece>>) => [...new Set(GEAR_SLOTS.flatMap((slot) => (held[slot] ? [held[slot]!.url] : [])))]

/** `more` are pieces it carries besides what is in its hands (arms.ts). */
export async function loadKit(body: string, held: Partial<Record<GearSlot, GearPiece>>, load: (url: string) => Promise<Gltf>, more: readonly string[] = []): Promise<LoadedKit> {
  const urls = [...new Set([...heldUrls(held), ...more])]
  const rig = bodyRig(body)
  const [kit, head, ...loaded] = await Promise.all([bodyKit(body), rig === 'standard' ? headKit(body) : undefined, ...urls.map((url) => loadPiece(url, load))])
  return { pieces: new Map(urls.flatMap((url, i) => (loaded[i] ? [[url, loaded[i]!] as const] : []))), ...(kit?.sockets ? { sockets: kit.sockets } : {}), ...(head ? { head } : {}) }
}

/**
 * The same from what has already loaded, for drawing in one go (the roster's busts): null while anything is still on
 * its way, calling `changed` as each piece lands.
 */
export function kitNow(body: string, held: Partial<Record<GearSlot, GearPiece>>, load: (url: string) => Promise<Gltf>, changed: () => void): LoadedKit | null {
  const urls = heldUrls(held)
  const rig = bodyRig(body)
  const kit = bodyKitNow(body, changed)
  let waiting = kit === null
  for (const url of urls) {
    if (ready.has(url)) continue
    waiting = true
    void loadPiece(url, load).then(changed)
  }
  const head = rig === 'standard' ? headKitNow(body, changed) : undefined
  if (waiting || head === null) return null
  return { pieces: new Map(urls.flatMap((url) => (ready.get(url) ? [[url, ready.get(url)!] as const] : []))), ...(kit?.sockets ? { sockets: kit.sockets } : {}), ...(head ? { head } : {}) }
}
