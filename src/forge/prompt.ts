import { TEXT_LIMITS } from '../charter/build.js'
import type { Gender, LookColor } from '../charter/look.js'
import type { SizeClass } from '../charter/sizes.js'
import type { BuildSlot } from '../charter/types.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../kit/body/shape.js'
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

/** The part of a prompt that describes the hero, before any "skills around ..." clause. */
export function heroPart(prompt: string): string {
  return prompt.split(SKILLS_CLAUSE)[0]
}

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

// ------------------------------------------------------------------------------------------------ the look a prompt asks for

/** Colour words and the '#rrggbb' each reads as. */
export const COLOUR_WORDS: Record<string, string> = {
  red: '#c8242c', crimson: '#a3122a', scarlet: '#d4231e', maroon: '#6e1423', orange: '#e8741c', amber: '#f0a020',
  gold: '#d4a531', golden: '#d4a531', yellow: '#f2cf2e', lime: '#9ccf2c', green: '#2f9a48', emerald: '#18905e', jade: '#3a9a7a',
  olive: '#6e7a2c', teal: '#178a8a', cyan: '#22b8d6', turquoise: '#2ec4b6', blue: '#2a5bd7', azure: '#3b8fe8', navy: '#1c2a5e',
  indigo: '#3b2a8a', purple: '#7a3ab0', violet: '#8a4ad0', magenta: '#c72a9a', pink: '#f07ab4', white: '#eeeeea', ivory: '#ece4cc',
  silver: '#b8bcc4', grey: '#7a7c82', gray: '#7a7c82', black: '#1a1a1e', brown: '#6a4228', bronze: '#a8743a', copper: '#b8642e',
  blonde: '#d8b46a', blond: '#d8b46a', ginger: '#c0602a', auburn: '#8a3a22', platinum: '#e4e0d4',
}
/** Phrases worth more than their words: the culture table's brand colours and the like. */
const COLOUR_PHRASES: [RegExp, string][] = [
  [/nvidia green/i, '#76b900'],
  [/jet black/i, '#0e0e10'],
  [/storm white/i, '#e6ecf2'],
  [/electric blue/i, '#2c7bff'],
  [/blood red/i, '#8a0a12'],
]
// heroes are drawn bare (2026-11-04), so a colour only lands on the body itself
const COLOUR_NOUNS: [RegExp, LookColor][] = [
  [/^(eyes?)$/, 'iris'],
  [/^(brows?|eyebrows?)$/, 'brow'],
  [/^(skin)$/, 'skin'],
]

/** Colours the prompt asks for on the body by name and noun: "blue eyes", "green skin", "NVIDIA green eyes". */
export function coloursFromPrompt(prompt: string): Partial<Record<LookColor, string>> {
  const out: Partial<Record<LookColor, string>> = {}
  // a phrase is read before its words, so "NVIDIA green eyes" are NVIDIA's green, not plain green
  for (const [re, hex] of COLOUR_PHRASES) {
    const at = prompt.search(re)
    if (at < 0) continue
    const after = prompt.slice(at).toLowerCase().split(/\s+/).slice(2, 5)
    const region = after.map((w) => COLOUR_NOUNS.find(([r]) => r.test(w.replace(/[^\p{L}]/gu, '')))?.[1]).find(Boolean)
    if (region) out[region] ??= hex
  }
  const words = prompt.toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/).filter(Boolean)
  for (let i = 0; i < words.length; i++) {
    const hex = COLOUR_WORDS[words[i]]
    if (!hex) continue
    // the noun a colour describes is the next noun-like word within a few words: "a red leather cape"
    for (let j = i + 1; j < Math.min(words.length, i + 4); j++) {
      const region = COLOUR_NOUNS.find(([re]) => re.test(words[j]))?.[1]
      if (region) {
        out[region] ??= hex
        break
      }
    }
  }
  return out
}

/** A gender the prompt states (she, a woman, a queen), or undefined when it doesn't. */
export function genderFromPrompt(prompt: string): Gender | undefined {
  if (/\b(she|her|hers|woman|women|female|girl|lady|queen|princess|goddess|empress|witch|heroine|mother|sister|daughter|wife)\b/i.test(prompt)) return 'f'
  if (/\b(he|him|his|man|men|male|boy|guy|king|prince|god|emperor|wizard|father|brother|son|husband|lord)\b/i.test(prompt)) return 'm'
  return undefined
}

/** Words for a build, and the physique each gives. */
const PHYSIQUE_WORDS: [RegExp, Partial<Physique>][] = [
  [/\b(?:muscular|muscled|muscle-bound|ripped|buff|jacked|brawny|beefy|burly|bodybuilder|hulking)\b/i, { muscle: 0.9 }],
  [/\b(?:slim|slender|lean|skinny|wiry|lanky|scrawny)\b/i, { weight: 0.2 }],
  [/\b(?:heavyset|fat|stout|chubby|portly|rotund|plump|overweight|pot-bellied)\b/i, { weight: 0.85 }],
  [/\bold\s+(?:[\p{L}-]+\s+)?(?:man|woman|lady|master|sage|hermit|wizard|witch|monk|king|queen|warrior|samurai|soldier|general|veteran)\b|\b(?:elderly|wrinkled|grey-haired|gray-haired|white-haired|grandpa|grandma|grandfather|grandmother|granny)\b/iu, { age: 0.7 }],
]

/** The build a prompt describes (muscular, slim, heavyset, old), or undefined when it says nothing about one. */
export function physiqueFromPrompt(prompt: string): Physique | undefined {
  const said = PHYSIQUE_WORDS.filter(([re]) => re.test(prompt))
  return said.length ? Object.assign({ ...NEUTRAL_PHYSIQUE }, ...said.map(([, p]) => p)) : undefined
}
