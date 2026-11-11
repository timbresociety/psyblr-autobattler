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
}

/** What of the motion library's index a rebound hero stands on. */
interface HeroIndex {
  bones: readonly string[]
  genders: Partial<Record<'m' | 'f', { rest: readonly (readonly number[])[] } | undefined>>
}

/** The generated test heroes the local list names; none when there is no list. */
export const auditHeroes = (): Promise<AuditHero[]> => fetch(`/${AUDIT_HEROES_FILE}`).then((r) => r.json() as Promise<AuditHero[]>).catch(() => [])

/** The heroes `/dev/try` can wear: any a local .scratch/tripo-in/try.json lists with a kit of its own, then the audit's. */
export const triedHeroes = async (): Promise<readonly TriedHero[]> => {
  const local = await fetch('/.scratch/tripo-in/try.json').then((r) => r.json() as Promise<TriedHero[]>).catch(() => [])
  return [...local, ...(await auditHeroes()).filter((h) => !local.some((l) => l.label === h.label))]
}

/**
 * A generated test hero in its own skin on our skeleton, as a file the game can dress (dev only: the mesh is under
 * .scratch). `ours` is a body of the hero's gender to take bone frames from; its bones are stood at the library's rest.
 */
export async function reboundFile(hero: TriedHero, ours: THREE.Object3D, idx: HeroIndex, load: (url: string) => Promise<{ scene: THREE.Object3D }>): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[]; rebuilt: Rebuilt }> {
  const ref = idx.genders[hero.gender]!
  idx.bones.forEach((name, k) => ours.getObjectByName(name)?.quaternion.fromArray(ref.rest[k] as number[]))
  const { scene: file } = await load(`/.scratch/tripo-in/${hero.file!}`)
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
