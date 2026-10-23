// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { PerspectiveCamera } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HudHero, HudState } from '../../../arena/client/match-view'
import { DEMO_HEROES, demoBuild } from '../../../arena/demo/roster'
import type { MatchEvent } from '../../../arena/engine/events'
import { capsule, prepareHero, type HeroState } from '../../../arena/engine/state'
import { ControlHud } from '../MatchHud'
import { ScoreBanner } from './Banner'
import type { HudController } from './controller'
import { KillFeed } from './KillFeed'
import { hudHeroes } from './model'
import { AllyRoster, EnemyRoster } from './Rosters'
import { attachWorldHud } from './WorldHud'
import { overheadLift, project, screenPoint } from './world'

// Musk and Huang on blue, Bezos and Zuckerberg on red, with their real kits
const setups = DEMO_HEROES.slice(0, 4).map((h) => prepareHero(demoBuild(h)))
const teams = [0, 0, 1, 1] as const
const info = hudHeroes(setups, teams)

const slots = (over: Partial<Record<'active1' | 'active2' | 'ultimate', number>> = {}): HudHero['cooldowns'] => ({
  basic: { left: 0, total: 0 },
  active1: { left: over.active1 ?? 0, total: 10 },
  active2: { left: over.active2 ?? 0, total: 12 },
  passive: { left: 0, total: 0 },
  ultimate: { left: over.ultimate ?? 0, total: 60 },
  movement: { left: 0, total: 8 },
})
const hudHero = (id: number, over: Partial<HudHero> = {}): HudHero => ({ id, name: setups[id].build.heroName, team: teams[id], alive: true, hp: 800, maxHp: 1000, damageDealt: 0, airborne: false, fallback: false, cooldowns: slots(), ...over })
const hudState = (heroes: HudHero[], over: Partial<HudState> = {}): HudState => ({ seconds: 61, timerSeconds: 300, paused: false, quality: 'full', healthShare: [0.8, 0.8], heroes, ...over })

/** A live match without a renderer: real camera and engine-shaped heroes, hooks fired by hand. */
function fakeMatch() {
  const lists = { events: [] as ((e: MatchEvent[]) => void)[], frame: [] as ((dt: number, alpha: number) => void)[] }
  const camera = new PerspectiveCamera(60, 2, 0.1, 400)
  camera.position.set(0, 2, 10)
  camera.lookAt(0, 2, 0)
  const heroes = teams.map((team, id) => ({ id, team, alive: true, hp: 800, maxHp: 1000, shield: 0, size: 'medium', cooldowns: { basic: 0, active1: 0, active2: 0, passive: 0, ultimate: 600, movement: 0 } }) as unknown as HeroState)
  const match = { heroes, human: undefined as number | undefined, tick: 0 }
  const drawn = [
    { x: 0, y: 0, z: 0 },
    { x: -3, y: 0, z: 0 },
    { x: 0.5, y: 0, z: -1 },
    { x: 8, y: 0, z: 0 },
  ]
  const hooks = {
    on: (kind: 'events' | 'frame', listener: never) => {
      const list = lists[kind] as unknown[]
      list.push(listener)
      return () => void list.splice(list.indexOf(listener), 1)
    },
  }
  const controller = { hooks, camera, positions: () => drawn, arena: { match, setups }, views: [] } as unknown as HudController
  return {
    controller,
    camera,
    match,
    drawn,
    events: (e: MatchEvent[]) => lists.events.forEach((l) => l(e)),
    frame: (dt = 1 / 60) => lists.frame.forEach((l) => l(dt, 0)),
    listeners: () => lists.events.length + lists.frame.length,
  }
}

const hit = (source: number, target: number, heavy = false): MatchEvent => ({ type: 'hit', source, target, slot: 'active1', amount: 120, heavy })
const death = (hero: number): MatchEvent => ({ type: 'death', hero })

afterEach(() => (cleanup(), vi.useRealTimers()))

