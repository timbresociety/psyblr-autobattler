import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ALL_SIZE_CLASSES, SIZES, type SizeClass } from '../../charter/sizes.js'

/**
 * A procedural skinned humanoid for the performance bench (U1): about 7,500 triangles on a Mixamo-named skeleton,
 * rigidly skinned, with its own colour and roughness/AO textures. It stands in for forged heroes until keys exist,
 * so the bench pays the real costs: skinning, one material and distinct textures per hero.
 */

export const BONE_NAMES = [
  'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigRightArm', 'mixamorigRightForeArm',
  'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigRightUpLeg', 'mixamorigRightLeg',
] as const

type BoneName = (typeof BONE_NAMES)[number]

/** Parent and offset from the parent, in metres, for the bind pose. */
const SKELETON: Record<BoneName, [BoneName | null, number, number]> = {
  mixamorigHips: [null, 0, 1.0],
  mixamorigSpine: ['mixamorigHips', 0, 0.25],
  mixamorigSpine2: ['mixamorigSpine', 0, 0.25],
  mixamorigNeck: ['mixamorigSpine2', 0, 0.2],
  mixamorigHead: ['mixamorigNeck', 0, 0.1],
  mixamorigLeftArm: ['mixamorigSpine2', 0.24, 0.15],
  mixamorigLeftForeArm: ['mixamorigLeftArm', 0, -0.3],
  mixamorigRightArm: ['mixamorigSpine2', -0.24, 0.15],
  mixamorigRightForeArm: ['mixamorigRightArm', 0, -0.3],
  mixamorigLeftUpLeg: ['mixamorigHips', 0.12, -0.05],
  mixamorigLeftLeg: ['mixamorigLeftUpLeg', 0, -0.45],
  mixamorigRightUpLeg: ['mixamorigHips', -0.12, -0.05],
  mixamorigRightLeg: ['mixamorigRightUpLeg', 0, -0.45],
}

/** Which colour of the suit a body part wears. */
type Paint = 'skin' | 'hair' | 'suit' | 'trim' | 'dark' | 'glove' | 'boot'

/** Body parts: geometry, centre in the bind pose, the bone that carries it, and its paint. */
function parts(): [THREE.BufferGeometry, number, number, BoneName, Paint][] {
  const cap = (r: number, h: number) => new THREE.CapsuleGeometry(r, h, 6, 18, 2)
  const limb = (r: number, h: number) => new THREE.CapsuleGeometry(r, h, 6, 16, 2)
  const hair = new THREE.SphereGeometry(0.128, 18, 7, 0, Math.PI * 2, 0, Math.PI * 0.55)
  const parts: [THREE.BufferGeometry, number, number, BoneName, Paint][] = [
    [cap(0.17, 0.12), 0, 1.04, 'mixamorigHips', 'dark'],
    [cap(0.16, 0.14), 0, 1.3, 'mixamorigSpine', 'trim'],
    [cap(0.2, 0.16), 0, 1.52, 'mixamorigSpine2', 'suit'],
    [new THREE.CylinderGeometry(0.06, 0.07, 0.12, 16, 2), 0, 1.72, 'mixamorigNeck', 'skin'],
    [new THREE.SphereGeometry(0.12, 24, 16), 0, 1.88, 'mixamorigHead', 'skin'],
    [hair, 0, 1.9, 'mixamorigHead', 'hair'],
    // a belt with a buckle cinches the waist, the way a hero suit reads at a distance
    [new THREE.TorusGeometry(0.175, 0.03, 6, 20).rotateX(Math.PI / 2), 0, 1.12, 'mixamorigHips', 'boot'],
    [new THREE.BoxGeometry(0.07, 0.06, 0.03).translate(0, 0, 0.18), 0, 1.12, 'mixamorigHips', 'glove'],
  ]
  for (const side of [1, -1]) {
    const L = side === 1 ? 'Left' : 'Right'
    parts.push(
      // broad shoulder pads give the silhouette its heroic V
      [new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.15, 0.8, 1), 0.23 * side, 1.62, `mixamorig${L}Arm` as BoneName, 'trim'],
      [limb(0.055, 0.2), 0.24 * side, 1.5, `mixamorig${L}Arm` as BoneName, 'suit'],
      [limb(0.045, 0.2), 0.24 * side, 1.2, `mixamorig${L}ForeArm` as BoneName, 'skin'],
      [new THREE.SphereGeometry(0.05, 14, 10), 0.24 * side, 1.04, `mixamorig${L}ForeArm` as BoneName, 'glove'],
      [limb(0.08, 0.3), 0.12 * side, 0.72, `mixamorig${L}UpLeg` as BoneName, 'dark'],
      [limb(0.06, 0.3), 0.12 * side, 0.3, `mixamorig${L}Leg` as BoneName, 'dark'],
      [new THREE.BoxGeometry(0.1, 0.06, 0.22, 3, 2, 4), 0.12 * side, 0.04, `mixamorig${L}Leg` as BoneName, 'boot'],
    )
  }
  return parts
}

/** A clean anime suit in the hero's hue: skin, dark hair, the suit with a lighter trim, darker legs, gloves and boots. */
export function suitColors(hue: number): Record<Paint, THREE.Color> {
  const hsl = (h: number, s: number, l: number) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l, THREE.SRGBColorSpace)
  return {
    skin: hsl(0.07, 0.45, 0.72),
    hair: hsl(hue + 0.55, 0.35, 0.16),
    suit: hsl(hue, 0.7, 0.5),
    trim: hsl(hue + 0.08, 0.75, 0.68),
    dark: hsl(hue, 0.35, 0.2),
    glove: hsl(0.13, 0.1, 0.92),
    boot: hsl(hue + 0.02, 0.3, 0.14),
  }
}

