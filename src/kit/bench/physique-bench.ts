import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { toClip, type ClipFile } from '../../arena/client/anim-library.js'
import type { AnimIndex } from '../../arena/client/anim-index.js'
import { fixups } from '../../arena/client/metarig/fixups.js'
import { applyPosture } from '../../arena/client/metarig/posture.js'
import { meshRest } from '../../arena/client/metarig/upgrade.js'
import { proportion } from '../../arena/client/wear/proportions.js'
import { preset, type ArchetypeId } from '../body/physique.js'
import { boneSet, girth, share, type Skeleton, type Skin } from '../body/regions.js'
import { bodyBase, shapeBody } from '../body/shape.js'
import { bodySpread, extraSpread } from '../body/spread.js'
import { gripWeight } from '../rig/aim.js'
import { JOINT_LIMITS, limitExcess } from '../rig/limits.js'
import { retargetClip } from '../rig/retarget.js'
import { benchModel } from './model.js'

/**
 * The physique test bench (GAME.md §9.7), headless: every archetype × the key clips, played on the archetype's own
 * body through the game's own proportions, posture, retargeting and fix-ups, and scored so regressions show as
 * numbers. Each score is taken on the clip as retargeted (`raw`) and after the fix-ups (`fixed`), so the fix-ups'
 * worth shows too. Lengths are the body file's metres (a hero's height scale multiplies them all alike).
 *
 * - limits: bone-frames past a joint limit by more than a degree, and the worst excess, in degrees;
 * - penetration: the deepest an arm or leg capsule goes into the torso or the other leg, in centimetres, and the share
 *   of frames deeper than one;
 * - foot slide: how far a planted foot's ground speed strays from its steady speed (clips run in place), cm/s;
 * - ground: the lowest sole's median height off the floor over the clip, centimetres (minus is sunk);
 * - grip: the off hand's distance from a two-handed grip, where the clip means both hands on it, centimetres.
 */

/** The key clips (§9.7) by the library's names; undefined where the library has none yet. */
export const BENCH_CLIPS: Readonly<Record<string, string | undefined>> = {
  combo: 'punch_combo',
  heavy: 'two_hand_sword_combo',
  block: 'standing_block_idle',
  cast: 'magic_standing_2h_cast_spell_01',
  jog: 'jog',
  run: 'run',
  sprint: 'sprint_forward',
  slide: 'running_slide_pose',
  mantle: undefined,
  landRoll: 'falling_to_roll',
  hitReact: 'hit_to_body',
  getUp: 'getting_up',
  jump: 'jump',
}
/** Clips meant with both hands on one weapon. */
const TWO_HANDED = new Set(['two_hand_sword_combo'])
/** Clips that keep a foot on the ground throughout, so the ground score means something. */
const GROUNDED = new Set(['punch_combo', 'two_hand_sword_combo', 'standing_block_idle', 'magic_standing_2h_cast_spell_01', 'hit_to_body'])

export interface Scores {
  limits: { violations: number; worst: number }
  penetration: { worst: number; frames: number }
  grip?: number
}
export interface ClipScore {
  clip: string
  frames: number
  raw: Scores
  fixed: Scores
  footSlide: number
  ground?: number
}
export interface ArchetypeScore {
  archetype: ArchetypeId
  body: string
  spread: { arm: number; leg: number }
  clips: Record<string, ClipScore | 'missing'>
}

const ANIM = 'public/anim/standard'
const SPAN = 0.2
const DEG = 180 / Math.PI

/** The torso's half width and half depth at a height, about the body's middle (skin mostly on the back's bones). */
function torsoSection(skin: Skin, skeleton: Skeleton, y: number) {
  const set = boneSet(skeleton, ['Hips', 'Spine', 'Spine1', 'Spine2'])
  const xs: number[] = []
  const zs: number[] = []
  for (let i = 0; i < skin.positions.length / 3; i++) {
    if ((skin.skin && !skin.skin[i]) || Math.abs(skin.positions[i * 3 + 1] - y) > 0.03 || share(skin, i, set) < 0.6) continue
    xs.push(Math.abs(skin.positions[i * 3]))
    zs.push(skin.positions[i * 3 + 2])
  }
  const pct = (v: number[], p: number) => [...v].sort((a, b) => a - b)[Math.floor((v.length - 1) * p)] ?? 0
  const mid = (pct(zs, 0.97) + pct(zs, 0.03)) / 2
  return { width: pct(xs, 0.95), depth: pct(zs.map((z) => Math.abs(z - mid)), 0.95) }
}

