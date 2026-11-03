import { scaleMagnitudes } from '../../charter/budget.js'
import { GEOMETRY_DEFAULTS } from '../../charter/geometry.js'
import type { BuildSlot, Delivery, Effect, Template } from '../../charter/types.js'
import { ENGINE, ticks } from './calibration.js'
import { cos, sin } from './maths.js'
import { slotBit, type Command, type HeroState } from './state.js'
import { interrupt, immune, togglePassive, type Ctx } from './effects.js'

/**
 * Melee as the canon has it (docs/plans/2026-10-31-canon-psyblr-human.md): the basic attack button tapped strikes,
 * held charges a heavy blow that lands when let go. Strikes that land chain, light, light, then the finisher; the
 * finisher and the heavy blow launch the target, which is out of control and untouchable until it takes control back
 * with any input. A guard (X) catches melee from in front and breaks the striker's chain. AI and players press the
 * same buttons, so both go through here.
 */

const MELEE = ENGINE.melee
const M = ENGINE.move
const BASIC = slotBit('basic')
const PASSIVE = slotBit('passive')
/** Deliveries that strike in reach, which a guard catches. */
const CLOSE = new Set<Delivery['kind']>(['melee', 'cone'])

/**
 * What a basic attack carries: its step in the chain (2 the finisher), or how charged a heavy blow is (0 to 1), and
 * `pace`, the share of a strike's damage it carries when it follows the last sooner than the hero's attack speed would
 * (the chain's beat, deliveries.ts).
 */
export interface MeleeBlow {
  step: number
  heavy?: number
  pace?: number
}

/**
 * Read this tick's basic attack and passive buttons: a press starts the hold, a release strikes (a light strike, or
 * past the heavy hold a heavy blow), and the passive's button turns it on or off. `strike` casts the basic attack.
 */
export function meleeButtons(ctx: Ctx, index: number, command: Command, strike: (blow: MeleeBlow) => boolean) {
  const hero = ctx.match.heroes[index]
  const now = ctx.match.tick
  const held = command.buttons & BASIC
  const was = hero.buttonsHeld & BASIC
  if (command.buttons & PASSIVE && !(hero.buttonsHeld & PASSIVE)) togglePassive(ctx, hero)
  hero.buttonsHeld = command.buttons
  if (held && !was) hero.basicSince = now
  if (held && hero.basicSince >= 0 && now - hero.basicSince === ticks(MELEE.heavyHold)) ctx.events.push({ type: 'melee', hero: hero.id, what: 'charge' })
  // a strike tapped a moment before the last one let go waits for it, rather than being lost
  if (hero.queued && (now > hero.queued.until || strike({ step: hero.combo.until >= now ? hero.combo.step : 0 }))) hero.queued = undefined
  if (!held && was && hero.basicSince >= 0) {
    const heldFor = now - hero.basicSince
    hero.basicSince = -1
    if (heldFor >= ticks(MELEE.heavyHold)) strike({ step: 0, heavy: Math.min(1, (heldFor - ticks(MELEE.heavyHold)) / ticks(MELEE.chargeFull)) })
    else if (!strike({ step: hero.combo.until >= now ? hero.combo.step : 0 })) hero.queued = { until: now + ticks(MELEE.buffer) }
  }
}

/** How much a blow is worth against a light strike: the finisher more, a heavy blow more again the longer it charged. */
export const blowWorth = (blow: MeleeBlow | undefined) => (!blow ? 1 : blow.heavy !== undefined ? MELEE.heavy + (MELEE.heavyFull - MELEE.heavy) * blow.heavy : (blow.step === 2 ? MELEE.finisher : 1) * (blow.pace ?? 1))

/** The basic attack's template for a blow, its magnitudes scaled by what the blow is worth. */
export const blowTemplate = (template: Template, blow: MeleeBlow | undefined) => {
  const worth = blowWorth(blow)
  return worth === 1 ? template : scaleMagnitudes(template, worth)
}

/**
 * The ranged weapon fires on repeat (§4 LMB): each shot is the weapon's template. A shotgun's pellets each carry
 * `share` of it (combat.ts, shotTemplate); `rider` says whether its slows, marks and the like ride along (always, now:
 * a weapon's rider is part of every shot).
 */
export interface Shot {
  share: number
  rider: boolean
}

const SHARED = new Set<Effect['kind']>(['damage', 'heal', 'shield'])
const shots = new WeakMap<Template, Map<string, Template>>()

export function shotTemplate(template: Template, shot: Shot | undefined): Template {
  if (!shot) return template
  const key = `${shot.share.toFixed(4)}/${shot.rider}`
  let mine = shots.get(template)
  if (!mine) shots.set(template, (mine = new Map()))
  let out = mine.get(key)
  if (!out) {
    const effects = template.effects.flatMap((e): Effect[] => {
      if (SHARED.has(e.kind)) return [{ ...e, amount: (e as { amount: number }).amount * shot.share, ratio: (e as { ratio: number }).ratio * shot.share } as Effect]
      return shot.rider || e.kind === 'execute' ? [e] : []
    })
    mine.set(key, (out = { ...template, delivery: shotDelivery(template), effects }))
  }
  return out
}

/** A pellet of a cone-shaped weapon flies as a shot across the cone's reach; beams and shots stay as they are. */
function shotDelivery(template: Template): Template['delivery'] {
  const d = template.delivery
  if (d.kind === 'projectile' || d.kind === 'beam') return d
  return { kind: 'projectile', range: Math.max(d.range, 6), speed: GEOMETRY_DEFAULTS.speed, projectileRadius: GEOMETRY_DEFAULTS.projectileRadius }
}

