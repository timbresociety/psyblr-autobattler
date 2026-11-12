import { scaleMagnitudes } from '../../charter/budget.js'
import { GEOMETRY_DEFAULTS } from '../../charter/geometry.js'
import type { BuildSlot, Delivery, Effect, Template } from '../../charter/types.js'
import { ENGINE, ticks } from './calibration.js'
import { cos, sin } from './maths.js'
import { MOVES, slotBit, type Command, type HeroState } from './state.js'
import { displace, interrupt, immune, togglePassive, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'

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
  /**
   * The V moveset's other blows (GAME.md §4, full kit only): at a sprint, in the air, a slam's landing, the launcher
   * (back + V), and the grab (V + X), whose throw lands as a blow too.
   */
  kind?: BlowKind
}

export type BlowKind = 'dash' | 'air' | 'slam' | 'launcher' | 'grab'

/** Whether a command steers away from where the hero faces: back + V is the launcher. */
const backward = (hero: HeroState, command: Command) => command.moveX * sin(hero.yaw) + command.moveZ * cos(hero.yaw) < -0.5

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
  const full = ctx.match.fullKit
  // V pressed with X held grabs, at once: its release strikes nothing more
  if (full && held && !was && command.moves & MOVES.block && !hero.airborne) {
    hero.basicSince = -1
    strike({ step: 0, kind: 'grab' })
    return
  }
  // V held in the air past the heavy hold plunges into a slam
  if (full && held && hero.airborne && hero.basicSince >= 0 && now - hero.basicSince === ticks(MELEE.heavyHold)) {
    hero.basicSince = -1
    if (!hero.slam && !hero.launch && !hero.hang && !hero.zip && !hero.travel) startSlam(ctx, hero)
    return
  }
  if (held && hero.basicSince >= 0 && now - hero.basicSince === ticks(MELEE.heavyHold)) ctx.events.push({ type: 'melee', hero: hero.id, what: 'charge' })
  // a strike tapped a moment before the last one let go waits for it, rather than being lost
  // a light strike's kind: in the air, at a sprint, or steering back (the launcher)
  const kind: BlowKind | undefined = !full ? undefined : hero.airborne ? 'air' : hero.sprinting ? 'dash' : backward(hero, command) ? 'launcher' : undefined
  const light = () => ({ step: kind === 'dash' || kind === 'launcher' ? 0 : hero.combo.until >= now ? hero.combo.step : 0, ...(kind ? { kind } : {}) })
  if (hero.queued && (now > hero.queued.until || strike(light()))) hero.queued = undefined
  if (!held && was && hero.basicSince >= 0) {
    const heldFor = now - hero.basicSince
    hero.basicSince = -1
    if (heldFor >= ticks(MELEE.heavyHold)) strike({ step: 0, heavy: Math.min(1, (heldFor - ticks(MELEE.heavyHold)) / ticks(MELEE.chargeFull)) })
    else if (!strike(light())) hero.queued = { until: now + ticks(MELEE.buffer) }
  }
}

/** V held in the air: the hero plunges straight down, and strikes where it lands (moveset.ts). */
export function startSlam(ctx: Ctx, hero: HeroState) {
  hero.slam = { from: ctx.match.tick }
  hero.velocity = { x: 0, y: -KIT.slam.speed, z: 0 }
  hero.airJumps = 1
  interrupt(ctx, hero)
  ctx.events.push({ type: 'melee', hero: hero.id, what: 'slam' })
}