interface Capsule {
  from: string
  to: string
  radius: number
  /** The share of the segment from `from` that is left out (where a limb joins the body it's measured against). */
  skip: number
}

const w = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]

/** The closest points' distance between two segments. */
function segmentDistance(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3): number {
  const d1 = w[0].subVectors(q1, p1)
  const d2 = w[1].subVectors(q2, p2)
  const r = w[2].subVectors(p1, p2)
  const a = d1.dot(d1)
  const e = d2.dot(d2)
  const f = d2.dot(r)
  const c = d1.dot(r)
  const b = d1.dot(d2)
  const den = a * e - b * b
  let s = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0
  let t = (b * s + f) / e
  if (t < 0) (t = 0), (s = THREE.MathUtils.clamp(-c / a, 0, 1))
  else if (t > 1) (t = 1), (s = THREE.MathUtils.clamp((b - c) / a, 0, 1))
  const c1 = w[3].copy(p1).addScaledVector(d1, s)
  const c2 = w[4].copy(p2).addScaledVector(d2, t)
  return c1.distanceTo(c2)
}

export async function benchArchetype(id: ArchetypeId, clips: Readonly<Record<string, string | undefined>> = BENCH_CLIPS): Promise<ArchetypeScore> {
  const p = preset(id)
  const g = p.gender
  const body = `${g}-${p.body}`
  const { model, mesh, file, morphNames } = await benchModel(`public/heroes/v2/${body}.glb`)
  const dials = { ...p.dials }
  const shaped = shapeBody(bodyBase(file), morphNames, dials, undefined, { skeleton: { bones: file.bones, rest: file.rest }, gender: g })
  const proportioned = proportion(mesh, shaped, dials)
  applyPosture(model, dials)
  model.updateMatrixWorld(true)
  const rest = meshRest(mesh)
  const spread = extraSpread(bodySpread(proportioned, rest), g)

  // capsules round the limbs, and the torso's section at the waist
  const radius = (from: string, to: string, at: number) => girth(proportioned, rest, from, to, at)
  const limb = (side: 'Left' | 'Right'): Record<string, Capsule> => ({
    upper: { from: `${side}Arm`, to: `${side}ForeArm`, radius: radius(`${side}Arm`, `${side}ForeArm`, 0.5), skip: 0.35 },
    fore: { from: `${side}ForeArm`, to: `${side}Hand`, radius: radius(`${side}ForeArm`, `${side}Hand`, 0.4), skip: 0 },
    thigh: { from: `${side}UpLeg`, to: `${side}Leg`, radius: radius(`${side}UpLeg`, `${side}Leg`, 0.5), skip: 0.3 },
    shin: { from: `${side}Leg`, to: `${side}Foot`, radius: radius(`${side}Leg`, `${side}Foot`, 0.4), skip: 0 },
  })
  const L = limb('Left')
  const R = limb('Right')
  const waist = torsoSection(proportioned, rest, (rest.rest.Spine[1] + rest.rest.Spine2[1]) / 2)
  // how high the ankle and the ball of the foot stand off the floor: the file's own, since longer or shorter legs move
  // the joints at rest but the game raises or lowers the hips to match (legDrop), leaving the feet on the floor
  const soles = { Left: [file.rest.LeftFoot[1], file.rest.LeftToeBase[1]], Right: [file.rest.RightFoot[1], file.rest.RightToeBase[1]] }

  const idx = JSON.parse(readFileSync(`${ANIM}/index.json`, 'utf8')) as AnimIndex
  const ref = idx.genders[g]!
  const find = (name: string) => model.getObjectByName(name)!
  const rotations = new Map(idx.bones.map((b) => [b, find(b).quaternion.clone()]))
  const hips = find('Hips').position.clone().add(new THREE.Vector3(0, (mesh.userData.legDrop as number | undefined) ?? 0, 0))
  const restOf = new Map([...rotations].map(([b, q]) => [b, q.clone().invert()]))
  const limited = idx.bones.filter((b) => JOINT_LIMITS[b] && b !== 'Hips')
  // a virtual two-handed grip: the right fist's knuckle line, out past the index finger
  const tip = (out: THREE.Vector3) => {
    const a = find('RightHandPinky1').getWorldPosition(w[0])
    const b = find('RightHandIndex1').getWorldPosition(w[1])
    return out.copy(b).sub(a).normalize().multiplyScalar(0.6).add(find('RightHand').getWorldPosition(w[2]))
  }
  const fix = fixups(model, model, spread, tip, 1.8)
  const pos = (name: string, out: THREE.Vector3) => find(name).getWorldPosition(out)

  const out: ArchetypeScore = { archetype: id, body, spread: { arm: +(spread.arm * DEG).toFixed(2), leg: +(spread.leg * DEG).toFixed(2) }, clips: {} }
  for (const [key, name] of Object.entries(clips)) {
    if (!name) {
      out.clips[key] = 'missing'
      continue
    }
    const clip = retargetClip(toClip(name, JSON.parse(readFileSync(`${ANIM}/${g}/${name}.json`, 'utf8')) as ClipFile, idx), { bones: idx.bones, rest: ref.rest, hips: ref.hips }, { rest: rotations, hips: hips.toArray() })
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(clip).play()
    const frames = Math.round(clip.duration * idx.fps) + 1
    const score = (): Scores => ({ limits: { violations: 0, worst: 0 }, penetration: { worst: 0, frames: 0 } })
    const raw = score()
    const fixed = score()
    const grips: { raw: number[]; fixed: number[] } = { raw: [], fixed: [] }
    const feet: Record<'Left' | 'Right', { at: THREE.Vector3; low: number }[]> = { Left: [], Right: [] }
    const lowest: number[] = []
    const two = TWO_HANDED.has(name)
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]
    const q = new THREE.Quaternion()
    const measure = (s: Scores, grip: number[] | undefined) => {
      model.updateMatrixWorld(true)
      for (const b of limited) {
        const e = limitExcess(b, q.copy(restOf.get(b)!).multiply(find(b).quaternion))
        if (e > 1) s.limits.violations++
        s.limits.worst = Math.max(s.limits.worst, e)
      }
      // the torso as an upright elliptic cylinder in its own frame; the limbs' capsules against it and each other
      const spineLow = pos('Spine', v[0])
      const spineHigh = pos('Spine2', v[1])
      const up = v[2].subVectors(spineHigh, spineLow).normalize()
      const side = pos('LeftArm', v[3]).sub(pos('RightArm', new THREE.Vector3())).addScaledVector(up, 0).normalize()
      side.addScaledVector(up, -side.dot(up)).normalize()
      const front = new THREE.Vector3().crossVectors(side, up)
      let deepest = 0
      const into = (c: Capsule) => {
        const a = pos(c.from, new THREE.Vector3())
        const b = pos(c.to, new THREE.Vector3())
        for (let k = 0; k <= 6; k++) {
          const t = c.skip + ((1 - c.skip) * k) / 6
          const pt = a.clone().lerp(b, t).sub(spineLow)
          const along = pt.dot(up)
          if (along < -0.05 || along > spineHigh.distanceTo(spineLow) + 0.1) continue
          const x = pt.dot(side)
          const z = pt.dot(front)
          const d = Math.hypot(x, z) || 1e-6
          const edge = 1 / Math.hypot(x / d / waist.width, z / d / waist.depth)
          deepest = Math.max(deepest, edge + c.radius - d)
        }
      }
      for (const c of [L.upper, L.fore, R.upper, R.fore]) into(c)
      for (const [a, b] of [[L.thigh, R.thigh], [L.shin, R.shin]] as const) {
        const ta = pos(a.from, new THREE.Vector3()).lerp(pos(a.to, new THREE.Vector3()), a.skip)
        const tb = pos(b.from, new THREE.Vector3()).lerp(pos(b.to, new THREE.Vector3()), b.skip)
        deepest = Math.max(deepest, a.radius + b.radius - segmentDistance(ta, pos(a.to, new THREE.Vector3()), tb, pos(b.to, new THREE.Vector3())))
      }
      const cm = Math.max(0, deepest) * 100
      s.penetration.worst = Math.max(s.penetration.worst, cm)
      if (cm > 1) s.penetration.frames++
      if (grip) {
        const right = pos('RightHand', new THREE.Vector3())
        const target = tip(new THREE.Vector3()).sub(right).normalize().multiplyScalar(SPAN).add(right)
        const d = pos('LeftHand', new THREE.Vector3()).distanceTo(target)
        grip.push(d)
      }
    }
    let gripping: boolean[] = []
    for (let f = 0; f < frames; f++) {
      mixer.setTime(f / idx.fps)
      measure(raw, two ? grips.raw : undefined)
      if (two) gripping.push(gripWeight(grips.raw[grips.raw.length - 1]) > 0)
      for (const s of ['Left', 'Right'] as const) {
        const foot = pos(`${s}Foot`, new THREE.Vector3())
        const toe = pos(`${s}ToeBase`, new THREE.Vector3())
        feet[s].push({ at: toe.clone().setY(0), low: Math.min(foot.y - soles[s][0], toe.y - soles[s][1]) })
      }
      lowest.push(Math.min(feet.Left[f].low, feet.Right[f].low))
      fix.apply(1 / idx.fps, { yaw: 0, pitch: 0, mode: 'off' })
      measure(fixed, two ? grips.fixed : undefined)
      fix.undo()
    }
    mixer.stopAllAction()
    mixer.uncacheRoot(model)
    // foot slide: each planted foot's speed against its own steady (treadmill) speed
    const slides: number[] = []
    for (const s of ['Left', 'Right'] as const) {
      const vs: THREE.Vector3[] = []
      for (let f = 1; f < frames; f++) if (feet[s][f].low < 0.02 && feet[s][f - 1].low < 0.02) vs.push(feet[s][f].at.clone().sub(feet[s][f - 1].at).multiplyScalar(idx.fps))
      if (vs.length < 2) continue
      const med = (k: 'x' | 'z') => [...vs].map((x) => x[k]).sort((a, b) => a - b)[vs.length >> 1]
      const steady = new THREE.Vector3(med('x'), 0, med('z'))
      for (const x of vs) slides.push(x.distanceTo(steady) * 100)
    }
    const meanGrip = (ds: number[]) => {
      const kept = ds.filter((_, f) => gripping[f])
      return kept.length ? +((kept.reduce((a, b) => a + b, 0) / kept.length) * 100).toFixed(2) : undefined
    }
    if (two) {
      raw.grip = meanGrip(grips.raw)
      fixed.grip = meanGrip(grips.fixed)
    }
    gripping = []
    const round = (s: Scores): Scores => ({ limits: { violations: s.limits.violations, worst: +s.limits.worst.toFixed(2) }, penetration: { worst: +s.penetration.worst.toFixed(2), frames: +(s.penetration.frames / frames).toFixed(3) }, ...(s.grip !== undefined ? { grip: s.grip } : {}) })
    out.clips[key] = {
      clip: name,
      frames,
      raw: round(raw),
      fixed: round(fixed),
      footSlide: +(slides.length ? slides.reduce((a, b) => a + b, 0) / slides.length : 0).toFixed(2),
      ...(GROUNDED.has(name) ? { ground: +([...lowest].sort((a, b) => a - b)[lowest.length >> 1] * 100).toFixed(2) } : {}),
    }
  }
  return out
}
