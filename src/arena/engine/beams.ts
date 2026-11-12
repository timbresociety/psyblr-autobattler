import { scaleMagnitudes } from '../../charter/budget.js'
import type { Effect } from '../../charter/types.js'
import { DT, ticks } from './calibration.js'
import { displace, resolve, type Ctx } from './effects.js'
import { KIT } from './kit-tuning.js'
import { add, distance, scale, sub, type Vec3 } from './maths.js'
import type { HeroState, MatchState } from './state.js'

/**
 * Held beams and beam clashes (GAME.md §4 Systems). A channel weapon held on keeps a beam from its muzzle to what it
 * reaches (deliveries.ts `fire`). When two enemies' beams meet, they clash: neither lands, and the point where they
 * meet is pushed toward the weaker side, faster the weaker it is and the more its rival mashes the trigger. The side it
 * reaches loses: its beam breaks and the winner's lands on it in a burst.
 */

type Clash = NonNullable<MatchState['clashes']>[number]

/** The clash a hero's beam is caught in, if any. */
export const clashOf = (match: MatchState, id: number): Clash | undefined => match.clashes?.find((c) => c.a === id || c.b === id)

/** Where a clash meets now: `t` of the way from a's muzzle to b's. */
export function clashPoint(match: MatchState, c: Clash): Vec3 {
  const a = match.heroes[c.a].beam!
  const b = match.heroes[c.b].beam!
  return add(a.from, scale(sub(b.from, a.from), c.t))
}

/** A fresh trigger press during a clash pushes harder for a moment. */
export function mash(match: MatchState, id: number) {
  const c = clashOf(match, id)
  if (!c) return
  if (c.a === id) c.ma = (c.ma ?? 0) + 1
  else c.mb = (c.mb ?? 0) + 1
}

/** A hero's beam's damage a second: its weapon's direct damage at the hero's numbers, times its rate of fire. */
function beamPower(ctx: Ctx, hero: HeroState): number {
  const { kit, sheet } = ctx.setups[hero.id]
  const w = kit.active1
  let each = 0
  for (const e of w.effects as Effect[]) if (e.kind === 'damage' && !e.overTime) each += e.amount + e.ratio * sheet[e.scaling]
  return Math.max(1, each * (w.ranged?.rate ?? 1) * sheet.fireRate)
}

/** Closest distance between segments p1-q1 and p2-q2 (sampled finely: beams are short and this runs on few pairs). */
function segmentsGap(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  let best = Infinity
  const n = 24
  for (let i = 0; i <= n; i++) {
    const a = add(p1, scale(sub(q1, p1), i / n))
    for (let j = 0; j <= n; j++) best = Math.min(best, distance(a, add(p2, scale(sub(q2, p2), j / n))))
  }
  return best
}

const width = (ctx: Ctx, h: HeroState) => ctx.setups[h.id].kit.active1.delivery.width ?? 0.6

/** Once a tick after heroes act: beams that went out end, beams that meet clash, clashes move and break. */
export function tickBeams(ctx: Ctx) {
  const m = ctx.match
  const now = m.tick
  for (const h of m.heroes) {
    if (h.beam && (now > h.beam.until || !h.alive || h.downed)) {
      h.beam = undefined
      ctx.events.push({ type: 'beam', hero: h.id, phase: 'off' })
    }
  }
  // a clash whose beam went out is over: the other beam reaches past it again
  m.clashes = (m.clashes ?? []).filter((c) => {
    if (m.heroes[c.a].beam && m.heroes[c.b].beam) return true
    ctx.events.push({ type: 'clash', a: c.a, b: c.b, phase: 'end', at: m.heroes[c.a].position })
    return false
  })
  const beaming = m.heroes.filter((h) => h.beam && !clashOf(m, h.id))
  for (let i = 0; i < beaming.length; i++) {
    for (let j = i + 1; j < beaming.length; j++) {
      const a = beaming[i]
      const b = beaming[j]
      if (a.team === b.team || clashOf(m, a.id) || clashOf(m, b.id)) continue
      if (segmentsGap(a.beam!.from, a.beam!.end, b.beam!.from, b.beam!.end) > (width(ctx, a) + width(ctx, b)) / 2 + 0.3) continue
      const c: Clash = { a: a.id, b: b.id, t: 0.5, since: now }
      m.clashes.push(c)
      ctx.events.push({ type: 'clash', a: a.id, b: b.id, phase: 'start', at: clashPoint(m, c) })
    }
  }
  for (const c of [...m.clashes]) {
    const a = m.heroes[c.a]
    const b = m.heroes[c.b]
    const pa = beamPower(ctx, a) * (1 + KIT.clash.mash * (c.ma ?? 0))
    const pb = beamPower(ctx, b) * (1 + KIT.clash.mash * (c.mb ?? 0))
    c.ma = (c.ma ?? 0) * 0.97
    c.mb = (c.mb ?? 0) * 0.97
    // positive: a is stronger, so the point moves toward b
    const lead = (pa - pb) / (pa + pb)
    const shove = lead === 0 ? 0 : Math.sign(lead) * Math.max(KIT.clash.least, Math.abs(lead))
    c.t = Math.min(1, Math.max(0, c.t + shove * KIT.clash.push * DT))
    const at = clashPoint(m, c)
    a.beam!.end = at
    b.beam!.end = at
    const long = now - c.since >= ticks(KIT.clash.longest)
    const reach = (h: HeroState) => distance(at, h.beam!.from) <= 0.6
    const loser = reach(b) || (long && c.t >= 0.5) ? b : reach(a) || long ? a : undefined
    if (!loser) continue
    const winner = loser === a ? b : a
    m.clashes = m.clashes.filter((x) => x !== c)
    ctx.events.push({ type: 'clash', a: c.a, b: c.b, phase: 'end', loser: loser.id, at })
    loser.beam = undefined
    ctx.events.push({ type: 'beam', hero: loser.id, phase: 'off' })
    const blast = scaleMagnitudes(ctx.setups[winner.id].kit.active1, KIT.clash.burst)
    resolve(ctx, winner, blast, 'active1', [loser], { ...loser.position })
    if (loser.alive && !loser.downed) displace(ctx, winner, loser, blast, 4)
  }
}
