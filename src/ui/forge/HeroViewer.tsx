import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { characterLook, paintGeometry } from '../../arena/client/character-look'
import type { Build } from '../../charter/build'
import type { Delivery } from '../../charter/types'
import type { Preset } from '../../forge/motion/library'
import type { EffectShape } from '../../forge/package'
import { characterFile } from '../arena/staging/loadout'
import { prefersReducedMotion } from '../arena/hud/format'
import { heroHue, type StageClip } from '../common/hero-look'
import { effectScale, effectWindow, pickAnimation, viewerSource, type MotionPlay } from './viewer'

export interface HeroViewerProps {
  /** The rigged GLB (or the motion GLB that carries the retargeted animations). */
  meshUrl?: string
  /** Extra GLBs whose animations are merged in (retarget batches). */
  motionUrls?: string[]
  motion?: MotionPlay
  effect?: { url: string; delivery: Pick<Delivery, 'kind' | 'range'>; shape: EffectShape }
  /** Aura or body element colour for the passive preview. */
  aura?: string
  /**
   * The hero's Charter build. While there is no real mesh (fake providers, offline, or still generating), the arena's
   * own character stands in, in the hero's colours, instead of a bare mannequin.
   */
  build?: Pick<Build, 'heroName' | 'roleId'>
  label: string
}

const CLIP_SECONDS = 1.6

/** The arena character's clip for a motion preset (it has no walk, jump, climb or turn of its own). */
const CLIP_FOR: Record<Preset, StageClip> = { idle: 'idle', walk: 'run', run: 'run', jump: 'hover', dive: 'fly', climb: 'hover', slash: 'slash', shoot: 'shoot', hurt: 'hurt', fall: 'fall', turn: 'idle' }
const LOOPING = new Set<string>(['idle', 'run', 'fly', 'hover'])

