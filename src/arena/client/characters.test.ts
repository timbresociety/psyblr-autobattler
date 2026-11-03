import { describe, expect, it } from 'vitest'
import { remixBuild } from '../../charter/build.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { STARTERS, starterBuild } from '../starters.js'
import { BODIES, bodyFor, characterLook, formCharacterLook } from './character-look.js'
import { lookFor } from '../recipes/looks.js'
import { POSE_RELEASE, elementLook } from '../../charter/skill-look.js'
import { castClip as stageClip } from '../../ui/common/hero-look.js'
import * as THREE from 'three'
import { castClip, gaitPlayer, groundSpeed, heldTip, leadHand, splitClip, standOn } from './characters.js'
import { GAIT_CLIPS, PACE_LIMITS, strideTime, type Gait } from './gait.js'

describe('a hero’s look', () => {
  it('is the same wherever the hero fights: it follows the name, not the slot or side', () => {
    const a = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    const b = characterLook(defaultBuild('fighter', 'Ada'), 0.3)
    expect(b.held).toEqual(a.held)
    expect(b.colors.skin.getHex()).toBe(a.colors.skin.getHex())
  })

  it('is bare when it has no look: no clothes, hair or weapon; mages are women by default', () => {
    expect(characterLook(defaultBuild('tank', 'T'), 0)).toMatchObject({ build: 'm-medium', held: {} })
    expect(characterLook(defaultBuild('mage', 'Mi'), 0).build).toBe('f-medium')
  })

  it('wears the body for its size: a huge hero a huge body, not a medium one scaled up', () => {
    expect(characterLook({ ...defaultBuild('fighter', 'Big'), sizeClass: 'huge' }, 0).build).toBe('m-huge')
    expect(characterLook({ ...defaultBuild('mage', 'Small'), sizeClass: 'tiny' }, 0).build).toBe('f-tiny')
    expect(bodyFor(defaultBuild('tank', 'T'), 'colossal')).toBe('m-colossal')
    expect(BODIES).toHaveLength(12)
  })

  it('its look picks the gender, the skin and the weapons in its hands, and carries its photo face', () => {
    const face = { url: '/dev-store/heroes/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.webp', width: 512, height: 512, points: new Array(956).fill(10) }
    const sword = { id: 'sword', url: '/kit/pieces/sword.glb' }
    const build = { ...defaultBuild('tank', 'Ada'), look: { gender: 'f' as const, colors: { skin: '#8a5a3c' }, face, gear: { hand_r: sword } } }
    const look = characterLook(build, 0.2)
    expect(look).toMatchObject({ build: 'f-medium', face, held: { hand_r: sword } })
    expect(look.colors.skin.getHexString()).toBe('8a5a3c')
  })
})

describe('the starters', () => {
  it('wear the bodies everyone does: their gender at their size, no photo face', () => {
    for (const hero of STARTERS) {
      const build = starterBuild(hero)
      const look = characterLook(build, hero.hue)
      expect(look.build, hero.id).toBe(`${build.look!.gender}-${hero.sizeClass}`)
      expect(look.face, hero.id).toBeUndefined()
    }
  })

  it('a remix looks exactly like the hero it came from: nothing about it depends on the name', () => {
    for (const hero of STARTERS) {
      const build = starterBuild(hero)
      const remix = remixBuild(build)
      expect(remix.heroName).toBe(`${hero.heroName} Remix`)
      expect(remix.heroId).toBeUndefined()
      expect(remix.gate).toEqual({ state: 'draft' })
      expect(remix.look, hero.id).toEqual(build.look)
      // a copy: editing the remix's look never reaches the original
      expect(remix.look).not.toBe(build.look)
      // drawn under any name and hue, the same hero
      expect(characterLook({ ...remix, heroName: 'Someone else' }, 0), hero.id).toEqual(characterLook(build, hero.hue))
    }
  })
})

