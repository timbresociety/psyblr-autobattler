// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CATALOG } from '../../../charter/templates/catalog'
import { at, buff, execute, heal, move, phys, push, resize, shield, slow, spirit, stun } from '../../../charter/templates/dsl'
import type { Delivery, Effect, Template } from '../../../charter/types'
import { AbilityIcon, ICON_KEYS, iconFor, toneFor } from './icons'

afterEach(cleanup)

const kit = (delivery: Delivery, effects: Effect[], slot: Template['slot'] = 'active') => ({ slot, delivery, effects })
const byName = (name: string) => CATALOG.find((t) => t.name === name)!

describe('ability icons from the kit (R38)', () => {
  it('reads how damage lands from the delivery', () => {
    expect(iconFor(kit(at.proj(20), [spirit(10)]))).toBe('orb')
    expect(iconFor(kit(at.proj(22, 2.5), [spirit(50)]))).toBe('burst')
    expect(iconFor(kit(at.beam(16), [spirit(40)]))).toBe('beam')
    expect(iconFor(kit(at.melee(), [phys(30)]))).toBe('slash')
    expect(iconFor(kit(at.cone(7, 3), [spirit(4)]))).toBe('cone')
    expect(iconFor(kit(at.aura(4), [phys(20)]))).toBe('nova')
    expect(iconFor(kit(at.zone(14, 4), [spirit(25)]))).toBe('zone')
  })

  it('lets movement, transformations and crowd control win over the delivery', () => {
    expect(iconFor(kit(at.dash(6), [move(6), phys(20)]))).toBe('dash')
    expect(iconFor(kit(at.blink(10), [move(10)]))).toBe('blink')
    expect(iconFor(kit(at.grapple(12), [push(4), stun(0.5), phys(20)]))).toBe('grapple')
    expect(iconFor(kit(at.self(), [resize('huge', 8), buff('damage', 20, 8)], 'ultimate'))).toBe('resize')
    expect(iconFor(kit(at.beam(16), [stun(0.4), spirit(55)]))).toBe('stun')
    expect(iconFor(kit(at.melee(), [execute(30, 50), phys(40)]))).toBe('execute')
    expect(iconFor(kit(at.proj(18), [push(3), phys(30)]))).toBe('push')
  })

  it('names what a skill does for allies when it deals no damage', () => {
    expect(iconFor(kit(at.aura(6), [heal(60, 0.4, 'allies')]))).toBe('heal')
    expect(iconFor(kit(at.self(), [shield(120, 3)]))).toBe('shield')
    expect(iconFor(kit(at.self(), [buff('damageReduction', 30, 4)]))).toBe('shield')
    expect(iconFor(kit(at.self(), [buff('moveSpeed', 40, 3)], 'movement'))).toBe('dash')
    expect(iconFor(kit(at.self(), [buff('damage', 20, 5), buff('attackSpeed', 20, 5)]))).toBe('buff')
    expect(iconFor(kit(at.zone(10, 3), [slow(40, 2)]))).toBe('slow')
    expect(iconFor(kit(at.self(), [move(4), buff('damage', 10, 2)]))).toBe('blink')
    expect(iconFor(kit(at.self(), [], 'ultimate'))).toBe('star')
  })

  it('maps real catalogue skills the way a viewer would name them', () => {
    expect(iconFor(byName('Fireball'))).toBe('burst')
    expect(iconFor(byName('Lightning Lance'))).toBe('stun')
    expect(iconFor(byName('Healing Burst'))).toBe('heal')
    expect(iconFor(byName('Mana Shield'))).toBe('shield')
    expect(iconFor(byName('Chain Hook'))).toBe('stun')
    expect(iconFor(byName('Sentry Turret'))).toBe('turret')
    expect(iconFor(byName('Vanish'))).toBe('stealth')
    expect(iconFor(byName('Tether'))).toBe('root')
    expect(iconFor(byName('Grapple Hook'))).toBe('grapple')
    expect(iconFor(byName('Meteor Storm'))).toBe('zone')
    expect(iconFor(byName('Super Form'))).toBe('resize')
    expect(toneFor(byName('Fireball'))).toBe('spirit')
    expect(toneFor(byName('Heavy Strike'))).toBe('phys')
    expect(toneFor(byName('Healing Burst'))).toBe('heal')
  })

  it('gives every catalogue template an icon that draws', () => {
    const used = new Set(CATALOG.map(iconFor))
    for (const key of used) expect(ICON_KEYS).toContain(key)
    // the set is varied enough to tell skills apart at a glance
    expect(used.size).toBeGreaterThanOrEqual(14)
    for (const icon of ICON_KEYS) {
      const { container } = render(<AbilityIcon icon={icon} />)
      const svg = container.querySelector('svg')!
      expect(svg.getAttribute('data-icon')).toBe(icon)
      expect(svg.getAttribute('aria-hidden')).toBe('true')
      expect(svg.querySelectorAll('path, circle, ellipse, rect').length).toBeGreaterThan(0)
      cleanup()
    }
  })
})
