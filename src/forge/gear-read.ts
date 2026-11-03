import { GEAR_SLOTS, type GearSlot } from '../charter/look.js'
import { BUILT_IN, builtIn, fits, type PieceEntry } from '../kit/pieces.js'

/**
 * What a hero holds, read from words: a built-in piece's id a hand. Heroes are drawn bare (2026-11-04), so the hands
 * are all the Forge reads of what a hero carries; the forge rework after the map and movement work redoes weapons.
 */
export type HeldWish = Partial<Record<GearSlot, string>>

/**
 * Words for a kind of hero more than a thing it holds ("a samurai"). They arm the hero only where nothing the prompt
 * names outright goes, so a samurai with a spear keeps the spear.
 */
const ARCHETYPES = new Set([
  'samurai', 'ronin', 'shogun', 'ninja', 'shinobi', 'monk', 'shaolin', 'wizard', 'sorcerer', 'witch', 'magician', 'knight', 'paladin',
  'crusader', 'viking', 'barbarian', 'spartan', 'guardian', 'centurion', 'gladiator', 'cowboy', 'sheriff', 'gunslinger', 'archer', 'ranger',
  'robin hood', 'pirate', 'soldier', 'hunter', 'sniper', 'king', 'queen', 'thor', 'reaper', 'grim reaper', 'jedi', 'swordsman', 'mage',
  'fairy', 'detective', 'scholar', 'singer', 'rapper', 'mc', 'pop star', 'idol', 'karaoke', 'rock star', 'rocker', 'musician',
])

/** Tags too common to stand for a piece on their own, or about something else in a hero's description. */
const STOP = new Set(['death', 'band', 'book'])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// a word's edges: letters, digits and hyphens belong to the word; a held thing is read in the plural too ("twin daggers")
const termRe = (words: string) => new RegExp(`(?<![\\p{L}\\p{N}-])${escape(words)}(?:e?s)?(?![\\p{L}\\p{N}-])`, 'gu')

interface Term {
  words: string
  re: RegExp
  piece: PieceEntry
  archetype: boolean
}

let terms: Term[] | undefined
/** Every phrase for a built-in piece, longest first, so "war hammer" is found before "hammer". */
function allTerms(): Term[] {
  if (terms) return terms
  const byWords = new Map<string, Term>()
  for (const piece of BUILT_IN)
    for (const words of [piece.name.toLowerCase(), ...piece.tags.map((t) => t.toLowerCase())])
      if (!byWords.has(words) && !STOP.has(words)) byWords.set(words, { words, re: termRe(words), piece, archetype: ARCHETYPES.has(words) })
  return (terms = [...byWords.values()].sort((a, b) => b.words.length - a.words.length))
}

interface Hit {
  term: Term
  at: number
  end: number
  plural: boolean
}

function hitsIn(text: string): Hit[] {
  const out: Hit[] = []
  for (const term of allTerms())
    for (const m of text.matchAll(term.re)) {
      const at = m.index
      const end = at + m[0].length
      if (out.some((h) => at < h.end && end > h.at)) continue
      out.push({ term, at, end, plural: m[0].length > term.words.length })
    }
  return out.sort((a, b) => a.at - b.at)
}

/**
 * The hands a prompt fills, from the built-in pieces' names and tags: a hand piece in the right hand (a pair, "twin
 * daggers", in both), an off-hand piece in the left. What the prompt names outright comes first; a kind of hero fills
 * the right hand only when it's still free. Quoted text is a skill's name, so it never arms anyone.
 */
export function gearFromPrompt(prompt: string): HeldWish {
  const text = prompt.toLowerCase().replace(/["“”][^"“”]*["“”]/g, ' ')
  const hits = hitsIn(text)
  const out: HeldWish = {}
  const place = (hit: Hit, archetype: boolean) => {
    const { piece } = hit.term
    const free = GEAR_SLOTS.filter((s) => !out[s] && fits(piece.kind, s))
    if (archetype) {
      if (piece.kind === 'hand' && !out.hand_r) out.hand_r = piece.id
      return
    }
    const pair = piece.kind === 'hand' && (hit.plural || /\b(?:dual|twin|two|pair of)\s+$/.test(text.slice(0, hit.at)))
    for (const slot of pair ? free : free.slice(0, 1)) out[slot] = piece.id
  }
  for (const hit of hits) if (!hit.term.archetype) place(hit, false)
  for (const hit of hits) if (hit.term.archetype) place(hit, true)
  return out
}

/** An AI reader's hands, kept only where each names a built-in piece that fits that hand. */
export function readGear(raw: unknown): HeldWish {
  const out: HeldWish = {}
  if (!raw || typeof raw !== 'object') return out
  for (const slot of GEAR_SLOTS) {
    const id = (raw as Record<string, unknown>)[slot]
    const piece = typeof id === 'string' ? builtIn(id) : undefined
    if (piece && fits(piece.kind, slot)) out[slot] = piece.id
  }
  return out
}

const DROP = /\b(?:no|without|remove|lose|drop|ditch|take away|get rid of)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|their\s+|its\s+)?([\p{L}-]+(?:\s[\p{L}-]+)?)/gu
const EMPTY = /\b(?:unarmed|empty[- ]handed|bare[- ]handed|no weapons?|without (?:a )?weapons?)\b/

/** The hands after a correction: "no shield" empties the hand that held it, and what the note names takes its hand. */
export function correctGear(gear: HeldWish, note: string): HeldWish {
  const lower = note.toLowerCase()
  if (EMPTY.test(lower)) return {}
  const out = { ...gear }
  for (const m of lower.matchAll(DROP)) {
    const words = m[1].split(' ').map((w) => w.replace(/e?s$/, ''))
    for (const slot of GEAR_SLOTS) {
      const piece = out[slot] ? builtIn(out[slot]!) : undefined
      if (piece && words.some((w) => w.length > 2 && [piece.name.toLowerCase(), ...piece.tags].some((t) => t.split(' ').includes(w)))) delete out[slot]
    }
  }
  return { ...out, ...gearFromPrompt(lower.replace(DROP, ' ')) }
}

/** The pieces held, in words: "katana and round shield". */
export const gearPhrase = (gear: HeldWish): string =>
  [...new Set(GEAR_SLOTS.flatMap((s) => (gear[s] ? [builtIn(gear[s]!)?.name.toLowerCase() ?? gear[s]!] : [])))].join(' and ')