describe('which clip a cast plays', () => {
  it('swings the melee style, shoots or casts the ranged weapon, and plays the ultimate as its own', () => {
    const marksman = defaultBuild('marksman', 'M')
    const fighter = defaultBuild('fighter', 'F')
    expect(castClip(marksman, 'ultimate').clip).toBe('ultimate')
    expect(getTemplate(fighter.slots.basic.templateId).delivery.kind).toBe('melee')
    expect(castClip(fighter, 'basic').clip).toBe('slash')
    // a gun shoots; a hand weapon (a ki blast, a bolt) plays its cast pose
    expect(castClip(fighter, 'active1').clip).toMatch(/^(shoot|cast)/)
    expect(castClip(marksman, 'active1').clip).toMatch(/^(shoot|cast)/)
  })

  it("plays the pose a skill's look picks, from just before its hands let go", () => {
    const build = starterBuild(STARTERS[0])
    const palms = { ...build, look: { ...build.look!, skills: { active1: { ...elementLook('energy'), pose: 'palms' as const } } } }
    expect(castClip(palms, 'active1')).toEqual({ clip: 'cast_palms', from: POSE_RELEASE.palms - 0.08 })
    // with no stored look, a famous move's name is enough
    const named = (name: string) => ({ ...build, look: { ...build.look!, skills: {} }, slots: { ...build.slots, ultimate: { ...build.slots.ultimate, name } } })
    expect(castClip(named('Kamehameha'), 'ultimate').clip).toBe('cast')
    expect(castClip(named('Special Beam Cannon'), 'ultimate').clip).toBe('cast_fingers')
    // an ultimate whose words name no pose keeps its own big clip
    expect(castClip(named('Mass Retaliation'), 'ultimate')).toEqual({ clip: 'ultimate', from: 0 })
    // the Forge preview plays the same pose, wind-up and all
    expect(stageClip(getTemplate(build.slots.active1.templateId), 'active1', { pose: 'clap' })).toBe('cast_clap')
  })
})

describe('the body a form changes (R23)', () => {
  const base = characterLook(defaultBuild('fighter', 'Kit'), 0.1)
  const bodyOf = (move: string) => lookFor(move)!.transformation!.body

  it('gives a Super Saiyan teal eyes', () => {
    const ssj = formCharacterLook(base, bodyOf('Super Saiyan'))
    expect(ssj.colors.eye.g).toBeGreaterThan(ssj.colors.eye.r * 2)
    expect(ssj.colors.eye.b).toBeGreaterThan(ssj.colors.eye.r * 2)
    expect(ssj.marks).toBeUndefined()
  })

  it('gives a Nine-Tails form red eyes and whisker marks', () => {
    const fox = formCharacterLook(base, bodyOf('Nine-Tails'))
    expect(fox.colors.eye.r).toBeGreaterThan(fox.colors.eye.g * 2)
    expect(fox.marks).toBe('whiskers')
  })

  it('changes nothing without a body', () => {
    expect(formCharacterLook(base, undefined)).toBe(base)
  })
})

describe('where a skill leaves the body (Forge goal, phase 1)', () => {
  /** A forearm from an elbow at (x, 1.2, 0), its hand bone (the wrist) `reach` metres ahead along +z. */
  const arm = (x: number, reach: number) => {
    const forearm = new THREE.Object3D()
    forearm.position.set(x, 1.2, 0)
    const hand = new THREE.Object3D()
    hand.position.set(0, 0, reach)
    forearm.add(hand)
    new THREE.Group().add(forearm)
    return hand
  }
  const ahead = new THREE.Vector3(0, 0, 1)

  it('leaves from the palm of the hand that leads, a little past its wrist', () => {
    const out = leadHand([arm(0.3, 0.1), arm(-0.3, 0.5)], ahead, new THREE.Vector3())!
    expect(out.x).toBeCloseTo(-0.3)
    expect(out.z).toBeCloseTo(0.5 * 1.35)
  })

  it('leaves from between the palms when both push out together, and from nowhere without hands', () => {
    const out = leadHand([arm(0.08, 0.5), arm(-0.08, 0.52)], ahead, new THREE.Vector3())!
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(0.51 * 1.35)
    expect(leadHand([], ahead, new THREE.Vector3())).toBeUndefined()
  })

  it('finds the far end of what a hand holds, in the socket’s own space', () => {
    const socket = new THREE.Object3D()
    socket.position.set(1, 2, 3)
    socket.rotation.set(0.4, 1.1, -0.3)
    expect(heldTip(socket)).toBeUndefined()
    // a blade a metre long, from just past the grip to its point
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 1))
    blade.position.set(0, 0, 0.6)
    socket.add(blade)
    const tip = heldTip(socket)!
    expect(tip.x).toBeCloseTo(0)
    expect(tip.y).toBeCloseTo(0)
    expect(tip.z).toBeCloseTo(1.1)
  })
})

