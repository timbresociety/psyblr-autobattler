import { geometryOf } from '../../charter/geometry.js'
import type { RoleId } from '../../charter/types.js'
import { SIZES } from '../../charter/sizes.js'
import { MELEE_STYLES } from '../../charter/templates/styles.js'
import type { BuildSlot, Effect, Template } from '../../charter/types.js'
import { DT, ENGINE, ticks } from './calibration.js'
import { controlled, enemiesOf, firePassive, resolve, sumBuff, tickStatuses, type Ctx } from './effects.js'
import { next } from './rng.js'
import { tickWorld } from './world.js'
import { GRIDS, HeroGrid } from './grid.js'
import { afterBlow, blowTemplate, guarded, meleeButtons, regain, shotSeconds, shotTemplate, SKILL_SLOTS, type MeleeBlow, type Shot } from './combat.js'
import { coverHit, coverInDisc, floorUnder } from './cover.js'
import { keepOut, standOn } from './locomotion.js'
import { PI, add, clamp, cos, direction, distance, distanceToSegment, dot, length, normalize, scale, segmentToCapsuleAxis, sin, sub, yawPitch, type Vec3 } from './maths.js'
import { bodyRadius, capsule, slotBit, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'
import type { TickRules } from './tick.js'
import { BASIC_SHARE, timingOf, timingTicks } from './timing.js'

/**
 * Where casts land (U4, KTD3). Every hit is engine geometry: heroes are vertical capsules, and each delivery is
 * sized from its own template numbers, which the effect renderer reads too, so what you see is what can hit you.
 */


/** A leap sails over cover lower than this, metres; taller ruins stop it like a dash. */
const LEAP_CLEARS = 3.3

export const chest = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })
export const aim = (h: HeroState) => direction(h.yaw, h.pitch)

/** Who a taunt makes this hero attack, while it lasts and the taunter lives. */
export function taunter(match: MatchState, h: HeroState): HeroState | undefined {
  if (!controlled(h, 'taunt', match.tick) || h.tauntBy < 0) return undefined
  const t = match.heroes[h.tauntBy]
  return t?.alive ? t : undefined
}

/** Where a hero's attack goes: its aim, or straight at whoever taunted it. */
function aimOf(match: MatchState, h: HeroState): Vec3 {
  const t = taunter(match, h)
  return t ? normalize(sub(chest(t), chest(h))) : aim(h)
}
const top = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height, z: h.position.z })
/** Gap from a point to the surface of a hero's capsule. */
const gap = (p: Vec3, h: HeroState) => distanceToSegment(p, h.position, top(h)) - capsule(h).radius
const inArc = (from: Vec3, d: Vec3, h: HeroState, degrees: number) => dot(d, normalize(sub(chest(h), from))) >= cos((degrees / 2) * (PI / 180))
const nearest = (from: Vec3, hs: HeroState[]) => (hs.length ? [hs.reduce((a, b) => (gap(from, b) < gap(from, a) ? b : a))] : [])
/** Roles that fight from range by choice (every hero has both a melee style and a ranged weapon, §4). */
const KEEPS_RANGE = new Set<RoleId>(['mage', 'marksman', 'support', 'controller', 'summoner'])
export const isRanged = (setup: HeroSetup) => KEEPS_RANGE.has(setup.build.roleId)

export interface Landing {
  hit: HeroState[]
  at: Vec3
  /** Cover the delivery struck, and where: a wall in the way, or every barrier inside a blast. */
  cover?: { index: number; at: Vec3 }[]
}

/** True when no standing ruin blocks the straight line between two points (R25). */
export function canSee(match: MatchState, a: Vec3, b: Vec3): boolean {
  return !match.cover || !coverHit(match.cover.pieces, match.cover.health, a, b)
}

/** The first piece of cover along a→b, with the point it is struck, if any. */
function firstCover(match: MatchState, a: Vec3, b: Vec3, radius = 0): { index: number; at: Vec3; t: number } | undefined {
  if (!match.cover) return undefined
  const hit = coverHit(match.cover.pieces, match.cover.health, a, b, radius)
  return hit ? { index: hit.index, t: hit.t, at: add(a, scale(sub(b, a), hit.t)) } : undefined
}

/** Every barrier inside a blast of `radius` around `at`. */
function coverInBlast(match: MatchState, at: Vec3, radius: number): { index: number; at: Vec3 }[] {
  return match.cover ? coverInDisc(match.cover.pieces, match.cover.health, at, radius).map((index) => ({ index, at })) : []
}

/** What one hit of a template does to a barrier: its direct damage at the caster's numbers. */
function barrierDamage(setup: HeroSetup, template: Template): number {
  let total = 0
  for (const e of template.effects as Effect[]) if (e.kind === 'damage' && !e.overTime) total += e.amount + e.ratio * setup.sheet[e.scaling]
  return total
}

