import * as THREE from 'three'
import { LOOK_SLOTS, type LookSlot, type Worn } from '../../../charter/look.js'
import { checkMeta, surfaceItem, type ItemMeta, type SurfaceItem } from '../../../kit/wear/item.js'
import { bodyKit, bodyKitNow } from '../body-kit.js'
import type { Gltf } from '../character-look.js'
import type { BodySockets } from '../gear.js'

/**
 * Wardrobe files as the client holds them: each loaded once and shared by every hero who wears it. A file is a
 * surface item when it carries bindings (_TRI and the rest) and a rigid one otherwise, a model to hang on a socket
 * (every built-in piece, and pieces players generated). Anything that fails to load or check is left off the hero:
 * a missing item never stops a fight.
 */

/** Welded vertices on the shared body surface; an item bound to anything else is refused. */
export const BODY_VERTICES = 2595

export type LoadedItem = { kind: 'surface'; item: SurfaceItem } | { kind: 'rigid'; file: Gltf; meta?: ItemMeta }

const values = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number) => {
  const out = new Float32Array(attr.count * size)
  for (let i = 0; i < attr.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = attr.getComponent(i, k)
  return out
}

/** Read a loaded file as a wardrobe item. */
export function readItem(file: Gltf): LoadedItem {
  let mesh: THREE.Mesh | undefined
  file.scene.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.getAttribute('_tri')) mesh = o as THREE.Mesh
  })
  if (!mesh) {
    // a rigid piece: its metadata, if it has any, rides on its first primitive
    let extras: unknown
    file.scene.traverse((o) => {
      if (extras === undefined && (o as THREE.Mesh).isMesh) extras = (o as THREE.Mesh).geometry.userData
    })
    let meta: ItemMeta | undefined
    try {
      meta = checkMeta(extras, BODY_VERTICES)
    } catch {
      meta = undefined
    }
    return meta ? { kind: 'rigid', file, meta } : { kind: 'rigid', file }
  }
  const g = mesh.geometry
  const attr = (name: string, size: number) => {
    const a = g.getAttribute(name)
    if (!a) throw new Error(`item has no ${name}`)
    return values(a, size)
  }
  const optional = (name: string) => (g.getAttribute(name) ? attr(name, 1) : undefined)
  const index = g.getIndex()
  if (!index) throw new Error('item has no index')
  const channel = optional('_channel')
  const len = optional('_len')
  const chain = g.getAttribute('_chain') ? attr('_chain', 3) : undefined
  const item = surfaceItem(
    {
      extras: g.userData,
      index: index.array,
      tri: attr('_tri', 3),
      st: attr('_st', 2),
      lift: attr('_lift', 1),
      normal: attr('_nlocal', 3),
      uv: attr('uv', 2),
      rest: attr('position', 3),
      ...(channel ? { channel } : {}),
      ...(len ? { len } : {}),
      ...(chain ? { chain } : {}),
    },
    BODY_VERTICES,
  )
  return { kind: 'surface', item }
}

const items = new Map<string, Promise<LoadedItem | undefined>>()
const ready = new Map<string, LoadedItem | undefined>()

/** An item, loaded and read once; undefined when it can't load. */
export function loadItem(url: string, load: (url: string) => Promise<Gltf>): Promise<LoadedItem | undefined> {
  let item = items.get(url)
  if (!item) {
    item = load(url)
      .then(readItem)
      .catch(() => undefined)
      .then((it) => {
        ready.set(url, it)
        return it
      })
    items.set(url, item)
  }
  return item
}

/** Everything a hero's outfit needs to be drawn: each worn item by URL, and its body's sockets for rigid ones. */
export interface LoadedWear {
  items: Map<string, LoadedItem>
  sockets?: BodySockets
}

const wornUrls = (outfit: Partial<Record<LookSlot, Worn>>) => [...new Set(LOOK_SLOTS.flatMap((slot) => (outfit[slot] ? [outfit[slot]!.url] : [])))]

export async function loadWear(body: string, outfit: Partial<Record<LookSlot, Worn>>, load: (url: string) => Promise<Gltf>): Promise<LoadedWear> {
  const urls = wornUrls(outfit)
  const [kit, ...loaded] = await Promise.all([bodyKit(body), ...urls.map((url) => loadItem(url, load))])
  return { items: new Map(urls.flatMap((url, i) => (loaded[i] ? [[url, loaded[i]!] as const] : []))), ...(kit?.sockets ? { sockets: kit.sockets } : {}) }
}

/**
 * The same from what has already loaded, for drawing in one go (the roster's busts): null while anything is still on
 * its way, calling `changed` as each item lands.
 */
export function wearNow(body: string, outfit: Partial<Record<LookSlot, Worn>>, load: (url: string) => Promise<Gltf>, changed: () => void): LoadedWear | null {
  const urls = wornUrls(outfit)
  const kit = bodyKitNow(body, changed)
  let waiting = kit === null
  for (const url of urls) {
    if (ready.has(url)) continue
    waiting = true
    void loadItem(url, load).then(changed)
  }
  if (waiting) return null
  return { items: new Map(urls.flatMap((url) => (ready.get(url) ? [[url, ready.get(url)!] as const] : []))), ...(kit?.sockets ? { sockets: kit.sockets } : {}) }
}
