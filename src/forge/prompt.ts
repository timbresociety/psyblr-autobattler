import { TEXT_LIMITS } from '../charter/build.js'
import type { SizeClass } from '../charter/sizes.js'
import type { BuildSlot } from '../charter/types.js'
import { findCulture } from './director/culture.js'
import { namedThemes } from './director/fake.js'

/**
 * What a Forge prompt says about a hero, read without a model: a name, a size, and a theme for each skill it names.
 * The offline path uses these as they are; with a model on, they are the hints it starts from. The engine still
 * chooses every mechanic and number: a theme only names a slot and steers which template matches it.
 */

const STOP = new Set(['a', 'an', 'the', 'my', 'our', 'this', 'that', 'some', 'make', 'create', 'forge', 'build', 'i', 'we'])
const BREAK = new Set(['who', 'with', 'that', 'which', 'and', 'in', 'of', 'as', 'from', 'for', 'into', 'wearing', 'whose', 'using', 'like', 'but', 'on', 'at', 'to'])

/** Where a prompt starts listing skills, the same phrasing the director's `namedThemes` reads. */
const SKILLS_CLAUSE = /\b(?:skills?|abilities|powers?)\s+(?:around|like|based on|about)\b/i

const title = (words: string[]) => words.map((w) => w.replace(/(^|-)(\p{L})/gu, (_, dash: string, c: string) => dash + c.toUpperCase())).join(' ')

/**
 * A name from the prompt: a run of capitalised words ("Jensen Huang in a Raiden-like avatar" is Jensen Huang), else a
 * hero the culture table knows, else the first few words that describe the hero ("a time-bending samurai who..." is
 * Time-Bending Samurai).
 */
export function nameFromPrompt(prompt: string): string {
  // the skills a prompt lists are capitalised too ("skills around Moon Slash"): they name skills, not the hero
  const about = prompt.split(SKILLS_CLAUSE)[0]
  const words = about.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const run: string[] = []
    for (let j = i; j < words.length; j++) {
      const word = words[j].replace(/[^\p{L}'"-]/gu, '')
      if (!/^["']?\p{Lu}/u.test(word) || BREAK.has(word.toLowerCase())) break
      run.push(word.replace(/["']/g, ''))
      if (/[,.;:!?]$/.test(words[j])) break
    }
    const meaningful = run.filter((w) => !STOP.has(w.toLowerCase()))
    if (meaningful.length) return meaningful.slice(0, 4).join(' ').slice(0, TEXT_LIMITS.heroName)
  }
  const culture = findCulture(about)[0]
  if (culture) return title([culture.names[0]]).slice(0, TEXT_LIMITS.heroName)
  const lead: string[] = []
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/[^\p{L}'-]/gu, '')
    if (!word || STOP.has(word)) {
      if (lead.length) break
      continue
    }
    if (BREAK.has(word)) break
    lead.push(word)
    if (lead.length === 3 || /[,.;:!?]$/.test(raw)) break
  }
  return (lead.length ? title(lead) : 'Unnamed Hero').slice(0, TEXT_LIMITS.heroName)
}

/** A size the prompt asks for, if it asks: "a giant", "a tiny gremlin". Colossal is only reached by transforming. */
export function sizeFromPrompt(prompt: string): SizeClass | undefined {
  if (/\b(giant|colossal|titan|huge|kaiju|enormous|gigantic)\b/i.test(prompt)) return 'huge'
  if (/\b(big|massive|towering|large|hulking|burly)\b/i.test(prompt)) return 'large'
  if (/\b(tiny|chibi|pocket|minuscule)\b/i.test(prompt)) return 'tiny'
  if (/\b(small|little|short|petite)\b/i.test(prompt)) return 'small'
  return undefined
}

// themes that belong in one slot: only the movement slot moves the hero, so a dash theme must land there
const MOVEMENT = /\b(teleport|blink|dash|leap|jump|fly|flight|warp|rush|charge|sprint|glide|grapple|hook|zip|step|torpedo)\b/i
const ULTIMATE = /\b(ultimate|summon|storm|apocalypse|cataclysm|final|nuke|meteor|army|datacenter|awaken|transform|judgement|judgment)\b/i
const PASSIVE = /\b(aura|passive|presence|law|always|regen\w*|thorns|instinct|blessing|curse|overclock)\b/i

/** One key per theme, so "tensor beam" and "tensor beams" count once. */
const themeKey = (theme: string) => theme.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/(\w{3,})s\b/g, '$1')

/**
 * A theme per skill slot from the prompt: the skills it names ("skills around CUDA, Stonks and memes"), then the ones
 * the culture table knows for the hero it mentions. A theme that reads as movement, an ultimate or a passive takes that
 * slot; anything else takes an active or the ultimate. Slots left without a theme stay empty, and the engine names
 * them by their mechanic, so a basic attack is never named after a datacenter.
 */
export function skillsFromPrompt(prompt: string): Partial<Record<BuildSlot, { name: string; flavour: string }>> {
  const seen = new Set<string>()
  const themes = [...namedThemes(prompt), ...findCulture(prompt).flatMap((c) => c.skillThemes)].filter((t) => {
    const key = themeKey(t)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const picks: Partial<Record<BuildSlot, { name: string; flavour: string }>> = {}
  for (const theme of themes) {
    const own: BuildSlot | undefined = MOVEMENT.test(theme) ? 'movement' : ULTIMATE.test(theme) ? 'ultimate' : PASSIVE.test(theme) ? 'passive' : undefined
    const slot = own && !picks[own] ? own : (['active1', 'active2', 'ultimate'] as const).find((s) => !picks[s])
    if (!slot) continue
    picks[slot] = { name: title(theme.split(/\s+/)).slice(0, TEXT_LIMITS.name), flavour: theme.slice(0, TEXT_LIMITS.flavour) }
  }
  return picks
}
