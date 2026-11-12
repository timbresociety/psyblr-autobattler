import { BUILD_SLOTS } from '../../charter/build.js'
import type { BuildSlot, Effect, Template } from '../../charter/types.js'
import { ENGINE, ticks } from './calibration.js'
import { floorUnder, type CoverPiece } from './cover.js'
import { dealDamage, displace, heal, interrupt, resolve, spells, type Ctx } from './effects.js'
import { keepOut } from './locomotion.js'
import { TAU, atan2, cos, distance, sin, yawPitch, type Vec3 } from './maths.js'
import { revive } from './moveset.js'
import { fuse, lockOn, tickSystems } from './systems.js'
import { startTraverse, tickTraverse } from './traverse.js'
import { AIM_STEPS, IDLE, capsule, createHero, slotBit, standing, type Command, type HeroSetup, type HeroState, type MatchState } from './state.js'

/**
 * The Q library's pieces that aren't a hit or a heal (GAME.md §4 Q): counters, summons, barriers, terrain, portals,
 * copying a kit, possession, lift-and-throw and reviving at range, plus the kit overrides a copy, a kit switch or a
 * form's moveset bring. Plain state on heroes and the match, ticked once after everyone acts.
 */

type Of<K extends Effect['kind']> = Extract<Effect, { kind: K }>

const now = (ctx: Ctx) => ctx.match.tick
const flatDistance = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z))
const chest = (h: HeroState): Vec3 => ({ x: h.position.x, y: h.position.y + capsule(h).height * ENGINE.chest, z: h.position.z })
const nextId = (m: MatchState) => (m.nextEntityId = (m.nextEntityId ?? 1) + 1) - 1
const steps = (angle: number) => Math.round((angle / TAU) * AIM_STEPS)
/** The floor under a point, standing on cover where there is some. */
const floorAt = (m: MatchState, p: Vec3) => (m.cover ? floorUnder(m.cover.pieces, m.cover.health, p, p.y + ENGINE.move.step) : 0)

/** How hard a blow would have struck: its direct damage at the striker's numbers (a reflect turns this back). */
function blowDamage(ctx: Ctx, source: HeroState, template: Template): { amount: number; type: 'physical' | 'spirit' } {
  const sheet = ctx.setups[source.id].sheet
  let amount = 0
  let type: 'physical' | 'spirit' = 'physical'
  for (const e of template.effects as Effect[])
    if (e.kind === 'damage' && !e.overTime) {
      amount += e.amount + e.ratio * sheet[e.scaling]
      type = e.type === 'spirit' ? 'spirit' : 'physical'
    }
  return { amount, type }
}

const strikes = new WeakMap<Template, Template>()
/** A counter's strike back: its template less the counter itself. */
function strikeOf(template: Template): Template {
  let t = strikes.get(template)
  if (!t) strikes.set(template, (t = { ...template, effects: template.effects.filter((e) => e.kind !== 'counter') }))
  return t
}

/** A counter answers `source`'s blow on `target` instead of letting it land. Returns whether it did. */
spells.answer = (ctx, source, target, template, _slot) => {
  const c = target.counter
  if (!c || c.until <= now(ctx) || source.team === target.team || source === target || !standing(target)) return false
  target.counter = undefined
  // a counter cancels the striker's charge and wind-up
  interrupt(ctx, source)
  ctx.events.push({ type: 'counter', hero: target.id, source: source.id, answer: c.answer })
  switch (c.answer) {
    case 'strike':
      resolve(ctx, target, strikeOf(ctx.setups[target.id].kit[c.slot]), c.slot, [source], chest(source))
      break
    case 'substitute': {
      // it was never there: it comes out behind the striker, facing its back
      const back = capsule(source).radius + capsule(target).radius + 0.5
      target.position = { x: source.position.x - sin(source.yaw) * back, y: source.position.y, z: source.position.z - cos(source.yaw) * back }
      target.yaw = source.yaw
      target.velocity = { x: 0, y: 0, z: 0 }
      target.invulnerableUntil = Math.max(target.invulnerableUntil, now(ctx) + ticks(0.4))
      keepOut(target, ctx.match)
      break
    }
    case 'reflect': {
      const { amount, type } = blowDamage(ctx, source, template)
      dealDamage(ctx, target, source, amount, type, c.slot)
      break
    }
    case 'absorb':
      heal(target, blowDamage(ctx, source, template).amount)
      break
  }
  return true
}

