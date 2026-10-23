import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { characterLook, paintGeometry, type CharacterLook, type Gltf } from '../../arena/client/character-look'
import { SIZE_SCALE } from '../../arena/demo/procedural-hero'
import type { Build } from '../../charter/build'
import { SIZES, type SizeClass } from '../../charter/sizes'
import type { RoleId } from '../../charter/types'
import { prefersReducedMotion } from '../arena/hud/format'
import { characterFile } from '../arena/staging/loadout'
import { ROLE_RGB, type StageClip } from './hero-look'

/**
 * The hero on a lit plinth: the arena's own character in the hero's colours and parts (character-look), playing its
 * idle on a slow turntable. Drag turns it; a cue plays one clip (a skill's cast) and returns to idle. One classic
 * WebGL context, drawn at most 30 times a second and only while on screen, released on unmount.
 */

export interface HeroStageProps {
  /** The hero to show. Without one, a dark stand-in figure waits on the plinth. */
  look?: { heroName: string; roleId: RoleId }
  hue?: number
  /** Plays one clip, then back to idle. A new `at` replays the same clip. */
  cue?: { clip: StageClip; at: number }
  /** Draws the hero at a size class's scale. */
  size?: SizeClass
  /** With `size`, rings the plinth with the hit capsule's real radius (the Forge's size picker). */
  hitbox?: boolean
  label: string
  className?: string
}

interface Live {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  sizer: THREE.Group
  turntable: THREE.Group
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  ring: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  hitbox: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  model?: THREE.Object3D
  mixer?: THREE.AnimationMixer
  actions?: Map<string, THREE.AnimationAction>
  scale: number
  targetScale: number
  dirty: boolean
}

const FPS = 30
const HERO_HEIGHT = 1.8
const START_ANGLE = 0.38

function radialTexture(stops: [number, string][]): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, color] of stops) grad.addColorStop(at, color)
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

const flat = (geo: THREE.BufferGeometry, y: number) => geo.rotateX(-Math.PI / 2).translate(0, y, 0)

/** A neutral figure for the empty stage: one build, no cape or armour, short hair. */
function standInLook(): CharacterLook {
  return { ...characterLook({ heroName: 'Hero', roleId: 'assassin' } as Build, 0.7), build: 'athletic', hair: 'crop', armour: false, cape: false }
}

function disposeModel(model: THREE.Object3D) {
  const materials = new Set<THREE.Material>()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    // the painted geometry is ours; its buffers are shared with the cached file, which only this renderer uploaded
    mesh.geometry.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
  })
  materials.forEach((m) => m.dispose())
}