/** Wear a barrier down; unbreakable ruins just report the hit so the client can show it. */
function strikeCover(ctx: Ctx, caster: HeroState, template: Template, struck: { index: number; at: Vec3 }[] = []) {
  const cover = ctx.match.cover
  if (!cover) return
  const amount = barrierDamage(ctx.setups[caster.id], template)
  for (const { index, at } of struck) {
    const before = cover.health[index]
    if (before > 0 && amount > 0) cover.health[index] = Math.max(0, before - amount)
    ctx.events.push({ type: 'cover-hit', index, at, health: cover.health[index] })
    if (before > 0 && cover.health[index] === 0) ctx.events.push({ type: 'cover-broken', index, at })
  }
}

/**
 * How far along the aim a ground skill lands: on the first enemy the aim passes over within its range, else where
 * the aim meets the floor, else at full range. So a zone lands where the player points, and the AI's lands on its
 * target, instead of always at the far end of its range.
 */
function zoneReach(enemies: readonly HeroState[], from: Vec3, dir: Vec3, range: number, radius: number): number {
  let first = Infinity
  for (const e of enemies) {
    const to = sub(chest(e), from)
    const along = dot(to, dir)
    if (along <= 0 || along > range + radius) continue
    if (length(sub(to, scale(dir, along))) <= radius + capsule(e).radius && along < first) first = along
  }
  if (first < Infinity) return Math.min(first, range)
  return dir.y < -0.05 ? clamp(from.y / -dir.y, 0.5, range) : range
}

/** The enemies an instant delivery reaches from the caster's current aim, and where it lands. */
export function landing(ctx: Ctx, caster: HeroState, template: Template, aimed?: { from: Vec3; dir: Vec3 }, prefer?: HeroState): Landing {
  const d = template.delivery
  const from = aimed?.from ?? chest(caster)
  const dir = aimed?.dir ?? aimOf(ctx.match, caster)
  const enemies = enemiesOf(ctx.match, caster)
  const reach = SIZES[caster.size].reachBonus
  const m = ctx.match
  // cover blocks anything aimed straight at a body; area blasts and auras land wherever they land
  const seen = (e: HeroState) => canSee(m, from, chest(e))
  // a swing or a lunge that reaches no hero can still strike the wall in front of it
  const swing = (hit: HeroState[], range: number): Landing => {
    const end = add(from, scale(dir, range))
    const wall = hit.length ? undefined : firstCover(m, from, end)
    return { hit, at: wall?.at ?? end, cover: wall ? [wall] : undefined }
  }
  // a leap with a radius brings what it carries down on everyone near where it lands
  if (d.kind === 'leap' && d.radius) {
    const p = caster.position
    const radius = d.radius
    return { hit: enemies.filter((e) => gap(p, e) <= radius), at: { ...p }, cover: coverInBlast(m, p, radius) }
  }
  switch (d.kind) {
    case 'melee': {
      // reach runs from the caster's body, not its chest: surface to surface, the way players and the AI judge it
      const inRange = (e: HeroState) => gap(from, e) - capsule(caster).radius <= d.range + ENGINE.meleeSlack + reach && seen(e)
      // the swing's magnet: the hero it lunged at is struck while it's still in reach and roughly ahead (§5)
      if (prefer?.alive && enemies.includes(prefer) && inRange(prefer) && inArc(from, dir, prefer, ENGINE.melee.lungeArc * 2)) return swing([prefer], d.range)
      const inReach = enemies.filter((e) => inRange(e) && inArc(from, dir, e, geometryOf(d).arcDegrees))
      return swing(nearest(from, inReach), d.range)
    }
    case 'cone':
      return swing(
        enemies.filter((e) => gap(from, e) <= d.range && inArc(from, dir, e, geometryOf(d).arcDegrees) && seen(e)),
        d.range,
      )
    case 'beam': {
      // a beam stops at the first wall it meets
      const full = add(from, scale(dir, d.range))
      const wall = firstCover(m, from, full, geometryOf(d).width / 2)
      const end = wall?.at ?? full
      return { hit: enemies.filter((e) => segmentToCapsuleAxis(from, end, e.position, capsule(e).height) <= geometryOf(d).width / 2 + capsule(e).radius), at: end, cover: wall ? [wall] : undefined }
    }
    case 'zone': {
      if (d.range > 0) {
        const centre = add(from, scale(dir, zoneReach(enemies, from, dir, d.range, d.radius ?? 0)))
        return { hit: enemies.filter((e) => gap(centre, e) <= (d.radius ?? 0)), at: centre, cover: coverInBlast(m, centre, d.radius ?? 0) }
      }
      // a zone with no range is a disc at the caster's level: heroes flying well above or below escape it
      const p = caster.position
      const flat = (e: HeroState) => distance({ x: e.position.x, y: 0, z: e.position.z }, { x: p.x, y: 0, z: p.z }) - capsule(e).radius
      return { hit: enemies.filter((e) => flat(e) <= (d.radius ?? 0) && Math.abs(e.position.y - p.y) <= ENGINE.groundReach), at: { ...p }, cover: coverInBlast(m, p, d.radius ?? 0) }
    }
    case 'aura':
      return { hit: enemies.filter((e) => gap(from, e) <= (d.radius ?? 0)), at: from }
    case 'self':
      return { hit: [], at: from }
    case 'projectile':
      return { hit: [], at: from }
    default: {
      // dashes, blinks and grapples go for the nearest enemy in a narrow arc ahead
      const inReach = enemies.filter((e) => gap(from, e) - capsule(caster).radius <= d.range + reach && inArc(from, dir, e, ENGINE.lungeArc) && seen(e))
      return swing(nearest(from, inReach), d.range)
    }
  }
}