spells.form = (ctx, caster, template, slot, seconds) => kitSwitch(ctx, caster, template, slot, seconds, 'form')

spells.apply = (ctx, caster, template, slot, e, hit, at) => {
  const where = at ?? hit[0]?.position ?? caster.position
  switch (e.kind) {
    case 'counter':
      caster.counter = { until: now(ctx) + ticks(e.duration), answer: e.answer, slot }
      ctx.events.push({ type: 'status', hero: caster.id, status: 'counter', until: caster.counter.until })
      return
    case 'summon':
      return summon(ctx, caster, slot, e)
    case 'barrier':
      return barrier(ctx, caster, where, e)
    case 'terrain':
      return terrain(ctx, caster, where, e)
    case 'portal':
      return portal(ctx, caster, where, e)
    case 'copyKit':
      return copyKit(ctx, caster, hit[0], e)
    case 'kitSwitch':
      return kitSwitch(ctx, caster, template, slot, e.duration, 'switch')
    case 'possess':
      return possess(ctx, caster, hit[0], e)
    case 'lift':
      for (const u of hit) lift(ctx, caster, u, e)
      return
    case 'revive':
      return reviveAtRange(ctx, caster, template, where, e)
    case 'traverse':
      return startTraverse(ctx, caster, template, slot, e)
    case 'lockon':
      return lockOn(ctx, caster, hit[0], slot, e)
    case 'fuse':
      return fuse(ctx, caster, template, e)
    default:
      return
  }
}

// ---- constructs -------------------------------------------------------------------------------------------------

/** The flat direction a caster aims along, snapped to the nearer axis (the cover is axis-aligned boxes). */
function axisOf(caster: HeroState): { alongX: boolean; sign: 1 | -1 } {
  const sx = sin(caster.yaw)
  const cz = cos(caster.yaw)
  const alongX = Math.abs(sx) > Math.abs(cz)
  return { alongX, sign: (alongX ? sx : cz) >= 0 ? 1 : -1 }
}

/** Raise a timed piece of cover: it joins the map's, and falls (world.ts) when `seconds` run out. */
function raise(ctx: Ctx, caster: HeroState, piece: CoverPiece, seconds: number) {
  const m = ctx.match
  if (!m.cover) m.cover = { pieces: [], health: [] }
  const health = piece.health ?? 1e6
  // a new array, so the cover's cached bounds are rebuilt for it
  m.cover = { pieces: [...m.cover.pieces, { ...piece, health }], health: [...m.cover.health, health] }
  const index = m.cover.pieces.length - 1
  ;(m.walls ??= []).push({ index, until: m.tick + ticks(seconds) })
  const s = piece.shape as Extract<CoverPiece['shape'], { kind: 'block' }>
  for (const h of m.heroes) {
    if (!h.alive) continue
    // ground rising under a hero carries it up; anyone else in the way is pushed out to the side
    const over = Math.abs(h.position.x - s.x) <= s.hx && Math.abs(h.position.z - s.z) <= s.hz
    if (over && piece.look === 'terrain' && h.position.y >= piece.base - 0.05) h.position.y = Math.max(h.position.y, floorAt(m, { ...h.position, y: piece.top }))
    keepOut(h, m)
  }
  ctx.events.push({ type: 'wall', index, owner: caster.id, phase: 'up', at: { x: s.x, y: piece.base, z: s.z }, hx: s.hx, hz: s.hz, top: piece.top, look: piece.look, base: piece.base, ...(piece.slope ? { slope: piece.slope } : {}) })
}

/** A one-way barrier across the aim where it lands: the caster's side shoots through it, nothing else gets past. */
function barrier(ctx: Ctx, caster: HeroState, at: Vec3, e: Of<'barrier'>) {
  const { alongX } = axisOf(caster)
  const half = e.length / 2
  const base = floorAt(ctx.match, at)
  const health = e.health * (1 + (ctx.setups[caster.id].mods?.constructPower ?? 0))
  // it runs across the aim: along z when aiming along x
  const shape = { kind: 'block' as const, x: at.x, z: at.z, hx: alongX ? 0.2 : half, hz: alongX ? half : 0.2 }
  raise(ctx, caster, { shape, base, top: base + e.height, look: 'barrier', health, pass: caster.team }, e.duration)
}

