import type { AttitudeId } from '../../kit/anim/attitude.js'
import * as THREE from 'three'
import type { Build } from '../../charter/build.js'
import { defaultLook, heldOf, ROLE_GENDER, type FacePhoto, type GearPiece, type GearSlot, type Gender } from '../../charter/look.js'
import type { FormBody, FormMark } from '../../charter/skill-look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../../kit/body/shape.js'
import type { Sculpt } from '../../kit/body/sculpt.js'
import { ALL_SIZE_CLASSES, type SizeClass } from '../../charter/sizes.js'

/**
 * What a hero looks like in the arena's own characters (R24), without any renderer: which body it wears (its size and
 * gender), how that body is built, its skin and photo face, and the weapons in its hands (body-model.ts builds the
 * body with them). Heroes are drawn bare (owner, 2026-11-04). Every hero is made this way, the starters too (starters.ts). The bodies come from
 * tools/blender/human.py. The arena, the staging busts and the 3D previews all read this, so a hero looks the same in
 * its portrait as on the field, on either side.
 */

/** A body for every size class in both genders, drawn at one nominal height: the game's size scale makes it big. */
export type BodyName = `${Gender}-${SizeClass}`
export const BODIES: readonly BodyName[] = (['m', 'f'] as const).flatMap((g) => ALL_SIZE_CLASSES.map((s) => `${g}-${s}` as BodyName))

export interface CharacterLook {
  build: BodyName
  /** How the body is built. */
  physique: Physique
  /** The weapons in its hands. */
  held: Partial<Record<GearSlot, GearPiece>>
  /** The body's own colours: its skin (baked into the hero's atlas under a photo face), the whites of its eyes, its irises and its brows. */
  colors: { skin: THREE.Color; eye: THREE.Color; iris: THREE.Color; brow: THREE.Color }
  /** A photo face to warp onto the body's own; its skin colour is then baked into the hero's atlas (face/composite). */
  face?: FacePhoto
  /** Marks painted on the face, as a form wears them (face/composite). */
  marks?: FormMark
  /** The head and face as sculpted by hand, on top of the photo's. */
  sculpt?: Sculpt
  /** How the body carries itself (kit/anim/attitude.ts); neutral when absent. */
  attitude?: AttitudeId
}

/** The look a form wears: the hero's own, with the form's eyes and marks. */
export function formCharacterLook(look: CharacterLook, body: FormBody | undefined): CharacterLook {
  if (!body) return look
  // the eyes take the form's colour: the irises outright, and the whites a little, lifted so the iris still reads
  const eye = body.eyes ? new THREE.Color().setStyle(body.eyes, THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.25) : look.colors.eye
  const iris = body.eyes ? new THREE.Color().setStyle(body.eyes, THREE.SRGBColorSpace) : look.colors.iris
  return { ...look, colors: { ...look.colors, eye, iris }, ...(body.marks ? { marks: body.marks } : {}) }
}

/** The body a hero wears: its size class (colossal while transformed) in its look's gender, or its role's without one. */
export function bodyFor(build: Pick<Build, 'roleId' | 'sizeClass' | 'look'>, size: SizeClass = build.sizeClass ?? 'medium'): BodyName {
  return `${build.look?.gender ?? ROLE_GENDER[build.roleId] ?? 'm'}-${size}`
}

/**
 * A hero's signature colour: a stable one from its name. The arena, the portraits and the 3D
 * previews all read this, so a hero keeps it everywhere and while it is edited.
 */
export function heroHue(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000) / 1000
}

/** A hero's look: its own, or what its role and hue give it before anyone changes it. */
export function characterLook(build: Build, hue: number): CharacterLook {
  const base = defaultLook(build.roleId, build.heroName ?? build.roleId, hue)
  const look = build.look ?? base
  const out: CharacterLook = {
    build: bodyFor(build),
    physique: { ...NEUTRAL_PHYSIQUE, ...(look.physique ?? {}) },
    held: heldOf(look),
    colors: {
      skin: new THREE.Color().setStyle(look.colors.skin ?? base.colors.skin, THREE.SRGBColorSpace),
      eye: new THREE.Color().setHSL(0, 0, 0.96, THREE.SRGBColorSpace),
      iris: new THREE.Color().setStyle(look.colors.iris ?? base.colors.iris ?? '#3a2e22', THREE.SRGBColorSpace),
      brow: new THREE.Color().setStyle(look.colors.brow ?? base.colors.brow, THREE.SRGBColorSpace),
    },
  }
  if (look.face) out.face = look.face
  if (look.sculpt) out.sculpt = look.sculpt
  if (look.attitude) out.attitude = look.attitude
  return out
}

