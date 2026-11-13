import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AnimIndex } from '../../arena/client/anim-index.js'
import { LIBRARY_MOVES } from '../../arena/client/library-gait.js'
import { AURA_CLIPS, CAST_CLIPS, MELEE_SETS, MOVEMENT_CLIPS, SHOT_CLIPS, ULTIMATE_CLIPS } from '../../arena/recipes/motions.js'
import { COMMON_MOTIONS, MOTIONS } from '../../charter/motions.js'
import { AUDIT_DROPPED, AUDIT_KEPT, NOT_A_GUARD } from './audit.js'
import { COVERAGE } from './coverage.js'
import { CLIP_TRIMS, CLIP_TURNS } from './trims.js'
import { WEAPON_MOVES } from './weapon-gait.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as AnimIndex
const GENDERS = ['m', 'f'] as const

/** Every clip each table plays or offers, by where it sits. */
function played(): [where: string, clip: string][] {
  const out: [string, string][] = []
  const add = (where: string, clips: readonly string[] | string | undefined) => {
    for (const clip of typeof clips === 'string' ? [clips] : (clips ?? [])) out.push([where, clip])
  }
  for (const [style, set] of Object.entries(MELEE_SETS)) for (const [move, clips] of Object.entries(set)) add(`melee ${style}.${move}`, clips as string | readonly string[])
  for (const [grip, ways] of Object.entries(SHOT_CLIPS)) for (const [way, clips] of Object.entries(ways)) add(`shot ${grip}.${way}`, clips)
  for (const [table, rows] of Object.entries({ CAST_CLIPS, MOVEMENT_CLIPS, AURA_CLIPS, ULTIMATE_CLIPS })) for (const [row, clips] of Object.entries(rows)) add(`${table}.${row}`, clips)
  for (const [move, clip] of Object.entries(LIBRARY_MOVES)) add(`engine ${move}`, clip)
  for (const [weapon, moves] of Object.entries(WEAPON_MOVES)) for (const [move, clip] of Object.entries(moves)) add(`${weapon} ${move}`, clip)
  for (const [move, { clip }] of Object.entries(COMMON_MOTIONS)) add(`shared ${move}`, clip)
  for (const m of MOTIONS) add(`catalogue ${m.kind} ${m.style}`, m.id)
  for (const c of COVERAGE) for (const [role, r] of Object.entries(c.roles)) add(`coverage ${c.id}.${role}`, r.clips)
  return out
}

describe('the clip audit holds (docs/reference/2026-11-05-clip-audit.md)', () => {
  it('plays no clip the audit took out, but where it says why', () => {
    const bad = played().filter(([, clip]) => AUDIT_DROPPED.has(clip) && !(clip in AUDIT_KEPT))
    expect(bad.map(([where, clip]) => `${where}: ${clip}`)).toEqual([])
  })

  it('keeps a dropped clip only where its reason holds', () => {
    const where = (clip: string) => played().filter(([, c]) => c === clip).map(([w]) => w)
    expect(where('hurricane_kick')).toEqual(['melee kicks.air'])
    expect(where('climbing_up_wall')).toEqual(['MOVEMENT_CLIPS.wallCrawl'])
    expect(where('prone_idle')).toEqual(['coverage rifle.prone'])
    for (const clip of Object.keys(AUDIT_KEPT)) expect(AUDIT_DROPPED.has(clip), clip).toBe(true)
  })

  it('holds a guard only with a clip that holds', () => {
    const guards = played().filter(([where]) => /\.block$|^catalogue block /.test(where))
    expect(guards.filter(([, clip]) => NOT_A_GUARD.has(clip)).map(([where, clip]) => `${where}: ${clip}`)).toEqual([])
  })

  it('plays only clips the library has, on both bodies', () => {
    for (const g of GENDERS) {
      const has = new Set(Object.values(index.genders[g].sets).flatMap((s) => Object.keys(s)))
      // a male-only emote is the coverage test's to count; gesture_1 has no female take
      const missing = played().filter(([where, clip]) => !has.has(clip) && !(g === 'f' && clip === 'gesture_1' && where.startsWith('coverage')))
      expect(missing.map(([where, clip]) => `${g} ${where}: ${clip}`)).toEqual([])
    }
  })

  it('trims each clip inside its own length, keeping its blow', () => {
    const fps = index.fps
    for (const g of GENDERS)
      for (const [clip, [from, to]] of Object.entries(CLIP_TRIMS)) {
        const file = `public/anim/standard/${g}/${clip}.json`
        let frames: number
        try {
          frames = (JSON.parse(readFileSync(file, 'utf8')) as { frames: number }).frames
        } catch {
          continue
        }
        const length = (frames - 1) / fps
        expect(from, `${g} ${clip} starts inside`).toBeLessThan(Math.min(to ?? length, length))
        const release = index.genders[g].marks?.[clip]?.[0]
        // an aim held and a hang looped have no blow to keep
        if (release !== undefined && !['pistol_aim', 'braced_hang', 'rifle_jump_up', 'male_runs_up_a_wall_onto_a_platform'].includes(clip)) {
          expect(release, `${g} ${clip}'s blow after the cut starts`).toBeGreaterThanOrEqual(from)
          expect(release, `${g} ${clip}'s blow before the cut ends`).toBeLessThanOrEqual(to ?? length)
        }
      }
  })

  it('turns a gait back only a little (a skew, not a different way), and an archer no further than side-on', () => {
    // an archer stands across its aim, so its stance turns most of a quarter turn; nothing else comes near one
    const archer = (clip: string) => /^standing_(aim|draw)_/.test(clip)
    for (const [clip, degrees] of Object.entries(CLIP_TURNS)) expect(Math.abs(degrees), clip).toBeLessThan(archer(clip) ? 90 : 45)
  })
})