/** Ground to walk on: a ramp up from in front of the caster, a platform where it lands, or a path along the aim. */
function terrain(ctx: Ctx, caster: HeroState, at: Vec3, e: Of<'terrain'>) {
  const m = ctx.match
  const { alongX, sign } = axisOf(caster)
  const half = e.length / 2
  const side = e.width / 2
  const foot = floorAt(m, caster.position)
  const box = (cx: number, cz: number, along: number, across: number) => ({ kind: 'block' as const, x: cx, z: cz, hx: alongX ? along : across, hz: alongX ? across : along })
  const ahead = (d: number) => ({ x: caster.position.x + (alongX ? sign * d : 0), z: caster.position.z + (alongX ? 0 : sign * d) })
  if (e.shape === 'platform') {
    const base = floorAt(m, at)
    return raise(ctx, caster, { shape: box(at.x, at.z, side, side), base, top: base + e.height, look: 'terrain' }, e.duration)
  }
  const c = ahead(capsule(caster).radius + 0.4 + half)
  if (e.shape === 'ramp') {
    const rise = alongX ? (sign > 0 ? 'x+' : 'x-') : sign > 0 ? 'z+' : 'z-'
    return raise(ctx, caster, { shape: box(c.x, c.z, half, side), base: foot, top: foot + e.height, slope: { rise, low: foot + 0.05 }, look: 'terrain' }, e.duration)
  }
  raise(ctx, caster, { shape: box(c.x, c.z, half, side), base: foot, top: foot + e.height, look: 'terrain' }, e.duration)
}

/** A pair of portals, one at the caster's feet and one where it lands; a caster's new pair closes its old one. */
function portal(ctx: Ctx, caster: HeroState, at: Vec3, e: Of<'portal'>) {
  const m = ctx.match
  for (const p of m.portals ?? []) if (p.owner === caster.id) closePortal(ctx, p)
  m.portals = (m.portals ?? []).filter((p) => p.owner !== caster.id)
  const a = { x: caster.position.x, y: floorAt(m, caster.position), z: caster.position.z }
  const b = { x: at.x, y: floorAt(m, { ...at, y: at.y + 1 }), z: at.z }
  const p = { id: nextId(m), owner: caster.id, a, b, until: m.tick + ticks(e.duration) }
  m.portals.push(p)
  // the caster has just stepped on its own: it goes through when it steps on again
  caster.portalAfter = m.tick + ticks(0.6)
  ctx.events.push({ type: 'portal', id: p.id, owner: p.owner, phase: 'open', a, b })
}

const closePortal = (ctx: Ctx, p: NonNullable<MatchState['portals']>[number]) => ctx.events.push({ type: 'portal', id: p.id, owner: p.owner, phase: 'close', a: p.a, b: p.b })

const PORTAL_RADIUS = 0.9

function tickPortals(ctx: Ctx) {
  const m = ctx.match
  if (!m.portals?.length) return
  m.portals = m.portals.filter((p) => {
    if (m.tick >= p.until) return void closePortal(ctx, p), false
    for (const h of m.heroes) {
      if (!standing(h) || (h.portalAfter ?? 0) > m.tick || h.grabbedBy !== undefined || h.lifted) continue
      const into = flatDistance(h.position, p.a) <= PORTAL_RADIUS && Math.abs(h.position.y - p.a.y) < 1.5 ? 'a' : flatDistance(h.position, p.b) <= PORTAL_RADIUS && Math.abs(h.position.y - p.b.y) < 1.5 ? 'b' : undefined
      if (!into) continue
      const from = into === 'a' ? p.a : p.b
      const to = into === 'a' ? p.b : p.a
      // out of the far one a step along the way it came, keeping its run
      const dx = to.x - from.x
      const dz = to.z - from.z
      const len = Math.sqrt(dx * dx + dz * dz) || 1
      const out = PORTAL_RADIUS + capsule(h).radius + 0.2
      h.position = { x: to.x + (dx / len) * out, y: to.y, z: to.z + (dz / len) * out }
      h.portalAfter = m.tick + ticks(1)
      keepOut(h, m)
      ctx.events.push({ type: 'portal', id: p.id, owner: p.owner, phase: 'through', a: from, b: to, who: h.id })
    }
    return true
  })
}