export type Gltf = { scene: THREE.Group; animations: THREE.AnimationClip[] }
const files = new Map<BodyName, Promise<Gltf>>()

/**
 * The bodies rebuilt on the Psyblr Human rig (tools/blender/human2.py, public/heroes/v2/; docs/plans/2026-10-31-canon-
 * psyblr-human.md, phase 1). A body listed here loads from v2 and moves on the standard rig's library; one left out
 * would stay on the 20-bone rig. All twelve are rebuilt, so every hero is on the Psyblr Human.
 */
export const V2_BODIES: ReadonlySet<BodyName> = new Set<BodyName>(
  (['m', 'f'] as const).flatMap((g) => (['tiny', 'small', 'medium', 'large', 'huge', 'colossal'] as const).map((s) => `${g}-${s}` as BodyName)),
)

/** Where a body's file and kit sidecar live. */
export const bodyFolder = (build: BodyName) => (V2_BODIES.has(build) ? '/heroes/v2' : '/heroes')

/** Load (once) and cache a character file; `load` is the shared GLTF loader with meshopt support. */
export function loadBuild(build: BodyName, load: (url: string) => Promise<Gltf>): Promise<Gltf> {
  let file = files.get(build)
  if (!file) {
    file = load(`${bodyFolder(build)}/${build}.glb`).catch((e: unknown) => {
      files.delete(build)
      throw e
    })
    files.set(build, file)
  }
  return file
}

/** The meta channel: each vertex's region (u), skin or eye. Textured files carry it in the second UV set. */
export function metaChannel(geometry: THREE.BufferGeometry): 'uv' | 'uv1' {
  return geometry.getAttribute('uv1') ? 'uv1' : 'uv'
}

/** The atlas texture a character mesh carries (its skin and face), if any. */
export function characterMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.map : m?.map) ?? null
}

/** The baked relief a character's skin carries, if any. */
export function characterNormalMap(mesh: THREE.Mesh): THREE.Texture | null {
  const m = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
  return (Array.isArray(m) ? m[0]?.normalMap : m?.normalMap) ?? null
}

/**
 * The classic (WebGL) material the previews and busts draw a character with. Its skin (_skin, from body-model.ts)
 * lets light in: light scattered under the surface blurs the relief its diffuse shows, red the most, and carries on a
 * little past where the surface turns from the light, warm. Its highlights keep the full relief, at skin's own
 * reflectance (IOR 1.4), and a faint sheen at grazing angles stands for its fine hair. Up close it has pores and faint
 * blotches (PORES_GLSL, BLOTCH_GLSL), where the atlas round a photo face is one flat colour. The eyes stay wet and glossy.
 */
export function classicCharacterMaterial(map: THREE.Texture | null, normalMap: THREE.Texture | null = null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, map, normalMap, roughness: 0.52, metalness: 0, ior: 1.4 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float _skin;\nvarying float vSkin;\nvarying vec3 vSkinRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkin = _skin;\nvSkinRest = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSkinRest;\n${GRAIN_GLSL}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${SKIN_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${BLOTCH_GLSL}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.1, roughnessFactor, vSkin);')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nskinFlatNormal = nonPerturbedNormal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${PORES_GLSL}`)
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor *= vSkin;\n#endif')
  }
  m.customProgramCacheKey = () => 'psyblr-skin'
  return m
}

/**
 * Value noise in three dimensions, and a normal bumped by a height in metres, for relief drawn without UVs on where a
 * surface sits at rest: skin's pores.
 */
const GRAIN_GLSL = `float grainHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// value noise in three dimensions, 0 to 1
float grainNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(grainHash(i), grainHash(i + vec3(1, 0, 0)), f.x), mix(grainHash(i + vec3(0, 1, 0)), grainHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(grainHash(i + vec3(0, 0, 1)), grainHash(i + vec3(1, 0, 1)), f.x), mix(grainHash(i + vec3(0, 1, 1)), grainHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// a normal bumped by a height (in metres) that changes dhx and dhy across a pixel: the height's slope along the surface
// (Mikkelsen's surface gradient, from the position's own change across the pixel), so the bump holds at any distance
vec3 grainNormal(vec3 surf, vec3 n, float dhx, float dhy, float faceDirection) {
  vec3 sx = dFdx(surf);
  vec3 sy = dFdy(surf);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDirection;
  det = det < 0.0 ? min(det, -1e-12) : max(det, 1e-12);
  return normalize(n - (dhx * r1 + dhy * r2) / det);
}`