function impact(ctx: Ctx, caster: HeroState, slot: BuildSlot, template: Template, at: Vec3) {
  const d = template.delivery
  ctx.events.push({ type: 'impact', hero: caster.id, slot, at, radius: d.radius ?? 0, range: d.range, ...(d.arcDegrees ? { arcDegrees: d.arcDegrees } : {}), ...(d.width ? { width: d.width } : {}) })
}

/**
 * What control forbids: silence stops skills, disarm stops basic attacks, grounded stops movement skills, and a
 * taunted hero can only attack its taunter. Fear and sleep stop everything (the tick never gets this far for them).
 */
function forbidden(match: MatchState, h: HeroState, slot: BuildSlot): boolean {
  const now = match.tick
  if (controlled(h, 'fear', now)) return true
  if (slot === 'basic' || slot === 'active1') return controlled(h, 'disarm', now)
  if (controlled(h, 'silence', now) || taunter(match, h)) return true
  return slot === 'movement' && controlled(h, 'grounded', now)
}

/**
 * Whether a hero is free to start `slot` (phase 1): nothing in progress, or a skill cutting short a basic attack's or a
 * Skill 1 shot's wind-up, or any action's recovery. A basic attack waits for whatever came before it.
 */
export function free(h: HeroState, slot: BuildSlot, now: number): boolean {
  const a = h.action
  if (!a || now >= a.ends) return true
  // Skill 1's shots are as light as a basic attack: any other skill cuts in on one
  return slot !== 'basic' && (a.released || a.slot === 'basic' || (a.slot === 'active1' && slot !== 'active1'))
}

/**
 * Cast a slot if it is ready (U4): pay for it now and start its wind-up. It lands on its release tick (`carryOn`), so
 * every hit follows a release and the client can show the wind-up first. Returns whether it started.
 */
export function cast(ctx: Ctx, index: number, slot: BuildSlot, blow?: MeleeBlow): boolean {
  const { match, setups } = ctx
  const caster = match.heroes[index]
  const setup = setups[index]
  const template = setup.kit[slot]
  // hands full: nothing is cast from a ledge hang
  if (forbidden(match, caster, slot) || !free(caster, slot, match.tick) || caster.roll || caster.hang || caster.travel) return false
  let interval = Infinity
  let shot: Shot | undefined
  // a cripple slows basic attacks and shots the way a slow slows feet: the strongest one counts
  const crippled = () => caster.slows.reduce((m, sl) => (sl.stat === 'attack' && sl.pct / 100 > m ? sl.pct / 100 : m), 0)
  let target: HeroState | undefined
  if (slot === 'basic') {
    if (match.tick < caster.nextAttackAt) return false
    const tempo = ticks(1 / Math.max(0.2, setup.sheet.attackSpeed * (1 + sumBuff(caster, 'attackSpeed')) * (1 - crippled())))
    // a light strike follows the last at the style's own beat, the way action brawlers chain (owner, 2026-11-04), and
    // carries the share of damage its tempo would have spread over the wait, so damage a second is unchanged; a heavy
    // blow keeps the tempo's wait. A hero quicker than the beat chains quicker still
    const beat = timingOf(template, slot)
    const between = blow?.heavy !== undefined ? tempo : Math.min(tempo, Math.max(1, ticks((beat.prep + beat.recover) / BASIC_SHARE)))
    if (blow && blow.heavy === undefined && between < tempo) blow = { ...blow, pace: between / tempo }
    caster.nextAttackAt = match.tick + between
    interval = between / ENGINE.tickHz
    target = lungeAt(ctx, caster, template)
  } else if (slot === 'active1') {
    // the ranged weapon fires on repeat at its fire rate, while its magazine lasts (§4 LMB, §5)
    const r = template.ranged
    if (!r || caster.cooldowns.active1 > 0 || caster.reloadUntil > 0 || caster.burst) return false
    if (caster.ammo <= 0) {
      startReload(ctx, caster)
      return false
    }
    const between = Math.max(1, ticks(shotSeconds(r.rate, setup.sheet.fireRate, (1 + sumBuff(caster, 'attackSpeed')) * (1 - crippled()))))
    caster.cooldowns.active1 = between
    interval = between / ENGINE.tickHz
    shot = { share: r.mode === 'pellets' ? 1 / (r.pellets ?? 1) : 1, rider: true }
  } else {
    if (slot === 'passive' || caster.cooldowns[slot] > 0) return false
    caster.cooldowns[slot] = ticks(template.cooldown * (1 - Math.min(40, setup.sheet.cooldownReduction) / 100))
  }
  // a skill pressed during a basic attack's wind-up takes over, and that swing never lands
  const before = caster.action
  if (before && !before.released && match.tick < before.ends) ctx.events.push({ type: 'interrupt', hero: caster.id, slot: before.slot })
  const { prep, recover } = timingTicks(template, slot, interval)
  const release = match.tick + prep
  caster.action = { slot, started: match.tick, release, ends: release + recover, released: false, ...(blow ? { melee: blow } : {}), ...(shot ? { shot } : {}), ...(target ? { target: target.id } : {}) }
  caster.blocking = false
  // a blow needs the body up on its feet; a shot or a spell is cast from wherever the hero crouches or lies (owner,
  // 2026-11-04)
  if (template.delivery.kind === 'melee') caster.stance = 'stand'
  ctx.events.push({ type: 'cast', hero: caster.id, slot, templateId: template.id, release, ends: release + recover, ...(blow ? { melee: blow } : {}) })
  return true
}