// ---- tricks: kits, possession -----------------------------------------------------------------------------------

/** Every slot but the ultimate is taken: a copy brings the target's weapons, skills, movement and passive. */
const COPIED: readonly BuildSlot[] = ['basic', 'active1', 'active2', 'movement', 'passive']

function copyKit(ctx: Ctx, caster: HeroState, target: HeroState | undefined, e: Of<'copyKit'>) {
  if (!target || target === caster) return
  const slots: Partial<Record<BuildSlot, { hero: number; slot: BuildSlot }>> = {}
  for (const s of COPIED) slots[s] = { hero: target.id, slot: s }
  setKit(ctx, caster, { slots, until: now(ctx) + ticks(e.duration), why: 'copy', ammo: caster.ammo }, target.id)
}

/**
 * A Kit switch (or a form's moveset): the template's `switchTo` slots replace the caster's for `seconds`. Casting the
 * switch again while it holds switches back.
 */
export function kitSwitch(ctx: Ctx, caster: HeroState, template: Template, slot: BuildSlot, seconds: number, why: 'switch' | 'form') {
  if (!template.switchTo) return
  if (why === 'switch' && caster.kitFrom?.why === 'switch') return endKit(ctx, caster)
  const slots: Partial<Record<BuildSlot, { hero: number; slot: BuildSlot; inner: BuildSlot }>> = {}
  for (const s of Object.keys(template.switchTo) as BuildSlot[]) slots[s] = { hero: caster.id, slot, inner: s }
  setKit(ctx, caster, { slots, until: now(ctx) + ticks(seconds), why, ammo: caster.ammo }, undefined)
}

function setKit(ctx: Ctx, hero: HeroState, kit: NonNullable<HeroState['kitFrom']>, from: number | undefined) {
  if (hero.kitFrom) endKit(ctx, hero)
  hero.kitFrom = kit
  hero.action = undefined
  hero.charging = undefined
  // a borrowed gun comes loaded
  const gun = kit.slots.active1
  if (gun) hero.ammo = ctx.setups[gun.hero].magazine
  ctx.events.push({ type: 'kit', hero: hero.id, phase: 'start', why: kit.why, ...(from !== undefined ? { from } : {}) })
}

function endKit(ctx: Ctx, hero: HeroState) {
  const k = hero.kitFrom
  if (!k) return
  hero.kitFrom = undefined
  hero.action = undefined
  hero.charging = undefined
  // its own gun comes back as it left it
  if (k.slots.active1) hero.ammo = k.ammo ?? hero.ammo
  ctx.events.push({ type: 'kit', hero: hero.id, phase: 'end', why: k.why })
}

const liveKits = new WeakMap<readonly HeroSetup[], Map<string, HeroSetup>>()

/**
 * The setups as they stand this tick: a hero whose kit is borrowed (`kitFrom`) gets the lent templates in place of its
 * own. The same setups when nobody's is, and the same objects tick to tick while a loan lasts.
 */
export function liveSetups(match: MatchState, setups: readonly HeroSetup[]): readonly HeroSetup[] {
  if (!match.heroes.some((h) => h.kitFrom)) return setups
  let memo = liveKits.get(setups)
  if (!memo) liveKits.set(setups, (memo = new Map()))
  return setups.map((s, i) => {
    const k = match.heroes[i]?.kitFrom
    if (!k) return s
    const key = `${i}:${JSON.stringify(k.slots)}`
    let live = memo!.get(key)
    if (!live) {
      const kit = { ...s.kit }
      let magazine = s.magazine
      for (const slot of BUILD_SLOTS) {
        const ref = k.slots[slot]
        if (!ref) continue
        const base = setups[ref.hero].kit[ref.slot]
        const lent = ref.inner ? base.switchTo?.[ref.inner] : base
        if (!lent) continue
        kit[slot] = lent
        if (slot === 'active1') magazine = ref.inner ? Math.max(2, lent.ranged?.magazine ?? s.magazine) : setups[ref.hero].magazine
      }
      memo!.set(key, (live = { ...s, kit, magazine, constructKit: undefined }))
    }
    return live
  })
}

