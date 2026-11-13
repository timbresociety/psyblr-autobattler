import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { castSpan, castTime, releaseOf } from './characters.js'
import { MOTION_RELEASE } from './anim-index.js'
import { clipTime, derived, sourceOf, sourceTime } from './clip-source.js'
import { trimmed } from './anim-library.js'
import { cut, heldLast, named, quickened, travelled } from './library-gait.js'
import { climbAlong } from './match-view.js'
import { glbChannels, packClipFrom, travelFromEnd, PACK_KIT, PACK_MOVES, PACK_SKILLS, PACK_STYLES } from './motion-pack.js'
import { AURA_CLIPS, CAST_CLIPS, MOVEMENT_CLIPS, SHOT_CLIPS, ULTIMATE_CLIPS } from '../recipes/motions.js'
import { ATTITUDES } from '../../kit/anim/attitude.js'

/** A binary glTF holding one animation: `Root` travelling 2 m ahead and 1 m up, `Hips` bobbing and turning, a `Jaw`. */
function packFile(): ArrayBuffer {
  const times = [0, 0.5, 1]
  const root = [0, 0, 0, 0, 0.5, 1, 0, 1, 2]
  const hips = [0, 1, 0, 0, 0.8, 0, 0, 1, 0]
  const turn = [0, 0, 0, 1, 0, 0.7071, 0, 0.7071, 0, 1, 0, 0]
  const floats = new Float32Array([...times, ...root, ...hips, ...turn])
  const bin = new Uint8Array(floats.buffer)
  const view = (byteOffset: number, count: number, type: string) => ({ bufferView: 0, byteOffset, componentType: 5126, count, type })
  const json = {
    asset: { version: '2.0' },
    nodes: [{ name: 'Root', children: [1] }, { name: 'Hips', children: [2] }, { name: 'Jaw' }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.length }],
    accessors: [view(0, 3, 'SCALAR'), view(12, 3, 'VEC3'), view(48, 3, 'VEC3'), view(84, 3, 'VEC4')],
    animations: [
      {
        name: 'vault--variant-001',
        samplers: [{ input: 0, output: 1 }, { input: 0, output: 2 }, { input: 0, output: 3 }, { input: 0, output: 3 }],
        channels: [
          { sampler: 0, target: { node: 0, path: 'translation' } },
          { sampler: 1, target: { node: 1, path: 'translation' } },
          { sampler: 2, target: { node: 1, path: 'rotation' } },
          { sampler: 3, target: { node: 2, path: 'rotation' } },
        ],
      },
    ],
  }
  let text = JSON.stringify(json)
  while (text.length % 4) text += ' '
  const head = new TextEncoder().encode(text)
  const out = new ArrayBuffer(12 + 8 + head.length + 8 + bin.length)
  const dv = new DataView(out)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.byteLength, true)
  dv.setUint32(12, head.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  new Uint8Array(out, 20, head.length).set(head)
  dv.setUint32(20 + head.length, bin.length, true)
  dv.setUint32(24 + head.length, 0x004e4942, true)
  new Uint8Array(out, 28 + head.length, bin.length).set(bin)
  return out
}

describe('a pack clip read from its file', () => {
  const { name, channels } = glbChannels(packFile())
  const clip = packClipFrom('vault--variant-001', channels, ['Hips', 'Spine'])

  it('reads the animation channel by channel without building anything', () => {
    expect(name).toBe('vault--variant-001')
    expect(channels.map((c) => `${c.node}.${c.path}`)).toEqual(['Root.translation', 'Hips.translation', 'Hips.rotation', 'Jaw.rotation'])
    expect(Array.from(channels[0].times)).toEqual([0, 0.5, 1])
  })

  it('becomes a library clip: the rig\'s bones and the hips\' position, nothing else', () => {
    expect(clip.tracks.map((t) => t.name).sort()).toEqual(['Hips.position', 'Hips.quaternion'])
    expect(clip.duration).toBe(1)
    // the hips keep their own motion about the spot: the dip stays
    expect(clip.tracks.find((t) => t.name === 'Hips.position')!.values[4]).toBeCloseTo(0.8)
  })

  it('leaves the Root\'s travel out, and keeps a note of it', () => {
    expect(clip.tracks.some((t) => t.name.startsWith('Root'))).toBe(false)
    expect((clip.userData.travel as { end: number[] }).end).toEqual([0, 1, 2])
    expect(travelFromEnd(clip, 0)).toEqual([0, -1, -2])
    expect(travelFromEnd(clip, 0.25)).toEqual([0, -0.75, -1.5])
    expect(travelFromEnd(clip, 1)).toEqual([0, 0, 0])
  })

  it('says which body\'s rest it is keyed on and what it came from', () => {
    expect(clip.userData.rest).toBe('m')
    expect(sourceOf(clip)).toEqual({ clip: 'vault--variant-001', from: 0, rate: 1 })
  })

  it('refuses a file that isn\'t one', () => {
    expect(() => glbChannels(new ArrayBuffer(64))).toThrow()
  })
})

