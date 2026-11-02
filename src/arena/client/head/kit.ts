import * as THREE from 'three'
import { parseFaceBasis, type FaceBasis } from '../../../kit/body/face-basis.js'
import type { CardPart, HeadMeta, RigidPart } from '../../../kit/head/head.js'

/**
 * A gender's head kit (public/kit/v2/head-<gender>.*, from tools/blender/humanlib/head.py): its 52 face shapes, and
 * its teeth, tongue, brows and lashes with their textures. Fetched once per gender and shared by every hero.
 */
export interface HeadKit {
  meta: HeadMeta
  shapes: FaceBasis
  brows: CardPart
  lashes: CardPart
  teethUpper: RigidPart
  teethLower: RigidPart
  tongue: RigidPart
  textures: Map<string, THREE.Texture>
}

const loading = new Map<string, Promise<HeadKit | undefined>>()
const settled = new Map<string, HeadKit | undefined>()

const get = <T>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`${url}: ${r.status}`))))

function texture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) =>
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.flipY = false
        // every hero of the gender draws with it: whoever lets a hero go must leave it be (see isShared)
        t.userData.shared = true
        resolve(t)
      },
      undefined,
      reject,
    ),
  )
}

/** The kit for a body's gender ('m-medium' → 'm'); undefined when it can't load (heroes then keep the body's own head). */
export function headKit(body: string): Promise<HeadKit | undefined> {
  const gender = body.startsWith('f') ? 'f' : 'm'
  let load = loading.get(gender)
  if (!load) {
    const base = `/kit/v2/head-${gender}`
    const parts = `${base}-parts`
    load = Promise.all([
      fetch(`${base}.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${base}.bin: ${r.status}`)))),
      get<HeadMeta>(`${base}.json`),
      get<CardPart>(`${parts}/brows.json`),
      get<CardPart>(`${parts}/lashes.json`),
      get<RigidPart>(`${parts}/teeth_upper.json`),
      get<RigidPart>(`${parts}/teeth_lower.json`),
      get<RigidPart>(`${parts}/tongue.json`),
    ])
      .then(async ([bin, meta, brows, lashes, teethUpper, teethLower, tongue]) => {
        const names = [...new Set([brows, lashes, teethUpper, teethLower, tongue].flatMap((p) => (p.texture ? [p.texture] : [])))]
        const loaded = await Promise.all(names.map((n) => texture(`${parts}/${n}`)))
        const kit: HeadKit = { meta, shapes: parseFaceBasis(bin), brows, lashes, teethUpper, teethLower, tongue, textures: new Map(names.map((n, i) => [n, loaded[i]])) }
        return kit
      })
      .catch((e: unknown) => {
        console.warn('head kit', gender, e)
        return undefined
      })
      .then((kit) => {
        settled.set(gender, kit)
        return kit
      })
    loading.set(gender, load)
  }
  return load
}

/** The kit if it has loaded (null while on its way, calling `ready` when it lands; undefined if it failed). */
export function headKitNow(body: string, ready: () => void): HeadKit | undefined | null {
  const gender = body.startsWith('f') ? 'f' : 'm'
  if (settled.has(gender)) return settled.get(gender)
  void headKit(body).then(ready)
  return null
}

/** True for geometry and textures every hero shares (the head kit's, the eyes'): letting one hero go must not free them. */
export const isShared = (x: { userData: Record<string, unknown> } | null | undefined) => !!x?.userData.shared
