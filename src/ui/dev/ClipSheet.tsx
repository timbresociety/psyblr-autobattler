import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { animClip, animIndex, fitClip, restPose, type RestPose } from '../../arena/client/anim-library'
import { buildModel } from '../../arena/client/body-model'
import { characterLook } from '../../arena/client/character-look'
import { heroHue } from '../../arena/client/characters'
import { libraryMoves } from '../../arena/client/library-gait'
import type { Build } from '../../charter/build'
import { defaultLook } from '../../charter/look'
import { AUDIT_BODIES } from '../../kit/bench/clips'
import { auditHeroes, reboundFile } from '../../kit/bench/hero-file'
import { characterFile } from '../arena/staging/loadout'

/**
 * The clip audit's contact sheets (`/dev/clips`, dev builds only; docs/plans/2026-11-05-session-1-handoff.md, step 3):
 * one clip on the six audit bodies, a row each, at evenly spaced frames, in plain clay so the silhouette reads, on a
 * floor grid with an arrow along the aim. `window.__sheet.draw({ clip })` resolves a JPEG data URL; `move` draws an
 * engine move as it plays (cut, turned, shifted) in place of a library clip, and `blade` holds a stand-in weapon.
 * `/dev/clips?heroes=1` adds the generated test heroes, in their own skins.
 */
interface SheetAsk {
  clip?: string
  move?: string
  columns?: number
  bodies?: readonly string[]
  /** Camera round the hero, radians: 0 behind it, as the player sees it, a quarter turn from its left side. */
  view?: number
  blade?: number
  from?: number
  to?: number
  /** The hips by the legs' true length, not standing height: what the audit tries on the generated heroes. */
  byLegs?: boolean
}

interface SheetBody {
  label: string
  gender: 'm' | 'f'
  model: THREE.Object3D
  rest: RestPose
  height: number
  mixer: THREE.AnimationMixer
  /** On a generated hero: how far the hips should move for the legs it has, against how far they do. */
  legs?: number
  build: string
}

const TILE = { width: 210, height: 270 }
const LABEL = 22

function aimArrow() {
  const group = new THREE.Group()
  const grid = new THREE.GridHelper(6, 12, 0x6d7a8c, 0x3a4250)
  group.add(grid)
  group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.01, 0), 1.4, 0xffb020, 0.3, 0.16))
  return group
}

async function loadBodies(): Promise<SheetBody[]> {
  const idx = await animIndex('standard')
  if (!idx) throw new Error('no library')
  const out: SheetBody[] = []
  const reference = new Map<string, THREE.Object3D>()
  for (const spec of AUDIT_BODIES) {
    const look = { ...defaultLook('fighter', spec.label, heroHue(spec.label)), gender: spec.gender, physique: spec.dials }
    const painted = characterLook({ heroName: spec.label, roleId: 'fighter', sizeClass: spec.body, look } as unknown as Build, 0.08)
    const file = await characterFile(painted.build)
    const model = cloneSkinned(file.scene)
    if (spec.label.endsWith('medium')) reference.set(spec.gender, cloneSkinned(file.scene))
    const clay = new THREE.MeshStandardMaterial({ color: spec.gender === 'f' ? 0xc9a58f : 0xa9b4c2, roughness: 0.7 })
    buildModel(model, painted, undefined, () => clay)
    const rest = restPose(model, idx.bones)
    if (!rest) throw new Error(`${spec.label}: no rest`)
    model.updateMatrixWorld(true)
    const head = model.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3())
    out.push({ label: spec.label, gender: spec.gender, model, rest, height: head.y + 0.15, mixer: new THREE.AnimationMixer(model), build: painted.build })
  }
  if (new URLSearchParams(location.search).has('heroes')) {
    for (const hero of await auditHeroes()) {
      const ours = reference.get(hero.gender)!
      const ref = idx.genders[hero.gender]!
      const { rebuilt } = await reboundFile(hero, ours, idx, (url) => new GLTFLoader().loadAsync(url))
      const reach = (o: THREE.Object3D) => ['LeftLeg', 'LeftFoot'].reduce((sum, n) => sum + o.getObjectByName(n)!.position.length(), 0)
      const legs = reach(rebuilt.root) / reach(ours) / (rebuilt.bones.get('Hips')!.position.y / ref.hips[1])
      const rest = { rotations: new Map(idx.bones.map((name, k) => [name, new THREE.Quaternion().fromArray(ref.rest[k] as number[])])), hips: rebuilt.bones.get('Hips')!.position.clone() }
      out.push({ label: hero.label, gender: hero.gender, model: rebuilt.root, rest, height: hero.height, mixer: new THREE.AnimationMixer(rebuilt.root), build: hero.label, legs })
    }
  }
  return out
}

