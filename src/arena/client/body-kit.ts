import type { FaceMeta } from './face/patch.js'
import type { BodySockets } from './gear.js'

/**
 * A body's kit sidecar (public/heroes/<body>.kit.json, written by the Blender pipeline): its face, its sockets, its
 * physique morphs in file order, and what fitting a photo's face shape to it needs: its face scale against the
 * reference body's (public/kit/face-basis.json) and its own face's weights on each basis group.
 */
export interface BodyKit extends FaceMeta {
  sockets?: BodySockets
  morphs?: string[]
  faceScale?: number
  fit?: number[]
}

const kits = new Map<string, Promise<BodyKit | undefined>>()
const settled = new Map<string, BodyKit | undefined>()

/** A body's kit sidecar, fetched once; undefined when it can't load (the hero then goes without a face or gear). */
export function bodyKit(body: string): Promise<BodyKit | undefined> {
  let kit = kits.get(body)
  if (!kit) {
    kit = fetch(`/heroes/${body}.kit.json`)
      .then((r) => (r.ok ? (r.json() as Promise<BodyKit>) : undefined))
      .catch(() => undefined)
      .then((k) => {
        settled.set(body, k)
        return k
      })
    kits.set(body, kit)
  }
  return kit
}

/** The sidecar if it has already loaded: null while it is on its way (calling `ready` once it lands). */
export function bodyKitNow(body: string, ready: () => void): BodyKit | undefined | null {
  if (settled.has(body)) return settled.get(body)
  void bodyKit(body).then(ready)
  return null
}
