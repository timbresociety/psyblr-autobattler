import { getTemplate } from '../../charter/templates/catalog.js'
import type { BuildSlot, Template } from '../../charter/types.js'
import { labTemplate, lmb, type LabKit } from '../lab/library.js'
import { ticks } from './calibration.js'
import { initialCoverHealth, type CoverPiece, type MapLine } from './cover.js'
import type { Arena, Combatant } from './match.js'
import { yawPitch, type Vec3 } from './maths.js'
import { addReserves } from './spells.js'
import { AIM_STEPS, MOVES, slotBit, type Command, type JumpPad } from './state.js'

/**
 * John's lab (`/dev/john`, session 2 plan): the House of Instinct's blue deck with what every row of the checklist needs
 * a few steps away (a marked wall, a column, a ledge, a jump pad, a zipline), John, an ally bot, a dummy and an enemy
 * bot. Each bot can be set to stand still, guard, hold a beam on John or fight. Everyone has five times the health, the
 * clock never runs out and damage never ramps, so a row can be tried as often as it takes.
 */

export type BotMode = 'still' | 'block' | 'beam' | 'fight'
export type LabBot = 'ally' | 'dummy' | 'enemy'

/** The heroes by index: John and his ally on blue, the dummy and the enemy bot on red. */
export const LAB_HEROES = { john: 0, ally: 1, dummy: 2, enemy: 3 } as const

export interface LabSetup {
  /** John's buttons, by lab option id (lab/library.ts); a slot left out keeps his build's. */
  kit?: LabKit
  bots?: Partial<Record<LabBot, BotMode>>
}

/** A lab match's live state: what each bot is doing, and each bot's own LMB to give back after a beam. */
export interface LabState {
  bots: Record<LabBot, BotMode>
  own: Partial<Record<number, { template: Template; magazine: number }>>
}

const DECK = 4.5
const HEALTH = 5

/**
 * The pieces on the deck: a marked wall to run, a column, a ledge to mantle, and the rest of the traversal course
 * (scripts/course.mjs): a low block to mantle from the ground, a slab overhead that a jump under it meets (3.2 m of
 * headroom, so the tallest John still stands there), and a tower to hang from.
 */
export const LAB_PIECES: readonly CoverPiece[] = [
  { shape: { kind: 'block', x: 7.65, z: -27, hx: 0.25, hz: 5 }, base: DECK, top: DECK + 4, run: true, look: 'wall' },
  { shape: { kind: 'column', x: 4.5, z: -27, r: 0.5 }, base: DECK, top: DECK + 5, look: 'pillar' },
  { shape: { kind: 'block', x: -6, z: -11.5, hx: 1.5, hz: 1.5 }, base: DECK, top: DECK + 2.1, look: 'grey' },
  { shape: { kind: 'block', x: 14, z: -37, hx: 1.5, hz: 0.6 }, base: DECK, top: DECK + 1, look: 'grey' },
  { shape: { kind: 'block', x: 19, z: -38, hx: 1.5, hz: 1.5 }, base: DECK + 3.2, top: DECK + 3.5, look: 'grey' },
  // a tower to hang from: the 2.1 m ledge is too low for a medium body's hang (its feet 2.2 m under its hands), and a
  // jump from the deck reaches this one's edge with the hands, not the feet
  { shape: { kind: 'block', x: -16, z: -47, hx: 1.5, hz: 1.5 }, base: DECK, top: DECK + 6, look: 'grey' },
]
export const LAB_PAD: JumpPad = { at: { x: 5.5, y: DECK, z: -12 }, r: 0.9, height: 6 }
/** A zipline down the left strip, high enough at its far end for the smallest body to jump to. */
export const LAB_LINE: MapLine = { kind: 'zip', a: { x: -5.5, y: DECK + 3.9, z: -41 }, b: { x: -5.5, y: DECK + 2.3, z: -24 } }

const SPOTS: readonly Vec3[] = [
  { x: 5.5, y: DECK, z: -40 },
  { x: 3.8, y: DECK, z: -38.5 },
  { x: 0, y: DECK, z: -36 },
  { x: -5, y: DECK, z: -20 },
]

/** The lab's teams: everyone five times as hard to put down. */
export const labTeams = (teams: [Combatant[], Combatant[]]): [Combatant[], Combatant[]] =>
  teams.map((side) => side.map((c) => ({ ...c, mods: { ...c.mods, mul: { ...c.mods?.mul, maxHealth: HEALTH - 1 } } }))) as [Combatant[], Combatant[]]

