import { useEffect, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { animClip, animIndex, fitClip, restPose, setOf, type RestPose } from '../../arena/client/anim-library.js'
import { characterLook, classicCharacterMaterial, type BodyName, type CharacterLook, type Gltf } from '../../arena/client/character-look.js'
import { heroAtlas } from '../../arena/client/face/hero-face.js'
import { restClothOn, settleCloth } from '../../arena/client/wear/cloth-model.js'
import { classicClothMaterial, classicPrintMaterial, dressModel } from '../../arena/client/wear/dress-model.js'
import { loadWear } from '../../arena/client/wear/items.js'
import type { Gender, HeroLook } from '../../charter/look.js'
import { SIZE_SCALE } from '../../arena/demo/procedural-hero'
import type { Build } from '../../charter/build'
import { SIZES, type SizeClass } from '../../charter/sizes'
import type { RoleId } from '../../charter/types'
import { prefersReducedMotion } from '../arena/hud/format'
import { characterFile, modelFile } from '../arena/staging/loadout'
import { ROLE_RGB, type StageClip } from './hero-look'

/**
 * The hero on a lit plinth: the arena's own character in the hero's colours and parts (character-look), standing in
 * its motion-captured idle (anim-library) on a slow turntable. Drag turns it; a cue plays one clip (a skill's cast) and
 * returns to idle; `play` loops a clip from the motion library instead. In the studio (the Forge's creator) the hero
 * faces the camera and holds still, the camera frames the body, the bust or the face, the wheel zooms, and a room's
 * light falls on it. One classic WebGL context, drawn at most 30 times a second (60 in the studio) and only while on
 * screen, released on unmount.
 */

/** What the camera frames: the whole body, the head and shoulders, or the face close up. */
export type StageFraming = 'body' | 'bust' | 'face'

export interface HeroStageProps {
  /** The hero to show: its name, role, size and look pick the body and dress it. Without one, a dark stand-in waits. */
  look?: { heroName: string; roleId: RoleId; sizeClass?: SizeClass; look?: HeroLook }
  hue?: number
  /** Plays one clip, then back to idle. A new `at` replays the same clip. */
  cue?: { clip: StageClip; at: number }
  /** Draws the hero at a size class's scale. */
  size?: SizeClass
  /** With `size`, rings the plinth with the hit capsule's real radius (the Forge's size picker). */
  hitbox?: boolean
  /** Holds the hero at this angle (radians, 0 facing the camera) instead of turning it slowly; a drag still turns it. */
  facing?: number
  /** Plays everything, clips and cloth, at this fraction of real time: slow motion for a dev bench. */
  speed?: number
  /** The creator's studio: facing the camera, room light, framing and zoom, drawn at 60 a second. */
  studio?: boolean
  /** What the camera frames (the studio); the whole body by default. */
  framing?: StageFraming
  /** A clip from the motion library to loop in place of the idle (the creator's moves). */
  play?: string
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
  /** The motion-library clip standing in for the file's idle: its name and action. */
  motion?: { name: string; action: THREE.AnimationAction }
  /** The model's body and gender, for fitting library clips to it. */
  body?: BodyName
  gender?: Gender
  /** The head as dressed, along its bone (headSpan), for the bust and face framings. */
  head?: HeadSpan
  scale: number
  targetScale: number
  /** A turn the turntable eases to (the studio's facing); a drag lets go of it. */
  turnTo?: number
  zoom: number
  dirty: boolean
}

const FPS = 30
const STUDIO_FPS = 60
const HERO_HEIGHT = 1.8
const START_ANGLE = 0.38
/** What each close framing fills the frame with, in heads (chin to crown), and how many heads below the head's middle it centres. */
const FRAMES: Record<Exclude<StageFraming, 'body'>, { heads: number; below: number }> = { bust: { heads: 3.6, below: 0.85 }, face: { heads: 1.8, below: 0 } }
const ZOOM = { min: 0.55, max: 1.7 }

/**
 * A clip from the motion library for a model whose rest pose is `rest`: the named one, its gender's first idle when
 * the library hasn't got it (or, for a `stance`, when the library no longer counts it a stance), or undefined when
 * the library can't load.
 */
async function libraryClip(gender: Gender, name: string, body: string, rest: RestPose | undefined, stance: boolean): Promise<THREE.AnimationClip | undefined> {
  if (!rest) return undefined
  const idx = await animIndex()
  const pick = stance && idx && setOf(idx, gender, name) !== 'idle' ? 'idle' : name
  const clip = (await animClip(gender, pick).catch(() => undefined)) ?? (pick === 'idle' ? undefined : await animClip(gender, 'idle').catch(() => undefined))
  return clip && fitClip(clip, gender, body, rest)
}

interface HeadSpan {
  /** The lowest and highest the head reaches along its bone, in the bone's own units: about the chin and the crown. */
  lo: number
  hi: number
}

/**
 * The head as dressed (sculpted, sized), measured on the body mesh along the head bone: every vertex the head carries
 * more than half of, at rest. Undefined for a model without a head bone.
 */
function headSpan(model: THREE.Object3D): HeadSpan | undefined {
  let mesh: THREE.SkinnedMesh | undefined
  model.traverse((o) => {
    if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh
  })
  const k = mesh ? mesh.skeleton.bones.findIndex((b) => b.name === 'head') : -1
  if (!mesh || k < 0) return undefined
  const geo = mesh.geometry
  const pos = geo.getAttribute('position')
  const joints = geo.getAttribute('skinIndex')
  const weights = geo.getAttribute('skinWeight')
  const toBone = mesh.skeleton.boneInverses[k].clone().multiply(mesh.bindMatrix)
  const v = new THREE.Vector3()
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < pos.count; i++) {
    let w = 0
    for (let c = 0; c < 4; c++) if (joints.getComponent(i, c) === k) w += weights.getComponent(i, c)
    if (w <= 0.5) continue
    v.fromBufferAttribute(pos, i).applyMatrix4(toBone)
    lo = Math.min(lo, v.y)
    hi = Math.max(hi, v.y)
  }
  return hi > lo ? { lo, hi } : undefined
}

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

