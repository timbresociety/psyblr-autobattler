import Delaunator from 'delaunator'
import * as THREE from 'three'
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ARCH, LETTERS, SHINE, TOKEN_BOX, TOKEN_SHINE, TOKEN_SHINE_AT, WORDMARK_BOX } from './marks'

/*
 * psyblr's marks in liquid iridescent chrome, the way psyblr.com makes its token (Psyblr Landing Page/src/gl: token.ts,
 * metal.ts, env.ts): every piece is the exact SVG outline inflated like a pillow, so it has curvature everywhere for
 * reflections to flow over; the metal is physical chrome with thin-film iridescence and a slowly flowing normal field;
 * and it reflects a studio with real darks (ink horizon bands) as well as bright strips, which is what lets chrome read
 * on a white page as well as a dark one.
 */

/** A 2D affine transform in canvas order: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = [number, number, number, number, number, number]
const mul = ([a, b, c, d, e, f]: Mat, [A, B, C, D, E, F]: Mat): Mat => [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f]

/** An SVG transform attribute (translate, rotate and scale, in order) as one matrix. */
export function svgTransform(t: string): Mat {
  let m: Mat = [1, 0, 0, 1, 0, 0]
  for (const [, op, args] of t.matchAll(/(translate|rotate|scale)\(([^)]*)\)/g)) {
    const n = args.split(/[\s,]+/).filter(Boolean).map(Number)
    if (op === 'translate') m = mul(m, [1, 0, 0, 1, n[0], n[1] ?? 0])
    else if (op === 'scale') m = mul(m, [n[0], 0, 0, n[1] ?? n[0], 0, 0])
    else {
      const r = (n[0] * Math.PI) / 180
      m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0])
    }
  }
  return m
}

type Ring = THREE.Vector2[]