function possess(ctx: Ctx, caster: HeroState, target: HeroState | undefined, e: Of<'possess'>) {
  if (!target || target === caster || target.team === caster.team || target.possessed || target.summon || target.unstoppableUntil > now(ctx)) return
  if (caster.possessing !== undefined) letGo(ctx, ctx.match.heroes[caster.possessing])
  target.possessed = { by: caster.id, until: now(ctx) + ticks(e.duration), team: target.team }
  target.team = caster.team
  caster.possessing = target.id
  interrupt(ctx, target)
  ctx.events.push({ type: 'possess', hero: target.id, by: caster.id, phase: 'start' })
}

function letGo(ctx: Ctx, target: HeroState) {
  const p = target.possessed
  if (!p) return
  target.team = p.team
  target.possessed = undefined
  const by = ctx.match.heroes[p.by]
  if (by.possessing === target.id) by.possessing = undefined
  interrupt(ctx, target)
  ctx.events.push({ type: 'possess', hero: target.id, by: p.by, phase: 'end' })
}

// ---- lift, revive -----------------------------------------------------------------------------------------------

const LIFT_RISE = 0.3

function lift(ctx: Ctx, caster: HeroState, u: HeroState, e: Of<'lift'>) {
  const t = now(ctx)
  if (u.unstoppableUntil > t || u.invulnerableUntil > t || u.lifted) return
  u.lifted = { by: caster.id, from: t, until: t + ticks(LIFT_RISE + e.hold), base: u.position.y, height: e.height, distance: e.distance }
  u.stunnedUntil = Math.max(u.stunnedUntil, u.lifted.until)
  u.knockback = undefined
  u.launch = undefined
  u.airborne = true
  interrupt(ctx, u)
  ctx.events.push({ type: 'lift', hero: u.id, by: caster.id, phase: 'up' })
}

function tickLifts(ctx: Ctx) {
  const t = now(ctx)
  for (const u of ctx.match.heroes) {
    const l = u.lifted
    if (!l) continue
    if (!u.alive || u.downed) {
      u.lifted = undefined
      continue
    }
    const k = Math.min(1, (t - l.from) / ticks(LIFT_RISE))
    u.position.y = l.base + l.height * k * (2 - k)
    u.velocity = { x: 0, y: 0, z: 0 }
    u.airborne = true
    if (t < l.until) continue
    u.lifted = undefined
    // thrown along where the lifter aims now, so it can turn to choose where
    const by = ctx.match.heroes[l.by]
    const origin = { x: u.position.x - sin(by.yaw), y: u.position.y, z: u.position.z - cos(by.yaw) }
    displace(ctx, by, u, LIFT_TEMPLATE, l.distance, false, origin)
    u.stunnedUntil = Math.max(u.stunnedUntil, t + ticks(ENGINE.knockbackTime))
    u.floored = true
    ctx.events.push({ type: 'lift', hero: u.id, by: l.by, phase: 'throw' })
  }
}

/** `displace` reads only a template's delivery and tags, to tell a pull from a push. */
const LIFT_TEMPLATE = { delivery: { kind: 'self', range: 0 }, tags: [] } as unknown as Template

/** Revive a downed ally where it landed (or the nearest to it), or every downed ally in reach, at `share` of its health. */
function reviveAtRange(ctx: Ctx, caster: HeroState, template: Template, at: Vec3, e: Of<'revive'>) {
  const reach = Math.max(template.delivery.range, ENGINE.alliesRadius) + (template.delivery.radius ?? 0)
  const downed = ctx.match.heroes.filter((o) => o.alive && o.downed && o.team === caster.team && distance(caster.position, o.position) <= reach + capsule(o).radius)
  if (!downed.length) return
  const raised = e.target === 'allies' ? downed : [downed.reduce((a, b) => (distance(b.position, at) < distance(a.position, at) ? b : a))]
  for (const u of raised) revive(ctx, u, caster.id, e.share)
}

// ---- summons ----------------------------------------------------------------------------------------------------

const SUMMON_BODY = {
  minion: { size: 'tiny', health: 0.3, damage: -0.6 },
  clone: { size: undefined, health: 0.5, damage: -0.5 },
  decoy: { size: undefined, health: 0.2, damage: -1 },
  titan: { size: 'colossal', health: 2.5, damage: 0.6 },
} as const