/** Land an action whose wind-up is over, and free a hero whose recovery is over (phase 1). */
export function carryOn(ctx: Ctx, index: number) {
  const hero = ctx.match.heroes[index]
  // a dash or leap that has arrived lands its skill there
  const tr = hero.travel
  if (tr?.arrived) {
    hero.travel = undefined
    deliver(ctx, index, tr.slot, tr.blow, tr.recovery, tr.shot, tr.target)
  }
  const a = hero.action
  if (!a) return
  if (!a.released && ctx.match.tick >= a.release) {
    a.released = true
    release(ctx, index, a.slot, a.melee, a.ends - a.release, a.shot, a.target)
  }
  if (ctx.match.tick >= a.ends && hero.action === a) hero.action = undefined
}

/** A cast lands: mobility first, then the delivery, then its effects. */
/** How far under a floor's top a move aimed down may end and still land on it, rather than go over its edge. */
const LIP = 1.5

function release(ctx: Ctx, index: number, slot: BuildSlot, blow?: MeleeBlow, recovery = 0, shot?: Shot, target?: number) {
  const { match, setups } = ctx
  const caster = match.heroes[index]
  const template = slot === 'basic' ? blowTemplate(setups[index].kit[slot], blow) : shotTemplate(setups[index].kit[slot], shot)
  ctx.events.push({ type: 'release', hero: caster.id, slot })
  if (slot === 'active1') return fire(ctx, caster, shot)
  for (const e of template.effects) {
    if (e.kind !== 'mobility') continue
    if (e.invulnerable) caster.invulnerableUntil = Math.max(caster.invulnerableUntil, match.tick + ticks(e.invulnerable))
    if (e.distance) {
      const startY = caster.position.y
      let p = add(caster.position, scale(aim(caster), e.distance))
      // a dash stops at the wall in its way; a blink jumps past it; a leap clears anything lower than its arc
      if (template.delivery.kind !== 'blink') {
        // sweep the feet, the waist and the head, so a lintel overhead stops a dash as surely as a wall
        const h = capsule(caster).height
        const from = caster.position
        // on the ground a played hero's dash runs along it: aimed down, its line would stop at the floor it stands on,
        // and the camera looks a little down most of the time (owner, 2026-11-05: "E skill isn't doing any movement");
        // the AI aims at what it fights, so its fights stay as they were
        const level = match.human === caster.id && template.delivery.kind === 'dash' && !caster.airborne && p.y < startY
        const end = level ? { ...p, y: startY } : p
        let t = 1
        for (const lift of template.delivery.kind === 'leap' ? [LEAP_CLEARS] : [0.05, h / 2, h - 0.05]) {
          const wall = firstCover(match, { ...from, y: from.y + lift }, { ...end, y: end.y + lift }, bodyRadius(caster))
          if (wall && wall.t < t) t = wall.t
        }
        if (t < 1) p = add(from, scale(sub(p, from), Math.max(0, t - 0.02)))
        // and it ends on what it ran along, however far down it was aimed
        if (level && match.cover) p = { ...p, y: Math.max(p.y, floorUnder(match.cover.pieces, match.cover.health, p, startY + ENGINE.move.step)) }
      }
      // aimed a little down, it ends on the floor under where it lands, not sunk into it; aimed steeply down past a lip
      // (at an enemy in a trench), it goes over the edge, and the walls put it beside them
      if (match.cover && p.y < startY) {
        const floor = floorUnder(match.cover.pieces, match.cover.health, p, startY + ENGINE.move.step)
        if (floor > p.y && floor - p.y <= LIP) p = { ...p, y: floor }
      }
      // a blink lands at once; a dash or a leap carries the hero there over time, and the skill lands on arrival
      const kind = template.delivery.kind
      if (kind === 'dash' || kind === 'leap') {
        const T = ENGINE.move.travel
        const from = caster.position
        const length = Math.sqrt((p.x - from.x) * (p.x - from.x) + (p.y - from.y) * (p.y - from.y) + (p.z - from.z) * (p.z - from.z))
        const seconds = kind === 'leap' ? T.leap.base + T.leap.per * length : Math.max(T.least, length / T.dash)
        const arc = kind === 'leap' ? Math.min(T.leap.top, T.leap.rise * length) : 0
        caster.travel = { from: match.tick, until: match.tick + Math.max(1, ticks(seconds)), x0: from.x, y0: from.y, z0: from.z, x1: p.x, y1: p.y, z1: p.z, arc, startY, slot, ...(blow ? { blow } : {}), recovery, ...(shot ? { shot } : {}), ...(target !== undefined ? { target } : {}) }
        caster.airborne = arc > 0 || caster.airborne
        caster.roll = undefined
        caster.slide = undefined
        return
      }
      caster.position = p
      keepOut(caster, match)
      // aimed up, a blink ends in the air, and the hero falls from there
      standOn(caster, match, Math.max(caster.position.y, startY))
    }
  }
  deliver(ctx, index, slot, blow, recovery, shot, target)
}