/**
 * Skin isn't one flat colour: faint blotches a centimetre or so across and finer ones a few millimetres across, a
 * little redder or paler. The body's atlas is flat round the photo face, so without them a forehead reads as plastic.
 */
const BLOTCH_GLSL = `
float blotch = grainNoise(vSkinRest * 70.0) * 0.6 + grainNoise(vSkinRest * 230.0 + 3.0) * 0.4;
diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.93, 0.965, 0.98), vec3(1.06, 1.0, 0.985), blotch), vSkin);`

/**
 * Pores: small pits about a millimetre apart over a finer, shallower roughness, bumping the normal by their slope in
 * metres (grainNormal), and a little less glossy in the pits, so a highlight on skin breaks up the way it does on a
 * face instead of sliding off it. They fade out where their cells shrink under a pixel or so, where they'd only
 * shimmer: the hero seen whole, or anything further than the creator's close look.
 */
const PORES_GLSL = `
{
  vec3 at = vSkinRest * 1000.0;
  float seen = vSkin * (1.0 - smoothstep(0.7, 1.4, length(fwidth(at))));
  // deeper in some patches than others, as a nose's pores are and a temple's aren't
  float pore = smoothstep(0.62, 0.86, grainNoise(at)) * mix(0.35, 1.0, smoothstep(0.25, 0.75, grainNoise(vSkinRest * 40.0 + 9.0)));
  float fine = grainNoise(at * 2.3 + 7.0);
  float relief = (fine * 0.00003 - pore * 0.00007) * seen;
  normal = grainNormal(-vViewPosition, normal, dFdx(relief), dFdy(relief), faceDirection);
  roughnessFactor = min(roughnessFactor + pore * 0.08 * seen, 1.0);
}`

/**
 * Direct light on skin, in place of three's RE_Direct_Physical (which it matches where _skin is 0, on the eyes). The
 * diffuse lights each channel by the normal partway back to the surface's own, before its relief, and adds a band
 * along the terminator: the soft, warm edge pre-integrated skin shading gives, kept to the edge so the lit side keeps
 * the skin's colour.
 */
const SKIN_GLSL = `varying float vSkin;
vec3 skinFlatNormal = vec3(0.0, 0.0, 1.0);
vec3 skinScatter(const in vec3 n, const in vec3 l) {
  vec3 nl = vec3(
    dot(normalize(mix(n, skinFlatNormal, 0.2 * vSkin)), l),
    dot(n, l),
    dot(n, l));
  vec3 band = vec3(0.08, 0.02, 0.01) * vSkin * (1.0 - smoothstep(vec3(0.0), vec3(0.45, 0.3, 0.25), abs(nl)));
  return saturate(nl) + band;
}
void RE_Direct_Skin(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  float dotNL = saturate(dot(geometryNormal, directLight.direction));
  vec3 irradiance = dotNL * directLight.color;
  vec3 scattered = skinScatter(geometryNormal, directLight.direction) * directLight.color;
  #ifdef USE_SHEEN
    sheenSpecularDirect += irradiance * BRDF_Sheen(directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness);
    float sheenAlbedoV = IBLSheenBRDF(geometryNormal, geometryViewDir, material.sheenRoughness);
    float sheenAlbedoL = IBLSheenBRDF(geometryNormal, directLight.direction, material.sheenRoughness);
    float sheenEnergyComp = 1.0 - max3(material.sheenColor) * max(sheenAlbedoV, sheenAlbedoL);
    irradiance *= sheenEnergyComp;
    scattered *= sheenEnergyComp;
  #endif
  reflectedLight.directSpecular += irradiance * BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, material) * material.multiScatteringCompensation;
  vec3 halfDir = normalize(directLight.direction + geometryViewDir);
  vec3 F = F_Schlick(material.specularColor, material.specularF90, saturate(dot(geometryViewDir, halfDir)));
  reflectedLight.directDiffuse += scattered * BRDF_Lambert(material.diffuseContribution) * (1.0 - F);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Skin`