/** Turn a fresh match on the house into the lab. */
export function labArena(arena: Arena, setup: LabSetup) {
  const m = arena.match
  m.fullKit = true
  m.damageRamp = undefined
  arena.timerTicks = ticks(24 * 3600)
  if (m.cover) {
    const pieces = [...m.cover.pieces, ...LAB_PIECES]
    m.cover = { pieces, health: initialCoverHealth(pieces) }
  }
  m.lines = [...(m.lines ?? []), LAB_LINE]
  m.pads = [...(m.pads ?? []), LAB_PAD]
  SPOTS.forEach((at, i) => {
    const h = m.heroes[i]
    if (!h) return
    h.position = { ...at }
    h.airborne = false
    h.yaw = i === 0 ? 0 : yawPitch({ x: SPOTS[0].x - at.x, y: 0, z: SPOTS[0].z - at.z }).yaw
  })
  // the enemy bot carries a Counter, for the row where one cancels a charging cast
  const enemy = arena.setups[LAB_HEROES.enemy]
  if (enemy) enemy.kit = { ...enemy.kit, active2: getTemplate('fighter-riposte') }
  for (const [slot, id] of Object.entries(setup.kit ?? {}) as [BuildSlot, string][]) equip(arena, slot, id)
  // the match reserved its summons' bodies from the kits it started with: John's lab picks may summon more
  addReserves(m, arena.setups)
  arena.lab = { bots: { ally: 'still', dummy: 'still', enemy: 'still', ...setup.bots }, own: {} }
}

/**
 * Put a lab option on John's `slot` now. Returns false when it can't be done live (a summon, whose bodies are made when
 * the match starts: the fight restarts for it) or the id is unknown.
 */
export function equip(arena: Arena, slot: BuildSlot, id: string, live = false): boolean {
  const found = labTemplate(id)
  if (!found || found.slot !== slot || (live && found.restart)) return false
  const setup = arena.setups[LAB_HEROES.john]
  // a new kit object: summons share their owner's setup, and the live kits are cached by it
  setup.kit = { ...setup.kit, [slot]: found.template }
  const john = arena.match.heroes[LAB_HEROES.john]
  john.cooldowns[slot] = 0
  if (john.stock) delete john.stock[slot]
  if (slot === 'active1') {
    setup.magazine = Math.max(2, found.template.ranged?.magazine ?? setup.magazine)
    john.ammo = setup.magazine
    john.reloadUntil = 0
  }
  if (slot === 'passive') john.energy = 1
  return true
}

const BEAM = lmb('magic2', 'channel')

/** The bots' commands this tick, over what the AI chose: still stands, block guards, beam holds a beam on its target. */
export function labCommands(arena: Arena, commands: (Command | undefined)[]) {
  const lab = arena.lab
  if (!lab) return
  const m = arena.match
  for (const bot of ['ally', 'dummy', 'enemy'] as const) {
    const i = LAB_HEROES[bot]
    const h = m.heroes[i]
    if (!h || m.human === i) continue
    const mode = lab.bots[bot]
    beamFor(arena, i, mode === 'beam')
    if (mode === 'fight' || !h.alive) continue
    if (mode === 'still') {
      commands[i] = undefined
      continue
    }
    // its target: John for a red bot, the nearest standing red hero for the ally
    const target = h.team === 1 ? m.heroes[LAB_HEROES.john] : m.heroes.filter((o) => o.team !== h.team && o.alive && !o.summon).sort((a, b) => dist2(a.position, h.position) - dist2(b.position, h.position))[0]
    if (!target) continue
    const { yaw, pitch } = yawPitch({ x: target.position.x - h.position.x, y: target.position.y - h.position.y, z: target.position.z - h.position.z })
    commands[i] = { moveX: 0, moveZ: 0, moves: mode === 'block' ? MOVES.block : 0, aimYaw: steps(yaw), aimPitch: steps(pitch), buttons: mode === 'beam' ? slotBit('active1') : 0 }
  }
}

/** A bot set to beam holds the lab's beam on LMB; set to anything else, it has its own back. */
function beamFor(arena: Arena, i: number, on: boolean) {
  const lab = arena.lab!
  const setup = arena.setups[i]
  const own = lab.own[i]
  if (on && !own) {
    lab.own[i] = { template: setup.kit.active1, magazine: setup.magazine }
    setup.kit = { ...setup.kit, active1: BEAM }
    setup.magazine = BEAM.ranged!.magazine
    arena.match.heroes[i].ammo = setup.magazine
  } else if (!on && own) {
    setup.kit = { ...setup.kit, active1: own.template }
    setup.magazine = own.magazine
    arena.match.heroes[i].ammo = Math.min(arena.match.heroes[i].ammo, own.magazine)
    delete lab.own[i]
  }
}

const dist2 = (a: Vec3, b: Vec3) => (a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z)
const TAU = 2 * Math.PI
const steps = (angle: number) => {
  const a = angle % TAU
  return Math.round(((a < 0 ? a + TAU : a) / TAU) * AIM_STEPS) % AIM_STEPS
}
