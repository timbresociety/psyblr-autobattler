// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { getTemplate } from '../../../charter/templates/catalog.js'
import type { BuildSlot, Template } from '../../../charter/types.js'
import { DEMO_HEROES, demoBuild } from '../../../arena/demo/roster.js'
import { CALLOUT_CAP, CALLOUT_LIFE, createCalloutPool } from './callouts.js'
import { heroInfo } from './model.js'
import type { ScreenPoint } from './world.js'

const head: ScreenPoint = { x: 400, y: 300, depth: 12, visible: true }
const spot = { x: 640, y: 530 }

describe('move call-outs', () => {
  it('shows one call a hero at a time, a new cast replacing the last', () => {
    const layer = document.createElement('div')
    const pool = createCalloutPool(layer)
    pool.spawn(3, 'Kamehameha', ['#f4fdff', '#59c7ff'])
    pool.spawn(3, 'Spirit Bomb', ['#e8fbff', '#59c7ff'])
    expect(pool.size()).toBe(1)
    expect(layer.textContent).toBe('Spirit Bomb')
  })

  it('never makes more nodes than its cap, the oldest giving way', () => {
    const layer = document.createElement('div')
    const pool = createCalloutPool(layer)
    for (let i = 0; i < 30; i++) pool.spawn(i, `Move ${i}`, ['#ffffff', '#ff00ff'])
    expect(pool.size()).toBe(CALLOUT_CAP)
    expect([...layer.children].map((n) => n.textContent)).toContain('Move 29')
    expect([...layer.children].map((n) => n.textContent)).not.toContain('Move 0')
  })

  it('wears its look’s colours, sits over the hero, and fades away after its life', () => {
    const layer = document.createElement('div')
    const pool = createCalloutPool(layer)
    pool.spawn(1, 'Galick Gun', ['#fff0fb', '#d36bff'])
    const node = layer.children[0] as HTMLElement
    expect(node.style.getPropertyValue('--call-core')).toBe('#fff0fb')
    expect(node.style.getPropertyValue('--call-glow')).toBe('#d36bff')
    pool.frame(0.5, () => head, spot)
    expect(node.style.visibility).toBe('visible')
    expect(node.style.transform).toContain('translate3d(400.0px')
    pool.frame(CALLOUT_LIFE, () => head, spot)
    expect(pool.live()).toBe(0)
    expect(node.style.visibility).toBe('hidden')
  })

  it("puts the controlled hero's own call low in the middle of the screen", () => {
    const layer = document.createElement('div')
    const pool = createCalloutPool(layer, { reducedMotion: true })
    pool.spawn(0, 'Final Flash', ['#ffffff', '#fff27a'], { fixed: true })
    pool.frame(0.2, () => head, spot)
    const node = layer.children[0] as HTMLElement
    expect(node.className).toContain('fixed')
    expect(node.style.transform).toContain('translate3d(640.0px, 530.0px')
  })

  it('hides a call whose hero is off screen', () => {
    const layer = document.createElement('div')
    const pool = createCalloutPool(layer)
    pool.spawn(2, 'Chidori', ['#ffffff', '#9ad8ff'])
    pool.frame(0.1, () => ({ ...head, visible: false }), spot)
    expect((layer.children[0] as HTMLElement).style.visibility).toBe('hidden')
  })

  it('calls out a famous move by the name the player gave it, in its palette', () => {
    const build = demoBuild(DEMO_HEROES[0])
    const named = { ...build, look: { ...build.look!, skills: {} }, slots: { ...build.slots, active1: { ...build.slots.active1, name: 'Galick Gun' } } }
    const kit = Object.fromEntries(Object.entries(named.slots).map(([slot, s]) => [slot, getTemplate(s.templateId)])) as Record<BuildSlot, Template>
    const info = heroInfo(0, 0, { build: named, kit })
    expect(info.skills.active1.name).toBe('Galick Gun')
    expect(info.skills.active1.callout).toEqual(['#fff0fb', '#d36bff'])
    // a plain skill is not called out
    expect(info.skills.basic.callout).toBeUndefined()
  })
})
