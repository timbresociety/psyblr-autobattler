import * as THREE from 'three'

/**
 * A real eyeball for the head (GAME.md §9.1): the white, the iris and the pupil on one sphere whose pole looks ahead
 * (+z), the iris pressed back into a flat disc the way it sits behind the cornea, and over it a clear cornea that
 * bulges forward and only adds its reflections, the wet highlight. Built at a radius of one, scaled to each socket.
 */

/** The iris's edge, as an angle from straight ahead (an iris is about 12 mm across on a 24 mm eye). */
const IRIS = (30 * Math.PI) / 180
const PUPIL = (11 * Math.PI) / 180
/** The cornea's edge, a little past the iris's, and how far its dome stands in front of the sphere. */
const CORNEA = (36 * Math.PI) / 180
const BULGE = 0.07

let ball: THREE.BufferGeometry | undefined
let cornea: THREE.BufferGeometry | undefined

/** The eyeball: a unit sphere, pole ahead, uv's v the angle from ahead (0 to 1 over 0 to π), with the iris flat. */
export function eyeballGeometry(): THREE.BufferGeometry {
  if (ball) return ball
  const g = new THREE.SphereGeometry(1, 48, 32)
  // its +y pole to the front
  g.rotateX(Math.PI / 2)
  const p = g.getAttribute('position')
  const flat = Math.cos(IRIS)
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i)
    // inside the iris, back onto the plane through its edge: the iris is flat, the cornea curves over it
    if (z > flat) p.setXYZ(i, p.getX(i), p.getY(i), flat - (z - flat) * 0.15)
  }
  g.computeVertexNormals()
  g.userData.shared = true
  return (ball = g)
}

/** The cornea: a cap over the iris, standing BULGE in front of the sphere at its middle. */
export function corneaGeometry(): THREE.BufferGeometry {
  if (cornea) return cornea
  const g = new THREE.SphereGeometry(1.004, 32, 10, 0, Math.PI * 2, 0, CORNEA)
  g.rotateX(Math.PI / 2)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i)
    const a = Math.acos(Math.min(1, v.z / v.length())) / CORNEA
    v.multiplyScalar(1 + BULGE * (1 - a * a))
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.computeVertexNormals()
  g.userData.shared = true
  return (cornea = g)
}

const textures = new Map<string, THREE.Texture>()

/**
 * The eye's colours, laid by angle from ahead (rows: v) and round the pole (columns: u): the pupil, the iris in the
 * hero's colour with its fibres and a darker ring at its edge, then the white, a touch pink toward the back.
 */
export function eyeTexture(iris: THREE.Color, white: THREE.Color): THREE.Texture {
  const key = `${iris.getHexString()}|${white.getHexString()}`
  const hit = textures.get(key)
  if (hit) return hit
  const W = 256
  const H = 256
  const data = new Uint8Array(W * H * 4)
  const ir = iris.clone().convertLinearToSRGB()
  const wh = white.clone().convertLinearToSRGB()
  // fibres: a few octaves of noise round the pole, the same on every eye of a colour
  const fibre = (u: number) => 0.5 + 0.22 * Math.sin(u * 2 * Math.PI * 37) * Math.sin(u * 2 * Math.PI * 11 + 1.3) + 0.14 * Math.sin(u * 2 * Math.PI * 83 + 0.7)
  for (let y = 0; y < H; y++) {
    // a row's v is (y + 0.5) / H, and SphereGeometry's v runs from 1 at its pole (now ahead) to 0 at the back
    const angle = (1 - (y + 0.5) / H) * Math.PI
    for (let x = 0; x < W; x++) {
      const u = x / W
      let r: number
      let g: number
      let b: number
      if (angle < PUPIL) {
        r = g = b = 0.02
      } else if (angle < IRIS) {
        const t = (angle - PUPIL) / (IRIS - PUPIL)
        // lighter round the pupil, darker toward the limbal ring at the edge
        const shade = (0.75 + 0.45 * fibre(u + t * 0.05)) * (1.15 - 0.55 * t) * (t > 0.85 ? 1 - (t - 0.85) * 4 : 1)
        r = ir.r * shade
        g = ir.g * shade
        b = ir.b * shade
      } else {
        const t = Math.min(1, (angle - IRIS) / (Math.PI - IRIS))
        // the white, shaded softly at the iris's edge and warming toward the back of the eye
        const edge = Math.min(1, (angle - IRIS) / 0.08)
        r = wh.r * (0.86 + 0.14 * edge) * (1 - 0.05 * t) + 0.06 * t
        g = wh.g * (0.86 + 0.14 * edge) * (1 - 0.12 * t)
        b = wh.b * (0.86 + 0.14 * edge) * (1 - 0.12 * t)
      }
      const o = (y * W + x) * 4
      data[o] = Math.round(Math.min(1, r) * 255)
      data[o + 1] = Math.round(Math.min(1, g) * 255)
      data[o + 2] = Math.round(Math.min(1, b) * 255)
      data[o + 3] = 255
    }
  }
  const t = new THREE.DataTexture(data, W, H)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  t.userData.shared = true
  textures.set(key, t)
  return t
}

/** An eye: the ball and its cornea, at a radius of one (the caller scales it to the socket). */
export function makeEye(iris: THREE.Color, white: THREE.Color): THREE.Group {
  const eye = new THREE.Group()
  eye.name = 'eyeball'
  const ballMesh = new THREE.Mesh(eyeballGeometry(), new THREE.MeshStandardMaterial({ map: eyeTexture(iris, white), roughness: 0.32, metalness: 0 }))
  ballMesh.name = 'sclera'
  // the cornea only adds light: its reflections and the highlight, never a tint over the iris
  const corneaMesh = new THREE.Mesh(
    corneaGeometry(),
    new THREE.MeshPhysicalMaterial({ color: 0x000000, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  )
  corneaMesh.name = 'cornea'
  corneaMesh.renderOrder = 2
  eye.add(ballMesh, corneaMesh)
  return eye
}