/** A path's filled shapes, each as its outline then its holes, mapped through `m` and then `toWorld`. */
function shapeRings(d: string, m: Mat, toWorld: (x: number, y: number) => [number, number]): Ring[][] {
  const data = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg>`)
  const map = (p: THREE.Vector2) => new THREE.Vector2(...toWorld(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5]))
  const ring = (path: THREE.Path) => {
    const pts = path.getPoints(24).map(map)
    if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-9) pts.pop()
    return pts
  }
  return data.paths.flatMap((p) => SVGLoader.createShapes(p)).map((s) => [ring(s), ...s.holes.map(ring)])
}

const segDist = (px: number, py: number, a: THREE.Vector2, b: THREE.Vector2) => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / (dx * dx + dy * dy || 1e-12)))
  return Math.hypot(a.x + dx * t - px, a.y + dy * t - py)
}

/**
 * One inflated piece: the outline (and any holes) resampled evenly, the inside filled with a hex grid of points, a
 * Delaunay triangulation over both (a dense rim keeps its edges), lifted on both sides by a quarter-circle of the
 * distance to the nearest edge.
 */
export function pillow(rings: Ring[], step: number, grid: number, cap: number, round = 0.6): THREE.BufferGeometry | undefined {
  const rims: Ring[] = rings.map((raw) => {
    const out: Ring = []
    raw.forEach((a, i) => {
      const b = raw[(i + 1) % raw.length]
      const n = Math.max(1, Math.ceil(a.distanceTo(b) / step))
      for (let k = 0; k < n; k++) out.push(a.clone().lerp(b, k / n))
    })
    return out
  })
  const rim = rims.flat()
  const edges: [THREE.Vector2, THREE.Vector2][] = rims.flatMap((r) => r.map((a, i) => [a, r[(i + 1) % r.length]] as [THREE.Vector2, THREE.Vector2]))
  // even-odd across every ring, so holes stay holes
  const inside = (x: number, y: number) => {
    let c = false
    for (const [a, b] of edges) if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c
    return c
  }
  const edgeDist = (x: number, y: number) => {
    let best = Infinity
    for (const [a, b] of edges) best = Math.min(best, segDist(x, y, a, b))
    return best
  }
  const box = new THREE.Box2().setFromPoints(rim)
  const inner: Ring = []
  for (let y = box.min.y + grid * 0.5, row = 0; y < box.max.y; y += grid * 0.866, row++)
    for (let x = box.min.x + (row % 2 ? grid * 0.5 : 0); x < box.max.x; x += grid) if (inside(x, y) && edgeDist(x, y) > grid * 0.55) inner.push(new THREE.Vector2(x, y))
  const verts = [...rim, ...inner]
  const coords = new Float64Array(verts.length * 2)
  verts.forEach((p, i) => coords.set([p.x, p.y], i * 2))
  const tri = new Delaunator(coords).triangles
  const faces: number[] = []
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [verts[tri[t]], verts[tri[t + 1]], verts[tri[t + 2]]]
    if (inside((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)) faces.push(tri[t], tri[t + 1], tri[t + 2])
  }
  if (!faces.length) return undefined
  const R = rim.length
  const N = inner.length
  const dist = inner.map((p) => edgeDist(p.x, p.y))
  const D = Math.max(1e-6, ...dist)
  const H = Math.min(round * D, cap)
  const lift = (d: number) => {
    const t = Math.min(d / (0.94 * D), 1)
    return H * Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)))
  }
  // the rim is shared by both faces; the inner points come twice, lifted forward and back
  const pos = new Float32Array((R + N * 2) * 3)
  rim.forEach((p, i) => pos.set([p.x, p.y, 0], i * 3))
  inner.forEach((p, i) => {
    const h = lift(dist[i])
    pos.set([p.x, p.y, h], (R + i) * 3)
    pos.set([p.x, p.y, -h], (R + N + i) * 3)
  })
  const back = (i: number) => (i < R ? i : i + N)
  const index: number[] = []
  for (let f = 0; f < faces.length; f += 3) {
    const [a, b, c] = [faces[f], faces[f + 1], faces[f + 2]]
    index.push(a, b, c, back(a), back(c), back(b))
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  // the front must face +z: if an inner front point's normal points away, flip every triangle
  if (N > 0 && geo.getAttribute('normal').getZ(R) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
    geo.setIndex(index)
    geo.computeVertexNormals()
  }
  return geo
}

function merged(parts: { d: string; m: Mat }[], toWorld: (x: number, y: number) => [number, number], step: number, grid: number, cap: number, round: number) {
  const geos = parts.flatMap(({ d, m }) => shapeRings(d, m, toWorld).map((rings) => pillow(rings, step, grid, cap, round))).filter((g): g is THREE.BufferGeometry => !!g)
  const geo = mergeGeometries(geos)
  geos.forEach((g) => g.dispose())
  return geo
}

const IDENT: Mat = [1, 0, 0, 1, 0, 0]
/** World units per token unit: the token is 2 × 2.26, like psyblr.com's. */
const K = 0.01
/** The wordmark is drawn at this size against the token (its CSS height over the token's CSS width, in SVG units). */
export const WORD_PER_TOKEN = 24 / WORDMARK_BOX[3] / (30 / TOKEN_BOX[2])

/** The token and the wordmark as two inflated geometries, each centred on its SVG frame, in world units. */
export function markGeometries() {
  const tcx = TOKEN_BOX[0] + TOKEN_BOX[2] / 2
  const tcy = TOKEN_BOX[1] + TOKEN_BOX[3] / 2
  const token = merged(
    [
      { d: ARCH, m: IDENT },
      { d: TOKEN_SHINE, m: svgTransform(TOKEN_SHINE_AT) },
    ],
    (x, y) => [(x - tcx) * K, -(y - tcy) * K],
    0.02,
    0.03,
    0.135,
    0.6,
  )
  const kw = K * WORD_PER_TOKEN
  const wcx = WORDMARK_BOX[0] + WORDMARK_BOX[2] / 2
  const wcy = WORDMARK_BOX[1] + WORDMARK_BOX[3] / 2
  const word = merged(
    [...LETTERS.map(([d, t]) => ({ d, m: svgTransform(t) })), { d: SHINE[0], m: svgTransform(SHINE[1]) }],
    (x, y) => [(x - wcx) * kw, -(y - wcy) * kw],
    0.022,
    0.026,
    0.08,
    // the letters' strokes are thin: inflate them nearly round, like tubes, so they have curvature to reflect with
    0.95,
  )
  return { token, word, tokenWidth: TOKEN_BOX[2] * K, wordHeight: WORDMARK_BOX[3] * kw }
}

const SNOISE = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`

/** The flowing-metal uniforms every piece shares. */
export interface MetalUniforms {
  uTime: { value: number }
  uFlow: { value: number }
  /** a ripple from a touch point: xyz in world, w its start time */
  uPulse: { value: THREE.Vector4 }
  /** how strongly the thin film tints the chrome */
  uFilm: { value: number }
}

/**
 * Physical chrome with thin-film iridescence, a normal field that flows like mercury, and a touch ripple. At the size of
 * a logo the physical film barely shows, so a pastel film tint (pearl, aqua, champagne, blush) also drifts over the
 * surface with its slope. Thin strokes take a little roughness, so their reflections don't shimmer between pixels.
 */
export function liquidMetal(u: MetalUniforms, roughness = 0.06) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness,
    iridescence: 1,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [180, 520],
    clearcoat: 0.45,
    clearcoatRoughness: 0.06,
    envMapIntensity: 1.3,
  })
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vWPos;\n${SNOISE}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 wp0 = (modelMatrix * vec4(transformed, 1.0)).xyz;
          transformed += objectNormal * snoise(wp0 * 1.4 + vec3(0.0, uTime * 0.25, 0.0)) * 0.008 * abs(objectNormal.z);
        }`,
      )
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uFlow; uniform vec4 uPulse; uniform float uFilm;\nvarying vec3 vWPos;\n${SNOISE}`)
      .replace(
        '#include <opaque_fragment>',
        `{
          float hue = atan(normal.y, normal.x) * 0.159 + dot(vWPos.xy, vec2(0.35, 0.22)) + uTime * 0.04;
          vec3 film = mix(vec3(1.0), 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67))), 0.32);
          outgoingLight = mix(outgoingLight, outgoingLight * film * 1.12, uFilm * (0.55 + 0.45 * (1.0 - abs(normal.z))));
        }
        #include <opaque_fragment>`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 q = vWPos * 0.85 + vec3(0.0, uTime * 0.16, uTime * 0.05);
          vec3 nn = vec3(snoise(q), snoise(q + vec3(19.1, 3.3, 7.7)), snoise(q + vec3(-11.7, 41.7, 2.9)));
          float age = uTime - uPulse.w;
          if (age > 0.0 && age < 3.0) {
            vec3 dv = vWPos - uPulse.xyz;
            float d = length(dv) + 1e-4;
            float x = (d - age * 1.9) * 5.0;
            nn += (dv / d) * exp(-x * x) * exp(-age * 1.5) * 2.2;
          }
          normal = normalize(normal + (viewMatrix * vec4(nn, 0.0)).xyz * uFlow);
        }`,
      )
  }
  m.customProgramCacheKey = () => 'psyblr-liquid-metal-2'
  return m
}

/**
 * The studio the chrome reflects: a pearl dome over a lilac floor, white strips for highlights, a warm sun, and two ink
 * horizon bands. Chrome only reads as metal when there's something darker to reflect, and on a white page it needs
 * more of it: the light page's studio has an ink floor and wider bands.
 */
export function studio(renderer: THREE.WebGLRenderer, dark = true): THREE.Texture {
  const scene = new THREE.Scene()
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 64, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#E6ECFF') },
          uMid: { value: new THREE.Color('#F9F8FF') },
          uHor: { value: new THREE.Color('#FFF5EC') },
          uLow: { value: new THREE.Color(dark ? '#ABA7CF' : '#6E6A92') },
          uBot: { value: new THREE.Color(dark ? '#4E4880' : '#211D38') },
        },
        vertexShader: `varying vec3 vDir;\nvoid main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 uTop, uMid, uHor, uLow, uBot;
          varying vec3 vDir;
          void main(){
            float e = vDir.y;
            vec3 c = mix(uHor, uMid, smoothstep(0.02, 0.35, e));
            c = mix(c, uTop, smoothstep(0.35, 1.0, e));
            c = mix(c, uLow, smoothstep(0.0, -0.18, e));
            c = mix(c, uBot, smoothstep(-0.18, -0.85, e));
            // faint aqua and blush lobes for thin-film variety
            c += vec3(0.06, 0.16, 0.14) * smoothstep(0.55, 1.0, dot(vDir, normalize(vec3(-1.0, 0.2, 0.3))));
            c += vec3(0.16, 0.07, 0.12) * smoothstep(0.6, 1.0, dot(vDir, normalize(vec3(1.0, 0.1, -0.4))));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    ),
  )
  const panel = (geo: THREE.BufferGeometry, color: string, intensity: number, at: THREE.Vector3Tuple) => {
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }))
    mesh.position.set(...at)
    mesh.lookAt(0, 0, 0)
    scene.add(mesh)
  }
  // a key strip overhead and in front, two rim strips, a soft top panel, a back strip, and a low warm sun
  panel(new THREE.PlaneGeometry(46, 4.5), '#FFFFFF', 5, [0, 20, 18])
  panel(new THREE.PlaneGeometry(4, 30), '#DDFBF2', 3, [-26, 6, 6])
  panel(new THREE.PlaneGeometry(4, 30), '#FFEFE2', 3, [26, 6, -4])
  panel(new THREE.PlaneGeometry(26, 26), '#F2F0FF', 1.5, [0, 34, -6])
  panel(new THREE.PlaneGeometry(30, 3), '#FFFFFF', 2.4, [0, 8, -30])
  panel(new THREE.CircleGeometry(3.6, 48), '#FFE2BC', 7, [16, 6, 38])
  // the classic chrome double horizon: a wide ink band low, a thinner one higher up
  const band = (height: number, color: string, y: number) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, height, 96, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.85), side: THREE.DoubleSide }))
    mesh.position.y = y
    scene.add(mesh)
  }
  band(dark ? 3.6 : 6, dark ? '#3E3868' : '#221E3A', -1.4)
  band(dark ? 1.4 : 2.2, dark ? '#5A5490' : '#3A3560', 13)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0.03)
  pmrem.dispose()
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
  })
  return target.texture
}