/** Every summon effect anywhere in a kit, a kit switch's slots included. */
function summonsIn(kit: Record<BuildSlot, Template>): Of<'summon'>[] {
  const out: Of<'summon'>[] = []
  const look = (t: Template) => {
    for (const e of t.effects as Effect[]) if (e.kind === 'summon') out.push(e)
    for (const inner of Object.values(t.switchTo ?? {})) if (inner) look(inner)
  }
  for (const s of BUILD_SLOTS) look(kit[s])
  return out
}

/**
 * Reserve bodies for every hero whose kit summons (§4 Q Summon): heroes that wait out of the match, not alive, until
 * their owner calls them in. Made when the match is set up, since the match's heroes never change in number once it
 * runs; made again after a kit changes before it runs (John's lab), adding only the bodies still missing.
 */
export function addReserves(match: MatchState, setups: HeroSetup[]) {
  const owners = match.heroes.filter((h) => !h.summon)
  for (const owner of owners) {
    const need = new Map<Of<'summon'>['what'], number>()
    for (const e of summonsIn(setups[owner.id].kit)) need.set(e.what, Math.max(need.get(e.what) ?? 0, e.what === 'titan' ? 1 : e.count))
    for (const [what, count] of need) {
      const have = match.heroes.filter((h) => h.summon?.owner === owner.id && h.summon.what === what).length
      for (let i = have; i < count; i++) {
        const setup = setups[owner.id]
        const id = match.heroes.length
        const body = createHero(setup, id, owner.team, { ...owner.position })
        body.alive = false
        body.hp = 0
        body.summon = { owner: owner.id, what, active: false, until: 0, dx: 0, dz: 1 }
        setups.push(setup)
        match.heroes.push(body)
      }
    }
  }
}

function summon(ctx: Ctx, caster: HeroState, _slot: BuildSlot, e: Of<'summon'>) {
  const m = ctx.match
  const t = now(ctx)
  const mine = m.heroes.filter((h) => h.summon?.owner === caster.id && h.summon.what === e.what)
  const count = e.what === 'titan' ? 1 : e.count
  let placed = 0
  for (const body of mine) {
    if (placed >= count) break
    // a recast calls in what's resting and renews what's already out
    if (body.summon!.active) {
      body.summon!.until = t + ticks(e.duration)
      placed++
      continue
    }
    callIn(ctx, caster, body, placed, count, e)
    placed++
  }
}

function callIn(ctx: Ctx, owner: HeroState, body: HeroState, i: number, count: number, e: Of<'summon'>) {
  const t = now(ctx)
  const setup = ctx.setups[body.id]
  const kind = SUMMON_BODY[e.what]
  // fanned out beside and a step ahead of its owner
  const spread = count > 1 ? (i / (count - 1) - 0.5) * 2 : 0
  const side = 1.4 * spread + (count === 1 ? 1.2 : 0)
  const ahead = e.what === 'titan' ? 2.5 : 1
  const at = {
    x: owner.position.x + cos(owner.yaw) * side + sin(owner.yaw) * ahead,
    y: owner.position.y,
    z: owner.position.z - sin(owner.yaw) * side + cos(owner.yaw) * ahead,
  }
  const fresh = createHero(setup, body.id, owner.team, at)
  const size = kind.size ?? owner.size
  fresh.size = size
  fresh.chosenSize = size
  fresh.maxHp = setup.sheet.maxHealth * kind.health
  fresh.hp = fresh.maxHp
  fresh.damageBonus = kind.damage
  fresh.yaw = owner.yaw
  fresh.summon = { owner: owner.id, what: e.what, active: true, until: t + ticks(e.duration), dx: sin(owner.yaw), dz: cos(owner.yaw) }
  // the same object the match (and the client) already hold
  for (const k of Object.keys(body) as (keyof HeroState)[]) if (!(k in fresh)) delete (body as Partial<HeroState>)[k]
  Object.assign(body, fresh)
  keepOut(body, ctx.match)
  ctx.events.push({ type: 'summon', hero: body.id, owner: owner.id, what: e.what, phase: 'in' })
}