/** A neutral figure for the empty stage: a generic body, nothing worn. */
function standInLook(): CharacterLook {
  return { ...characterLook({ heroName: 'Hero', roleId: 'assassin' } as Build, 0.7), build: 'm-medium', outfit: {} }
}

function disposeModel(model: THREE.Object3D) {
  const materials = new Set<THREE.Material>()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    // the painted geometry is ours; its buffers are shared with the cached file, which only this renderer uploaded
    mesh.geometry.dispose()
    // so is each clone's skeleton (the outfit's own, when its cloth hangs on bones of its own)
    ;(o as THREE.SkinnedMesh).skeleton?.dispose()
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m)
  })
  materials.forEach((m) => m.dispose())
}

export function HeroStage({ look, hue = 0.08, cue, size, hitbox = false, facing, speed = 1, studio = false, framing = 'body', play, label, className = '' }: HeroStageProps) {
  const host = useRef<HTMLDivElement>(null)
  const live = useRef<Live | undefined>(undefined)
  const pace = useRef({ facing, speed, studio, framing })
  pace.current = { facing, speed, studio, framing }
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const reduced = useRef(prefersReducedMotion())
  // the clip the hero should be in: one being played, else its stance
  const want = play ?? look?.look?.idle ?? 'idle'
  const stance = play === undefined
  const wanted = useRef({ name: want, stance })
  wanted.current = { name: want, stance }

  // the renderer, lights, plinth and loop: once per mount
  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      if (typeof WebGL2RenderingContext === 'undefined') throw new Error('no WebGL2')
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: pace.current.studio ? 'default' : 'low-power' })
    } catch {
      setFailed(true)
      return
    }
    const studioMode = pace.current.studio
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, studioMode ? 2 : 1.75))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = studioMode ? 1 : 1.06
    renderer.setClearColor(0x000000, 0)
    renderer.domElement.setAttribute('aria-hidden', 'true')
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60)
    // the studio: a soft room lights skin and cloth from every side, so the key and rims can be gentler
    let environment: THREE.Texture | undefined
    if (studioMode) {
      const pmrem = new THREE.PMREMGenerator(renderer)
      environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      scene.environment = environment
      scene.environmentIntensity = 0.45
    }
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x2b1b3c, studioMode ? 0.7 : 1.25))
    const key = new THREE.DirectionalLight(0xffe2c4, studioMode ? 2.2 : 2.6)
    key.position.set(studioMode ? 1.6 : 2.4, 3.4, 3.2)
    const rimCool = new THREE.DirectionalLight(0x8fb8ff, studioMode ? 2.2 : 2.8)
    rimCool.position.set(-3.2, 2.8, -2.6)
    const rimWarm = new THREE.DirectionalLight(0xffa36a, studioMode ? 1.6 : 2.1)
    rimWarm.position.set(3.4, 2.2, -2.8)
    const fill = new THREE.DirectionalLight(0xc8b6ff, studioMode ? 0.7 : 0.55)
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
    glow.name = 'plinth glow'
    ring.name = 'plinth ring'
    hitbox.name = 'hitbox ring'
    shadow.name = 'contact shadow'
    const turntable = new THREE.Group()
    const sizer = new THREE.Group()
    turntable.rotation.y = pace.current.facing ?? (studioMode ? 0 : START_ANGLE)
    turntable.add(sizer)
    sizer.add(shadow)
    scene.add(glow, ring, hitbox, turntable)

    const state: Live = { renderer, scene, camera, sizer, turntable, glow, ring, hitbox, scale: 1, targetScale: 1, zoom: 1, dirty: true }
    live.current = state

    // dev only: `__probe` can read this close-up with rays (src/arena/client/probe.ts; never in production)
    let unprobe: (() => void) | undefined
    let unmounted = false
    // and `__stages` holds each stage's live state by its label, for checks that read the turntable and the motion
    const stages = ((globalThis as { __stages?: Map<string, Live> }).__stages ??= new Map())
    if (import.meta.env.DEV) stages.set(label, state)
    if (import.meta.env.DEV)
      void import('../../arena/client/probe.js').then(({ watch }) => {
        const name = label ?? 'hero'
        if (!unmounted) unprobe = watch(`stage:${name}`, { scene, camera, canvas: renderer.domElement, heroes: () => (state.model ? [{ root: state.model, name }] : []) })
      })

    // where the camera wants to be: the whole body at three quarters of the height (smaller sizes keep the medium
    // framing, so they read as small), a little from above so the plinth reads; or the bust or face, following the head
    const t = () => 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const eye = new THREE.Vector3()
    const aim = new THREE.Vector3()
    const chin = new THREE.Vector3()
    const crown = new THREE.Vector3()
    const goal = { eye: new THREE.Vector3(), aim: new THREE.Vector3() }
    let snapped = false
    const aimAt = () => {
      const s = Math.max(1, state.scale)
      const framingNow = pace.current.framing
      const bone = framingNow === 'body' || !state.head ? undefined : state.model?.getObjectByName('head')
      if (bone && state.head) {
        const f = FRAMES[framingNow as Exclude<StageFraming, 'body'>]
        // the head as it is now, chin to crown, wherever the clip has it (and however big the hero and its head)
        bone.updateWorldMatrix(true, false)
        chin.set(0, state.head.lo, 0).applyMatrix4(bone.matrixWorld)
        crown.set(0, state.head.hi, 0).applyMatrix4(bone.matrixWorld)
        const size = chin.distanceTo(crown)
        const d = (f.heads * size * state.zoom) / t()
        goal.aim.set((chin.x + crown.x) / 2, (chin.y + crown.y) / 2 - f.below * size, (chin.z + crown.z) / 2)
        goal.eye.set(goal.aim.x, goal.aim.y + d * 0.05, goal.aim.z + d)
        return
      }
      const h = HERO_HEIGHT * s
      const d = Math.max(h / (0.78 * t()), (0.95 * s) / (0.7 * t() * camera.aspect)) * state.zoom
      goal.aim.set(0, h * 0.45, 0)
      goal.eye.set(0, h * 0.62 - (1 - state.zoom) * h * 0.1, d)
    }
    const place = (blend: number) => {
      aimAt()
      if (!snapped || blend >= 1) {
        eye.copy(goal.eye)
        aim.copy(goal.aim)
        snapped = true
      } else {
        eye.lerp(goal.eye, blend)
        aim.lerp(goal.aim, blend)
      }
      camera.position.copy(eye)
      camera.lookAt(aim)
    }
    const resize = () => {
      const w = el.clientWidth || 1
      const hgt = el.clientHeight || 1
      renderer.setSize(w, hgt)
      camera.aspect = w / hgt
      camera.updateProjectionMatrix()
      place(1)
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

    // drag to turn; the turntable resumes a moment after the hand lets go; in the studio the wheel zooms
    let dragging = false
    let lastX = 0
    let spin = 0
    let resumeAt = 0
    const down = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      spin = 0
      state.turnTo = undefined
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
    const wheel = (e: WheelEvent) => {
      if (!pace.current.studio) return
      e.preventDefault()
      state.zoom = THREE.MathUtils.clamp(state.zoom * Math.exp(e.deltaY * 0.0012), ZOOM.min, ZOOM.max)
      state.dirty = true
    }
    const canvas = renderer.domElement
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('wheel', wheel, { passive: false })

    const timer = new THREE.Timer()
    let acc = 0
    renderer.setAnimationLoop(() => {
      timer.update()
      const dt = Math.min(0.1, timer.getDelta())
      if (!visible) return
      acc += dt
      const studioNow = pace.current.studio
      if (acc < 1 / (studioNow ? STUDIO_FPS : FPS) && !dragging) return
      const step = acc * pace.current.speed
      const real = acc
      acc = 0
      const calm = reduced.current
      if (!calm) state.mixer?.update(step)
      if (!dragging && Math.abs(spin) > 0.01) {
        turntable.rotation.y += spin * step
        spin *= Math.pow(0.04, step)
      } else if (!dragging && state.turnTo !== undefined) {
        // the studio's facing: ease round the short way, then hold
        const gap = Math.atan2(Math.sin(state.turnTo - turntable.rotation.y), Math.cos(state.turnTo - turntable.rotation.y))
        turntable.rotation.y += gap * Math.min(1, real * (calm ? 60 : 6))
        if (Math.abs(gap) < 0.002) {
          turntable.rotation.y = state.turnTo
          state.turnTo = undefined
        }
        state.dirty = true
      } else if (!dragging && !calm && !studioNow && pace.current.facing === undefined && performance.now() > resumeAt) {
        turntable.rotation.y += step * 0.26
      }
      if (Math.abs(state.scale - state.targetScale) > 0.002) {
        state.scale += (state.targetScale - state.scale) * Math.min(1, step * (calm ? 60 : 7))
        sizer.scale.setScalar(state.scale)
        state.dirty = true
      }
      // reduced motion: nothing moves on its own, so only changes are drawn
      if (calm && !state.dirty && !dragging) return
      state.dirty = false
      // the outfit's loose cloth swings with the turntable and the idle, or holds still under reduced motion
      if (state.model) {
        if (calm) restClothOn(state.model)
        else settleCloth(state.model, step)
      }
      state.model?.updateMatrixWorld(true)
      place(calm ? 1 : 1 - Math.exp(-real * 7))
      renderer.render(scene, camera)
    })

    return () => {
      unmounted = true
      unprobe?.()
      if (stages.get(label) === state) stages.delete(label)
      renderer.setAnimationLoop(null)
      ro.disconnect()
      io.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('wheel', wheel)
      state.mixer?.stopAllAction()
      if (state.model) disposeModel(state.model)
      for (const mesh of [glow, ring, hitbox, shadow]) {
        mesh.geometry.dispose()
        mesh.material.map?.dispose()
        mesh.material.dispose()
      }
      environment?.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
      live.current = undefined
    }
  }, [])

  // the hero itself: rebuilt when its body (size, gender), parts, colours or face change
  const lookKey = look ? `${look.roleId}|${look.heroName}|${look.sizeClass ?? 'medium'}|${hue.toFixed(3)}|${JSON.stringify(look.look ?? null)}` : 'stand-in'
  useEffect(() => {
    const state = live.current
    if (!state) return
    let cancelled = false
    const painted = look ? characterLook({ heroName: look.heroName, roleId: look.roleId, sizeClass: look.sizeClass, look: look.look } as Build, hue) : standInLook()
    const gender = painted.build.charAt(0) as Gender
    const [r, g, b] = look ? ROLE_RGB[look.roleId] : [255, 207, 90]
    state.glow.material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
    state.glow.material.opacity = look ? 0.5 : 0.22
    characterFile(painted.build)
      .then(async (file: Gltf) => {
        const [atlas, wear, idx] = await Promise.all([look ? heroAtlas(file, painted) : null, look ? loadWear(painted.build, painted.outfit, modelFile) : undefined, animIndex()])
        if (cancelled || live.current !== state) return undefined
        const model = cloneSkinned(file.scene)
        // its rest, read before anything moves it, fits the library's clips to this body
        const rest = idx ? restPose(model, idx.bones) : undefined
        const clip = await libraryClip(gender, wanted.current.name, painted.build, rest, wanted.current.stance)
        return { file, atlas, wear, model, rest, clip }
      })
      .then(
        (made) => {
          if (!made || cancelled || live.current !== state) return
          const { file, atlas, wear, model, clip } = made
          // the hero in its own atlas, colours and outfit; the empty stage keeps a dark, glossy silhouette
          const empty = new THREE.MeshStandardMaterial({ color: 0x1c1230, roughness: 0.42, metalness: 0.55, emissive: 0x140a22, emissiveIntensity: 0.6 })
          const body = (map: THREE.Texture | null, normalMap: THREE.Texture | null) => (look ? classicCharacterMaterial(map, normalMap) : empty)
          dressModel(model, painted, wear, { body, cloth: (map) => (look ? classicClothMaterial(map) : empty), print: (print) => (look ? classicPrintMaterial(print) : empty) }, atlas)
          // a rebuilt hero (a slider moved) carries on from where the last one was in its clip
          const was = state.motion
          const time = was && clip && was.name === clip.name ? was.action.time : undefined
          if (state.model) {
            state.mixer?.stopAllAction()
            state.sizer.remove(state.model)
            disposeModel(state.model)
          }
          const mixer = new THREE.AnimationMixer(model)
          const actions = new Map(file.animations.map((c) => [c.name, mixer.clipAction(c)]))
          let motion: Live['motion']
          if (clip) {
            const action = mixer.clipAction(clip)
            action.play()
            motion = { name: clip.name, action }
            if (time !== undefined) action.time = time
            else mixer.update(reduced.current ? 0 : Math.random() * Math.min(2, clip.duration))
          } else {
            actions.get('idle')?.play()
            // a calm, natural pose when nothing should move
            mixer.update(reduced.current ? 0.6 : Math.random() * 2)
          }
          if (time !== undefined) mixer.update(0)
          state.sizer.add(model)
          Object.assign(state, { model, mixer, actions, motion, body: painted.build, gender, head: headSpan(model), dirty: true })
          setLoaded(true)
        },
        () => !cancelled && setFailed(true),
      )
    return () => {
      cancelled = true
    }
  }, [lookKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // a clip from the library in place of the idle, or back to the idle: crossfaded on the hero as it stands
  useEffect(() => {
    const state = live.current
    if (!state?.model || !state.mixer || !state.gender || !state.body || state.motion?.name === want) return
    let cancelled = false
    const { model, mixer, gender, body } = state
    void animIndex().then(async (idx) => {
      // the rest is read off the file's own scene: the model on stage is mid-clip
      const file = await characterFile(body)
      const rest = idx ? restPose(file.scene, idx.bones) : undefined
      const clip = await libraryClip(gender, want, body, rest, stance)
      if (cancelled || !clip || state.model !== model || state.motion?.name === clip.name) return
      const action = mixer.clipAction(clip)
      action.reset().fadeIn(0.35).play()
      const from = state.motion?.action ?? state.actions?.get('idle')
      from?.fadeOut(0.35)
      state.motion = { name: clip.name, action }
      state.dirty = true
    })
    return () => {
      cancelled = true
    }
  }, [want, loaded])

  // the studio's facing: the turntable eases to it
  useEffect(() => {
    const state = live.current
    if (!state || facing === undefined) return
    state.turnTo = facing
    state.dirty = true
  }, [facing])

  // a new framing starts at its natural zoom
  useEffect(() => {
    const state = live.current
    if (!state) return
    state.zoom = 1
    state.dirty = true
  }, [framing])

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

  // a skill's cast: one play, then a blend back to the idle (the library's, or the file's)
  useEffect(() => {
    const state = live.current
    if (!cue || !state?.mixer || !state.actions || reduced.current) return
    const action = state.actions.get(cue.clip)
    const idle = state.motion?.action ?? state.actions.get('idle')
    if (!action || !idle || action === idle) return
    const mixer = state.mixer
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)
    // held on its last frame while idle fades back in: let go, the body would blend toward its bind pose meanwhile
    action.clampWhenFinished = true
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
      className={`hero-stage${role ? ` role-${role}` : ' is-empty'}${loaded ? ' is-loaded' : ''}${studio ? ' is-studio' : ''} ${className}`}
      role="img"
      aria-label={`3D preview of ${label}`}
      style={{ '--hue': `${Math.round(hue * 360)}deg` } as CSSProperties}
    >
      {failed && <span className="hero-stage-fallback">{label}</span>}
    </div>
  )
}

export default HeroStage
