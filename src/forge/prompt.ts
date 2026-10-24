import { TEXT_LIMITS } from '../charter/build.js'
import type { Gender, HairStyle, LookColor } from '../charter/look.js'
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

// ------------------------------------------------------------------------------------------------ the look a prompt asks for

const COLOUR_WORDS: Record<string, string> = {
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
const COLOUR_NOUNS: [RegExp, LookColor][] = [
  [/^(cape|cloak|mantle)s?$/, 'cape'],
  [/^(armou?r|plate|plates|helmet|pauldrons?|metal)$/, 'metal'],
  [/^(jacket|suit|coat|robes?|shirt|tee|outfit|uniform|gi|tunic|hoodie|top|costume|clothes)$/, 'suit'],
  [/^(trim|accents?|stripes?|belt|sash)$/, 'trim'],
  [/^(pants|trousers|jeans|legs|shorts)$/, 'pants'],
  [/^(boots?|shoes?)$/, 'boot'],
  [/^(gloves?|gauntlets?)$/, 'glove'],
  [/^(hair|mane|beard)$/, 'hair'],
  [/^(eyes?)$/, 'iris'],
  [/^(skin)$/, 'skin'],
]

/** Colours the prompt asks for by name and noun: "a red cape", "gold armour", "a black leather jacket", "NVIDIA green". */
export function coloursFromPrompt(prompt: string): Partial<Record<LookColor, string>> {
  const out: Partial<Record<LookColor, string>> = {}
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
  for (const [re, hex] of COLOUR_PHRASES) {
    const at = prompt.search(re)
    if (at < 0) continue
    const after = prompt.slice(at).toLowerCase().split(/\s+/).slice(2, 5)
    const region = after.map((w) => COLOUR_NOUNS.find(([r]) => r.test(w.replace(/[^\p{L}]/gu, '')))?.[1]).find(Boolean)
    out[region ?? 'suit'] ??= hex
  }
  return out
}

/** A gender the prompt states (she, a woman, a queen), or undefined when it doesn't. */
export function genderFromPrompt(prompt: string): Gender | undefined {
  if (/\b(she|her|hers|woman|women|female|girl|lady|queen|princess|goddess|empress|witch|heroine|mother|sister|daughter|wife)\b/i.test(prompt)) return 'f'
  if (/\b(he|him|his|man|men|male|boy|guy|king|prince|god|emperor|wizard|father|brother|son|husband|lord)\b/i.test(prompt)) return 'm'
  return undefined
}

/** The hair, armour and cape a prompt asks for, where it asks. */
export function partsFromPrompt(prompt: string): { hair?: HairStyle; armour?: boolean; cape?: boolean } {
  const out: { hair?: HairStyle; armour?: boolean; cape?: boolean } = {}
  if (/\b(bald|shaved head|shaven head|hairless)\b/i.test(prompt)) out.hair = 'none'
  else if (/\b(helmet|helm|knight|spartan|centurion|legionnaire)\b/i.test(prompt)) out.hair = 'helmet'
  else if (/\b(long hair|ponytail|braids?|flowing hair|mane)\b/i.test(prompt)) out.hair = 'long'
  else if (/\b(spiky|spiked hair|super saiyan|anime hair|mohawk)\b/i.test(prompt)) out.hair = 'spiky'
  else if (/\b(short hair|crew cut|buzz cut|buzzcut|crop)\b/i.test(prompt)) out.hair = 'crop'
  if (/\b(armou?r|armou?red|plate|knight|paladin|spartan|mech|cyborg|power suit)\b/i.test(prompt)) out.armour = true
  if (/\b(no armou?r|unarmou?red|light clothes)\b/i.test(prompt)) out.armour = false
  if (/\b(cape|cloak|caped|mantle)\b/i.test(prompt)) out.cape = true
  return out
}