function tickSummons(ctx: Ctx) {
  const t = now(ctx)
  for (const h of ctx.match.heroes) {
    const s = h.summon
    if (!s?.active) continue
    const owner = ctx.match.heroes[s.owner]
    if (h.alive && t < s.until && owner.alive) continue
    s.active = false
    if (h.alive) {
      h.alive = false
      h.hp = 0
      h.action = undefined
      h.knockback = undefined
      h.launch = undefined
    }
    ctx.events.push({ type: 'summon', hero: h.id, owner: s.owner, what: s.what, phase: 'out' })
  }
}

/**
 * What a summon does this tick, driven by the engine: a decoy runs on the way its owner faced; the rest go for the
 * nearest enemy standing (or follow their owner when there's none), striking in reach and shooting in range.
 */
function summonCommand(match: MatchState, setups: readonly HeroSetup[], h: HeroState): Command {
  const s = h.summon!
  if (s.what === 'decoy') {
    const { yaw } = yawPitch({ x: s.dx, y: 0, z: s.dz })
    return { moveX: s.dx, moveZ: s.dz, moves: 0, aimYaw: steps(yaw), aimPitch: 0, buttons: 0 }
  }
  let target: HeroState | undefined
  let best = Infinity
  for (const o of match.heroes) {
    if (!standing(o) || o.team === h.team || o.stealthUntil > match.tick) continue
    const d = flatDistance(o.position, h.position)
    if (d < best) ((best = d), (target = o))
  }
  const owner = match.heroes[s.owner]
  const goal = target ?? owner
  const dx = goal.position.x - h.position.x
  const dz = goal.position.z - h.position.z
  const flat = Math.sqrt(dx * dx + dz * dz) || 1
  const yaw = atan2(dx, dz)
  if (!target) return flat > 3 ? { moveX: dx / flat, moveZ: dz / flat, moves: 0, aimYaw: steps(yaw), aimPitch: 0, buttons: 0 } : { ...IDLE, aimYaw: steps(yaw) }
  const pitch = atan2(chest(target).y - chest(h).y, flat)
  const kit = setups[h.id].kit
  const reach = kit.basic.delivery.range + capsule(h).radius + capsule(target).radius + 0.3
  const close = flat <= reach
  const inRange = flat <= kit.active1.delivery.range
  // a basic attack strikes as it's let go: tap it every other tick in reach
  const tap = close && !(h.buttonsHeld & slotBit('basic')) ? slotBit('basic') : 0
  const shoot = !close && inRange ? slotBit('active1') : 0
  const walk = close ? 0 : 1
  return { moveX: (dx / flat) * walk, moveZ: (dz / flat) * walk, moves: 0, aimYaw: steps(yaw), aimPitch: steps(pitch), buttons: tap | shoot }
}

/**
 * The commands heroes act on this tick: a possessed hero takes its possessor's (whose own body stands still), and a
 * summon the engine's own. The same array when neither applies.
 */
export function commandsFor(match: MatchState, setups: readonly HeroSetup[], commands: readonly (Command | undefined)[]): readonly (Command | undefined)[] {
  let out: (Command | undefined)[] | undefined
  const set = (i: number, c: Command) => ((out ??= [...commands])[i] = c)
  for (const h of match.heroes) {
    if (h.summon?.active && h.alive) set(h.id, summonCommand(match, setups, h))
    else if (h.possessed && h.alive) {
      const by = match.heroes[h.possessed.by]
      set(h.id, commands[by.id] ?? IDLE)
      set(by.id, { ...IDLE, aimYaw: steps(by.yaw), aimPitch: steps(by.pitch) })
    }
  }
  return out ?? commands
}

/** Once a tick after everything moved: lifts held and thrown, portals, possessions, borrowed kits and summons running out. */
export function tickSpells(ctx: Ctx) {
  const m = ctx.match
  const t = now(ctx)
  tickLifts(ctx)
  tickPortals(ctx)
  tickTraverse(ctx)
  for (const h of m.heroes) {
    if (h.counter && h.counter.until <= t) h.counter = undefined
    if (h.kitFrom && (t >= h.kitFrom.until || !h.alive)) endKit(ctx, h)
    const p = h.possessed
    if (p && (t >= p.until || !h.alive || !standing(m.heroes[p.by]))) letGo(ctx, h)
  }
  tickSummons(ctx)
  tickSystems(ctx)
}