/** The rest of a released cast, where the caster now stands: the delivery, then its effects. */
function deliver(ctx: Ctx, index: number, slot: BuildSlot, blow?: MeleeBlow, recovery = 0, shot?: Shot, target?: number) {
  const { match, setups } = ctx
  const caster = match.heroes[index]
  const template = slot === 'basic' ? blowTemplate(setups[index].kit[slot], blow) : shotTemplate(setups[index].kit[slot], shot)
  if (template.delivery.kind === 'projectile') {
    const d = template.delivery
    const { speed, projectileRadius } = geometryOf(d)
    const from = chest(caster)
    match.projectiles.push({ id: match.nextProjectileId++, owner: index, slot, position: from, step: scale(aimOf(match, caster), speed / ENGINE.tickHz), ticksLeft: Math.max(1, ticks(d.range / speed)), ...(shot ? { shot } : {}) })
    ctx.events.push({ type: 'projectile', id: match.nextProjectileId - 1, hero: caster.id, slot, from, radius: projectileRadius, speed })
    return
  }
  const landed = landing(ctx, caster, template, undefined, target !== undefined ? match.heroes[target] : undefined)
  const { at, cover } = landed
  // a guard facing a close blow catches it, unless the blow is heavy (combat.ts)
  const hit = guarded(ctx, caster, template, landed.hit, blow)
  if (template.delivery.kind !== 'self') impact(ctx, caster, slot, template, at)
  strikeCover(ctx, caster, template, cover)
  resolve(ctx, caster, template, slot, hit, at)
  if (slot === 'basic') {
    afterBasic(ctx, caster, hit[0])
    afterBlow(ctx, caster, blow, hit, recovery)
  }
}

/**
 * The melee magnet (§5): the enemy a swing goes for, the nearest in reach plus the style's lunge and roughly ahead.
 * The swing carries the body toward it through the wind-up, stopping at striking distance, and lands on it.
 */
function lungeAt(ctx: Ctx, caster: HeroState, template: Template): HeroState | undefined {
  const style = template.style ? MELEE_STYLES[template.style] : undefined
  if (!style) return undefined
  const from = chest(caster)
  const dir = aimOf(ctx.match, caster)
  const reach = template.delivery.range + ENGINE.meleeSlack + SIZES[caster.size].reachBonus
  const near = enemiesOf(ctx.match, caster).filter((e) => gap(from, e) - capsule(caster).radius <= reach + style.lunge && inArc(from, dir, e, ENGINE.melee.lungeArc) && canSee(ctx.match, from, chest(e)))
  const [prey] = nearest(from, near)
  if (!prey) return undefined
  const dx = prey.position.x - caster.position.x
  const dz = prey.position.z - caster.position.z
  const flat = Math.sqrt(dx * dx + dz * dz) || 1
  const room = flat - capsule(caster).radius - capsule(prey).radius - template.delivery.range * 0.6
  if (room > 0.05) {
    const n = Math.max(1, ticks(ENGINE.melee.lungeTime))
    const metres = Math.min(style.lunge, room)
    caster.lunge = { x: (dx / flat) * (metres / n), z: (dz / flat) * (metres / n), until: ctx.match.tick + n, target: prey.id }
  }
  return prey
}

function moveLunges(ctx: Ctx) {
  for (const hero of ctx.match.heroes) {
    const l = hero.lunge
    if (!l) continue
    if (!hero.alive || hero.knockback || hero.launch || ctx.match.tick > l.until) {
      hero.lunge = undefined
      continue
    }
    hero.position = { x: hero.position.x + l.x, y: hero.position.y, z: hero.position.z + l.z }
    keepOut(hero, ctx.match)
  }
}

/** The ranged weapon's magazine refills over its reload time (§5); a reload already under way runs on. */
function startReload(ctx: Ctx, hero: HeroState) {
  const r = ctx.setups[hero.id].kit.active1.ranged
  if (!r || hero.reloadUntil > 0) return
  hero.reloadUntil = ctx.match.tick + Math.max(1, ticks(r.reload))
  hero.burst = undefined
  ctx.events.push({ type: 'reload', hero: hero.id, phase: 'start', until: hero.reloadUntil })
}

