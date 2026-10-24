import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/traits.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { createMatch } from '../engine/match.js'
import { AIM_STEPS } from '../engine/state.js'
import { BLEND_SECONDS, Cameras, pullIn } from './camera.js'
import { BINDINGS, commandFrom } from './input.js'
import { handBack, heroForKey, releaseIfDead, take } from './takeover.js'

const arena = () => createMatch(armyModifiers([defaultBuild('fighter'), defaultBuild('mage')]), armyModifiers([defaultBuild('tank'), defaultBuild('support')]), 1)

describe('takeover and controls (U17)', () => {
  it('covers AE2: a key for an enemy hero, or a dead one, takes nothing', () => {
    const { match } = arena()
    expect(heroForKey(match, 0, 'Digit2')).toBe(1)
    expect(take(match, 0, 2)).toBe(false)
    expect(match.human).toBeUndefined()
    match.heroes[1].alive = false
    expect(take(match, 0, heroForKey(match, 0, 'Digit2'))).toBe(false)
    expect(take(match, 0, heroForKey(match, 0, 'Digit1'))).toBe(true)
    expect(match.human).toBe(0)
  })

  it('covers AE1: when the controlled hero dies, control returns to watching', () => {
    const { match } = arena()
    take(match, 0, 0)
    match.heroes[0].alive = false
    expect(releaseIfDead(match)).toBe(true)
    expect(match.human).toBeUndefined()
  })

  it('Tab-style hand back clears control, and taking another hero switches directly', () => {
    const { match } = arena()
    take(match, 0, 0)
    take(match, 0, 1)
    expect(match.human).toBe(1)
    handBack(match)
    expect(match.human).toBeUndefined()
  })

  it('Z flies down, Space flies up, and no binding uses Ctrl or Alt', () => {
    expect(commandFrom({ held: new Set(['KeyZ']) }, 0, 0).vertical).toBe(-1)
    expect(commandFrom({ held: new Set(['Space']) }, 0, 0).vertical).toBe(1)
    expect(Object.keys(BINDINGS).some((k) => /Control|Alt|Meta/.test(k))).toBe(false)
  })

  it('aims exactly where the camera looks, quantized, with no assist', () => {
    const yaw = 1.234
    const pitch = -0.3
    const c = commandFrom({ held: new Set(['Mouse0', 'KeyW']) }, yaw, pitch)
    expect(c.aimYaw).toBe(Math.round((yaw / (Math.PI * 2)) * AIM_STEPS))
    expect(c.aimPitch).toBe(Math.round((pitch / (Math.PI * 2)) * AIM_STEPS) + AIM_STEPS)
    expect(c.buttons & 1).toBe(1)
    expect(c.moveX).toBeCloseTo(Math.sin(yaw))
  })

  it('blends between cameras over about half a second, not one frame', () => {
    const cams = new Cameras(new THREE.PerspectiveCamera())
    cams.set('hero')
    cams.update(1 / 60, { x: 0, y: 0, z: 0 }, [])
    expect(cams.progress()).toBeLessThan(0.1)
    for (let i = 0; i < Math.ceil(BLEND_SECONDS * 60); i++) cams.update(1 / 60, { x: 0, y: 0, z: 0 }, [])
    expect(cams.progress()).toBe(1)
  })

  it('pulls the camera in front of a wall', () => {
    const wall = new THREE.Box3(new THREE.Vector3(-5, 0, -3), new THREE.Vector3(5, 5, -2))
    const at = pullIn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, -6), [wall])
    expect(at.z).toBeGreaterThan(-2)
  })
})
