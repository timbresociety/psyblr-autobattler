import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AnimIndex } from '../client/anim-index.js'
import { E_OPTIONS, F_OPTIONS, LMB_FAMILIES, LMB_MODES, Q_OPTIONS, R_OPTIONS, V_OPTIONS, lmb } from '../lab/library.js'
import { AURA_CLIPS, CAST_CLIPS, MELEE_SETS, MOVEMENT_CLIPS, SHOT_CLIPS, ULTIMATE_CLIPS, auraKind, castFamily, castShape, movementKind, shotClips, shotGrip, shotWay, skillClips, ultimateShape } from './motions.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as AnimIndex
const combat = (g: 'm' | 'f') => index.genders[g].sets.combat
const TABLES = { CAST_CLIPS, MOVEMENT_CLIPS, AURA_CLIPS, ULTIMATE_CLIPS } as Record<string, Record<string, readonly string[] | undefined>>
const shots = Object.entries(SHOT_CLIPS).flatMap(([grip, ways]) => Object.entries(ways).map(([way, clips]) => [`SHOT_CLIPS.${grip}.${way}`, clips ?? []] as const))
const blows = Object.entries(MELEE_SETS).flatMap(([family, set]) => Object.entries(set).map(([move, clip]) => [`MELEE_SETS.${family}.${move}`, typeof clip === 'string' ? [clip] : [...clip]] as const))