/** Reloads finishing, an idle weapon topping up, bloom settling and a burst's next shot, once a tick per hero. */
function tickWeapon(ctx: Ctx, hero: HeroState) {
  const setup = ctx.setups[hero.id]
  const now = ctx.match.tick
  hero.bloom = Math.max(0, hero.bloom - ENGINE.ranged.recover * DT)
  if (hero.reloadUntil > 0 && now >= hero.reloadUntil) {
    hero.reloadUntil = 0
    hero.ammo = setup.magazine
    ctx.events.push({ type: 'reload', hero: hero.id, phase: 'end', until: now })
  } else if (hero.reloadUntil === 0 && hero.ammo < setup.magazine && now - hero.lastShot >= ticks(ENGINE.ranged.topUp)) startReload(ctx, hero)
  const b = hero.burst
  if (b && now >= b.next) {
    if (hero.ammo <= 0 || controlled(hero, 'disarm', now) || hero.stunnedUntil > now) hero.burst = undefined
    else {
      fire(ctx, hero, { share: 1, rider: true }, true)
      b.left--
      b.next = now + Math.max(1, ticks(ENGINE.ranged.burstGap))
      if (b.left <= 0) hero.burst = undefined
    }
  }
}

/**
 * Where the muzzle is (§5): the hand holding the weapon, by its style, a share of the body's height up, ahead and to the
 * right of the feet along the facing. The character faces +z at yaw 0, so its right is -x.
 */
export function muzzle(hero: HeroState, style: keyof typeof ENGINE.ranged.muzzle): Vec3 {
  const [up, ahead, right] = ENGINE.ranged.muzzle[style]
  const h = capsule(hero).height
  const fx = sin(hero.yaw)
  const fz = cos(hero.yaw)
  return { x: hero.position.x + (fx * ahead - fz * right) * h, y: hero.position.y + up * h, z: hero.position.z + (fz * ahead + fx * right) * h }
}

/**
 * What the crosshair covers (§5): the first enemy or wall along the aim from the eye, else the weapon's full range.
 * Shots fly from the muzzle at this point, so what the reticle sits on is what gets hit.
 */
function aimPoint(ctx: Ctx, hero: HeroState, range: number): Vec3 {
  const eye = chest(hero)
  const dir = aimOf(ctx.match, hero)
  let best = range
  for (const e of enemiesOf(ctx.match, hero)) {
    const to = sub(chest(e), eye)
    const along = dot(to, dir)
    if (along <= 0 || along >= best) continue
    if (segmentToCapsuleAxis(eye, add(eye, scale(dir, along)), e.position, capsule(e).height) <= capsule(e).radius) best = along
  }
  const wall = firstCover(ctx.match, eye, add(eye, scale(dir, best)))
  return add(eye, scale(dir, wall ? wall.t * best : best))
}

/** A direction turned off `dir` by up to `spread` radians each way, from the rules' seeded dice. */
function spreadOut(ctx: Ctx, dir: Vec3, spread: number): Vec3 {
  if (spread <= 0) return dir
  const a = yawPitch(dir)
  return direction(a.yaw + (next(ctx.match.rules) * 2 - 1) * spread, a.pitch + (next(ctx.match.rules) * 2 - 1) * spread * 0.6)
}

/**
 * One trigger pull of the ranged weapon (§5): a round from the magazine leaves the muzzle for the point the crosshair
 * covers, turned by the bloom (the style's own, more while moving or in the air, growing a little each shot). A
 * shotgun throws its pellets across its cone, a beam lands along its line at once, a burst queues its next shots.
 */
