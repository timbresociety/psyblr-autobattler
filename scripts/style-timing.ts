/**
 * Each melee style's beat from its clips (GAME.md §5: combo windows from contact frames), written to
 * src/arena/engine/style-timing.json for the engine, which can't read the client's library at run time.
 *
 *     npx tsx scripts/style-timing.ts
 *
 * For every style, its light strikes' contact (seconds to the blow) and recovery (the blow to the clip's end) are taken
 * from the library's tags, median over both bodies. A style's wind-up and recovery are the engine's basic beat times
 * how much slower or quicker its clips land than the median style's, held to between 0.75 and 1.4 of it: a
 * greatsword winds up longer than fists, and nothing ever takes a clip's raw seconds (Mixamo strikes start from a
 * long idle).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { MOTIONS } from '../src/charter/motions.js'
import { MELEE_STYLES } from '../src/charter/templates/styles.js'
import type { MeleeStyle } from '../src/charter/types.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as {
  genders: Record<string, { sets: { combat: Record<string, number> }; tags?: Record<string, { contact?: number }> }>
}
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}
const round = (x: number) => Math.round(x * 1000) / 1000

const beats: Partial<Record<MeleeStyle, { contact: number; recover: number; clips: number }>> = {}
for (const style of Object.keys(MELEE_STYLES) as MeleeStyle[]) {
  const contacts: number[] = []
  const recovers: number[] = []
  for (const motion of MOTIONS.filter((m) => m.kind === 'light' && m.style === style)) {
    for (const g of Object.values(index.genders)) {
      const duration = g.sets.combat[motion.id]
      const tag = g.tags?.[motion.id]
      // a contact at the very end says nothing about a strike's beat (strikes start and end at rest, so most loop)
      if (!duration || !tag?.contact || tag.contact >= duration * 0.9) continue
      contacts.push(tag.contact)
      recovers.push(duration - tag.contact)
    }
  }
  if (contacts.length) beats[style] = { contact: median(contacts), recover: median(recovers), clips: contacts.length }
}
const mid = { contact: median(Object.values(beats).map((b) => b.contact)), recover: median(Object.values(beats).map((b) => b.recover)) }
const clamp = (x: number) => Math.min(1.4, Math.max(0.75, x))
const out = Object.fromEntries(
  (Object.keys(MELEE_STYLES) as MeleeStyle[]).map((style) => {
    const b = beats[style]
    return [style, b ? { prep: round(clamp(b.contact / mid.contact)), recover: round(clamp(b.recover / mid.recover)), clips: b.clips } : { prep: 1, recover: 1, clips: 0 }]
  }),
)
writeFileSync('src/arena/engine/style-timing.json', JSON.stringify(out, null, 2) + '\n')
console.log(out)
