import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/traits.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { createMatch } from '../engine/match.js'
import { AIM_STEPS, MOVES, slotBit } from '../engine/state.js'
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

  it('binds GAME.md §3: Space jumps, Shift dashes or sprints, C crouches, Ctrl lies prone, Z rolls, X guards, V strikes', () => {
    const moves = (...keys: string[]) => commandFrom({ held: new Set(keys) }, 0, 0).moves
    expect(moves('Space')).toBe(MOVES.jump)
    expect(moves('ShiftLeft')).toBe(MOVES.dash)
    expect(moves('ShiftRight', 'KeyC')).toBe(MOVES.dash | MOVES.crouch)
    expect(moves('ControlLeft')).toBe(MOVES.prone)
    expect(moves('KeyZ')).toBe(MOVES.dodge)
    expect(moves('KeyX')).toBe(MOVES.block)
    const buttons = (...keys: string[]) => commandFrom({ held: new Set(keys) }, 0, 0).buttons
    expect(buttons('KeyV')).toBe(slotBit('basic'))
    expect(buttons('Mouse0')).toBe(slotBit('active1'))
    expect(buttons('KeyQ', 'KeyE', 'KeyF', 'KeyR')).toBe(slotBit('active2') | slotBit('movement') | slotBit('passive') | slotBit('ultimate'))
    // the right button zooms the camera; the engine never hears it
    expect(commandFrom({ held: new Set(['Mouse2']) }, 0, 0)).toMatchObject({ moves: 0, buttons: 0 })
  })

  it('aims exactly where the camera looks, quantized, with no assist', () => {
    const yaw = 1.234
    const pitch = -0.3
    const c = commandFrom({ held: new Set(['Mouse0', 'KeyW']) }, yaw, pitch)
    expect(c.aimYaw).toBe(Math.round((yaw / (Math.PI * 2)) * AIM_STEPS))
    expect(c.aimPitch).toBe(Math.round((pitch / (Math.PI * 2)) * AIM_STEPS) + AIM_STEPS)
    expect(c.buttons & slotBit('active1')).toBe(slotBit('active1'))
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

  it('a wall behind the shoulder pulls the camera in at once, and it eases back out once the wall is gone', () => {
    const camera = new THREE.PerspectiveCamera()
    const cams = new Cameras(camera)
    cams.set('hero')
    cams.yaw = 0
    cams.pitch = 0
    const hero = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 60; i++) cams.update(1 / 60, hero, [])
    const full = camera.position.z
    expect(full).toBeLessThan(-4)
    const wall = new THREE.Box3(new THREE.Vector3(-5, 0, -3), new THREE.Vector3(5, 5, -2))
    cams.update(1 / 60, hero, [wall])
    expect(camera.position.z).toBeGreaterThan(-2)
    // gone: one frame later it has moved out only a little, half a second later most of the way
    cams.update(1 / 60, hero, [])
    expect(camera.position.z).toBeGreaterThan(-2.2)
    for (let i = 0; i < 40; i++) cams.update(1 / 60, hero, [])
    expect(camera.position.z).toBeLessThan(full + 0.5)
  })

  it('following a hero while watching shows it from behind its shoulder, turning with it; a slide lets it go', () => {
    const camera = new THREE.PerspectiveCamera()
    const cams = new Cameras(camera)
    const hero = { x: 10, y: 4.5, z: 5 }
    cams.follow = 3
    for (let i = 0; i < 240; i++) cams.update(1 / 60, undefined, [], hero, Math.PI / 2)
    // facing +x, the camera is behind it (-x), a little above, and looks the same way
    expect(camera.position.x).toBeLessThan(hero.x - 4)
    expect(Math.abs(camera.position.z - hero.z)).toBeLessThan(1.5)
    expect(camera.position.y).toBeGreaterThan(hero.y + 1.5)
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
    expect(look.x).toBeGreaterThan(0.8)
    // turned by hand it stays turned a moment, then comes round behind the hero again
    cams.orbit(400, 0)
    cams.update(1 / 60, undefined, [], hero, Math.PI / 2)
    expect(Math.abs(cams.yaw - Math.PI / 2)).toBeGreaterThan(1)
    for (let i = 0; i < 600; i++) cams.update(1 / 60, undefined, [], hero, Math.PI / 2)
    expect(Math.abs(cams.yaw - Math.PI / 2)).toBeLessThan(0.05)
    const at = camera.position.clone()
    cams.pan(1, 0)
    expect(cams.follow).toBeUndefined()
    for (let i = 0; i < 60; i++) cams.update(1 / 60, undefined, [])
    expect(camera.position.distanceTo(at)).toBeLessThan(1.5)
  })

  it('pulls the camera in front of a wall', () => {
    const wall = new THREE.Box3(new THREE.Vector3(-5, 0, -3), new THREE.Vector3(5, 5, -2))
    const at = pullIn(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 2, -6), [wall])
    expect(at.z).toBeGreaterThan(-2)
  })
})