/** Where each mark sits on the canvas, in CSS pixels from its top left. */
export interface MarkLayout {
  width: number
  height: number
  token: DOMRect
  word: DOMRect
}

/** The live marks: one small WebGL canvas, laid over the SVG marks it replaces. Throws where WebGL isn't available. */
export class ChromeMarks {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10)
  private uniforms: MetalUniforms = { uTime: { value: 0 }, uFlow: { value: 0.14 }, uPulse: { value: new THREE.Vector4(0, 0, 0, -100) }, uFilm: { value: 0.5 } }
  private token: THREE.Mesh
  private word: THREE.Mesh
  private tokenWidth: number
  private wordHeight: number
  private scale = 1
  private env: THREE.Texture
  private dark = true

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.env = studio(this.renderer)
    this.scene.environment = this.env
    const geo = markGeometries()
    this.token = new THREE.Mesh(geo.token, liquidMetal(this.uniforms))
    this.word = new THREE.Mesh(geo.word, liquidMetal(this.uniforms, 0.16))
    this.tokenWidth = geo.tokenWidth
    this.wordHeight = geo.wordHeight
    // a slight turn: the tops of the pillows catch the sky and the strips, the lower slopes the ink horizon
    this.token.rotation.set(-0.05, 0.14, 0)
    this.word.rotation.set(-0.04, 0.08, 0)
    this.scene.add(this.token, this.word)
  }

  /** Fit the camera and both marks to where their SVG stand-ins sit. */
  layout({ width, height, token, word }: MarkLayout) {
    // supersampled: the marks are small, and chrome's reflections alias long before its edges do
    this.renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * 1.5, 3))
    this.renderer.setSize(width, height, false)
    // one world unit in CSS pixels, from the token's width
    this.scale = token.width / this.tokenWidth || 1
    const s = this.scale
    Object.assign(this.camera, { left: 0, right: width / s, top: 0, bottom: -height / s })
    this.camera.updateProjectionMatrix()
    this.token.position.set((token.left + token.width / 2) / s, -(token.top + token.height / 2) / s, 0)
    this.word.position.set((word.left + word.width / 2) / s, -(word.top + word.height / 2) / s, 0)
    this.word.scale.setScalar(word.height / s / this.wordHeight || 1)
    this.word.visible = word.width > 0
  }

  /** Brighter chrome on the dark page; deeper chrome, from a darker studio, on the light one. */
  theme(dark: boolean) {
    this.renderer.toneMappingExposure = dark ? 1.12 : 0.95
    this.uniforms.uFilm.value = dark ? 0.5 : 0.38
    // thin letters on a white page read as gunmetal chrome; on the dark page, bright chrome
    ;(this.word.material as THREE.MeshPhysicalMaterial).color.set(dark ? 0xffffff : 0x7a7694)
    if (dark === this.dark) return
    this.dark = dark
    this.env.dispose()
    this.env = studio(this.renderer, dark)
    this.scene.environment = this.env
  }

  /** A ripple through the metal from a point on the canvas (CSS pixels). */
  pulse(x: number, y: number) {
    this.uniforms.uPulse.value.set(x / this.scale, -y / this.scale, 0.2, this.uniforms.uTime.value)
  }

  frame(seconds: number) {
    this.uniforms.uTime.value = seconds
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    this.token.geometry.dispose()
    this.word.geometry.dispose()
    ;(this.token.material as THREE.Material).dispose()
    ;(this.word.material as THREE.Material).dispose()
    this.env.dispose()
    this.renderer.dispose()
  }
}