/**
 * Seconds between a weapon's shots (§5: fire rate follows attack speed): the weapon's rate times the sheet's fire rate,
 * then buffs and cripples (`tempo`), never faster than one shot every `fastest` seconds.
 */
export const shotSeconds = (rate: number, fireRate: number, tempo = 1) => Math.max(ENGINE.primary.fastest, 1 / Math.max(0.2, rate * fireRate * tempo))

/**
 * Take out of `hit` everyone whose guard faces the caster of a close blow: each reports the block, and the striker's
 * chain breaks and it staggers. Returns who is still hit.
 */
export function guarded(ctx: Ctx, caster: HeroState, template: Template, hit: HeroState[], blow?: MeleeBlow): HeroState[] {
  if (!CLOSE.has(template.delivery.kind)) return hit
  const now = ctx.match.tick
  const half = ((MELEE_BLOCK_ARC / 2) * Math.PI) / 180
  const kept = hit.filter((u) => {
    if (!u.blocking) return true
    const dx = caster.position.x - u.position.x
    const dz = caster.position.z - u.position.z
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    // the caster within the arc the guard faces
    if ((dx / len) * sin(u.yaw) + (dz / len) * cos(u.yaw) < cos(half)) return true
    // a heavy blow breaks the guard (§5): the guard drops, the guard staggers, and the blow lands
    if (blow?.heavy !== undefined) {
      u.blocking = false
      u.stunnedUntil = Math.max(u.stunnedUntil, now + ticks(MELEE.guardBreak))
      interrupt(ctx, u)
      ctx.events.push({ type: 'melee', hero: u.id, what: 'guard-broken', by: caster.id })
      return true
    }
    ctx.events.push({ type: 'melee', hero: u.id, what: 'blocked', by: caster.id })
    return false
  })
  if (kept.length < hit.length) {
    caster.combo = { step: 0, until: 0 }
    caster.stunnedUntil = Math.max(caster.stunnedUntil, now + ticks(MELEE.blockStagger))
    interrupt(ctx, caster)
  }
  return kept
}
const MELEE_BLOCK_ARC = M.block.arcDegrees

/**
 * After a basic attack lands: the chain moves on when it hit and breaks when it missed, and a finisher or a heavy
 * blow launches whoever it hit, as high as its own double jump or jump, pushed away from the striker.
 */
export function afterBlow(ctx: Ctx, caster: HeroState, blow: MeleeBlow | undefined, hit: HeroState[], recovery: number) {
  if (!blow) return
  const now = ctx.match.tick
  const launches = blow.heavy !== undefined || blow.step === 2
  if (blow.heavy !== undefined || !hit.length) caster.combo = { step: 0, until: 0 }
  // the chain stays open for a while after the next strike is allowed, however slowly the hero swings
  else caster.combo = { step: (blow.step + 1) % 3, until: Math.max(now + recovery, caster.nextAttackAt) + ticks(MELEE.chain) }
  if (!launches) return
  const lift = blow.heavy !== undefined ? M.jump : M.jump + M.airJump
  for (const u of hit) {
    if (!u.alive || immune(u, now)) continue
    // a big body flies as much lower as it jumps lower
    const height = lift * M.jumpScale[u.size]
    // up and down under gravity: a parabola that takes as long as a jump that high
    const n = Math.max(2, ticks(2 * Math.sqrt((2 * height) / M.gravity)))
    const dx = u.position.x - caster.position.x
    const dz = u.position.z - caster.position.z
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    const step = MELEE.launchPush / n
    u.knockback = undefined
    u.launch = { from: now, until: now + n, height, base: u.position.y, regain: true, push: { x: (dx / len) * step, z: (dz / len) * step } }
    u.stunnedUntil = Math.max(u.stunnedUntil, now + n)
    u.invulnerableUntil = Math.max(u.invulnerableUntil, now + n)
    u.airborne = true
    u.velocity = { x: 0, y: 0, z: 0 }
    u.slide = undefined
    u.roll = undefined
    u.combo = { step: 0, until: 0 }
    interrupt(ctx, u)
    ctx.events.push({ type: 'melee', hero: u.id, what: 'launch', by: caster.id })
  }
}

/**
 * A launched hero takes control back with any input once `regainAfter` has passed: the launch ends where it is, it
 * can be hit again, and it falls from there as from a jump. Returns whether it did.
 */
export function regain(ctx: Ctx, hero: HeroState, command: Command | undefined): boolean {
  const l = hero.launch
  const now = ctx.match.tick
  if (!l?.regain || !command || now - l.from < ticks(MELEE.regainAfter)) return false
  const input = command.moves !== 0 || command.buttons !== 0 || Math.abs(command.moveX) + Math.abs(command.moveZ) > 0.1
  if (!input) return false
  hero.launch = undefined
  hero.stunnedUntil = Math.min(hero.stunnedUntil, now)
  hero.invulnerableUntil = Math.min(hero.invulnerableUntil, now)
  hero.airborne = true
  hero.velocity = { x: 0, y: 0, z: 0 }
  // the keys that took control back don't also jump or strike
  hero.held = command.moves
  hero.buttonsHeld = command.buttons
  ctx.events.push({ type: 'melee', hero: hero.id, what: 'regain' })
  return true
}

/** Which slots the skill loop casts: everything but the basic attack (meleeButtons) and the passive (a toggle). */
export const SKILL_SLOTS: readonly BuildSlot[] = ['movement', 'ultimate', 'active1', 'active2']
