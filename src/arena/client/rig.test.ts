import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { KEYED_BONES, STANDARD_BONES } from '../../kit/rig/standard.js'
import { MOTIONS } from '../../charter/motions.js'
import { headBone, RIGS, rigOf } from './rig.js'
import { splitClip } from './characters.js'

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { bones: string[]; rig?: string; genders: Record<string, { sets: Record<string, Record<string, number>>; gait: Record<string, unknown> }> }

function skeleton(names: readonly string[], parents: readonly (string | null)[]): THREE.Object3D {
  const root = new THREE.Group()
  const made = new Map<string, THREE.Bone>()
  names.forEach((name, i) => {
    const bone = new THREE.Bone()
    bone.name = name
    made.set(name, bone)
    const parent = parents[i]
    ;(parent ? made.get(parent)! : root).add(bone)
  })
  return root
}

describe('the rigs the arena animates', () => {
  it('tells the Psyblr Human from the 20-bone rig by its hips, and finds the head on both', () => {
    const standard = skeleton(STANDARD_BONES.map((b) => b.name), STANDARD_BONES.map((b) => b.parent))
    const legacy = skeleton(['hips', 'spine', 'head'], [null, 'hips', 'spine'])
    expect(rigOf(standard).kind).toBe('standard')
    expect(rigOf(legacy).kind).toBe('legacy')
    expect(headBone(standard)?.name).toBe('Head')
    expect(headBone(legacy)?.name).toBe('head')
    expect(rigOf(new THREE.Group()).kind).toBe('legacy')
  })

  it('names bones that exist on each rig, with a twist for every limb segment', () => {
    const names = new Set(STANDARD_BONES.map((b) => b.name))
    const s = RIGS.standard
    for (const n of [s.hips, s.spine, s.chest, s.upperChest, s.neck, s.head, s.hand.L, s.hand.R, s.thigh.L, s.shin.R, s.foot.L, ...s.legBones, ...Object.keys(s.twistShare), ...s.fingers.L, ...s.fingers.R]) expect(names.has(n), n).toBe(true)
    expect(s.twists.map((t) => t.bone).sort()).toEqual(['LeftArmTwist', 'LeftForeArmTwist', 'LeftLegTwist', 'LeftUpLegTwist', 'RightArmTwist', 'RightForeArmTwist', 'RightLegTwist', 'RightUpLegTwist'])
    for (const t of s.twists) expect(names.has(t.follows) && names.has(t.parent)).toBe(true)
    expect(s.fingers.L).toHaveLength(15)
  })

  it('splits a clip into legs and the rest on either rig', () => {
    const track = (bone: string) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    const legacy = new THREE.AnimationClip('a', 1, [track('hips'), track('thigh_L'), track('spine'), track('hand_R')])
    const standard = new THREE.AnimationClip('b', 1, [track('Hips'), track('LeftUpLeg'), track('LeftLegTwist'), track('Spine'), track('RightHandIndex1')])
    expect(splitClip(legacy, RIGS.legacy).legs.tracks.map((t) => t.name)).toEqual(['hips.quaternion', 'thigh_L.quaternion'])
    expect(splitClip(standard, RIGS.standard).legs.tracks.map((t) => t.name)).toEqual(['Hips.quaternion', 'LeftUpLeg.quaternion', 'LeftLegTwist.quaternion'])
    expect(splitClip(standard, RIGS.standard).top.tracks.map((t) => t.name)).toEqual(['Spine.quaternion', 'RightHandIndex1.quaternion'])
  })

  it('ships the standard rig library with the contract\'s keyed bones, hips first, the first\'s sets, and Mixamo\'s combat set', () => {
    const standard = read('../../../public/anim/standard/index.json')
    const legacy = read('../../../public/anim/index.json')
    expect(standard.rig).toBe('standard')
    expect(standard.bones[0]).toBe('Hips')
    const keyed = new Set(KEYED_BONES)
    for (const b of standard.bones) expect(keyed.has(b), b).toBe(true)
    expect(standard.bones).not.toContain('Jaw')
    expect(standard.bones).toContain('LeftHandThumb1')
    expect(standard.bones).toContain('RightEye')
    const m = standard.genders.m
    expect(Object.keys(m.sets)).toEqual([...Object.keys(legacy.genders.m.sets), 'combat'])
    // every clip the combat catalogue names is in the library
    for (const motion of MOTIONS) expect(m.sets.combat[motion.id], motion.id).toBeDefined()
    for (const set of Object.keys(legacy.genders.m.sets)) expect(Object.keys(m.sets[set]).sort()).toEqual(Object.keys(legacy.genders.m.sets[set]).sort())
    expect(m.gait.run).toBeDefined()
  })
})