export function ClipSheet() {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState('Loading six bodies…')
  useEffect(() => {
    let gone = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(1)
    host.current?.append(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1b1f27)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 2.2)
    sun.position.set(2, 5, -3)
    scene.add(sun, aimArrow())
    const camera = new THREE.PerspectiveCamera(28, TILE.width / TILE.height, 0.05, 80)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 1), new THREE.MeshStandardMaterial({ color: 0xff4f6a, roughness: 0.4 }))
    const bodies = loadBodies()
    const moves = new Map<string, Promise<Map<string, THREE.AnimationClip>>>()
    const movesOf = (g: 'm' | 'f') => {
      let m = moves.get(g)
      if (!m) moves.set(g, (m = libraryMoves(g, 'standard')))
      return m
    }

    const fitted = async (ask: SheetAsk, b: SheetBody) => {
      const source = ask.move ? (await movesOf(b.gender)).get(ask.move) : await animClip(b.gender, ask.clip!, 'standard').catch(() => undefined)
      if (!source) return undefined
      const clip = fitClip(source, b.gender, b.build, b.rest, 'standard')
      if (!ask.byLegs || !b.legs) return clip
      const out = clip.clone()
      const track = out.tracks.find((t) => t.name === 'Hips.position')!
      const rest = b.rest.hips.toArray()
      for (let i = 0; i < track.values.length; i++) track.values[i] = rest[i % 3] + (track.values[i] - rest[i % 3]) * b.legs
      return out
    }

    /** The metres the skin itself goes under the floor at its worst, by body: bones can't say this for a deep chest or a big head. */
    const low = async (ask: SheetAsk) => {
      const out: Record<string, { depth: number; at: number }> = {}
      const point = new THREE.Vector3()
      for (const b of (await bodies).filter((x) => !ask.bodies || ask.bodies.includes(x.label))) {
        const clip = await fitted(ask, b)
        if (!clip) continue
        const skins: THREE.SkinnedMesh[] = []
        b.model.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skins.push(o as THREE.SkinnedMesh) })
        b.mixer.stopAllAction()
        const action = b.mixer.clipAction(clip)
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        let depth = 0, at = 0
        for (let time = 0; time < clip.duration; time += 1 / 12) {
          action.time = time
          b.mixer.update(0)
          b.model.updateMatrixWorld(true)
          for (const mesh of skins) {
            mesh.skeleton.update()
            const count = mesh.geometry.getAttribute('position').count
            for (let i = 0; i < count; i += 16) {
              mesh.getVertexPosition(i, point)
              if (point.y < depth) { depth = point.y; at = time }
            }
          }
        }
        out[b.label] = { depth: +depth.toFixed(3), at: +at.toFixed(2) }
        b.mixer.stopAllAction()
        b.mixer.uncacheClip(clip)
      }
      return out
    }

    const draw = async (ask: SheetAsk) => {
      const columns = ask.columns ?? 8
      const list = (await bodies).filter((b) => !ask.bodies || ask.bodies.includes(b.label))
      const width = columns * TILE.width
      const height = list.length * (TILE.height + LABEL)
      renderer.setSize(width, height, false)
      renderer.setScissorTest(true)
      const paper = document.createElement('canvas')
      paper.width = width
      paper.height = height
      const pen = paper.getContext('2d')!
      pen.fillStyle = '#10131a'
      pen.fillRect(0, 0, width, height)
      pen.font = '13px sans-serif'
      const view = ask.view ?? 0.55
      for (const [row, b] of list.entries()) {
        const clip = await fitted(ask, b)
        const y = row * (TILE.height + LABEL)
        pen.fillStyle = '#e8edf5'
        if (!clip) {
          pen.fillText(`${b.label}: no clip`, 8, y + 16)
          continue
        }
        b.mixer.stopAllAction()
        const action = b.mixer.clipAction(clip)
        action.setLoop(THREE.LoopOnce, 1)
        action.clampWhenFinished = true
        action.play()
        scene.add(b.model)
        const hand = b.model.getObjectByName('RightHand')
        const from = ask.from ?? 0
        const to = Math.min(ask.to ?? clip.duration, clip.duration)
        for (let c = 0; c < columns; c++) {
          const time = from + ((to - from) * c) / Math.max(1, columns - 1)
          action.time = Math.min(time, clip.duration - 1e-3)
          b.mixer.update(0)
          b.model.updateMatrixWorld(true)
          if (ask.blade && hand) {
            const a = b.model.getObjectByName('RightHandPinky1')!.getWorldPosition(new THREE.Vector3())
            const z = b.model.getObjectByName('RightHandIndex1')!.getWorldPosition(new THREE.Vector3())
            const at = hand.getWorldPosition(new THREE.Vector3())
            const dir = z.sub(a).normalize()
            blade.scale.z = ask.blade
            blade.position.copy(at).addScaledVector(dir, ask.blade / 2)
            blade.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir)
            scene.add(blade)
          } else scene.remove(blade)
          const hips = b.model.getObjectByName('Hips')!.getWorldPosition(new THREE.Vector3())
          const reach = b.height * 3.5
          const look = new THREE.Vector3(0, Math.max(b.height * 0.5, hips.y), 0)
          camera.position.set(Math.sin(view) * reach, look.y + b.height * 0.45, -Math.cos(view) * reach)
          camera.lookAt(look)
          const x = c * TILE.width
          const top = height - (y + LABEL + TILE.height)
          renderer.setViewport(x, top, TILE.width, TILE.height)
          renderer.setScissor(x, top, TILE.width, TILE.height)
          renderer.render(scene, camera)
          pen.drawImage(renderer.domElement, x, y + LABEL, TILE.width, TILE.height, x, y + LABEL, TILE.width, TILE.height)
          pen.fillStyle = '#e8edf5'
          pen.fillText(c === 0 ? `${b.label} ${time.toFixed(2)}s` : `${time.toFixed(2)}s`, x + 6, y + 16)
        }
        scene.remove(b.model)
        scene.remove(blade)
        b.mixer.stopAllAction()
        b.mixer.uncacheClip(clip)
      }
      return paper.toDataURL('image/jpeg', 0.82)
    }
    ;(window as unknown as { __sheet?: { draw: typeof draw; low: typeof low; ready: Promise<unknown> } }).__sheet = { draw, low, ready: bodies }
    bodies.then(
      () => !gone && setState('Ready: window.__sheet.draw({ clip })'),
      (e: Error) => !gone && setState(`Failed: ${e.message}`),
    )
    return () => {
      gone = true
      renderer.dispose()
    }
  }, [])
  return (
    <main style={{ padding: 16 }}>
      <p>{state}</p>
      <div ref={host} />
    </main>
  )
}