describe('feet that stay planted (Forge goal, phase 2)', () => {
  it('splits a clip at the hips: hips and legs below, the rest of the body above', () => {
    const turn = (bone: string) => new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    const { legs, top } = splitClip(new THREE.AnimationClip('slash', 1, ['hips', 'spine', 'thigh_L', 'foot_R', 'hand_R', 'head'].map(turn)))
    expect(legs.tracks.map((t) => t.name)).toEqual(['hips.quaternion', 'thigh_L.quaternion', 'foot_R.quaternion'])
    expect(top.tracks.map((t) => t.name)).toEqual(['spine.quaternion', 'hand_R.quaternion', 'head.quaternion'])
    expect([legs.duration, top.duration]).toEqual([1, 1])
  })

  /** Two feet on a body; over a 1 s stride each one plants half a metre ahead, slides back a metre, then lifts and swings forward. */
  const runner = () => {
    const body = new THREE.Group()
    for (const name of ['foot_L', 'foot_R']) body.add(Object.assign(new THREE.Object3D(), { name }))
    // [time, height, how far ahead]: planted for the first half second, then up and forward
    const keys = [[0, 0, 0.5], [0.5, 0, -0.5], [0.55, 0.2, -0.5], [0.95, 0.2, 0.5], [1, 0, 0.5]]
    const step = (foot: string) => new THREE.VectorKeyframeTrack(`${foot}.position`, keys.map((k) => k[0]), keys.flatMap((k) => [0, k[1], k[2]]))
    return { body, clip: new THREE.AnimationClip('run', 1, [step('foot_L'), step('foot_R')]) }
  }

  it('measures how fast a run carries the body: how fast a planted foot slides back under it', () => {
    const { body, clip } = runner()
    expect(groundSpeed(body, clip)).toBeCloseTo(2, 1)
    // the model itself is never posed
    expect(body.getObjectByName('foot_L')!.position.z).toBe(0)
  })

  it('measures nothing on a body without both feet', () => {
    const { body, clip } = runner()
    body.remove(body.getObjectByName('foot_R')!)
    expect(groundSpeed(body, clip)).toBeUndefined()
  })
})

