import * as THREE from 'three'
import { ENGINE } from '../engine/calibration.js'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { color, mix, positionWorld, smoothstep, texture, uv } from 'three/tsl'
import { paintedTexture } from './ruins.js'
import { PALETTE, SUN } from './sky.js'
import { batchStatic } from './render/batch.js'
import { valley } from './valley.js'

export { atmosphere, lights, skyFlashOf, type SkyFlash } from './sky.js'

/**
 * The arena (R1, R25): a ruined courtyard on a rise above a mountain valley at golden hour, after the owner's
 * reference sheet (Forge goal, phase 2 look pass), split into two near-mirror halves like Dire and Radiant, with no
 * lanes, creeps or base. The ruins heroes fight around come from the engine's cover (ruins.ts); this module draws the
 * paving, the sky, the light and the haze, and valley.ts the land outside the barrier, where nothing can be walked into.
 */

export interface ArenaMap {
  group: THREE.Group
  /** Axis-aligned boxes the cameras keep out of. */
  proxies: THREE.Box3[]
}

export const TEAM_COLORS = [0x4fa3ff, 0xff6a4a] as const

/** A barrier panel that fades upward, tinted to its half. */
function barrierTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 128, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.15, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(canvas)
}

export function buildMap(): ArenaMap {
  const { halfWidth: W, halfLength: L } = ENGINE.arena
  const group = new THREE.Group()
  const proxies: THREE.Box3[] = []

  // the courtyard: worn limestone slabs with grass in the joints (generated art, tools/textures/process.py), one tile
  // every 5 m in world space, so the paving that runs on past the barrier (valley.ts) lines up with it; a slow blotch of
  // lighter and darker stone over tens of metres keeps the tiling from showing, and each half leans a touch toward its team
  const half = (side: 0 | 1) => {
    const mat = new MeshStandardNodeMaterial({ normalMap: paintedTexture('paving', 'normal'), roughnessMap: paintedTexture('paving', 'rough'), normalScale: new THREE.Vector2(1.1, 1.1), roughness: 1 })
    const blotch = smoothstep(0.25, 0.55, texture(paintedTexture('meadow', 'albedo'), positionWorld.xz.div(47)).g)
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(TEAM_COLORS[side]), 0.05)
    mat.colorNode = texture(paintedTexture('paving', 'albedo'), uv()).rgb.mul(mix(0.84, 1.08, blotch)).mul(color(tint))
    const centre = (side ? 1 : -1) * (L / 2)
    const geo = new THREE.PlaneGeometry(W * 2, L)
    const pos = geo.getAttribute('position')
    const uvs = geo.getAttribute('uv')
    // the plane lies flat with its local y along world -z
    for (let i = 0; i < pos.count; i++) uvs.setXY(i, (pos.getX(i) + W) / 5, (pos.getY(i) - centre) / 5)
    const top = new THREE.Mesh(geo, mat)
    top.name = 'floor'
    top.rotation.x = -Math.PI / 2
    top.position.z = centre
    top.receiveShadow = true
    group.add(top)
  }
  half(0)
  half(1)

  // the trim is batched into a draw per colour (GAME.md §10), so each colour shares one material
  const trim = new THREE.Group()
  const shared = new Map<string, THREE.Material>()
  const once = (key: string, make: () => THREE.Material) => shared.get(key) ?? (shared.set(key, make()), shared.get(key)!)

  // the centre line and the edge trim glow faintly, enough to read the halves and the bounds without paint on the stone
  const glow = (w: number, d: number, x: number, z: number, color: number, strength: number) => {
    const material = once(`line ${color} ${strength}`, () => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), toneMapped: false }))
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material)
    strip.name = 'line'
    strip.rotation.x = -Math.PI / 2
    strip.position.set(x, 0.015, z)
    trim.add(strip)
  }
  glow(W * 2, 0.22, 0, 0, PALETTE.line, 0.75)
  for (const side of [0, 1] as const) {
    const z = (side ? 1 : -1) * (L - 0.15)
    glow(W * 2, 0.28, 0, z, TEAM_COLORS[side], 0.85)
    glow(0.28, L, -W + 0.15, (side ? 1 : -1) * (L / 2), TEAM_COLORS[side], 0.85)
    glow(0.28, L, W - 0.15, (side ? 1 : -1) * (L / 2), TEAM_COLORS[side], 0.85)
  }

  // a faint barrier a little over head height: where the engine stops a hero, the audience can see why
  const fade = barrierTexture()
  const height = 6
  const wall = (w: number, x: number, z: number, rotY: number, color: number) => {
    const material = once(`barrier ${color}`, () => new THREE.MeshBasicMaterial({ color, map: fade, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }))
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, height), material)
    m.name = 'barrier'
    m.position.set(x, height / 2, z)
    m.rotation.y = rotY
    trim.add(m)
  }
  for (const side of [0, 1] as const) {
    const s = side ? 1 : -1
    wall(W * 2, 0, s * L, 0, TEAM_COLORS[side])
    wall(L, -W, s * (L / 2), Math.PI / 2, TEAM_COLORS[side])
    wall(L, W, s * (L / 2), Math.PI / 2, TEAM_COLORS[side])
  }

  batchStatic(trim)
  // the probe names what it looks through: the batches keep their pieces' names
  for (const m of trim.children) if (m.name === 'batch') m.name = ((m as THREE.Mesh).material as THREE.Material).transparent ? 'barrier' : 'line'
  group.add(trim)

  // the land outside: meadow and ruins at the courtyard's edge, pine forest, the lake and the mountains
  const around = valley(W, L, SUN)
  group.add(around.group)
  proxies.push(...around.proxies)

  return { group, proxies }
}