describe('the clips each family, kind and shape plays (GAME.md §4)', () => {
  it('names only clips both bodies have in their combat set', () => {
    const rows = [...Object.entries(TABLES).flatMap(([table, r]) => Object.entries(r).map(([row, clips]) => [`${table}.${row}`, clips ?? []] as const)), ...shots, ...blows]
    for (const g of ['m', 'f'] as const) expect(rows.flatMap(([row, clips]) => clips.filter((c) => !(c in combat(g))).map((c) => `${g} ${row} ${c}`))).toEqual([])
  })

  it('never gives two shapes or kinds of a button the same first clip', () => {
    for (const [table, rows] of Object.entries(TABLES)) {
      const firsts = Object.values(rows).map((clips) => clips?.[0])
      expect(new Set(firsts).size, table).toBe(firsts.length)
    }
  })

  it('fires and casts nothing that is only a fragment of a move', () => {
    const short = [...shots, ...blows].flatMap(([row, clips]) => clips.filter((c) => combat('m')[c] < 0.24).map((c) => `${row} ${c}`))
    expect(short).toEqual([])
  })

  it("gives every melee family its own chain, heavy blow and moveset, none of them playing one clip twice but the grab", () => {
    for (const [family, set] of Object.entries(MELEE_SETS)) {
      const own = [...set.chain, set.heavy, set.dash, set.air, set.slam, set.launcher, set.flurry]
      expect(new Set(own).size, family).toBe(own.length)
    }
    const chains = Object.values(MELEE_SETS).map((s) => s.chain.join())
    expect(new Set(chains).size).toBe(chains.length)
  })

  it('fires every LMB family and way of firing on its own grip', () => {
    for (const f of LMB_FAMILIES)
      for (const m of LMB_MODES) {
        const t = lmb(f.id, m.id)
        expect(shotGrip(t), `${f.id} ${m.id}`).toBe(f.id)
        expect(shotClips(t)?.[0], `${f.id} ${m.id}`).toBe((SHOT_CLIPS[f.id][shotWay(t)] ?? SHOT_CLIPS[f.id].single)[0])
      }
    expect(shotWay(lmb('thrown', 'single', 'lobbed'))).toBe('lobbed')
    expect(shotWay(lmb('bow', 'charge'))).toBe('charge')
    expect(shotWay(lmb('magic2', 'channel'))).toBe('held')
    // the one-hand gun fires the pistol shot; paired guns fire it too, akimbo (characters.ts turns each arm out and plays
    // the off arm half a beat behind); the long gun, the heavy gun and the bow each their own
    expect(SHOT_CLIPS.pistol.single[0]).toBe('pistol_fire')
    expect(SHOT_CLIPS.paired.single[0]).toBe('pistol_fire')
    const singles = (['pistol', 'rifle', 'heavy', 'bow'] as const).map((g) => SHOT_CLIPS[g].single[0])
    expect(new Set(singles).size).toBe(singles.length)
  })

  it("sorts every lab option into its own group's family, shape, kind or shape of R", () => {
    for (const o of Q_OPTIONS.filter((x) => x.group !== 'Systems')) expect(castFamily(o.template), o.id).toBe(o.group.toLowerCase())
    const Q: Record<string, string> = {
      'q-riposte': 'parry', 'q-substitution': 'substitute', 'q-mirror': 'reflect', 'q-drink': 'absorb',
      'q-minions': 'minions', 'q-clone': 'clone', 'q-decoy': 'decoy',
      'q-wall': 'wall', 'q-barrier': 'barrier', 'q-ramp': 'terrain', 'q-platform': 'terrain', 'q-path': 'terrain', 'q-portal': 'portal', 'q-turret': 'turret', 'q-trap': 'trap', 'q-totem': 'totem',
      'q-swap-health': 'swapHealth', 'q-steal': 'steal', 'q-rewind': 'rewind', 'q-copy': 'copyKit', 'q-possess': 'possess',
      'q-stun': 'stun', 'q-root': 'root', 'q-hook': 'pull', 'q-push': 'push', 'q-lift': 'lift',
      'q-heal': 'heal', 'q-shield': 'shield', 'q-revive': 'revive', 'q-curse': 'curse', 'q-zone': 'zone', 'q-reveal': 'vision',
      'q-fireball': 'bolt', 'q-wave': 'charged', 'q-cost': 'bolt', 'q-charges': 'bolt',
    }
    for (const o of Q_OPTIONS) expect(castShape(o.template), o.id).toBe(Q[o.id])
    const E: Record<string, string> = { 'e-blink': 'blink', 'e-teleport': 'teleport', 'e-swap': 'swap', 'e-dash': 'dash', 'e-homing': 'homing', 'e-leap': 'leap', 'e-grapple': 'grapple', 'e-swing': 'swing', 'e-flight': 'flight', 'e-glide': 'glide', 'e-crawl': 'wallCrawl', 'e-burrow': 'burrow', 'e-ride': 'ride', 'e-wall-run': 'wallRun', 'e-roll': 'combatRoll', 'e-slide': 'powerSlide', 'e-zipline': 'zipline' }
    for (const o of E_OPTIONS) expect(movementKind(o.template), o.id).toBe(E[o.id])
    const F: Record<string, string> = { 'f-flame': 'element', 'f-frost': 'element', 'f-lightning': 'element', 'f-thorns': 'guard', 'f-berserk': 'numbers', 'f-vanish': 'stealth', 'f-mana-shield': 'guard', 'f-allies': 'allies' }
    for (const o of F_OPTIONS) expect(auraKind(o.template), o.id).toBe(F[o.id])
    const R: Record<string, string> = { 'r-strike': 'strike', 'r-devastation': 'devastation', 'r-domain': 'domain', 'r-rally': 'rally', 'r-rampage': 'rampage', 'r-form': 'form', 'r-titan-form': 'giant', 'r-titan': 'titan', 'r-switch': 'switch', 'r-fuse': 'fusion' }
    for (const o of R_OPTIONS) expect(ultimateShape(o.template), o.id).toBe(R[o.id])
  })

  it('gives every Q, E, F and R pick in the lab a clip, and the R lock-on each family its own flurry', () => {
    for (const o of [...Q_OPTIONS, ...E_OPTIONS, ...F_OPTIONS, ...R_OPTIONS]) expect(skillClips(o.template, o.slot)?.length, o.id).toBeGreaterThan(0)
    const strike = R_OPTIONS.find((o) => o.id === 'r-strike')!.template
    for (const v of V_OPTIONS) expect(skillClips(strike, 'ultimate', v.template.style)?.[0], v.id).toBe(MELEE_SETS[v.template.style!].flurry)
  })
})