describe('enemy roster (R38)', () => {
  it('shows every enemy: name, health and Q/E/R with seconds, the fallen greyed, no keys to take them', () => {
    render(<EnemyRoster heroes={[hudHero(2, { hp: 640, cooldowns: slots({ active1: 3.2 }) }), hudHero(3, { alive: false, hp: 0 })]} info={info} team={1} />)
    const list = screen.getByRole('list', { name: 'Enemy heroes' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Bezos')
    expect(rows[1].textContent).toContain('Zuckerberg')
    expect(rows[1].className).toContain('dead')
    expect(within(rows[0]).getByRole('meter', { name: 'Health' }).getAttribute('aria-valuenow')).toBe('640')
    expect(within(rows[0]).getByRole('img', { name: /^Q .+: 4 s$/ }).className).toContain('is-cd')
    const ult = within(rows[0]).getByRole('img', { name: /^R .+: ready$/ })
    expect(ult.className).toContain('is-ult')
    expect(ult.className).toContain('is-ready')
    // the ability letters are there; the 1-0 keys that take a hero are not
    expect([...list.querySelectorAll('kbd')].map((k) => k.textContent)).toEqual(['Q', 'E', 'R', 'Q', 'E', 'R'])
    expect(list.querySelector('.hud-card-key')).toBeNull()
  })
})

describe('ally roster (R38)', () => {
  it('numbers heroes in key order and lifts the one being steered', () => {
    render(<AllyRoster heroes={[hudHero(0), hudHero(1)]} info={info} controlled={1} side={0} />)
    const cards = within(screen.getByRole('list', { name: 'Your heroes' })).getAllByRole('listitem')
    expect(cards.map((c) => c.querySelector('.hud-card-key')!.textContent)).toEqual(['1', '2'])
    expect(cards[1].className).toContain('controlled')
    expect(cards[1].textContent).toContain('You')
    expect(cards[0].className).not.toContain('controlled')
    expect(cards[0].textContent).toContain('Musk')
  })
})

describe('score banner (R38)', () => {
  it('gives both sides a pip per hero with a health sliver, the fallen crossed out', () => {
    render(<ScoreBanner state={hudState([hudHero(0), hudHero(1, { hp: 240 }), hudHero(2), hudHero(3, { alive: false, hp: 0 })])} heroes={info} side={0} />)
    expect(screen.getByRole('timer').textContent).toContain('3:59')
    const blue = within(screen.getByRole('list', { name: 'Blue heroes' })).getAllByRole('listitem')
    const red = within(screen.getByRole('list', { name: 'Red heroes' })).getAllByRole('listitem')
    expect(blue).toHaveLength(2)
    expect((blue[1].querySelector('.hud-pip-hp') as HTMLElement).style.transform).toBe('scaleX(0.24)')
    expect(blue[1].className).toContain('low')
    expect(red[1].className).toContain('dead')
    expect((red[0].querySelector('.hud-pip-hp') as HTMLElement).style.transform).toBe('scaleX(0.8)')
    expect(screen.getByText('Blue 2 alive, Red 1 alive')).toBeTruthy()
  })
})

describe('kill feed (R38)', () => {
  it('credits the last hitter, keeps the newest four, and lets each entry go after five seconds', () => {
    vi.useFakeTimers()
    const m = fakeMatch()
    render(<KillFeed controller={m.controller} heroes={info} />)
    act(() => m.events([hit(1, 2), hit(0, 2), death(2)]))
    const feed = screen.getByRole('list', { name: 'Kill feed' })
    const [entry] = within(feed).getAllByRole('listitem')
    expect(entry.textContent).toMatch(/Musk.*eliminated.*Bezos/)
    act(() => void vi.advanceTimersByTime(2000))
    act(() => m.events([death(0), death(1), death(3), death(2)]))
    expect(within(feed).getAllByRole('listitem')).toHaveLength(4)
    act(() => void vi.advanceTimersByTime(5000))
    expect(within(feed).queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('world layer: overhead bars and damage numbers (R38)', () => {
  beforeEach(() => {
    // jsdom has no layout: the layer is a 1000 x 500 canvas
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 })
  })
  afterEach(() => {
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
    delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  })

  it('pins each bar to its hero’s projected head, and hides the steered, the fallen and the unseen', () => {
    const m = fakeMatch()
    const layer = document.createElement('div')
    const stop = attachWorldHud(layer, m.controller, info)
    m.frame()
    const bars = [...layer.querySelectorAll<HTMLElement>('.hud-oh')]
    expect(bars).toHaveLength(4)
    const head = project(m.camera, 0, overheadLift(capsule(m.match.heroes[0]).height, 1), 0, 1000, 500, screenPoint())
    expect(head.x).toBeCloseTo(500)
    expect(head.y).toBeLessThan(250)
    expect(bars[0].style.transform).toContain(`translate3d(${head.x.toFixed(1)}px, ${head.y.toFixed(1)}px, 0)`)
    expect(bars.map((b) => b.style.visibility)).toEqual(['visible', 'visible', 'visible', 'visible'])
    expect(bars[2].className).toContain('team-1')
    expect(bars[2].querySelector('.hud-oh-name')!.textContent).toBe('Bezos')

    m.match.human = 1
    m.match.heroes[2].alive = false
    m.drawn[3] = { x: 0, y: 0, z: 30 }
    m.frame()
    expect(bars.map((b) => b.style.visibility)).toEqual(['visible', 'hidden', 'hidden', 'hidden'])
    stop()
    expect(layer.children).toHaveLength(0)
    expect(m.listeners()).toBe(0)
  })

  it('reads health, shields and the ultimate straight from the engine every frame', () => {
    const m = fakeMatch()
    const layer = document.createElement('div')
    const stop = attachWorldHud(layer, m.controller, info)
    Object.assign(m.match.heroes[0], { hp: 500, shield: 200 })
    m.match.heroes[0].cooldowns.ultimate = 0
    m.frame()
    const bar = layer.querySelector<HTMLElement>('.hud-oh')!
    expect(bar.querySelector<HTMLElement>('.hud-oh-hp')!.style.transform).toBe('scaleX(0.5)')
    expect(bar.querySelector<HTMLElement>('.hud-oh-sh')!.style.transform).toBe('translateX(50.0%) scaleX(0.2)')
    expect(bar.querySelector('.hud-oh-ult')!.className).toContain('ready')
    expect(bar.querySelector<HTMLElement>('.hud-oh-bar')!.style.getPropertyValue('--seg')).toBe('25.000%')
    stop()
  })

  it('pops a number over the hero that was hit, never over the steered hero', () => {
    const m = fakeMatch()
    const layer = document.createElement('div')
    const stop = attachWorldHud(layer, m.controller, info)
    m.match.human = 0
    m.events([hit(2, 0), hit(0, 2, true)])
    m.frame()
    const numbers = [...layer.querySelectorAll<HTMLElement>('.hud-dmg')]
    expect(numbers).toHaveLength(1)
    expect(numbers[0].className).toContain('heavy')
    expect(numbers[0].className).toContain('own')
    expect(numbers[0].style.visibility).toBe('visible')
    stop()
  })
})

describe('while steering a hero (R14, R42)', () => {
  it('frames the enemy nearest the crosshair and kicks the crosshair on the hero’s own hits', () => {
    const m = fakeMatch()
    m.match.human = 0
    const state = hudState([hudHero(0), hudHero(1), hudHero(2, { hp: 420, cooldowns: slots({ ultimate: 12.5 }) }), hudHero(3)], { controlled: 0 })
    const { container } = render(<ControlHud hero={state.heroes[0]} info={info[0]} controller={m.controller} state={state} heroes={info} />)
    expect(screen.queryByRole('region', { name: 'Target' })).toBeNull()
    act(() => m.frame())
    const target = screen.getByRole('region', { name: 'Target' })
    expect(target.textContent).toContain('Bezos')
    expect(target.textContent).toContain('420')
    expect(within(target).getByRole('img', { name: /^R .+: 13 s$/ })).toBeTruthy()

    const group = screen.getByRole('group', { name: 'Controlled hero' })
    expect(within(group).getByRole('meter', { name: 'Health' }).getAttribute('aria-valuenow')).toBe('800')
    expect(within(group).getAllByRole('img').map((i) => i.getAttribute('aria-label')!.split(' ')[0])).toEqual(['LMB', 'SHIFT', 'Q', 'E', 'R'])

    const crosshair = container.querySelector('.hud-crosshair')!
    act(() => (m.events([hit(0, 2)]), m.frame()))
    expect(crosshair.className).toContain('kick-a')
    act(() => (m.events([hit(0, 2, true)]), m.frame()))
    expect(crosshair.className).toContain('kick-b')
    expect(crosshair.className).toContain('heavy')
    act(() => (m.events([hit(0, 3), death(3)]), m.frame()))
    expect(crosshair.className).toContain('kill')
  })
})
