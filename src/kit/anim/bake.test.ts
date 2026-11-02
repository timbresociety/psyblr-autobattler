import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { undelta, type ClipFile } from '../../arena/client/anim-library.js'
import { readNodes } from '../body/node.js'
import { clampClip, levelPlantedFeet, limitWorst, mirrorClip, mirrorName, pose, restOf, tagClip, type Frames, type Skel } from './bake.js'

const idx = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as { bones: string[]; fps: number; rot: number; pos: number; genders: { m: { gait: Record<string, { speed: number }> } } }
let skel: Skel
let keyed: number[]

const load = (name: string): Frames => {
  const file = JSON.parse(readFileSync(`public/anim/standard/m/${name}.json`, 'utf8')) as ClipFile
  return { frames: file.frames, rot: undelta(file.rot, file.frames, 4, idx.rot), pos: undelta(file.pos, file.frames, 3, idx.pos) }
}
const copy = (c: Frames): Frames => ({ frames: c.frames, rot: c.rot.slice(), pos: c.pos.slice() })
const at = (name: string) => skel.names.indexOf(name)

beforeAll(async () => {
  const tree = await readNodes('public/heroes/v2/m-medium.glb')
  skel = {
    names: tree.nodes.map((n) => n.name),
    parent: tree.nodes.map((n) => n.parent),
    t: tree.nodes.map((n) => new Vector3().fromArray(n.t)),
    r: tree.nodes.map((n) => new Quaternion().fromArray(n.r)),
  }
  keyed = idx.bones.map((b) => at(b))
})

describe('clip baking (GAME.md §12)', () => {
  it('names a clip by its other side, or not at all', () => {
    expect(mirrorName('hit_from_left')).toBe('hit_from_right')
    expect(mirrorName('right_strafe_walking')).toBe('left_strafe_walking')
    expect(mirrorName('lefty_jab')).toBeUndefined()
    expect(mirrorName('punch_combo')).toBeUndefined()
  })

  it('mirrors a clip onto its other side, and back again', () => {
    const clip = load('hook_punch')
    const once = mirrorClip(skel, keyed, clip)
    const a = pose(skel, keyed, clip)
    const b = pose(skel, keyed, once)
    const mid = restOf(skel).at[keyed[0]].x
    // the left hand goes where the right hand went, across the middle
    let worst = 0
    for (let f = 0; f < clip.frames; f++) {
      const left = b.at[f][at('LeftHand')]
      const right = a.at[f][at('RightHand')]
      worst = Math.max(worst, Math.hypot(left.x - (2 * mid - right.x), left.y - right.y, left.z - right.z))
    }
    expect(worst).toBeLessThan(0.01)
    // and twice over it is the clip again
    const twice = mirrorClip(skel, keyed, once)
    let angle = 0
    for (let i = 0; i < clip.rot.length; i += 4) {
      const q = new Quaternion().fromArray(clip.rot, i).normalize()
      const r = new Quaternion().fromArray(twice.rot, i)
      angle = Math.max(angle, (q.angleTo(r) * 180) / Math.PI)
    }
    expect(angle).toBeLessThan(0.5)
    for (let i = 0; i < clip.pos.length; i++) expect(twice.pos[i]).toBeCloseTo(clip.pos[i], 5)
  })

  it('stands a planted foot flat and leaves a lifting heel alone', () => {
    const rest = restOf(skel)
    for (const name of ['magic_standing_idle', 'hit_to_body', 'jog']) {
      const clip = load(name)
      const levelled = copy(clip)
      levelPlantedFeet(skel, keyed, levelled)
      const before = pose(skel, keyed, clip)
      const after = pose(skel, keyed, levelled)
      const foot = at('LeftFoot')
      const ball = at('LeftToeBase')
      const restRise = rest.at[ball].y - rest.at[foot].y
      for (let f = 0; f < clip.frames; f++) {
        const heel = before.at[f][foot].y - rest.at[foot].y
        const rise = after.at[f][ball].y - after.at[f][foot].y
        // the heel never moves, the ball comes up to the rest's height over a planted heel
        expect(after.at[f][foot].distanceTo(before.at[f][foot])).toBeLessThan(1e-4)
        if (heel < 0.02) expect(rise).toBeGreaterThan(restRise - 0.003)
        if (heel > 0.06) expect(after.world[f][foot].angleTo(before.world[f][foot])).toBeLessThan(1e-3)
      }
    }
  })

  it('tags where the feet plant, where a blow lands and that a jog loops', () => {
    const jog = load('jog')
    const speed = idx.genders.m.gait.jog.speed
    const seconds = (jog.frames - 1) / idx.fps
    const tags = tagClip(skel, keyed, jog, idx.fps, { x: 0, z: speed * seconds })
    expect(tags.loop).toBe(true)
    // a jog stride: each foot down once or twice a loop, never both at the same moment for long
    expect(tags.plants.left.length).toBeGreaterThanOrEqual(1)
    expect(tags.plants.right.length).toBeGreaterThanOrEqual(1)
    const idle = tagClip(skel, keyed, load('magic_standing_idle'), idx.fps, { x: 0, z: 0 })
    const length = (load('magic_standing_idle').frames - 1) / idx.fps
    const held = (p: [number, number][]) => p.reduce((s, [a, b]) => s + b - a, 0)
    expect(held(idle.plants.left)).toBeGreaterThan(0.9 * length)
    expect(held(idle.plants.right)).toBeGreaterThan(0.9 * length)
    const punch = tagClip(skel, keyed, load('hook_punch'), idx.fps, { x: 0, z: 0 })
    expect(punch.contact).toBeGreaterThan(0.1)
    expect(punch.contact).toBeLessThan((load('hook_punch').frames - 1) / idx.fps)
  })

  it('holds a clip to the joint limits, and measures how far one strays past them', () => {
    const clip = copy(load('hook_punch'))
    expect(limitWorst(skel, keyed, clip)).toBe(0)
    expect(clampClip(skel, keyed, clip)).toBe(0)
    // swing the left forearm 150° sideways on one frame: past its limit, and clamped back inside
    const k = idx.bones.indexOf('LeftForeArm')
    const f = 5
    const o = (f * keyed.length + k) * 4
    const bent = new Quaternion().fromArray(clip.rot, o).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (150 * Math.PI) / 180))
    bent.toArray(clip.rot, o)
    expect(limitWorst(skel, keyed, clip)).toBeGreaterThan(15)
    expect(clampClip(skel, keyed, clip)).toBe(1)
    expect(limitWorst(skel, keyed, clip)).toBe(0)
  })
})
