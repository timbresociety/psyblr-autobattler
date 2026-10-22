import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Delivery } from '../../charter/types'
import type { EffectShape } from '../../forge/package'
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
  label: string
}

const CLIP_SECONDS = 1.6

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

/** Preview of the forged hero: mesh, the chosen motion, and the effect sprite in its cast window (U12). */
export function HeroViewer({ meshUrl, motionUrls = [], motion, effect, aura, label }: HeroViewerProps) {
  const host = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFailed(true)
      return
    }
    const width = el.clientWidth || 360
    const height = el.clientHeight || 360
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
    camera.position.set(0, 1.4, 4.2)
    camera.lookAt(0, 1, 0)
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1a22, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2)
    key.position.set(2, 4, 3)
    scene.add(key)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshStandardMaterial({ color: 0x15151c, roughness: 1 }))
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const stage = new THREE.Group()
    scene.add(stage)
    let mixer: THREE.AnimationMixer | undefined
    let pose: ((preset: string, t: number) => void) | undefined
    const preset = motion?.kind === 'preset' ? motion.preset : 'idle'

    let disposed = false
    const useMannequin = () => {
      if (disposed) return
      const m = mannequin()
      stage.add(m.root)
      pose = m.pose
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
        .catch(useMannequin)
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

    const clock = new THREE.Clock()
    const window_ = effect ? effectWindow(effect.delivery, CLIP_SECONDS) : undefined
    renderer.setAnimationLoop(() => {
      const dt = clock.getDelta()
      const t = clock.elapsedTime
      mixer?.update(dt)
      pose?.(preset, t)
      stage.rotation.y = Math.sin(t * 0.3) * 0.4
      if (sprite && window_) {
        const phase = t % CLIP_SECONDS
        sprite.visible = phase >= window_.start && phase <= window_.end
      }
      if (halo) halo.scale.setScalar(1 + Math.sin(t * 3) * 0.05)
      renderer.render(scene, camera)
    })

    return () => {
      disposed = true
      renderer.setAnimationLoop(null)
      renderer.dispose()
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh
        mesh.geometry?.dispose()
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
        for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) {
          ;(m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose()
          m.dispose()
        }
      })
      renderer.domElement.remove()
    }
  }, [meshUrl, motionUrls.join('|'), motion?.kind === 'clip' ? motion.url : motion?.preset, effect?.url, aura])

  return (
    <div className="hero-viewer" ref={host} role="img" aria-label={`3D preview of ${label}`}>
      {failed && <p className="hero-viewer-fallback">3D preview needs WebGL. The hero is still saved.</p>}
    </div>
  )
}