function fire(ctx: Ctx, hero: HeroState, shot: Shot | undefined, followUp = false) {
  const { match, setups } = ctx
  const setup = setups[hero.id]
  const weapon = setup.kit.active1
  const r = weapon.ranged
  if (!r) return
  const now = match.tick
  hero.ammo = Math.max(0, hero.ammo - 1)
  hero.lastShot = now
  if (!followUp && r.mode === 'burst' && (r.burst ?? 1) > 1) hero.burst = { left: (r.burst ?? 1) - 1, next: now + Math.max(1, ticks(ENGINE.ranged.burstGap)) }
  const template = shotTemplate(weapon, shot)
  const from = muzzle(hero, r.style)
  const target = aimPoint(ctx, hero, template.delivery.range)
  const toTarget = sub(target, from)
  // a target nearer than the muzzle's reach is shot along the aim itself
  const straight = length(toTarget) > 1.5 ? normalize(toTarget) : aimOf(match, hero)
  const moving = hero.velocity.x * hero.velocity.x + hero.velocity.z * hero.velocity.z > 1.5 * 1.5
  const R = ENGINE.ranged
  const spread = Math.min(R.max, R.base[r.style] + hero.bloom + (moving ? R.moving : 0) + (hero.airborne ? R.airborne : 0))
  hero.bloom = Math.min(R.max, hero.bloom + R.perShot)
  if (hero.ammo === 0) startReload(ctx, hero)
  if (template.delivery.kind === 'beam') {
    const dir = spreadOut(ctx, straight, spread)
    const landed = landing(ctx, hero, template, { from, dir })
    impact(ctx, hero, 'active1', template, landed.at)
    strikeCover(ctx, hero, template, landed.cover)
    resolve(ctx, hero, template, 'active1', landed.hit, landed.at)
    if (landed.hit[0]) afterBasic(ctx, hero, landed.hit[0])
    return
  }
  const { speed, projectileRadius } = geometryOf(template.delivery)
  const pellets = r.mode === 'pellets' ? (r.pellets ?? 1) : 1
  const cone = weapon.delivery.kind === 'cone' ? ((geometryOf(weapon.delivery).arcDegrees / 2) * PI) / 180 : 0
  for (let i = 0; i < pellets; i++) {
    // pellets fan evenly across the cone, each nudged by the bloom
    const fan = pellets > 1 ? (i / (pellets - 1)) * 2 - 1 : 0
    const aim0 = yawPitch(straight)
    const base = fan ? direction(aim0.yaw + fan * cone * 0.5, aim0.pitch) : straight
    const dir = spreadOut(ctx, base, spread)
    match.projectiles.push({ id: match.nextProjectileId++, owner: hero.id, slot: 'active1', position: from, step: scale(dir, speed / ENGINE.tickHz), ticksLeft: Math.max(1, ticks(template.delivery.range / speed)), ...(shot ? { shot } : {}) })
    ctx.events.push({ type: 'projectile', id: match.nextProjectileId - 1, hero: hero.id, slot: 'active1', from, radius: projectileRadius, speed })
  }
}

function afterBasic(ctx: Ctx, hero: HeroState, target: HeroState | undefined) {
  hero.hitCount++
  firePassive(ctx, hero, 'onHit', target)
  if (hero.hitCount % 3 === 0) firePassive(ctx, hero, 'everyThirdHit', target)
}

/** Move every projectile one tick, sweeping its path so a fast shot cannot skip through a hero. */
function flyProjectiles(ctx: Ctx) {
  const { match, setups } = ctx
  const left: MatchState['projectiles'] = []
  const grid = GRIDS.on && match.projectiles.length > 4 ? new HeroGrid(match.heroes) : undefined
  // the widest body on the field: a shot's path is widened by it to find whom it might touch
  const widest = grid ? Math.max(...match.heroes.map((h) => capsule(h).radius)) : 0
  for (const p of match.projectiles) {
    const owner = match.heroes[p.owner]
    const template = shotTemplate(setups[p.source ?? p.owner].kit[p.slot], p.shot)
    const size = geometryOf(template.delivery).projectileRadius
    const end = add(p.position, p.step)
    const r = widest + size
    const near = grid ? grid.within(Math.min(p.position.x, end.x) - r, Math.max(p.position.x, end.x) + r, Math.min(p.position.z, end.z) - r, Math.max(p.position.z, end.z) + r).filter((o) => o.team !== owner.team) : enemiesOf(match, owner)
    const struck = near.filter((e) => segmentToCapsuleAxis(p.position, end, e.position, capsule(e).height) <= capsule(e).radius + size)
    const first = struck.length ? struck.reduce((a, b) => (distance(p.position, chest(b)) < distance(p.position, chest(a)) ? b : a)) : undefined
    const wall = firstCover(match, p.position, end, size)
    // the shot meets whichever comes first along its path: a hero (its chest projected onto the path), or the cover
    const stepSq = dot(p.step, p.step) || 1
    const heroT = first ? clamp(dot(sub(chest(first), p.position), p.step) / stepSq, 0, 1) : 2
    if (wall && wall.t < heroT) {
      const area = template.delivery.radius
      impact(ctx, owner, p.slot, template, wall.at)
      // the piece it struck always takes the hit, even when the blast is smaller than the shot
      const blast = area ? coverInBlast(match, wall.at, area).filter((c) => c.index !== wall.index) : []
      strikeCover(ctx, owner, template, [{ index: wall.index, at: wall.at }, ...blast])
      // a blast against a wall still catches heroes beside it, and anything the shot raises rises there
      if (area || raises(template)) resolve(ctx, owner, template, p.slot, area ? enemiesOf(match, owner).filter((e) => gap(wall.at, e) <= area) : [], wall.at)
      continue
    }
    // a reflect turns the shot back on whoever fired it: it flies home as the reflector's
    if (first && first.reflectUntil > match.tick) {
      p.source ??= p.owner
      p.owner = first.id
      p.step = scale(p.step, -1)
      p.position = end
      ctx.events.push({ type: 'reflect', hero: first.id, projectile: p.id })
      if (--p.ticksLeft > 0) left.push(p)
      continue
    }
    if (first) {
      const at = chest(first)
      const area = template.delivery.radius
      const hit = area ? enemiesOf(match, owner).filter((e) => gap(at, e) <= area) : [first]
      impact(ctx, owner, p.slot, template, at)
      if (area) strikeCover(ctx, owner, template, coverInBlast(match, at, area))
      resolve(ctx, owner, template, p.slot, hit, at)
      if ((p.slot === 'basic' || p.slot === 'active1') && p.source === undefined) afterBasic(ctx, owner, first)
      continue
    }
    p.position = end
    if (--p.ticksLeft > 0) left.push(p)
    // a thrown trap, turret or field that reaches the end of its range comes down where it is
    else if (raises(template)) resolve(ctx, owner, template, p.slot, [], { x: end.x, y: 0, z: end.z })
  }
  match.projectiles = left
}

