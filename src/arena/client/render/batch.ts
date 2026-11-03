import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Bake a group of static meshes into one mesh per material (GAME.md §10: the map's pieces drawn batched), so scenery
 * that never moves or breaks costs a draw call per material instead of one per piece, and as few again in the shadow
 * pass. Instanced and skinned meshes are left as they are, and so is anything whose geometry can't join the rest (a
 * different set of attributes). Returns how many meshes were folded in.
 */
export function batchStatic(group: THREE.Object3D): number {
  group.updateMatrixWorld(true)
  const toGroup = new THREE.Matrix4().copy(group.matrixWorld).invert()
  const bins = new Map<string, { material: THREE.Material; castShadow: boolean; receiveShadow: boolean; meshes: THREE.Mesh[] }>()
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || Array.isArray(mesh.material) || !mesh.visible) return
    const g = mesh.geometry
    if (Object.keys(g.morphAttributes).length) return
    const layout = Object.entries(g.attributes)
      .map(([name, a]) => `${name}${a.itemSize}`)
      .sort()
      .join(',')
    const key = `${mesh.material.uuid}|${layout}|${g.index ? 'i' : 'n'}|${mesh.castShadow}|${mesh.receiveShadow}`
    let bin = bins.get(key)
    if (!bin) bins.set(key, (bin = { material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, meshes: [] }))
    bin.meshes.push(mesh)
  })
  let folded = 0
  const m = new THREE.Matrix4()
  for (const bin of bins.values()) {
    if (bin.meshes.length < 2) continue
    const parts = bin.meshes.map((mesh) => mesh.geometry.clone().applyMatrix4(m.multiplyMatrices(toGroup, mesh.matrixWorld)))
    const merged = mergeGeometries(parts)
    for (const p of parts) p.dispose()
    if (!merged) continue
    merged.computeBoundingSphere()
    const batch = new THREE.Mesh(merged, bin.material)
    batch.name = 'batch'
    batch.castShadow = bin.castShadow
    batch.receiveShadow = bin.receiveShadow
    batch.matrixAutoUpdate = false
    group.add(batch)
    // the originals are dropped, not disposed: one may share its geometry with a mesh left as it was
    for (const mesh of bin.meshes) mesh.removeFromParent()
    folded += bin.meshes.length
  }
  return folded
}
