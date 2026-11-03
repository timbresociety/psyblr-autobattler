import * as THREE from 'three'

/** How far a small prop is drawn (GAME.md §10: distance LOD on props); past it a chip of rubble is a pixel or two. */
export const PROP_REACH = 45
/** How far the camera moves before the props are sorted again. */
const RESORT = 2

/**
 * Distance LOD for an instanced prop: only the instances within `reach` of the camera are drawn. The near ones are
 * packed to the front of the instance buffer and the count cut to them, so the far ones cost nothing at all, in the
 * main pass or the shadows'.
 */
export class PropLod {
  private readonly matrices: THREE.Matrix4[] = []
  private readonly centres: THREE.Vector3[] = []
  private readonly last = new THREE.Vector3(Infinity, Infinity, Infinity)

  constructor(
    readonly mesh: THREE.InstancedMesh,
    readonly reach = PROP_REACH,
  ) {
    for (let i = 0; i < mesh.count; i++) {
      const m = new THREE.Matrix4()
      mesh.getMatrixAt(i, m)
      this.matrices.push(m)
      this.centres.push(new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(mesh.matrixWorld))
    }
    // the bounds stay those of every instance, so the mesh is never culled for the near ones' sake
    mesh.computeBoundingSphere()
  }

  /** Sort the props for a camera at `eye`; returns how many are drawn. */
  update(eye: THREE.Vector3): number {
    if (this.last.distanceToSquared(eye) < RESORT * RESORT) return this.mesh.count
    this.last.copy(eye)
    const reach2 = this.reach * this.reach
    let n = 0
    for (let i = 0; i < this.matrices.length; i++) if (this.centres[i].distanceToSquared(eye) <= reach2) this.mesh.setMatrixAt(n++, this.matrices[i])
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    return n
  }
}

/** Every small instanced prop under `root` (the rubble at the feet of the ruins), each with its distance LOD. */
export function propLods(root: THREE.Object3D): PropLod[] {
  root.updateMatrixWorld(true)
  const out: PropLod[] = []
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh && o.name === 'rubble') out.push(new PropLod(o as THREE.InstancedMesh))
  })
  return out
}