/** How much a blow is worth against a light strike: the finisher more, a heavy blow more again the longer it charged. */
export const blowWorth = (blow: MeleeBlow | undefined) => (!blow ? 1 : blow.heavy !== undefined ? MELEE.heavy + (MELEE.heavyFull - MELEE.heavy) * blow.heavy : (blow.step === 2 ? MELEE.finisher : 1) * (blow.pace ?? 1) * (blow.kind ? KIND_WORTH[blow.kind] : 1))
const KIND_WORTH: Record<BlowKind, number> = { dash: KIT.dashAttack.worth, air: KIT.air.worth, slam: KIT.slam.worth, launcher: KIT.launcher.worth, grab: KIT.grab.worth }

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
  let parried = false
  const kept = hit.filter((u) => {
    if (!u.blocking) return true
    const dx = caster.position.x - u.position.x
    const dz = caster.position.z - u.position.z
    const len = Math.sqrt(dx * dx + dz * dz) || 1
    // the caster within the arc the guard faces
    if ((dx / len) * sin(u.yaw) + (dz / len) * cos(u.yaw) < cos(half)) return true
    // a guard raised just before the blow lands is a perfect guard: it catches even a heavy blow, and the striker
    // staggers for longer (GAME.md §4 Defend)
    if (ctx.match.fullKit && u.guardSince !== undefined && now - u.guardSince <= ticks(KIT.parry.window)) {
      parried = true
      ctx.events.push({ type: 'melee', hero: u.id, what: 'parry', by: caster.id })
      return false
    }
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
    caster.stunnedUntil = Math.max(caster.stunnedUntil, now + ticks(parried ? KIT.parry.stagger : MELEE.blockStagger))
    interrupt(ctx, caster)
    if (parried) ctx.events.push({ type: 'melee', hero: caster.id, what: 'stagger' })
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
  const full = ctx.match.fullKit
  if (full && blow.kind && afterKind(ctx, caster, blow, hit, recovery)) return
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
    // with the full kit, a launch that isn't recovered from in the air lands in a knockdown
    if (full) u.floored = true
    interrupt(ctx, u)
    ctx.events.push({ type: 'melee', hero: u.id, what: 'launch', by: caster.id })
  }
}

/**
 * What the V moveset's other blows do once they land (full kit). Returns true when the blow is fully handled; false
 * lets the usual chain and launch run.
 */
function afterKind(ctx: Ctx, caster: HeroState, blow: MeleeBlow, hit: HeroState[], recovery: number): boolean {
  const now = ctx.match.tick
  const live = hit.filter((u) => u.alive && !u.downed && !immune(u, now))
  const template = ctx.setups[caster.id].kit.basic
  switch (blow.kind) {
    case 'dash':
      for (const u of live) displace(ctx, caster, u, template, KIT.dashAttack.push)
      caster.combo = hit.length ? { step: 1, until: Math.max(now + recovery, caster.nextAttackAt) + ticks(MELEE.chain) } : { step: 0, until: 0 }
      return true
    case 'launcher': {
      caster.combo = { step: 0, until: 0 }
      for (const u of live) {
        const height = KIT.launcher.height * M.jumpScale[u.size]
        const n = Math.max(2, ticks(2 * Math.sqrt((2 * height) / M.gravity)))
        u.knockback = undefined
        // no taking control back and not untouchable: it's there to be chased and juggled
        u.launch = { from: now, until: now + n, height, base: u.position.y, juggle: true }
        u.stunnedUntil = Math.max(u.stunnedUntil, now + n)
        u.airborne = true
        u.velocity = { x: 0, y: 0, z: 0 }
        u.slide = undefined
        u.roll = undefined
        u.floored = true
        interrupt(ctx, u)
        ctx.events.push({ type: 'melee', hero: u.id, what: 'launch', by: caster.id })
      }
      if (live.length) caster.chase = { target: live[0].id, until: now + ticks(KIT.launcher.chase) }
      return true
    }
    case 'air': {
      if (!hit.length) {
        caster.combo = { step: 0, until: 0 }
        return true
      }
      // held up too: rising and falling back to where it struck over the target's hold, so the next hit meets it
      caster.velocity.y = Math.max(caster.velocity.y, (M.gravity * KIT.air.hold) / 2)
      const spike = blow.step === 2
      caster.combo = spike ? { step: 0, until: 0 } : { step: blow.step + 1, until: Math.max(now + recovery, caster.nextAttackAt) + ticks(MELEE.chain) }
      for (const u of live) {
        if (!u.airborne && !u.launch) continue
        u.knockback = undefined
        u.floored = true
        interrupt(ctx, u)
        if (spike) {
          // the third air hit drives it into the floor
          u.launch = undefined
          u.airborne = true
          u.velocity = { x: 0, y: -KIT.air.spike, z: 0 }
          u.stunnedUntil = Math.max(u.stunnedUntil, now + ticks(0.6))
          ctx.events.push({ type: 'melee', hero: u.id, what: 'spike', by: caster.id })
        } else {
          // held where it is, a little bump, for the next hit to land
          const n = ticks(KIT.air.hold)
          u.launch = { from: now, until: now + n, height: KIT.air.bump, base: u.position.y, juggle: true }
          u.stunnedUntil = Math.max(u.stunnedUntil, now + n)
          u.velocity = { x: 0, y: 0, z: 0 }
          ctx.events.push({ type: 'melee', hero: u.id, what: 'juggle', by: caster.id })
        }
      }
      return true
    }
    default:
      return false
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
  hero.floored = undefined
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
