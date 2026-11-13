import * as THREE from 'three'
import type { Build } from '../../charter/build'
import { hangCarry, meshRest } from '../../arena/client/metarig/upgrade'
import { carrySockets } from '../body/carry'
import { AUDIT_HEROES_FILE, type AuditHero } from './clips'
import { onFloor, ourBone, rebindMesh, rebuildSkeleton, standing, type Rebuilt } from './rebind'

export interface TriedHero {
  label: string
  gender: 'm' | 'f'
  height: number
  /** Absent, the hero wears its usual body: the plain case to hold a generated one against. */
  file?: string
  build?: Build
  /** The mesh its ultimate transforms it into, and how tall that stands. */
  form?: { file: string; height: number }
  /** The folder its files are in, with its closing slash; the local generator's exports without one. */
  root?: string
}

/** Where the game's own generated heroes are: their meshes, and index.json listing them (scripts/generated-heroes.mjs). */
export const GENERATED_HEROES = '/heroes/generated/'
/** Where the generator's exports are kept on a development machine, as it made them. */
const LOCAL_HEROES = '/.scratch/tripo-in/'

/** What of the motion library's index a rebound hero stands on. */
interface HeroIndex {
  bones: readonly string[]
  genders: Partial<Record<'m' | 'f', { rest: readonly (readonly number[])[] } | undefined>>
}

/** The generated test heroes the local list names; none when there is no list. */
export const auditHeroes = (): Promise<AuditHero[]> => fetch(`/${AUDIT_HEROES_FILE}`).then((r) => r.json() as Promise<AuditHero[]>).catch(() => [])

/**
 * The generated heroes a match can wear: the game's own (GENERATED_HEROES), then, on a development machine, any more
 * the local lists name that the game has not been given yet (try.json, with a kit of its own, then the audit's).
 */
export const triedHeroes = async (): Promise<readonly TriedHero[]> => {
  const list = (url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<TriedHero[]>) : [])).catch(() => [] as TriedHero[])
  const own = (await list(`${GENERATED_HEROES}index.json`)).map((h) => ({ ...h, root: GENERATED_HEROES }))
  if (!import.meta.env?.DEV) return own
  const local = await list(`${LOCAL_HEROES}try.json`)
  const more = [...local, ...(await auditHeroes()).filter((h) => !local.some((l) => l.label === h.label))]
  return [...own, ...more.filter((h) => !own.some((o) => o.label === h.label))]
}

/**
 * A generated test hero in its own skin on our skeleton, as a file the game can dress (dev only: the mesh is under
 * .scratch). `ours` is a body of the hero's gender to take bone frames from; its bones are stood at the library's rest.
 */
export async function reboundFile(hero: TriedHero, ours: THREE.Object3D, idx: HeroIndex, load: (url: string) => Promise<{ scene: THREE.Object3D }>): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[]; rebuilt: Rebuilt }> {
  const ref = idx.genders[hero.gender]!
  idx.bones.forEach((name, k) => ours.getObjectByName(name)?.quaternion.fromArray(ref.rest[k] as number[]))
  const { scene: file } = await load(`${hero.root ?? LOCAL_HEROES}${hero.file!}`)
  file.updateMatrixWorld(true)
  let mesh: THREE.SkinnedMesh | undefined
  file.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh })
  const box = new THREE.Box3().setFromBufferAttribute(mesh!.geometry.getAttribute('position') as THREE.BufferAttribute).applyMatrix4(mesh!.matrixWorld)
  const fit = standing(box, hero.height)
  const joints = new Map(mesh!.skeleton.bones.map((b) => [ourBone(b.name), onFloor(b.getWorldPosition(new THREE.Vector3()), fit)]))
  const rebuilt = rebuildSkeleton(ours, joints)
  const skinned = rebindMesh(mesh!, rebuilt, fit)
  // the mesh has no eyes to turn: stand-ins keep the library's bone list whole
  for (const eye of ['LeftEye', 'RightEye']) {
    const o = new THREE.Bone()
    o.name = eye
    o.quaternion.fromArray(ref.rest[idx.bones.indexOf(eye)] as number[])
    rebuilt.bones.get('Head')!.add(o)
  }
  // the carry slots, measured off its own skin like any body's
  const geo = skinned.geometry
  const skin = { positions: geo.getAttribute('position').array, joints: geo.getAttribute('skinIndex').array, weights: geo.getAttribute('skinWeight').array }
  hangCarry(skinned, carrySockets(skin, meshRest(skinned)))
  return { scene: rebuilt.root as THREE.Group, animations: [], rebuilt }
}