/** How big each class is drawn: the Charter's body scale, the same one the hit capsule uses. */
export const SIZE_SCALE = Object.fromEntries(ALL_SIZE_CLASSES.map((s) => [s, SIZES[s].scale])) as Record<SizeClass, number>

/** The skinned body; with `colors`, each part also carries its suit colour as a vertex colour. */
export function bodyGeometry(colors?: Record<Paint, THREE.Color>): THREE.BufferGeometry {
  const pieces = parts().map(([geo, x, y, bone, paint]) => {
    const g = (geo.index ? geo.toNonIndexed() : geo).translate(x, y, 0)
    g.deleteAttribute('normal')
    const count = g.getAttribute('position').count
    if (colors) {
      const c = colors[paint]
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3))
    }
    const index = BONE_NAMES.indexOf(bone)
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4).map((_, i) => (i % 4 === 0 ? index : 0)), 4))
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(count * 4).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4))
    return g
  })
  const merged = mergeGeometries(pieces)
  merged.computeVertexNormals()
  return merged
}

export const triangleCount = (geo: THREE.BufferGeometry) => (geo.index ? geo.index.count : geo.getAttribute('position').count) / 3

function skeleton(): { root: THREE.Bone; bones: Record<BoneName, THREE.Bone> } {
  const bones = {} as Record<BoneName, THREE.Bone>
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone()
    bone.name = name
    bones[name] = bone
  }
  for (const name of BONE_NAMES) {
    const [parent, x, y] = SKELETON[name]
    bones[name].position.set(x, y, 0)
    if (parent) bones[parent].add(bones[name])
  }
  return { root: bones.mixamorigHips, bones }
}

/** Colour and packed occlusion/roughness/metal textures, unique per hero, drawn on a canvas in the browser. */
function textures(hue: number, size: number, seed: number): { map: THREE.Texture; orm: THREE.Texture } {
  const paint = (draw: (ctx: CanvasRenderingContext2D) => void) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    draw(canvas.getContext('2d')!)
    const texture = new THREE.CanvasTexture(canvas)
    texture.generateMipmaps = true
    return texture
  }
  const map = paint((ctx) => {
    ctx.fillStyle = `hsl(${hue * 360} 55% 42%)`
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 160; i++) {
      const r = ((seed * 9301 + i * 49297) % 233280) / 233280
      ctx.fillStyle = `hsl(${(hue * 360 + r * 60) % 360} 60% ${30 + r * 40}%)`
      ctx.fillRect(r * size, ((i * 37) % 100) / 100 * size, size / 24, size / 6)
    }
  })
  map.colorSpace = THREE.SRGBColorSpace
  const orm = paint((ctx) => {
    const grad = ctx.createLinearGradient(0, 0, size, size)
    grad.addColorStop(0, 'rgb(255 110 20)')
    grad.addColorStop(1, 'rgb(190 200 60)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
  })
  return { map, orm }
}

export interface BenchHero {
  mesh: THREE.SkinnedMesh
  /** Pose the body: running on the ground or flying. */
  animate: (t: number, flying: boolean) => void
}

export function benchHero(options: { hue: number; sizeClass: SizeClass; textureSize: number; seed: number; geometry?: THREE.BufferGeometry; look?: 'bench' | 'suit' }): BenchHero {
  const { root, bones } = skeleton()
  // the bench keeps its textured material so frame times stay comparable; the arena dresses demo heroes in a suit
  const suit = options.look === 'suit'
  const material = suit
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 })
    : (() => {
        const { map, orm } = textures(options.hue, options.textureSize, options.seed)
        return new THREE.MeshStandardMaterial({ map, roughnessMap: orm, aoMap: orm, metalnessMap: orm })
      })()
  // each hero gets its own geometry unless the caller shares one, so the bench measures distinct heroes
  const mesh = new THREE.SkinnedMesh(options.geometry ?? bodyGeometry(suit ? suitColors(options.hue) : undefined), material)
  mesh.add(root)
  mesh.updateMatrixWorld(true)
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])))
  mesh.scale.setScalar(SIZE_SCALE[options.sizeClass])
  mesh.frustumCulled = false
  const animate = (t: number, flying: boolean) => {
    const swing = Math.sin(t * 9)
    const stride = flying ? 0.15 : 0.8
    bones.mixamorigLeftUpLeg.rotation.x = flying ? 0.5 : swing * stride
    bones.mixamorigRightUpLeg.rotation.x = flying ? 0.35 : -swing * stride
    bones.mixamorigLeftLeg.rotation.x = flying ? 0.6 : Math.max(0, -swing) * 1.1
    bones.mixamorigRightLeg.rotation.x = flying ? 0.5 : Math.max(0, swing) * 1.1
    bones.mixamorigLeftArm.rotation.z = flying ? -1.2 : 0.1
    bones.mixamorigRightArm.rotation.z = flying ? 1.2 : -0.1
    bones.mixamorigLeftArm.rotation.x = flying ? 0 : -swing * stride
    bones.mixamorigRightArm.rotation.x = flying ? 0 : swing * stride
    bones.mixamorigSpine.rotation.x = flying ? 0.5 : 0.08
    bones.mixamorigHips.position.y = 1 + (flying ? 0 : Math.abs(swing) * 0.04)
  }
  return { mesh, animate }
}