/** A capsule-and-sphere stand-in that poses procedurally, so fakes and offline mode still preview (KTD11). */
function mannequin(): { root: THREE.Group; pose: (preset: string, t: number) => void } {
  const root = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a8f9c, roughness: 0.55, metalness: 0.1 })
  const part = (geo: THREE.BufferGeometry, x: number, y: number) => {
    const mesh = new THREE.Mesh(geo, skin)
    mesh.position.set(x, y, 0)
    root.add(mesh)
    return mesh
  }
  part(new THREE.CapsuleGeometry(0.28, 0.6, 6, 12), 0, 1.15)
  part(new THREE.SphereGeometry(0.18, 16, 12), 0, 1.75)
  const armL = part(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), -0.4, 1.15)
  const armR = part(new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), 0.4, 1.15)
  const legL = part(new THREE.CapsuleGeometry(0.1, 0.65, 4, 8), -0.15, 0.45)
  const legR = part(new THREE.CapsuleGeometry(0.1, 0.65, 4, 8), 0.15, 0.45)
  const pose = (preset: string, t: number) => {
    const swing = Math.sin(t * (preset === 'run' ? 10 : preset === 'walk' ? 6 : 2))
    const stride = preset === 'run' ? 0.9 : preset === 'walk' ? 0.5 : 0.05
    legL.rotation.x = swing * stride
    legR.rotation.x = -swing * stride
    armL.rotation.x = -swing * stride
    armR.rotation.x = preset === 'slash' ? -Math.PI * (0.2 + 0.8 * Math.max(0, Math.sin(t * 4))) : preset === 'shoot' ? -Math.PI / 2 : swing * stride
    root.position.y = preset === 'jump' ? Math.max(0, Math.sin(t * 3)) * 0.6 : Math.abs(swing) * 0.02
  }
  return { root, pose }
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,207,90,0.55)')
  grad.addColorStop(0.45, 'rgba(255,170,90,0.18)')
  grad.addColorStop(1, 'rgba(255,170,90,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

/** Preview of the forged hero: mesh, the chosen motion, and the effect sprite in its cast window (U12). */
export function HeroViewer({ meshUrl, motionUrls = [], motion, effect, aura, build, label }: HeroViewerProps) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

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
    const width = el.clientWidth || 360
    const height = el.clientHeight || 360
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(width, height)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100)
    camera.position.set(0, 1.3, 3.7)
    camera.lookAt(0, 0.92, 0)
    scene.add(new THREE.HemisphereLight(0xffe9d6, 0x2b1b3c, 1.2))
    const key = new THREE.DirectionalLight(0xffe2c4, 2.4)
    key.position.set(2.4, 3.4, 3.2)
    const rim = new THREE.DirectionalLight(0x8fb8ff, 2.4)
    rim.position.set(-3.2, 2.8, -2.6)
    const warm = new THREE.DirectionalLight(0xffa36a, 1.6)
    warm.position.set(3.4, 2.2, -2.8)
    scene.add(key, rim, warm)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.7, 64), new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const stage = new THREE.Group()
    scene.add(stage)
    let mixer: THREE.AnimationMixer | undefined
    let pose: ((preset: string, t: number) => void) | undefined
    let oneShot: (() => void) | undefined
    const preset = motion?.kind === 'preset' ? motion.preset : 'idle'

    let disposed = false
    const useMannequin = () => {
      if (disposed) return
      const m = mannequin()
      stage.add(m.root)
      pose = m.pose
    }
    // the arena's character in the hero's colours, playing the closest clip it has to the chosen motion
    const useCharacter = (hero: Pick<Build, 'heroName' | 'roleId'>) => {
      const look = characterLook(hero as Build, heroHue(hero.heroName))
      characterFile(look.build)
        .then((file) => {
          if (disposed) return
          const model = cloneSkinned(file.scene)
          const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.06 })
          model.traverse((o) => {
            const mesh = o as THREE.SkinnedMesh
            if (!mesh.isSkinnedMesh) return
            mesh.geometry = paintGeometry(mesh.geometry, look)
            mesh.material = material
            mesh.frustumCulled = false
          })
          stage.add(model)
          mixer = new THREE.AnimationMixer(model)
          const names = file.animations.map((c) => c.name)
          const want = !motion ? 'idle' : motion.kind === 'preset' ? CLIP_FOR[motion.preset] : (pickAnimation(motion, names) ?? 'cast')
          const clip = file.animations.find((c) => c.name === want) ?? file.animations.find((c) => c.name === 'idle')
          const idleClip = file.animations.find((c) => c.name === 'idle')
          if (!clip) return
          const action = mixer.clipAction(clip)
          if (LOOPING.has(clip.name) || !idleClip) {
            action.play()
            return
          }
          // a one-off move replays every cycle from idle, so its impact lines up with the effect's cast window
          const idle = mixer.clipAction(idleClip)
          idle.play()
          const m = mixer
          m.addEventListener('finished', (e) => {
            if (e.action !== action) return
            idle.reset().fadeIn(0.2).play()
            action.fadeOut(0.2)
          })
          oneShot = () => {
            action.reset()
            action.setLoop(THREE.LoopOnce, 1)
            action.fadeIn(0.08).play()
            idle.fadeOut(0.08)
          }
          oneShot()
        })
        .catch(useMannequin)
    }
    if (viewerSource(meshUrl) === 'glb') {
      const loader = new GLTFLoader()
      Promise.all([meshUrl!, ...motionUrls.filter((u) => viewerSource(u) === 'glb')].map((u) => loader.loadAsync(u)))
        .then(([main, ...extra]) => {
          if (disposed) return
          stage.add(main.scene)
          const clips = [...main.animations, ...extra.flatMap((g) => g.animations)]
          const name = motion ? pickAnimation(motion, clips.map((c) => c.name)) : undefined
          const clip = clips.find((c) => c.name === name)
          if (clip) {
            mixer = new THREE.AnimationMixer(main.scene)
            mixer.clipAction(clip).play()
          }
        })
        .catch(build ? () => useCharacter(build) : useMannequin)
    } else if (build) {
      useCharacter(build)
    } else {
      useMannequin()
    }

    let sprite: THREE.Sprite | undefined
    if (effect) {
      const texture = new THREE.TextureLoader().load(effect.url)
      sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }))
      const size = effectScale(effect.shape)
      sprite.scale.set(Math.min(size.width, 6), Math.min(size.height, 6), 1)
      sprite.position.set(effect.shape.delivery === 'beam' ? size.width / 2 : 0, 1.1, effect.shape.delivery === 'aura' || effect.shape.delivery === 'self' ? 0 : 0.6)
      scene.add(sprite)
    }
    let halo: THREE.Mesh | undefined
    if (aura) {
      halo = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(aura), transparent: true, opacity: 0.7 }))
      halo.rotation.x = Math.PI / 2
      halo.position.y = 0.05
      scene.add(halo)
    }

    const timer = new THREE.Timer()
    const window_ = effect ? effectWindow(effect.delivery, CLIP_SECONDS) : undefined
    // the motion itself is what is being chosen, so it plays; only the idle sway stops for reduced motion
    const sway = prefersReducedMotion() ? 0 : 0.4
    let lastPhase = 0
    renderer.setAnimationLoop(() => {
      timer.update()
      const dt = timer.getDelta()
      const t = timer.getElapsed()
      const phase = t % CLIP_SECONDS
      if (oneShot && phase < lastPhase) oneShot()
      lastPhase = phase
      mixer?.update(dt)
      pose?.(preset, t)
      stage.rotation.y = Math.sin(t * 0.3) * sway
      if (sprite && window_) sprite.visible = phase >= window_.start && phase <= window_.end
      if (halo) halo.scale.setScalar(1 + Math.sin(t * 3) * 0.05)
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      renderer.setAnimationLoop(null)
      mixer?.stopAllAction()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          ;(m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose()
          m.dispose()
        }
      })
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [meshUrl, motionUrls.join('|'), motion?.kind === 'clip' ? motion.url : motion?.preset, effect?.url, aura, build?.heroName, build?.roleId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="hero-viewer" ref={host} role="img" aria-label={`3D preview of ${label}`}>
      {failed && <p className="hero-viewer-fallback">3D preview needs WebGL. The hero is still saved.</p>}
    </div>
  )
}