describe('walking, jogging and running every way on the motion library (Forge goal, phase B)', () => {
  // the masculine library's gaits as scripts/rpm-anim.ts measured them, rounded
  const speeds: Record<string, number> = { walk: 1.58, jog: 3.39, run: 5.45 }
  const gaits: Record<string, Gait> = Object.fromEntries(GAIT_CLIPS.map((name) => [name, { speed: speeds[name.split('_')[0]] * (name.endsWith('_back') ? 0.8 : 1), strides: name.startsWith('walk') ? 2 : 1, strike: 0.25 }]))
  const durations: Record<string, number> = { walk: 1.92, jog: 0.71, run: 0.58 }
  // a bare rig whose every clip moves its hips and turns its spine, so each clip has a legs half and a top half
  const rig = () => {
    const body = new THREE.Group()
    for (const name of ['hips', 'spine']) body.add(Object.assign(new THREE.Object3D(), { name }))
    const clips = new Map(
      GAIT_CLIPS.map((name) => {
        const d = durations[name.split('_')[0]]
        return [name, new THREE.AnimationClip(name, d, [new THREE.VectorKeyframeTrack('hips.position', [0, d], [0, 0, 0, 0, 1, 0]), new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, d], [0, 0, 0, 1, 0, 0, 0, 1])])]
      }),
    )
    const mixer = new THREE.AnimationMixer(body)
    const player = gaitPlayer(mixer, { gender: 'm', rig: 'legacy', clips, gaits, bones: [] }, (clip) => clip)
    const action = (name: string) => mixer.existingAction(clips.get(name)!)!
    return { body, mixer, player, action }
  }
  const weights = (of: (name: string) => THREE.AnimationAction) => Object.fromEntries(GAIT_CLIPS.map((name) => [name, of(name).weight]).filter(([, w]) => (w as number) > 1e-9))

  it('plays the two ways either side of where it goes, at its pace, every clip on one stride', () => {
    const { player, action } = rig()
    // walking forward and to its left at once
    player.update(1 / 60, 1, 0, 1.5, Math.PI / 4)
    expect(weights(action)).toEqual({ walk: expect.closeTo(0.5), walk_left: expect.closeTo(0.5) })
    // both feet land together: each clip is as far through its stride as the other, from its own left-foot landing
    const phase = ((1 / 60) * Math.max(PACE_LIMITS[0], 1.5 / 1.58)) / (1.92 / 2)
    for (const name of ['walk', 'walk_left']) expect(action(name).time).toBeCloseTo(strideTime(gaits[name], 1.92, phase))
    // only as much as the gait shows: half of it, a quarter each way
    player.update(1 / 60, 0.5, 0, 1.5, Math.PI / 4)
    expect(action('walk').weight).toBeCloseTo(0.25)
  })

  it('changes pace by blending into the next tier over a moment, a tier at a time', () => {
    const { player, action } = rig()
    player.update(1 / 60, 1, 0, 1.5, 0)
    // sprinting off: a jog first, the walk fading out under it, then the run (a run is the sprint's alone)
    player.update(0.1, 1, 0, 5.6, 0, true)
    const early = weights(action)
    expect(early.walk).toBeGreaterThan(0)
    expect(early.jog).toBeGreaterThan(0)
    expect(early.run).toBeUndefined()
    for (let k = 0; k < 40; k++) player.update(1 / 60, 1, 0, 5.6, 0, true)
    expect(weights(action)).toEqual({ run: expect.closeTo(1) })
    // backing away it runs backwards
    for (let k = 0; k < 40; k++) player.update(1 / 60, 1, 0, 4.4, Math.PI, true)
    expect(weights(action)).toEqual({ run_back: expect.closeTo(1) })
    // without the sprint the same pace jogs
    for (let k = 0; k < 40; k++) player.update(1 / 60, 1, 0, 5.6, 0)
    expect(weights(action)).toEqual({ jog: expect.closeTo(1) })
  })

  it('holds a cast’s back as the cast’s own hips would, over hips leaning into a strafe', () => {
    const turned = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
    // the strafe's hips turned most of the way toward where it goes and leaning into the run; the cast's tipped back
    const strafing = turned(0, 1.4, 0.55)
    const casting = turned(-0.35, 0, 0)
    // a cast's spine leans forward over its hips, to stand the chest up again
    const spine = turned(0.4, 0.1, 0)
    const stood = standOn(spine, strafing, casting, 1, new THREE.Quaternion())
    // on the strafe's hips, the spine stands as it does on the cast's: upright again, facing the aim
    expect(strafing.clone().multiply(stood).angleTo(casting.clone().multiply(spine))).toBeCloseTo(0)
    // part of the way, part of the difference; none of the way, the spine as the clips have it
    const half = standOn(spine, strafing, casting, 0.5, new THREE.Quaternion())
    const gap = strafing.clone().multiply(spine).angleTo(casting.clone().multiply(spine))
    expect(strafing.clone().multiply(half).angleTo(casting.clone().multiply(spine))).toBeCloseTo(gap / 2)
    expect(standOn(spine, strafing, casting, 0, new THREE.Quaternion()).angleTo(spine)).toBeCloseTo(0)
  })

  it('runs under a cast with its legs alone', () => {
    const { body, mixer, player, action } = rig()
    for (let k = 0; k < 40; k++) player.update(1 / 60, 0, 0.7, 5.6, -Math.PI / 2, true)
    expect(weights(action)).toEqual({})
    // the run to its right moves the hips (a legs track) as far as it shows: 0.7 of the way the clip has them now
    mixer.update(0)
    const t = action('run_right').time
    expect(body.getObjectByName('hips')!.position.y).toBeCloseTo((0.7 * t) / durations.run)
  })
})