/** Whether a template raises something in the world (a field, wall, trap or turret) where it lands. */
const raises = (t: Template) => t.effects.some((e) => e.kind === 'field' || e.kind === 'wall' || e.kind === 'trap' || e.kind === 'turret')

function moveKnockbacks(ctx: Ctx) {
  const cover = ctx.match.cover
  for (const hero of ctx.match.heroes) {
    const kb = hero.knockback
    if (!kb || !hero.alive) continue
    const before = hero.position
    let lift: number = ENGINE.move.step
    if (kb.hop !== undefined && kb.from !== undefined && kb.y !== undefined) {
      // thrown along the ground: an arc over a track that follows the floor it crosses, up a ramp or a step, and falls
      // off a ledge (§5)
      const n = kb.until - kb.from + 1
      const k = ctx.match.tick - kb.from + 1
      const arc = (4 * kb.hop * k * (n - k)) / (n * n)
      const x = before.x + kb.step.x
      const z = before.z + kb.step.z
      // a body in flight lands only on what is under it; near the ground it still takes a step or a ramp in its stride
      lift = Math.max(ENGINE.move.step - arc, 0.05)
      const floor = cover ? floorUnder(cover.pieces, cover.health, { x, y: kb.y, z }, kb.y + arc + lift) : 0
      let vy = kb.vy ?? 0
      let y = kb.y
      if (floor >= y - 1e-6) ((y = floor), (vy = 0))
      else ((vy -= ENGINE.move.gravity * DT), (y = Math.max(floor, y + vy * DT)))
      kb.y = y
      kb.vy = vy
      hero.position = { x, y: y + arc, z }
    } else hero.position = add(before, kb.step)
    const hits: number[] = []
    keepOut(hero, ctx.match, hits, lift)
    // a wall that turns the body back is a slam: once a flight, it wears a breakable piece down and stops the flight
    // unless it broke through (§6b)
    const pushed = sub(hero.position, before)
    const along = dot(pushed, kb.step)
    if (cover && hits.length && !kb.slammed && along < 0.5 * dot(kb.step, kb.step)) {
      kb.slammed = true
      const index = hits[0]
      ctx.events.push({ type: 'slam', hero: hero.id, at: { ...hero.position }, index, speed: length(kb.step) * ENGINE.tickHz })
      let standing = false
      for (const i of new Set(hits)) {
        const left = cover.health[i]
        if (left > 0) {
          cover.health[i] = Math.max(0, left - ENGINE.knock.slamDamage)
          ctx.events.push({ type: 'cover-hit', index: i, at: { ...hero.position }, health: cover.health[i] })
          if (cover.health[i] === 0) ctx.events.push({ type: 'cover-broken', index: i, at: { ...hero.position } })
        }
        if (cover.health[i] !== 0) standing = true
      }
      if (standing) kb.until = ctx.match.tick
    }
    if (ctx.match.tick >= kb.until) {
      // the flight is over: a hero over the floor lands, one past a ledge or knocked out of the air falls from there
      hero.velocity = { x: 0, y: kb.hop !== undefined ? Math.min(0, kb.vy ?? 0) : 0, z: 0 }
      hero.airborne = true
      standOn(hero, ctx.match)
      hero.knockback = undefined
      ctx.events.push({ type: 'knockback', hero: hero.id, phase: 'end' })
    }
  }
}

/** The combat rules for `tick`: statuses, casts from pressed buttons, then projectiles and knockback. */
export const COMBAT_RULES: TickRules = {
  statuses: (match, setups, events) => {
    const ctx = { match, setups, events }
    tickStatuses(ctx)
    // reloads run on through a stun
    for (const h of match.heroes) if (h.alive) tickWeapon(ctx, h)
  },
  act: (match, setups, hero, command: Command, events) => {
    const ctx = { match, setups, events }
    carryOn(ctx, hero)
    // the basic attack strikes on release and charges while held, the passive toggles (combat.ts); skills cast as pressed
    meleeButtons(ctx, hero, command, (blow) => cast(ctx, hero, 'basic', blow))
    if (!command.buttons) return
    for (const slot of SKILL_SLOTS) if (command.buttons & slotBit(slot) && cast(ctx, hero, slot)) return
  },
  after: (match, setups, events) => {
    const ctx = { match, setups, events }
    moveLunges(ctx)
    flyProjectiles(ctx)
    moveKnockbacks(ctx)
    tickWorld(ctx)
  },
}

