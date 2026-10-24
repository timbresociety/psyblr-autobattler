import * as THREE from 'three'
import { characterMap, type CharacterLook, type Gltf } from '../character-look.js'
import { bodyKit } from '../body-kit.js'
import { compositeFace } from './composite.js'
import { buildFacePatch, type FaceMeta, type Rgba } from './patch.js'
import type { Pt } from './warp.js'

/**
 * A hero's photo face, from stored photo to finished atlas: the body's face sidecar and the photo load once each, the
 * photo is warped onto that body (patch.ts) and painted into a copy of its atlas (composite.ts). Cached per body,
 * photo and skin colour, so twenty heroes sharing a face do the work once. Anything that fails leaves the hero on its
 * body's shared atlas: a missing face never stops a fight.
 */

/** A body's face data, from its kit sidecar. */
export function faceMeta(body: string): Promise<FaceMeta | undefined> {
  return bodyKit(body)
}

const photos = new Map<string, Promise<Rgba | undefined>>()

/** A stored photo's pixels. Blob serves public files to any origin, so the canvas stays readable. */
export function photoPixels(url: string): Promise<Rgba | undefined> {
  let photo = photos.get(url)
  if (!photo) {
    photo = (async () => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return undefined
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      return { width: data.width, height: data.height, data: data.data }
    })().catch(() => undefined)
    photos.set(url, photo)
  }
  return photo
}

function toCanvas(rgba: Rgba): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = rgba.width
  canvas.height = rgba.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height), 0, 0)
  return canvas
}

/** The skinned mesh of a character file, whose geometry and atlas the face is painted onto. */
export function fileMesh(file: Gltf): THREE.SkinnedMesh | undefined {
  let found: THREE.SkinnedMesh | undefined
  file.scene.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh
  })
  return found
}

const atlases = new Map<string, Promise<THREE.Texture | null>>()
const ready = new Map<string, THREE.Texture | null>()

const keyOf = (look: CharacterLook) => (look.face ? `${look.build}|${look.face.url}|${look.colors.skin.getHexString()}` : '')

/** The hero's own atlas with its photo face; null when it has no face or the face could not be made. */
export function heroAtlas(file: Gltf, look: CharacterLook): Promise<THREE.Texture | null> {
  const face = look.face
  const mesh = fileMesh(file)
  const atlas = mesh ? characterMap(mesh) : null
  if (!face || !mesh || !atlas?.image) return Promise.resolve(null)
  const key = keyOf(look)
  let made = atlases.get(key)
  if (!made) {
    made = (async () => {
      const [meta, photo] = await Promise.all([faceMeta(look.build), photoPixels(face.url)])
      if (!meta || !photo) return null
      // the landmarks were found on the image as uploaded; scale them if the stored file came back another size
      const sx = photo.width / face.width
      const sy = photo.height / face.height
      const points: Pt[] = []
      for (let i = 0; i < face.points.length; i += 2) points.push([face.points[i] * sx, face.points[i + 1] * sy])
      const { patch } = buildFacePatch(photo, points, meta, 512)
      const canvas = compositeFace(mesh.geometry, atlas.image as CanvasImageSource & { width: number; height: number }, meta.frame, toCanvas(patch), look.colors.skin)
      const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement)
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.wrapS = atlas.wrapS
      texture.wrapT = atlas.wrapT
      texture.anisotropy = atlas.anisotropy
      return texture
    })().catch(() => null)
    made.then((t) => ready.set(key, t))
    atlases.set(key, made)
  }
  return made
}

/**
 * For drawing that can't wait (the staging busts): the face atlas if it is ready, null when there is none, and
 * undefined while it is being made, with `onReady` called once it is.
 */
export function heroAtlasNow(file: Gltf, look: CharacterLook, onReady: () => void): THREE.Texture | null | undefined {
  if (!look.face) return null
  const key = keyOf(look)
  if (ready.has(key)) return ready.get(key)!
  void heroAtlas(file, look).then(onReady)
  return undefined
}
