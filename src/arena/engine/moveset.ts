import { ENGINE, ticks } from './calibration.js'
import { blowTemplate } from './combat.js'
import { displace, enemiesOf, fate, interrupt, immune, resolve, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'
import { standOn } from './locomotion.js'
import { cos, sin } from './maths.js'
import { capsule, MOVES, standing, type Command, type HeroState } from './state.js'

/**
 * The locked library's fight moves that outlast a single blow (GAME.md §4, "Shared" and the V moveset): knockdowns
 * and getting up, the grab's hold and throw, the slam's landing, the launcher's chase, and the downed state with its
 * revive. Only matches with `fullKit` reach them. Blows choose their kind in combat.ts; this runs what follows.
 */

const M = ENGINE.move

const facing = (h: HeroState) => ({ x: sin(h.yaw), z: cos(h.yaw) })
const flat = (a: HeroState, b: HeroState) => {
  const dx = a.position.x - b.position.x
  const dz = a.position.z - b.position.z
  return Math.sqrt(dx * dx + dz * dz)
}

/** Knock a hero down where it lies: out of control until it gets up or rolls out (KIT.down). */
export function knockDown(ctx: Ctx, hero: HeroState) {
  const now = ctx.match.tick
  hero.floored = undefined
  hero.down = { from: now, until: now + ticks(KIT.down.time) }
  hero.stunnedUntil = Math.max(hero.stunnedUntil, hero.down.until)
  hero.velocity = { x: 0, y: 0, z: 0 }
  hero.slide = undefined
  hero.roll = undefined
  hero.blocking = false
  interrupt(ctx, hero)
  ctx.events.push({ type: 'melee', hero: hero.id, what: 'knockdown' })
}

/**
 * A knocked-down hero, before the tick checks whether it can act: it gets up when its time is up, untouchable while it
 * rises, or rolls out at once on a dodge or a jump once `techAfter` has passed. Returns whether it rolled out.
 */
export function getUp(ctx: Ctx, hero: HeroState, command: Command | undefined): boolean {
  const d = hero.down
  if (!d) return false
  const now = ctx.match.tick
  if (now >= d.until) {
    hero.down = undefined
    const rise = now + ticks(KIT.down.rise)
    hero.invulnerableUntil = Math.max(hero.invulnerableUntil, rise)
    hero.stunnedUntil = Math.max(hero.stunnedUntil, rise)
    ctx.events.push({ type: 'melee', hero: hero.id, what: 'get-up' })
    return false
  }
  if (!command || now - d.from < ticks(KIT.down.techAfter) || !(command.moves & (MOVES.dodge | MOVES.jump))) return false
  const steer = Math.sqrt(command.moveX * command.moveX + command.moveZ * command.moveZ)
  const [x, z] = steer > 0.1 ? [command.moveX / steer, command.moveZ / steer] : [facing(hero).x, facing(hero).z]
  hero.down = undefined
  hero.stunnedUntil = Math.min(hero.stunnedUntil, now)
  hero.roll = { from: now, until: now + ticks(M.roll.time), x, z }
  hero.invulnerableUntil = Math.max(hero.invulnerableUntil, now + ticks(M.roll.time))
  hero.stance = 'stand'
  // the keys that rolled it out don't roll it again
  hero.held = command.moves
  ctx.events.push({ type: 'move', hero: hero.id, move: 'wake-roll' })
  return true
}

/** V + X lands: the nearest enemy within reach ahead, on the ground and not untouchable, is caught and held. */
export function grabAt(ctx: Ctx, caster: HeroState): boolean {
  const now = ctx.match.tick
  const f = facing(caster)
  const half = ((KIT.grab.arc / 2) * Math.PI) / 180
  let prey: HeroState | undefined
  let best = Infinity
  for (const e of enemiesOf(ctx.match, caster)) {
    if (e.airborne || immune(e, now) || e.grabbedBy !== undefined || e.down) continue
    const d = flat(caster, e)
    const gap = d - capsule(caster).radius - capsule(e).radius
    if (gap > KIT.grab.reach || d < 1e-6) continue
    if (((e.position.x - caster.position.x) * f.x + (e.position.z - caster.position.z) * f.z) / d < cos(half)) continue
    if (gap < best) ((best = gap), (prey = e))
  }
  ctx.events.push({ type: 'melee', hero: caster.id, what: prey ? 'grab' : 'grab-miss', ...(prey ? { by: prey.id } : {}) })
  if (!prey) return false
  caster.grab = { target: prey.id, from: now, until: now + ticks(KIT.grab.hold) }
  prey.grabbedBy = caster.id
  prey.blocking = false
  prey.knockback = undefined
  prey.slide = undefined
  prey.roll = undefined
  prey.stunnedUntil = Math.max(prey.stunnedUntil, caster.grab.until + 1)
  interrupt(ctx, prey)
  return true
}

/** Let go of whatever a hero holds, without a throw (it was knocked away, stunned or downed). */
function release(hero: HeroState, match: Ctx['match']) {
  const g = hero.grab
  if (!g) return
  hero.grab = undefined
  const prey = match.heroes[g.target]
  if (prey?.grabbedBy === hero.id) {
    prey.grabbedBy = undefined
    prey.stunnedUntil = Math.min(prey.stunnedUntil, match.tick)
    standOn(prey, match)
  }
}

/** One tick of a grab: the held hero stays in front of the holder, and is thrown along the holder's facing at the end. */
function holdGrab(ctx: Ctx, hero: HeroState) {
  const g = hero.grab!
  const now = ctx.match.tick
  const prey = ctx.match.heroes[g.target]
  if (!prey?.alive || prey.downed || !standing(hero) || hero.stunnedUntil > now || hero.knockback || hero.launch) return release(hero, ctx.match)
  const f = facing(hero)
  const reach = capsule(hero).radius + capsule(prey).radius + 0.1
  prey.position = { x: hero.position.x + f.x * reach, y: hero.position.y + 0.25, z: hero.position.z + f.z * reach }
  prey.velocity = { x: 0, y: 0, z: 0 }
  prey.yaw = hero.yaw + Math.PI
  if (now < g.until) return
  hero.grab = undefined
  prey.grabbedBy = undefined
  prey.stunnedUntil = Math.min(prey.stunnedUntil, now)
  const template = blowTemplate(ctx.setups[hero.id].kit.basic, { step: 0, kind: 'grab' })
  ctx.events.push({ type: 'melee', hero: hero.id, what: 'throw', by: prey.id })
  resolve(ctx, hero, template, 'basic', [prey], { ...prey.position })
  if (!prey.alive || prey.downed) return
  prey.position.y = hero.position.y
  displace(ctx, hero, prey, template, KIT.grab.throw)
  prey.stunnedUntil = Math.max(prey.stunnedUntil, now + ticks(ENGINE.knockbackTime))
  prey.floored = true
}

function slamLands(ctx: Ctx, hero: HeroState) {
  hero.slam = undefined
  const now = ctx.match.tick
  const at = { ...hero.position }
  const template = blowTemplate(ctx.setups[hero.id].kit.basic, { step: 0, kind: 'slam' })
  const hit = enemiesOf(ctx.match, hero).filter((e) => flat(hero, e) - capsule(e).radius <= KIT.slam.radius && Math.abs(e.position.y - at.y) <= ENGINE.groundReach && !immune(e, now))
  ctx.events.push({ type: 'melee', hero: hero.id, what: 'slam-land' })
  ctx.events.push({ type: 'impact', hero: hero.id, slot: 'basic', at, radius: KIT.slam.radius, range: 0 })
  resolve(ctx, hero, template, 'basic', hit, at)
  for (const u of hit) {
    if (!u.alive || u.downed) continue
    const n = Math.max(2, ticks(2 * Math.sqrt((2 * KIT.slam.pop) / M.gravity)))
    u.knockback = undefined
    u.launch = { from: now, until: now + n, height: KIT.slam.pop, base: u.position.y }
    u.stunnedUntil = Math.max(u.stunnedUntil, now + n)
    u.airborne = true
    u.floored = true
    interrupt(ctx, u)
  }
  hero.nextAttackAt = Math.max(hero.nextAttackAt, now + ticks(0.35))
  hero.stunnedUntil = Math.max(hero.stunnedUntil, now + ticks(0.2))
}

/**
 * After its launcher lands, a hero's jump chases its target: the jump is turned to reach the target's peak, along the
 * way to it. Called after the hero moved, with this tick's events, which hold its jump if it jumped.
 */
export function chaseJump(ctx: Ctx, hero: HeroState) {
  const c = hero.chase
  if (!c) return
  const now = ctx.match.tick
  if (now > c.until) return void (hero.chase = undefined)
  if (!ctx.events.some((e) => e.type === 'move' && e.hero === hero.id && e.move === 'jump')) return
  hero.chase = undefined
  const prey = ctx.match.heroes[c.target]
  if (!prey?.alive || !prey.launch) return
  // meet it at the top of its flight: rising fast enough to be level with it when it peaks (never sooner than a beat)
  const l = prey.launch
  const peak = l.base + l.height
  const time = Math.max(0.25, ((l.from + l.until) / 2 - now) / ENGINE.tickHz)
  const vy = (peak - hero.position.y) / time + (M.gravity * time) / 2
  const dx = prey.position.x - hero.position.x
  const dz = prey.position.z - hero.position.z
  const d = Math.sqrt(dx * dx + dz * dz)
  // stop a body's width short of it, so the air strike lands rather than passes
  const go = Math.max(0, d - capsule(hero).radius - capsule(prey).radius - 0.6)
  hero.velocity = { x: d > 1e-6 ? (dx / d) * (go / time) : 0, y: vy, z: d > 1e-6 ? (dz / d) * (go / time) : 0 }
  hero.airSpeed = go / time
  ctx.events.push({ type: 'move', hero: hero.id, move: 'chase' })
}

/** A hero's health ran out while an ally still stands: it goes down instead of dying (KIT.downed). */
export function goDown(ctx: Ctx, hero: HeroState) {
  const now = ctx.match.tick
  hero.hp = 1
  hero.downed = { from: now, until: now + ticks(KIT.downed.bleed), revive: 0, by: -1 }
  hero.action = undefined
  hero.down = undefined
  hero.floored = undefined
  hero.slam = undefined
  hero.blocking = false
  hero.passiveOn = false
  hero.stance = 'prone'
  release(hero, ctx.match)
  if (hero.grabbedBy !== undefined) release(ctx.match.heroes[hero.grabbedBy], ctx.match)
  if (hero.hang || hero.zip || hero.wallRun) {
    hero.hang = undefined
    hero.zip = undefined
    hero.wallRun = undefined
    hero.airborne = true
  }
  ctx.events.push({ type: 'downed', hero: hero.id, phase: 'down' })
}

/** Whether a dying hero goes down instead: only with the full kit, and while an ally still stands to revive it. */
export const goesDown = (ctx: Ctx, hero: HeroState) => !!ctx.match.fullKit && !hero.downed && !hero.summon && ctx.match.heroes.some((o) => o !== hero && o.team === hero.team && !o.summon && standing(o))

/** A downed hero crawls; it takes no other action. */
export function crawlCommand(command: Command | undefined): Command {
  return { moveX: command?.moveX ?? 0, moveZ: command?.moveZ ?? 0, moves: 0, aimYaw: command?.aimYaw ?? 0, aimPitch: command?.aimPitch ?? 0, buttons: 0 }
}

/**
 * The interact key held beside a downed ally revives it over KIT.downed.time; the helper does nothing else meanwhile.
 * Letting go, or stepping away, loses the progress. Returns whether the hero is busy reviving.
 */
export function reviveButton(ctx: Ctx, index: number, command: Command): boolean {
  const { match } = ctx
  const hero = match.heroes[index]
  const now = match.tick
  const stop = () => {
    const was = hero.reviving && match.heroes[hero.reviving.ally]
    if (was?.downed && was.downed.by === hero.id) was.downed.revive = 0
    hero.reviving = undefined
    return false
  }
  if (!match.fullKit || !(command.moves & MOVES.interact) || hero.airborne || !standing(hero)) return stop()
  let ally: HeroState | undefined
  let best = Infinity
  for (const o of match.heroes) {
    if (o === hero || o.team !== hero.team || !o.alive || !o.downed) continue
    const d = flat(hero, o)
    if (d <= KIT.downed.reach + capsule(hero).radius && d < best) ((best = d), (ally = o))
  }
  if (!ally) return stop()
  if (hero.reviving?.ally !== ally.id) {
    stop()
    hero.reviving = { ally: ally.id, from: now }
    ally.downed!.revive = 0
    ctx.events.push({ type: 'downed', hero: ally.id, phase: 'revive-start', by: hero.id })
  }
  ally.downed!.by = hero.id
  if (++ally.downed!.revive >= ticks(KIT.downed.time)) revive(ctx, ally, hero.id)
  hero.velocity.x = 0
  hero.velocity.z = 0
  return true
}

/** Back on its feet at a share of its health (an ally's help, or a spell or an ultimate that revives). */
export function revive(ctx: Ctx, hero: HeroState, by: number, share: number = KIT.downed.health) {
  const now = ctx.match.tick
  hero.downed = undefined
  hero.hp = Math.max(1, hero.maxHp * share)
  hero.stance = 'stand'
  hero.invulnerableUntil = Math.max(hero.invulnerableUntil, now + ticks(1))
  hero.stunnedUntil = Math.min(hero.stunnedUntil, now)
  for (const o of ctx.match.heroes) if (o.reviving?.ally === hero.id) o.reviving = undefined
  ctx.events.push({ type: 'downed', hero: hero.id, phase: 'revived', by })
}

function bleedOut(ctx: Ctx, hero: HeroState) {
  hero.downed = undefined
  hero.alive = false
  hero.hp = 0
  hero.knockback = undefined
  hero.launch = undefined
  for (const o of ctx.match.heroes) if (o.reviving?.ally === hero.id) o.reviving = undefined
  ctx.events.push({ type: 'downed', hero: hero.id, phase: 'out' })
  ctx.events.push({ type: 'death', hero: hero.id })
}

/** Once a tick after everything has moved: grabs held and thrown, slams landing, flights ending in knockdowns, the downed bleeding out. */
export function tickMoveset(ctx: Ctx) {
  const { match } = ctx
  if (!match.fullKit) return
  const now = match.tick
  for (const hero of match.heroes) {
    if (!hero.alive) continue
    if (hero.grab) holdGrab(ctx, hero)
    if (hero.slam && !hero.airborne) slamLands(ctx, hero)
    if (hero.slam && (hero.launch || hero.knockback || hero.downed)) hero.slam = undefined
    if (hero.floored && !hero.airborne && !hero.launch && !hero.knockback && hero.grabbedBy === undefined && !hero.downed) knockDown(ctx, hero)
    if (hero.downed) {
      const helped = match.heroes.some((o) => o !== hero && o.team === hero.team && !o.summon && standing(o))
      if (now >= hero.downed.until || !helped) bleedOut(ctx, hero)
    }
  }
}

fate.goesDown = goesDown
fate.goDown = goDown