export function HeroStage({ look, hue = 0.08, cue, size, hitbox = false, label, className = '' }: HeroStageProps) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef<Live | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const reduced = useRef(prefersReducedMotion())

  // the renderer, lights, plinth and loop: once per mount
  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      if (typeof WebGL2RenderingContext === 'undefined') throw new Error('no WebGL2')
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    } catch {
      setFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60)
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x2b1b3c, 1.25))
    const key = new THREE.DirectionalLight(0xffe2c4, 2.6)
    key.position.set(2.4, 3.4, 3.2)
    const rimCool = new THREE.DirectionalLight(0x8fb8ff, 2.8)
    rimCool.position.set(-3.2, 2.8, -2.6)
    const rimWarm = new THREE.DirectionalLight(0xffa36a, 2.1)
    rimWarm.position.set(3.4, 2.2, -2.8)
    const fill = new THREE.DirectionalLight(0xc8b6ff, 0.55)
    fill.position.set(-2.5, 1.2, 3)
    scene.add(key, rimCool, rimWarm, fill)

    const glow = new THREE.Mesh(
      flat(new THREE.CircleGeometry(1.7, 64), 0.002),
      new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,255,255,0.95)'], [0.3, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }),
    )
    const ring = new THREE.Mesh(flat(new THREE.RingGeometry(0.8, 0.83, 96), 0.004), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.5, depthWrite: false }))
    const hitbox = new THREE.Mesh(flat(new THREE.RingGeometry(0.94, 1, 96), 0.005), new THREE.MeshBasicMaterial({ color: 0xffcf5a, transparent: true, opacity: 0.85, depthWrite: false }))
    hitbox.visible = false
    const shadow = new THREE.Mesh(flat(new THREE.CircleGeometry(0.62, 48), 0.006), new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(0,0,0,0.8)'], [0.55, 'rgba(0,0,0,0.3)'], [1, 'rgba(0,0,0,0)']]), transparent: true, depthWrite: false }))
    const turntable = new THREE.Group()
    const sizer = new THREE.Group()
    turntable.rotation.y = START_ANGLE
    turntable.add(sizer)
    sizer.add(shadow)
    scene.add(glow, ring, hitbox, turntable)

    const state: Live = { renderer, scene, camera, sizer, turntable, glow, ring, hitbox, scale: 1, targetScale: 1, dirty: true }
    live.current = state

    // frame the whole body at three quarters of the height (smaller sizes keep the medium framing, so they read as small),
    // a little from above so the plinth reads
    const frame = () => {
      const s = Math.max(1, state.scale)
      const h = HERO_HEIGHT * s
      const t = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      const d = Math.max(h / (0.78 * t), (0.95 * s) / (0.7 * t * camera.aspect))
      camera.position.set(0, h * 0.62, d)
      camera.lookAt(0, h * 0.45, 0)
    }
    const resize = () => {
      const w = el.clientWidth || 1
      const hgt = el.clientHeight || 1
      renderer.setSize(w, hgt)
      camera.aspect = w / hgt
      camera.updateProjectionMatrix()
      frame()
      state.dirty = true
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    // only draw while on screen
    let visible = true
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      state.dirty = true
    })
    io.observe(el)

    // drag to turn; the turntable resumes a moment after the hand lets go
    let dragging = false
    let lastX = 0
    let spin = 0
    let resumeAt = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      spin = 0
      try {
        renderer.domElement.setPointerCapture(e.pointerId)
      } catch {
        // a synthetic pointer cannot be captured; dragging still works while over the stage
      }
    }
    const move = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      turntable.rotation.y += dx * 0.012
      spin = dx * 0.012 * FPS
      state.dirty = true
    }
    const up = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      resumeAt = performance.now() + 2500
      renderer.domElement.releasePointerCapture?.(e.pointerId)
    }
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)

    const clock = new THREE.Clock()
    let acc = 0
    renderer.setAnimationLoop(() => {
      const dt = Math.min(0.1, clock.getDelta())
      if (!visible) return
      acc += dt
      if (acc < 1 / FPS && !dragging) return
      const step = acc
      acc = 0
      const calm = reduced.current
      if (!calm) state.mixer?.update(step)
      if (!dragging && Math.abs(spin) > 0.01) {
        turntable.rotation.y += spin * step
        spin *= Math.pow(0.04, step)
      } else if (!dragging && !calm && performance.now() > resumeAt) {
        turntable.rotation.y += step * 0.26
      }
      if (Math.abs(state.scale - state.targetScale) > 0.002) {
        state.scale += (state.targetScale - state.scale) * Math.min(1, step * (calm ? 60 : 7))
        sizer.scale.setScalar(state.scale)
        frame()
        state.dirty = true
      }
      // reduced motion: nothing moves on its own, so only changes are drawn
      if (calm && !state.dirty && !dragging) return
      state.dirty = false
      renderer.render(scene, camera)
    })

    return () => {
      renderer.setAnimationLoop(null)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      state.mixer?.stopAllAction()
      if (state.model) disposeModel(state.model)
      for (const mesh of [glow, ring, hitbox, shadow]) {
        mesh.geometry.dispose()
        mesh.material.map?.dispose()
        mesh.material.dispose()
      }
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      live.current = undefined
    }
  }, [])

  // the hero itself: rebuilt when its build, parts or colours change
  const lookKey = look ? `${look.roleId}|${look.heroName}|${hue.toFixed(3)}` : 'stand-in'
  useEffect(() => {
    const state = live.current
    if (!state) return
    let cancelled = false
    const painted = look ? characterLook({ heroName: look.heroName, roleId: look.roleId } as Build, hue) : standInLook()
    const [r, g, b] = look ? ROLE_RGB[look.roleId] : [255, 207, 90]
    state.glow.material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
    state.glow.material.opacity = look ? 0.5 : 0.22
    characterFile(painted.build).then(
      (file: Gltf) => {
        if (cancelled || live.current !== state) return
        const model = cloneSkinned(file.scene)
        const material = look
          ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.06 })
          : new THREE.MeshStandardMaterial({ color: 0x1c1230, roughness: 0.42, metalness: 0.55, emissive: 0x140a22, emissiveIntensity: 0.6 })
        model.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh
          if (!mesh.isSkinnedMesh) return
          mesh.geometry = paintGeometry(mesh.geometry, painted)
          mesh.material = material
          mesh.frustumCulled = false
        })
        if (state.model) {
          state.mixer?.stopAllAction()
          state.sizer.remove(state.model)
          disposeModel(state.model)
        }
        const mixer = new THREE.AnimationMixer(model)
        const actions = new Map(file.animations.map((clip) => [clip.name, mixer.clipAction(clip)]))
        actions.get('idle')?.play()
        // a calm, natural pose when nothing should move
        mixer.update(reduced.current ? 0.6 : Math.random() * 2)
        state.sizer.add(model)
        Object.assign(state, { model, mixer, actions, dirty: true })
        setLoaded(true)
      },
      () => !cancelled && setFailed(true),
    )
    return () => {
      cancelled = true
    }
  }, [lookKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // size class: scale, and the hit capsule's radius as a ring (0.4 m at medium plus the class's extra)
  const ringed = hitbox && !!size
  useEffect(() => {
    const state = live.current
    if (!state) return
    state.targetScale = size ? SIZE_SCALE[size] : 1
    state.hitbox.visible = ringed
    state.ring.visible = !ringed
    if (size && ringed) state.hitbox.scale.setScalar(Math.max(0.25, 0.4 + SIZES[size].hitRadius))
    state.dirty = true
  }, [size, ringed])

  // a skill's cast: one play, then a blend back to idle
  useEffect(() => {
    const state = live.current
    if (!cue || !state?.mixer || !state.actions || reduced.current) return
    const action = state.actions.get(cue.clip)
    const idle = state.actions.get('idle')
    if (!action || !idle || action === idle) return
    const mixer = state.mixer
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    action.clampWhenFinished = false
    action.fadeIn(0.12).play()
    idle.fadeOut(0.12)
    const done = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== action) return
      mixer.removeEventListener('finished', done)
      idle.reset().fadeIn(0.3).play()
      action.fadeOut(0.3)
    }
    mixer.addEventListener('finished', done)
    return () => mixer.removeEventListener('finished', done)
  }, [cue?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  const role = look?.roleId
  return (
    <div
      ref={host}
      className={`hero-stage${role ? ` role-${role}` : ' is-empty'}${loaded ? ' is-loaded' : ''} ${className}`}
      role="img"
      aria-label={`3D preview of ${label}`}
      style={{ '--hue': `${Math.round(hue * 360)}deg` } as CSSProperties}
    >
      {failed && <span className="hero-stage-fallback">{label}</span>}
    </div>
  )
}

export default HeroStage