describe('a climb drawn from the top of its ledge down', () => {
  // a 2.2 m climb, 0.6 m in over the edge, heading along -x
  const m = { from: 0, until: 45, x0: 5, y0: 3, z0: 0, x1: 4.4, y1: 5.2, z1: 0 }
  const out = new THREE.Vector3()

  it('ends where the engine\'s climb ends, and starts across where it started', () => {
    expect(climbAlong(out, m, { y: 0, z: 0 }).toArray()).toEqual([4.4, 5.2, 0])
    expect(climbAlong(out, m, { y: -1.6, z: 1 }).toArray().map((v) => +v.toFixed(4))).toEqual([5, 3.6, 0])
  })

  it('between them is as far under the top as its clip has it, whatever the ledge\'s height', () => {
    const half = climbAlong(out, m, { y: -0.8, z: 0.5 })
    expect(half.y).toBeCloseTo(5.2 - 0.8)
    expect(half.x).toBeCloseTo(4.7)
  })
})

describe('a library climb\'s own way up, taken out of its hips (library-gait.ts travelled)', () => {
  // a pull-up: the hips rise 1.6 m and go 0.4 m in over the edge, swaying a little across
  const pullUp = new THREE.AnimationClip('pulling_up_to_a_ledge', 2, [new THREE.VectorKeyframeTrack('Hips.position', [0, 1, 2], [0, 0.4, 0, 0.05, 1.2, 0.1, 0, 2.0, 0.4]), new THREE.QuaternionKeyframeTrack('Spine.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, 1])])
  const clip = travelled(pullUp, 0.5)
  const hips = clip.tracks.find((t) => t.name === 'Hips.position')!.values

  it('leaves the hips as high over the top as they end, with their sway across', () => {
    expect(Array.from(hips).map((v) => +v.toFixed(3))).toEqual([0, 0.5, 0, 0.05, 0.5, 0, 0, 0.5, 0])
    expect(clip.tracks).toHaveLength(2)
  })

  it('keeps the way up as its travel, read from its end like a pack clip\'s', () => {
    expect(travelFromEnd(clip, 0)!.map((v) => +v.toFixed(3))).toEqual([0, -1.6, -0.4])
    expect(travelFromEnd(clip, 1)!.map((v) => +v.toFixed(3))).toEqual([0, -0.8, -0.3])
    expect(travelFromEnd(clip, 2)!.map((v) => +v.toFixed(3))).toEqual([0, 0, 0])
  })

  it('reads its travel in its source\'s seconds, so a cut made first is no matter', () => {
    const late = travelled(cut(pullUp, 1, 2, 0.5), 0.5)
    expect(sourceOf(late).from).toBe(1)
    // half way through what plays is 1.5 s into the source
    expect(travelFromEnd(late, 1.5)!.map((v) => +v.toFixed(3))).toEqual([0, -0.4, -0.15])
    expect(travelFromEnd(late, 1)!.map((v) => +v.toFixed(3))).toEqual([0, -0.8, -0.3])
  })
})

describe('a clip keeps its marks through every cut, retime and new name', () => {
  const key = (name: string, seconds: number) => new THREE.AnimationClip(name, seconds, [new THREE.VectorKeyframeTrack('Hips.position', [0, seconds / 2, seconds], [0, 1, 0, 0, 1, 0, 0, 1, 0])])

  it('knows where in its source each of its seconds falls', () => {
    const roll = cut(key('quick_roll_to_run', 2), 0.5, 1.5, 0.5)
    expect(sourceOf(roll)).toEqual({ clip: 'quick_roll_to_run', from: 0.5, rate: 2 })
    expect(sourceTime(roll, 0.25)).toBeCloseTo(1)
    expect(clipTime(roll, 1)).toBeCloseTo(0.25)
    // a mark cut away is not on the clip at all
    expect(clipTime(roll, 0.2)).toBeUndefined()
    expect(clipTime(roll, 1.8)).toBeUndefined()
  })

  it('carries the source through a rename, a retime and a hold', () => {
    const renamed = named(quickened(cut(key('jab_cross', 2), 0.4, 1.4, 1), 2), 'slash')
    expect(renamed.name).toBe('slash')
    expect(sourceOf(renamed).clip).toBe('jab_cross')
    expect(sourceOf(renamed).from).toBeCloseTo(0.4)
    expect(sourceOf(renamed).rate).toBeCloseTo(2)
    expect(clipTime(heldLast(key('prone_forward_stop', 1.2)), 0.6)).toBeUndefined()
    expect(sourceOf(derived(renamed, key('x', 1), 0.1)).from).toBeCloseTo(0.6)
  })

  it('a short wind-up starts late in its clip rather than playing all of it many times too fast', () => {
    MOTION_RELEASE.set('twirl', 1.2)
    const clip = key('twirl', 2)
    // with no clock the whole wind-up is spread over the cast
    expect(castTime(clip, 0, 0)).toBeCloseTo(0)
    expect(castTime(clip, 0.5, 0)).toBeCloseTo(0.6)
    // the engine winds a light blow up in 0.12 s: the clip plays its last 0.24 s to the contact, at twice its pace
    expect(castTime(clip, 0, 0, 0, 0.12)).toBeCloseTo(1.2 - 0.24)
    expect(castTime(clip, 0.5, 0, 0, 0.12)).toBeCloseTo(1.2 - 0.12)
    expect(castTime(clip, 1, 0, 0, 0.12)).toBeCloseTo(1.2)
    // a wind-up long enough for the clip plays all of it, and the follow-through runs at the clip's own pace either way
    expect(castTime(clip, 0, 0, 0, 1)).toBeCloseTo(0)
    expect(castTime(clip, 1, 0, 0.3, 0.12)).toBeCloseTo(1.5)
    MOTION_RELEASE.delete('twirl')
  })

  it('a blow lands on its own mark, not on the mark of the name it plays under', () => {
    MOTION_RELEASE.set('jab_cross', 0.9)
    // played as the engine's `slash`: the body file's own `slash` marks 0.2 s, which is another clip's
    const slash = named(cut(key('jab_cross', 2), 0.4, 1.4, 1), 'slash')
    expect(releaseOf(slash)).toBeCloseTo(0.5)
    expect(castSpan(slash).release).toBeCloseTo(0.5)
    // a body file's own clip keeps its own
    expect(releaseOf(key('slash', 0.6))).toBeCloseTo(0.2)
    MOTION_RELEASE.delete('jab_cross')
  })

  it('a pack clip lands on the contact checked on it, wherever it is cut', () => {
    const blow = key('melee-combo-1--variant-001', 1.2667)
    blow.userData = { contact: 0.2, source: { clip: 'melee-combo-1--variant-001', from: 0, rate: 1 } }
    expect(releaseOf(blow)).toBeCloseTo(0.2)
    const later = cut(blow, 0.1, 1.1, 1)
    later.userData.contact = 0.2
    expect(releaseOf(later)).toBeCloseTo(0.1)
  })

  it('a trimmed library clip moves its mark with the trim', () => {
    MOTION_RELEASE.set('casting_spell', 5)
    // kit/anim/trims.ts cuts casting_spell to [4.4, 7.2]
    const cast = trimmed(key('casting_spell', 8))
    expect(cast.duration).toBeCloseTo(2.8)
    expect(releaseOf(cast)).toBeCloseTo(0.6)
    MOTION_RELEASE.delete('casting_spell')
  })
})

describe('the pack\'s mapping', () => {
  it('gives every blow of the kit a contact that was measured on it, in every attitude\'s set', () => {
    for (const style of Object.values(PACK_STYLES)) {
      expect(style.contacts).toHaveLength(Object.keys(PACK_KIT).length)
      for (const contact of style.contacts) expect(contact).toBeGreaterThan(0)
    }
  })

  it('cuts no clip backwards', () => {
    for (const move of Object.values(PACK_MOVES)) {
      if (move.cut) expect(move.cut[1]).toBeGreaterThan(move.cut[0])
      if (move.part) expect(move.part[0] < move.part[1] && move.part[0] >= 0 && move.part[1] <= 1).toBe(true)
    }
  })

  it('gives every attitude a motion set of its own, with a gait measured on each loop', () => {
    expect(Object.keys(PACK_STYLES).sort()).toEqual([...ATTITUDES].sort())
    expect(new Set(Object.values(PACK_STYLES).map((s) => s.set)).size).toBe(ATTITUDES.length)
    for (const style of Object.values(PACK_STYLES)) for (const pace of [style.walk, style.jog, style.run]) expect(pace.speed > 0 && pace.strides >= 1 && pace.strike >= 0).toBe(true)
  })
})

describe("the pack's clips for skills (PACK_SKILLS)", () => {
  it('keys each by what a skill is, as the recipes file it, and names one pack clip with its moment', () => {
    const known: Record<string, (rest: string[]) => boolean> = {
      shot: ([grip, way]) => grip in SHOT_CLIPS && ['single', 'burst', 'auto', 'spread', 'held', 'charge', 'lobbed'].includes(way),
      cast: ([shape]) => shape in CAST_CLIPS,
      move: ([kind]) => kind in MOVEMENT_CLIPS,
      aura: ([kind]) => kind in AURA_CLIPS,
      ult: ([shape]) => shape in ULTIMATE_CLIPS,
    }
    for (const [key, move] of Object.entries(PACK_SKILLS)) {
      const [group, ...rest] = key.split(':')
      expect(known[group]?.(rest), key).toBe(true)
      // the pack clip's own id, never an action's first variant: a skill's clip was chosen, not defaulted
      expect(move.action, key).toMatch(/--variant-\d{3}$/)
      if (!move.loop) expect(move.contact, key).toBeGreaterThan(0)
    }
  })
})
