import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BLENDSHAPES, BONE_NAMES, bone, chainTo, KEYED_BONES, LEGACY_TO_STANDARD, mirrored, parentOf, STANDARD_BONES, STANDARD_TO_LEGACY } from './standard.js'

const animIndex = JSON.parse(readFileSync(new URL('../../../public/anim/index.json', import.meta.url), 'utf8')) as { bones: string[] }

describe('the Psyblr Human rig contract', () => {
  it('names every bone once, parents before children, rooted at the hips', () => {
    expect(new Set(BONE_NAMES).size).toBe(BONE_NAMES.length)
    const seen = new Set<string>()
    for (const b of STANDARD_BONES) {
      if (b.parent === null) expect(b.name).toBe('Hips')
      else expect(seen.has(b.parent), `${b.name} comes before its parent ${b.parent}`).toBe(true)
      seen.add(b.name)
    }
    expect(chainTo('LeftHandIndex3')).toEqual(['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'LeftHandIndex2', 'LeftHandIndex3'])
  })

  it('is Mixamo-compatible with twists, fingers, a jaw and eyes', () => {
    for (const side of ['Left', 'Right']) {
      for (const name of ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase']) expect(bone(side + name)?.kind).not.toBe(undefined)
      for (const f of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) for (let i = 1; i <= 3; i++) expect(bone(`${side}Hand${f}${i}`)?.kind).toBe('finger')
      for (const [twist, follows] of [['ArmTwist', 'ForeArm'], ['ForeArmTwist', 'Hand'], ['UpLegTwist', 'Leg'], ['LegTwist', 'Foot']]) {
        const t = bone(side + twist)
        expect(t?.kind).toBe('twist')
        expect(t?.follows).toBe(side + follows)
        expect(parentOf(side + follows)).toBe(t?.parent)
      }
    }
    expect(bone('Jaw')?.parent).toBe('Head')
    expect(bone('LeftEye')?.parent).toBe('Head')
    expect(STANDARD_BONES.length).toBe(76)
  })

  it('mirrors every sided bone onto one of the same kind', () => {
    for (const b of STANDARD_BONES) {
      const other = bone(mirrored(b.name))
      expect(other?.kind, b.name).toBe(b.kind)
      expect(mirrored(mirrored(b.name))).toBe(b.name)
    }
    expect(mirrored('Spine1')).toBe('Spine1')
  })

  it('maps every bone of the 20-bone rig that today\'s clips key', () => {
    expect(Object.keys(LEGACY_TO_STANDARD).sort()).toEqual([...animIndex.bones].sort())
    for (const legacy of animIndex.bones) expect(STANDARD_TO_LEGACY[LEGACY_TO_STANDARD[legacy]]).toBe(legacy)
    expect(LEGACY_TO_STANDARD.upper_chest).toBe('Spine2')
    expect(LEGACY_TO_STANDARD.shin_R).toBe('RightLeg')
  })

  it('keys no twist or end bone', () => {
    for (const name of KEYED_BONES) expect(['twist', 'end']).not.toContain(bone(name)?.kind)
    expect(KEYED_BONES).toContain('LeftHandThumb1')
    expect(KEYED_BONES).not.toContain('LeftHandThumb4')
  })

  it('carries the 52 ARKit blendshapes, each sided one with its pair', () => {
    expect(BLENDSHAPES.length).toBe(52)
    expect(new Set(BLENDSHAPES).size).toBe(52)
    for (const s of BLENDSHAPES) {
      if (s.endsWith('Left')) expect(BLENDSHAPES).toContain(s.slice(0, -4) + 'Right')
      if (s.endsWith('Right')) expect(BLENDSHAPES).toContain(s.slice(0, -5) + 'Left')
    }
    expect(BLENDSHAPES).toContain('jawOpen')
  })
})
