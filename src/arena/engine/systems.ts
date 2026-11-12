import { scaleMagnitudes } from '../../charter/budget.js'
import type { SizeClass } from '../../charter/sizes.js'
import type { BuildSlot, Effect, Template } from '../../charter/types.js'
import { ticks } from './calibration.js'
import { applyEffect, controlled, dealDamage, displace, firePassive, resolve, spells, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'
import { keepOut } from './locomotion.js'
import { cos, sin } from './maths.js'
import { MOVES, capsule, standing, type Command, type HeroState } from './state.js'

/**
 * The library's systems and the R shapes that aren't one hit (GAME.md §4 F, R and Systems): an elemental sheath on
 * every hit, the when-hit trigger, the power meter and ability charges, a form's stages, a Strike's lock-on, fusion and
 * team-ups. Plain state on heroes, ticked once after everyone acts.
 */

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>
const flat = (a: HeroState, b: HeroState) => Math.sqrt((a.position.x - b.position.x) * (a.position.x - b.position.x) + (a.position.z - b.position.z) * (a.position.z - b.position.z))
const BIGGER: Record<SizeClass, SizeClass> = { tiny: 'small', small: 'medium', medium: 'large', large: 'huge', huge: 'colossal', colossal: 'colossal' }

/** Every hit that lands (not damage over time): the striker's element rides it, the struck's when-hit passive answers, and both meters fill. */
spells.hit = (ctx, source, target, amount, slot) => {
  const now = ctx.match.tick
  if (ctx.match.fullKit) {
    source.power = Math.min(1, (source.power ?? 0) + amount / (source.maxHp * KIT.power.dealt))
    target.power = Math.min(1, (target.power ?? 0) + amount / (target.maxHp * KIT.power.taken))
  }
  const passive = ctx.setups[source.id].kit.passive
  if (source.passiveOn && !controlled(source, 'break', now)) for (const e of passive.effects as Effect[]) if (e.kind === 'element') sheath(ctx, source, target, amount, e)
  // a when-hit passive never answers another passive's answer, so two of them can't trade forever
  if (slot !== 'passive' && target.alive) firePassive(ctx, target, 'whenHit', source)
}

/** An elemental sheath (§4 F): flame burns on, frost slows, lightning leaps to the next enemy. */
function sheath(ctx: Ctx, source: HeroState, target: HeroState, amount: number, e: Of<'element'>) {
  const now = ctx.match.tick
  const K = KIT.element
  if (e.element === 'flame') {
    if (!target.alive) return
    target.dots.push({ perSecond: (amount * K.flame.share) / K.flame.seconds, type: 'spirit', until: now + ticks(K.flame.seconds), source: source.id })
    ctx.events.push({ type: 'element', hero: target.id, from: source.id, element: 'flame' })
  } else if (e.element === 'frost') {
    if (!target.alive) return
    target.slows.push({ pct: K.frost.pct, until: now + ticks(K.frost.seconds) })
    ctx.events.push({ type: 'element', hero: target.id, from: source.id, element: 'frost' })
  } else {
    let next: HeroState | undefined
    let best: number = K.lightning.reach
    for (const o of ctx.match.heroes) {
      if (o === target || o.team === source.team || !standing(o) || o.fused) continue
      const d = flat(o, target)
      if (d < best) ((best = d), (next = o))
    }
    if (!next) return
    ctx.events.push({ type: 'element', hero: target.id, from: source.id, element: 'lightning', to: next.id })
    dealDamage(ctx, source, next, amount * K.lightning.share, 'spirit', 'dot')
  }
}

/**
 * Whether a skill can be cast now, paying for it if so (§4 Systems): its cooldown, or one of its charges (each coming
 * back over the cooldown in turn), and its share of the power meter.
 */
export function spend(ctx: Ctx, hero: HeroState, template: Template, slot: BuildSlot, cooldown: number): boolean {
  if (template.cost !== undefined && (hero.power ?? 0) < template.cost) return false
  if (template.charges) {
    const stock = hero.stock?.[slot] ?? template.charges
    if (stock <= 0) return false
    ;(hero.stock ??= {})[slot] = stock - 1
    // the cooldown counts to the next charge, and only runs while one is missing
    if (hero.cooldowns[slot] <= 0) hero.cooldowns[slot] = cooldown
  } else {
    if (hero.cooldowns[slot] > 0) return false
    hero.cooldowns[slot] = cooldown
  }
  if (template.cost !== undefined) {
    hero.power = (hero.power ?? 0) - template.cost
    ctx.events.push({ type: 'power', hero: hero.id, power: hero.power })
  }
  return true
}

/** Charges come back one a cooldown, the cooldown starting again while any is still missing. */
function restock(ctx: Ctx, hero: HeroState) {
  if (!hero.stock) return
  for (const slot of Object.keys(hero.stock) as BuildSlot[]) {
    const t = ctx.setups[hero.id].kit[slot]
    const most = t.charges ?? 0
    if (hero.cooldowns[slot] > 0 || hero.stock[slot]! >= most) continue
    hero.stock[slot] = hero.stock[slot]! + 1
    if (hero.stock[slot]! < most) hero.cooldowns[slot] = ticks(t.cooldown)
  }
}

/**
 * R pressed again while its staged form holds steps the form up a stage (§4 R): a bigger body and harder hits. Returns
 * whether it did, which uses the press.
 */
export function stageUp(ctx: Ctx, hero: HeroState, template: Template): boolean {
  const now = ctx.match.tick
  const form = (template.effects as Effect[]).find((e): e is Of<'form'> => e.kind === 'form' && !!e.stages)
  if (!form || hero.formUntil <= now || !hero.formStage || hero.formStage >= form.stages!) return false
  hero.formStage++
  const left = (hero.formUntil - now) / 60
  hero.buffs = hero.buffs.filter((b) => b.source !== `stage:${hero.id}`)
  hero.buffs.push({ stat: 'damage', pct: (hero.formStage - 1) * KIT.stage.damage * 100, until: hero.formUntil, source: `stage:${hero.id}` })
  const was = hero.formUntil
  applyEffect(ctx, hero, template, 'ultimate', { kind: 'resize', sizeClass: BIGGER[hero.size], duration: left }, [])
  hero.formUntil = was
  ctx.events.push({ type: 'form', hero: hero.id, phase: 'stage', size: hero.size, stage: hero.formStage })
  return true
}

const rests = new WeakMap<Template, Template>()
/** A Strike's blows: its template less the lock-on, a share of it each. */
function blowOf(template: Template, hits: number): Template {
  let r = rests.get(template)
  if (!r) rests.set(template, (r = scaleMagnitudes({ ...template, effects: template.effects.filter((e) => e.kind !== 'lockon') }, 1 / hits)))
  return r
}

/** R Strike (§4 R): lock on to the target and land its blows one by one, the two held out of the fight meanwhile. */
export function lockOn(ctx: Ctx, caster: HeroState, target: HeroState | undefined, slot: BuildSlot, e: Of<'lockon'>) {
  const now = ctx.match.tick
  if (!target || !standing(target) || target.unstoppableUntil > now) return
  const until = now + ticks(e.duration)
  caster.lockon = { target: target.id, from: now, until, hits: Math.max(1, e.hits), done: 0, slot }
  caster.invulnerableUntil = Math.max(caster.invulnerableUntil, until)
  target.stunnedUntil = Math.max(target.stunnedUntil, until + ticks(0.2))
  target.lockedBy = caster.id
  target.knockback = undefined
  caster.action = undefined
  ctx.events.push({ type: 'lockon', hero: caster.id, target: target.id, phase: 'start', n: 0 })
}

function tickLockon(ctx: Ctx, h: HeroState) {
  const l = h.lockon!
  const now = ctx.match.tick
  const target = ctx.match.heroes[l.target]
  if (!h.alive || h.downed || !target.alive || target.downed) return endLockon(ctx, h)
  // face to face with it, the caster's blows land evenly over the lock
  const away = capsule(target).radius + capsule(h).radius + 0.4
  h.position = { x: target.position.x + sin(target.yaw) * away, y: target.position.y, z: target.position.z + cos(target.yaw) * away }
  h.yaw = target.yaw + Math.PI
  h.velocity = { x: 0, y: 0, z: 0 }
  const due = Math.min(l.hits, Math.floor(((now - l.from) * l.hits) / Math.max(1, l.until - l.from)))
  while (l.done < due) {
    l.done++
    ctx.events.push({ type: 'lockon', hero: h.id, target: target.id, phase: 'blow', n: l.done })
    resolve(ctx, h, blowOf(ctx.setups[h.id].kit[l.slot], l.hits), l.slot, [target])
  }
  if (now >= l.until) {
    // the last blow sends it flying
    if (target.alive && !target.downed) {
      displace(ctx, h, target, ctx.setups[h.id].kit[l.slot], KIT.lockon.finish)
      target.floored = true
    }
    endLockon(ctx, h)
  }
}

function endLockon(ctx: Ctx, h: HeroState) {
  const l = h.lockon!
  h.lockon = undefined
  const target = ctx.match.heroes[l.target]
  if (target.lockedBy === h.id) target.lockedBy = undefined
  ctx.events.push({ type: 'lockon', hero: h.id, target: l.target, phase: 'end', n: l.done })
}

/** Fusion (§4 Systems): the caster takes its nearest ally into itself, bigger and stronger, for a while. */
export function fuse(ctx: Ctx, caster: HeroState, template: Template, e: Of<'fuse'>) {
  const now = ctx.match.tick
  let ally: HeroState | undefined
  let best: number = KIT.fuse.reach
  for (const o of ctx.match.heroes) {
    if (o === caster || o.team !== caster.team || !standing(o) || o.summon || o.fused || o.fusing) continue
    const d = flat(o, caster)
    if (d <= best) ((best = d), (ally = o))
  }
  if (!ally || caster.fusing) return
  const until = now + ticks(e.duration)
  caster.fusing = { ally: ally.id, until }
  ally.fused = { into: caster.id, until }
  ally.action = undefined
  caster.buffs.push({ stat: 'damage', pct: KIT.fuse.damage * 100, until, source: `fuse:${caster.id}` })
  caster.shield = Math.max(caster.shield, ally.hp * KIT.fuse.shield)
  caster.shieldUntil = Math.max(caster.shieldUntil, until)
  applyEffect(ctx, caster, template, 'ultimate', { kind: 'resize', sizeClass: BIGGER[BIGGER[caster.size]], duration: e.duration }, [])
  ctx.events.push({ type: 'fuse', hero: caster.id, ally: ally.id, phase: 'start' })
}

function unfuse(ctx: Ctx, h: HeroState) {
  const f = h.fusing!
  h.fusing = undefined
  const ally = ctx.match.heroes[f.ally]
  ally.fused = undefined
  // it steps out beside the caster
  ally.position = { x: h.position.x + cos(h.yaw) * 1.2, y: h.position.y, z: h.position.z - sin(h.yaw) * 1.2 }
  keepOut(ally, ctx.match)
  ally.invulnerableUntil = Math.max(ally.invulnerableUntil, ctx.match.tick + ticks(0.5))
  ctx.events.push({ type: 'fuse', hero: h.id, ally: f.ally, phase: 'end' })
}

/**
 * A team-up (§4 Team): the interact key held beside a standing ally gets it to throw the hero along its aim; it comes
 * down hard on whoever is where it lands (traverse.ts lands it). Once in a while for each hero.
 */
export function teamUpButton(ctx: Ctx, index: number, command: Command): boolean {
  const { match } = ctx
  const hero = match.heroes[index]
  const now = match.tick
  if (!match.fullKit || !(command.moves & MOVES.interact) || hero.airborne || !standing(hero) || now < (hero.teamUpAfter ?? 0) || hero.travel) return false
  let ally: HeroState | undefined
  let best: number = KIT.teamUp.reach
  for (const o of match.heroes) {
    if (o === hero || o.team !== hero.team || !standing(o) || o.summon || o.fused) continue
    const d = flat(o, hero)
    if (d <= best) ((best = d), (ally = o))
  }
  if (!ally) return false
  hero.teamUpAfter = now + ticks(KIT.teamUp.again)
  // thrown along its aim, arcing over whatever is in the way
  const T = KIT.teamUp
  const dx = sin(hero.yaw)
  const dz = cos(hero.yaw)
  const p = hero.position
  const until = now + ticks(T.flight)
  hero.travel = { from: now, until, x0: p.x, y0: p.y, z0: p.z, x1: p.x + dx * T.throw, y1: p.y, z1: p.z + dz * T.throw, arc: T.arc, startY: p.y, slot: 'basic', recovery: 0, land: 'teamup' }
  hero.airborne = true
  hero.action = undefined
  ally.yaw = hero.yaw
  ctx.events.push({ type: 'teamup', hero: hero.id, ally: ally.id, phase: 'throw' })
  return true
}

/** A thrown hero lands: whoever is under it takes the blow and is knocked up. */
export function teamUpLands(ctx: Ctx, hero: HeroState) {
  const T = KIT.teamUp
  const now = ctx.match.tick
  for (const o of ctx.match.heroes) {
    if (o.team === hero.team || !standing(o) || o.fused || flat(o, hero) > T.radius) continue
    dealDamage(ctx, hero, o, T.damage, 'physical', 'basic')
    if (o.alive && !o.downed && o.unstoppableUntil <= now) {
      o.launch = { from: now, until: now + ticks(0.5), height: 1.2, base: o.position.y }
      o.airborne = true
      o.stunnedUntil = Math.max(o.stunnedUntil, now + ticks(0.5))
    }
  }
  ctx.events.push({ type: 'teamup', hero: hero.id, ally: -1, phase: 'land' })
}

/** Once a tick after everyone moved: charges coming back, a form's stage ending, lock-ons landing their blows, fusions. */
export function tickSystems(ctx: Ctx) {
  const now = ctx.match.tick
  for (const h of ctx.match.heroes) {
    restock(ctx, h)
    if (h.formStage && h.formUntil <= now) h.formStage = undefined
    if (h.lockon) tickLockon(ctx, h)
    if (h.fusing && (now >= h.fusing.until || !h.alive || h.downed)) unfuse(ctx, h)
    if (h.fused) {
      // inside its fusion: carried along, out of the fight
      const into = ctx.match.heroes[h.fused.into]
      h.position = { ...into.position }
      h.velocity = { x: 0, y: 0, z: 0 }
    }
  }
}
