import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, fract, instancedBufferAttribute, length, positionLocal, smoothstep, time, uv, vec3 } from 'three/tsl'
import { DEMO_HEROES } from '../demo/roster'
import { benchHero, type BenchHero } from '../demo/procedural-hero'
import { summarizeFrames, type FrameSummary } from './frames'
import { createRenderer, type Backend } from './render/renderer'

/**
 * The performance bench (U1): 20 distinct heroes running and flying, about 50,000 additive particles, and synthetic
 * main-thread load sized to the engine, AI and physics budget, so a pass predicts a real 10v10 (R26).
 */

export interface BenchLoad {
  /** Busy time per 60 Hz engine tick for 20 heroes. */
  engineMsPerTick: number
  /** Busy time per AI decision; each of 20 heroes decides every 9 ticks. */
  aiMsPerDecision: number
  /** Busy time per frame for cosmetic physics. */
  physicsMsPerFrame: number
}

export const DEFAULT_LOAD: BenchLoad = { engineMsPerTick: 0.25, aiMsPerDecision: 0.05, physicsMsPerFrame: 2 }
export const NO_LOAD: BenchLoad = { engineMsPerTick: 0, aiMsPerDecision: 0, physicsMsPerFrame: 0 }

export interface BenchReport extends FrameSummary {
  backend: Backend
  drawCalls: number
  triangles: number
  particles: number
  heroes: number
}

const PARTICLES_PER_SYSTEM = 12_500
const SYSTEMS = 4
const FOCUS_HEROES = 2

function busy(ms: number) {
  if (ms <= 0) return
  const end = performance.now() + ms
  while (performance.now() < end) {
    // simulated engine, AI and physics work
  }
}

/** One instanced particle system whose motion runs entirely in the vertex shader (KTD11). */
function particleSystem(count: number, color: THREE.Color, centre: THREE.Vector3, seed: number): THREE.InstancedMesh {
  const origin = new Float32Array(count * 3)
  const velocity = new Float32Array(count * 3)
  const life = new Float32Array(count * 2)
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    origin.set([centre.x + (rnd() - 0.5) * 6, centre.y + rnd() * 2, centre.z + (rnd() - 0.5) * 6], i * 3)
    velocity.set([(rnd() - 0.5) * 6, 2 + rnd() * 6, (rnd() - 0.5) * 6], i * 3)
    life.set([rnd(), 0.6 + rnd() * 1.4], i * 2)
  }
  // the typings return an untyped node for instanced attributes, so name the vector types here
  const o = instancedBufferAttribute(new THREE.InstancedBufferAttribute(origin, 3), 'vec3') as unknown as typeof positionLocal
  const v = instancedBufferAttribute(new THREE.InstancedBufferAttribute(velocity, 3), 'vec3') as unknown as typeof positionLocal
  const l = instancedBufferAttribute(new THREE.InstancedBufferAttribute(life, 2), 'vec2') as unknown as ReturnType<typeof uv>
  const age = fract(time.div(l.y).add(l.x))
  const t = age.mul(l.y)
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  material.positionNode = positionLocal.mul(float(1).sub(age).mul(0.3).add(0.05)).add(o.add(v.mul(t)).add(vec3(0, t.mul(t).mul(-2), 0)))
  material.colorNode = vec3(color.r, color.g, color.b)
  material.opacityNode = smoothstep(0.5, 0, length(uv().sub(0.5))).mul(float(1).sub(age))
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count)
  mesh.frustumCulled = false
  return mesh
}

function arena(scene: THREE.Scene) {
  const half = (color: number, z: number) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }))
    plane.rotation.x = -Math.PI / 2
    plane.position.z = z
    plane.receiveShadow = true
    scene.add(plane)
  }
  half(0x2b3a4a, -20)
  half(0x4a2f2b, 20)
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2018, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(20, 40, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40 })
  scene.add(sun)
}

export async function runBench(canvas: HTMLCanvasElement, options: { forceWebGL: boolean; load: BenchLoad; onReport: (r: BenchReport) => void }): Promise<() => void> {
  const { renderer, backend } = await createRenderer(canvas, { forceWebGL: options.forceWebGL })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.shadowMap.enabled = true
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x10141c)
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400)
  arena(scene)

  const heroes: { hero: BenchHero; radius: number; speed: number; flying: boolean; phase: number }[] = DEMO_HEROES.map((h, i) => {
    const hero = benchHero({ hue: h.hue, sizeClass: h.sizeClass, textureSize: i < FOCUS_HEROES ? 2048 : 1024, seed: i + 1 })
    scene.add(hero.mesh)
    return { hero, radius: 6 + (i % 5) * 4, speed: 0.4 + (i % 4) * 0.15, flying: i % 3 === 0, phase: (i / DEMO_HEROES.length) * Math.PI * 2 }
  })
  const colors = [0x66ccff, 0xffaa33, 0xff4466, 0x99ff66]
  for (let i = 0; i < SYSTEMS; i++) scene.add(particleSystem(PARTICLES_PER_SYSTEM, new THREE.Color(colors[i]), new THREE.Vector3((i - 1.5) * 10, 1, (i % 2) * 8 - 4), 1000 + i))

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas
    renderer.setSize(w, h, false)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const frames: number[] = []
  let last = performance.now()
  let started = last
  let tickDebt = 0
  let ticks = 0
  let lastReport = 0
  let stopped = false
  const loop = () => {
    if (stopped) return
    const now = performance.now()
    const dt = (now - last) / 1000
    last = now
    if (now - started > 2000) frames.push(dt * 1000)
    if (frames.length > 600) frames.shift()

    // synthetic game load: fixed 60 Hz engine ticks, staggered AI decisions, and physics once a frame
    tickDebt += Math.min(dt, 0.1) * 60
    while (tickDebt >= 1) {
      tickDebt--
      ticks++
      busy(options.load.engineMsPerTick)
      busy(options.load.aiMsPerDecision * heroes.filter((_, i) => (ticks + i) % 9 === 0).length)
    }
    busy(options.load.physicsMsPerFrame)

    const t = now / 1000
    const near: { mesh: THREE.SkinnedMesh; d: number }[] = []
    for (const h of heroes) {
      const a = h.phase + t * h.speed
      h.hero.mesh.position.set(Math.cos(a) * h.radius, h.flying ? 4 + Math.sin(t + h.phase) * 1.5 : 0, Math.sin(a) * h.radius)
      h.hero.mesh.rotation.y = -a
      h.hero.animate(t + h.phase, h.flying)
      near.push({ mesh: h.hero.mesh, d: h.hero.mesh.position.distanceToSquared(camera.position) })
    }
    // only the heroes nearest the camera cast shadows (KTD9)
    near.sort((a, b) => a.d - b.d).forEach((n, i) => (n.mesh.castShadow = i < 4))

    camera.position.set(Math.cos(t * 0.1) * 34, 16, Math.sin(t * 0.1) * 34)
    camera.lookAt(0, 2, 0)
    renderer.render(scene, camera)

    if (now - lastReport > 500 && frames.length > 30) {
      lastReport = now
      const report: BenchReport = { ...summarizeFrames(frames), backend, drawCalls: renderer.info.render.drawCalls, triangles: renderer.info.render.triangles, particles: PARTICLES_PER_SYSTEM * SYSTEMS, heroes: heroes.length }
      ;(window as unknown as { __bench?: BenchReport }).__bench = report
      options.onReport(report)
    }
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  started = performance.now()

  return () => {
    stopped = true
    window.removeEventListener('resize', resize)
    renderer.dispose()
  }
}
