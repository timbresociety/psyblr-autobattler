import { LOOK_SLOTS, type LookSlot, type WornPrint } from '../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../kit/body/shape.js'
import { FINISHES, KNOBS, type Finish, type Knob, type Rung } from '../kit/wear/item.js'
import { LIBRARY, libraryItem, slotsFor, type LibraryEntry } from '../kit/wear/library.js'
import { PRINT_SCALE, PRINT_WORDS, PRINTS, isPrintId, type PrintId } from '../kit/wear/prints.js'
import { COLOUR_WORDS } from './prompt.js'

/**
 * What a reading asks the hero to wear, a wish a slot, in the library's own words. Each wish names the item that
 * answers it and the rung it sits on: worn as made, recoloured, restyled with a print or a cut, or generated new when
 * nothing in the library is close. An AI reader picks from the same library (forge/reading.ts); the offline reader
 * here matches the library's tags. Either way the reading takes the lowest rung that gets there and shows its cost.
 */

export interface WearWish {
  slot: LookSlot
  /** The words the prompt or the image put it in: "wide straw hat". */
  phrase: string
  /** The library item, or a community item's id, that answers it. None means it's made by generating. */
  item?: string
  /** Nothing worn here on purpose: bald, clean-shaven, barefoot. */
  bare?: true
  rung: Rung
  /** '#rrggbb' per channel; the item's own where null. */
  colors?: (string | null)[]
  finishes?: (Finish | null)[]
  /** A built-in print over one of the item's channels. */
  print?: WishPrint
  knobs?: Partial<Record<Knob, number>>
}

/** A built-in print as a wish holds it: which one, and the ink, size and channel when the player set them. */
export type WishPrint = { id: PrintId } & Pick<WornPrint, 'ink' | 'scale' | 'channel'>

const BARE_PHRASE: Partial<Record<LookSlot, string>> = { hair: 'bald', beard: 'clean-shaven', head: 'no hat', upper: 'shirtless', feet: 'barefoot' }
/** How a slot left empty on purpose reads: bald, clean-shaven, shirtless, barefoot. */
export const barePhrase = (slot: LookSlot): string => BARE_PHRASE[slot] ?? 'nothing'

/** A wish nothing in the library answers yet, for the Wardrobe to offer generating, and what stands in meanwhile. */
export interface WearGap {
  phrase: string
  slot: LookSlot
  /** The item worn in the slot meanwhile: the gap closes once something else is worn there. */
  under?: string
}

const HEX = /^#[0-9a-f]{6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The rung a wish's own fields put it on: no item is a generate, a print or a cut a restyle, a colour or finish a recolour. */
export function rungOfWish(wish: Omit<WearWish, 'rung'>): Rung {
  if (wish.bare) return 'wear'
  if (!wish.item) return 'generate'
  if (wish.print || (wish.knobs && Object.keys(wish.knobs).length)) return 'restyle'
  if (wish.colors?.some(Boolean) || wish.finishes?.some(Boolean)) return 'recolour'
  return 'wear'
}

/** Whether a wish can sit on a rung: anything can be generated, the rest needs an item, and its colours or its print. */
export function canReach(wish: WearWish, rung: Rung): boolean {
  if (wish.bare) return rung === 'wear'
  if (rung === 'generate') return true
  if (!wish.item) return false
  if (rung === 'recolour') return !!(wish.colors?.some(Boolean) || wish.finishes?.some(Boolean))
  if (rung === 'restyle') return !!(wish.print || (wish.knobs && Object.keys(wish.knobs).length))
  return true
}

/** The wish moved to a rung: down to the item as made or to its colours alone, or up to generating a new one. */
export function atRung(wish: WearWish, rung: Rung): WearWish {
  if (!canReach(wish, rung)) return wish
  if (rung === 'generate') return { ...wish, rung }
  const { colors, finishes, print: _print, knobs: _knobs, rung: _rung, ...rest } = wish
  const kept = rung === 'wear' ? rest : rung === 'recolour' ? { ...rest, ...(colors ? { colors } : {}), ...(finishes ? { finishes } : {}) } : { ...wish }
  return { ...kept, rung: rungOfWish(kept) }
}

// ------------------------------------------------------------------------------------------------ untrusted wishes

/** Up to `max` channels' worth of a list, each entry kept or nulled, with trailing nulls dropped; none when all are. */
function channels<T>(raw: unknown, max: number, keep: (v: unknown) => T | null): (T | null)[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.slice(0, max).map(keep)
  while (out.length && out.at(-1) === null) out.pop()
  return out.length ? out : undefined
}
const hexOf = (v: unknown) => (typeof v === 'string' && HEX.test(v.toLowerCase()) ? v.toLowerCase() : null)
const finishOf = (v: unknown) => ((FINISHES as readonly unknown[]).includes(v) ? (v as Finish) : null)

/** A built-in print as a reader names it (its id) or as a reading keeps it, on a channel the item has. */
function readPrint(raw: unknown, channelCount: number): WishPrint | undefined {
  const p = typeof raw === 'string' ? { id: raw } : raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined
  if (!p || !isPrintId(p.id) || !channelCount) return undefined
  const print: WishPrint = { id: p.id }
  const ink = hexOf(p.ink)
  if (ink) print.ink = ink
  if (typeof p.scale === 'number' && Number.isFinite(p.scale)) print.scale = Math.round(Math.min(PRINT_SCALE.max, Math.max(PRINT_SCALE.min, p.scale)) * 10) / 10
  if (Number.isInteger(p.channel) && (p.channel as number) > 0 && (p.channel as number) < channelCount) print.channel = p.channel as number
  return print
}

/** Cuts as a reader lists them ({knob, value} pairs) or as a reading keeps them (by knob), each held to 0 to 1. */
function readKnobs(raw: unknown, allowed: readonly Knob[]): Partial<Record<Knob, number>> | undefined {
  const pairs = Array.isArray(raw) ? raw.map((k) => [(k as { knob?: unknown })?.knob, (k as { value?: unknown })?.value]) : raw && typeof raw === 'object' ? Object.entries(raw) : []
  const out: Partial<Record<Knob, number>> = {}
  for (const [knob, value] of pairs) {
    if (!allowed.includes(knob as Knob) || typeof value !== 'number' || !Number.isFinite(value)) continue
    const v = Math.min(1, Math.max(0, value))
    // as made is no cut at all
    if (v < 1) out[knob as Knob] = Math.round(v * 100) / 100
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Wishes rebuilt from an AI reader's answer or a reading sent back from the Forge: slots and items from the library
 * (or a community item's id), an item worn in a slot it can't go in moved to one it can, colours and finishes checked
 * per channel, prints and cuts only where the item takes them, and one wish a slot. A full-body wish and an upper or
 * lower one can't both be worn, so the first one said stays.
 */
export function readWear(raw: unknown): WearWish[] {
  if (!Array.isArray(raw)) return []
  const out: WearWish[] = []
  for (const w of raw.slice(0, 16)) {
    if (!w || typeof w !== 'object') continue
    const v = w as Record<string, unknown>
    const said = typeof v.item === 'string' ? v.item : ''
    const bare = v.bare === true || said === 'none'
    const entry = bare ? undefined : libraryItem(said)
    const item = entry ? entry.id : !bare && UUID.test(said) ? said : undefined
    let slot = LOOK_SLOTS.find((s) => s === v.slot)
    if (entry && (!slot || !slotsFor(entry.slot).includes(slot))) slot = slotsFor(entry.slot)[0]
    if (!slot) continue
    // a second thing held goes in the other hand
    if (slot === 'hand_r' && out.some((o) => o.slot === 'hand_r') && (!entry || slotsFor(entry.slot).includes('hand_l'))) slot = 'hand_l'
    if (out.some((o) => o.slot === slot) || clashes(out, slot)) continue
    const phrased = typeof v.phrase === 'string' ? v.phrase.replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase() : ''
    if (bare) {
      out.push({ slot, phrase: phrased || barePhrase(slot), bare: true, rung: 'wear' })
      continue
    }
    const phrase = phrased || entry?.name.toLowerCase() || ''
    if (!phrase) continue
    const max = entry?.channels.length || 4
    const colors = channels(v.colors, max, hexOf)
    const finishes = channels(v.finishes, max, finishOf)
    const print = readPrint(v.print, entry ? entry.channels.length : 4)
    const knobs = readKnobs(v.knobs, entry ? entry.knobs : KNOBS)
    const wish: Omit<WearWish, 'rung'> = { slot, phrase, ...(item ? { item } : {}), ...(colors ? { colors } : {}), ...(finishes ? { finishes } : {}), ...(print ? { print } : {}), ...(knobs ? { knobs } : {}) }
    // generating is the one rung a reader may pick over an item that's close; every other rung is what the wish holds
    out.push({ ...wish, rung: v.rung === 'generate' ? 'generate' : rungOfWish(wish) })
  }
  return out
}

/** A full-body item covers the upper and lower slots, so it can't share a reading with a wish for either. */
function clashes(wishes: readonly WearWish[], slot: LookSlot): boolean {
  const worn = (s: LookSlot) => wishes.some((w) => w.slot === s && !w.bare)
  if (slot === 'full') return worn('upper') || worn('lower')
  if (slot === 'upper' || slot === 'lower') return worn('full')
  return false
}

/** The wishes in an AI reader's own words, for showing it its last reading. */
export const wearAnswer = (wishes: readonly WearWish[]) =>
  wishes.map((w) => ({
    slot: w.slot,
    phrase: w.phrase,
    item: w.bare ? 'none' : w.item && libraryItem(w.item) ? w.item : '',
    rung: w.rung,
    colors: (w.colors ?? []).map((c) => c ?? ''),
    finishes: (w.finishes ?? []).map((f) => f ?? ''),
    print: w.print?.id ?? '',
    knobs: Object.entries(w.knobs ?? {}).map(([knob, value]) => ({ knob, value })),
  }))

// ------------------------------------------------------------------------------------------------ the offline reader

/**
 * Words for a kind of hero more than a thing it wears. They dress the hero only where nothing the prompt names
 * outright goes, so a samurai in a red hoodie keeps the hoodie and still gets the katana.
 */
const ARCHETYPES = new Set([
  'samurai', 'ronin', 'shogun', 'ninja', 'shinobi', 'geisha', 'monk', 'shaolin', 'wizard', 'sorcerer', 'witch', 'magician', 'fairy', 'gandalf',
  'knight', 'paladin', 'crusader', 'viking', 'barbarian', 'spartan', 'guardian', 'centurion', 'gladiator', 'cowboy', 'sheriff', 'rancher',
  'gunslinger', 'detective', 'noir', 'gentleman', 'archer', 'ranger', 'robin hood', 'angel', 'saint', 'holy', 'scholar', 'nerd', 'pirate',
  'cyborg', 'cyberpunk', 'astronaut', 'rocketeer', 'soldier', 'hunter', 'sniper', 'king', 'queen', 'monarch', 'ceo', 'churchill', 'lincoln',
  'thor', 'reaper', 'grim reaper', 'mob boss', 'peaky blinders', 'indiana jones', 'superhero', 'rock star', 'rocker', 'musician', 'singer',
  'rapper', 'mc', 'pop star', 'idol', 'punk', 'succubus', 'judo', 'taekwondo', 'kendo', 'swordsman', 'mage', 'jedi',
])

/** Tags too common to stand for an item on their own, or about something else in a hero's description. */
const STOP = new Set(['short', 'long', 'crop', 'curly', 'swept', 'slick', 'volume', 'spikes', 'spiky', 'fringe', 'bob', 'bun', 'death', 'smoking', 'stealth', 'indian', 'band', 'bag', 'bandages', 'mohican', 'tache', 'specs'])

/** Everyday words for an item the library has a better name for: armour is plate armour, a jacket a bomber. */
const PLAIN: [string, string][] = [
  ['armour', 'knight_armour'], ['armor', 'knight_armour'], ['mech suit', 'knight_armour'], ['power armour', 'knight_armour'], ['power armor', 'knight_armour'],
  ['space suit', 'jumpsuit'], ['spacesuit', 'jumpsuit'], ['overalls', 'jumpsuit'], ['dungarees', 'jumpsuit'], ['leotard', 'bodysuit'], ['wetsuit', 'bodysuit'],
  ['jacket', 'bomber'], ['coat', 'long_coat'], ['parka', 'long_coat'], ['raincoat', 'long_coat'], ['blouse', 'shirt'], ['cardigan', 'sweater'],
  ['hat', 'fedora'], ['shoes', 'sneakers'], ['slippers', 'sandals'], ['mask', 'ninja_mask'], ['bow tie', 'frock_coat'], ['bowtie', 'frock_coat'],
]

/** Garments the library doesn't have yet, and where each is worn: the reading offers to generate them. */
const MISSING: [string, LookSlot][] = [
  ['poncho', 'upper'], ['tunic', 'upper'], ['apron', 'upper'], ['corset', 'upper'], ['waistcoat', 'upper'], ['toga', 'full'], ['sari', 'full'],
  ['saree', 'full'], ['uniform', 'full'], ['tutu', 'lower'], ['sarong', 'lower'], ['lederhosen', 'lower'], ['beret', 'head'], ['turban', 'head'],
  ['bowler hat', 'head'], ['sombrero', 'head'], ['headdress', 'head'], ['high heels', 'feet'], ['heels', 'feet'], ['clogs', 'feet'],
  ['shawl', 'back'],
]

/** A material named before an item, as the finish of its first channel: "a black leather cape". */
const MATERIALS: Record<string, Finish> = { leather: 'leather', silk: 'silk', silken: 'silk', satin: 'silk', denim: 'denim', knit: 'knit', knitted: 'knit', wool: 'knit', woolly: 'knit', cotton: 'cotton', linen: 'cotton', metal: 'metal', steel: 'metal', iron: 'metal', chrome: 'metal', glowing: 'glow', neon: 'glow' }

interface Term {
  words: string
  re: RegExp
  /** The items those words answer; none for a garment the library lacks. */
  items: LibraryEntry[]
  slot?: LookSlot
  archetype: boolean
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// a word's edges: letters, digits and hyphens belong to the word, so "shirt" isn't found inside "t-shirt". Only what's
// held is read in the plural ("twin daggers"): "masks" and "shields" are as often what a skill does
const termRe = (words: string, plural: boolean) => new RegExp(`(?<![\\p{L}\\p{N}-])${escape(words)}${plural ? '(?:e?s)?' : ''}(?![\\p{L}\\p{N}-])`, 'gu')
const held = (entry: LibraryEntry) => entry.slot === 'hand' || entry.slot === 'offhand'

let terms: Term[] | undefined
/** Every phrase the offline reader knows, longest first, so "straw hat" is found before "hat". */
function allTerms(): Term[] {
  if (terms) return terms
  const byWords = new Map<string, Term>()
  const add = (words: string, item: LibraryEntry | undefined, slot?: LookSlot) => {
    const term = byWords.get(words) ?? { words, re: termRe(words, !item || held(item)), items: [], ...(slot ? { slot } : {}), archetype: ARCHETYPES.has(words) }
    if (item && !term.items.includes(item)) term.items.push(item)
    if (item && held(item)) term.re = termRe(words, true)
    byWords.set(words, term)
  }
  for (const entry of LIBRARY) for (const tag of entry.tags) if (!STOP.has(tag)) add(tag.toLowerCase(), entry)
  for (const [words, id] of PLAIN) if (!byWords.has(words)) add(words, libraryItem(id))
  for (const [words, slot] of MISSING) if (!byWords.has(words)) add(words, undefined, slot)
  return (terms = [...byWords.values()].sort((a, b) => b.words.length - a.words.length))
}

interface Hit {
  term: Term
  at: number
  end: number
  plural: boolean
}

/** The phrases a text names, each where it stands, a longer phrase winning over the shorter ones inside it. */
function hitsIn(text: string): Hit[] {
  const out: Hit[] = []
  for (const term of allTerms()) {
    for (const m of text.matchAll(term.re)) {
      const at = m.index
      const end = at + m[0].length
      if (out.some((h) => at < h.end && end > h.at)) continue
      out.push({ term, at, end, plural: m[0].length > term.words.length })
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

// where the words describing an item stop: "with", "in", "and a", or a part of the body ("green eyes and a cape")
const BREAK = /\b(?:with|wearing|in|holding|wields?|carr(?:y|ies)|has|and (?:a|an|the|his|her|their)|eyes|hair|skin|beard|mane|brows?)\b/g

/** The words just before a phrase that describe it: at most five, back to a clause break, a break word or the phrase before. */
function modifiersOf(text: string, hit: Hit, hits: readonly Hit[]): string {
  const from = Math.max(0, hit.at - 48, ...hits.filter((h) => h.end <= hit.at).map((h) => h.end))
  const before = text.slice(from, hit.at)
  const clause = before.slice(before.search(/[,.;:!?()](?=[^,.;:!?()]*$)/) + 1)
  const cut = [...clause.matchAll(BREAK)].at(-1)
  return (cut ? clause.slice(cut.index + cut[0].length) : clause).split(/\s+/).slice(-5).join(' ')
}

/** What the words before an item ask of it: its colours in the order said, a material, a print, a shorter cut. */
function described(entry: LibraryEntry | undefined, words: string): Omit<WearWish, 'slot' | 'phrase' | 'item' | 'rung'> & { said: string } {
  const list = words.split(/[^\p{L}-]+/u).filter(Boolean)
  const colors = list.map((w) => COLOUR_WORDS[w]).filter(Boolean)
  const material = list.map((w) => MATERIALS[w]).find(Boolean)
  const print = PRINTS.find((p) => PRINT_WORDS[p].some((w) => new RegExp(`(?<![\\p{L}-])${escape(w)}(?![\\p{L}-])`, 'u').test(words)))
  const short = /(?<![\p{L}-])(?:short|cropped|knee-length)(?![\p{L}-])/u.test(words)
  const cut = short ? (['length', 'hem', 'leg'] as const).find((k) => !entry || entry.knobs.includes(k)) : undefined
  const max = entry?.channels.length || 4
  // only the words that describe it go in the phrase: "a red and gold" is "red and gold"
  const kept = list.filter((w) => COLOUR_WORDS[w] || MATERIALS[w] || w === 'and' || /^(?:short|cropped)$/.test(w) || PRINTS.some((p) => PRINT_WORDS[p].some((x) => x.split(' ').includes(w))))
  while (kept[0] === 'and') kept.shift()
  while (kept.at(-1) === 'and') kept.pop()
  return {
    said: kept.join(' '),
    ...(colors.length ? { colors: colors.slice(0, max) } : {}),
    ...(material ? { finishes: [material] } : {}),
    ...(print && (!entry || entry.channels.length) ? { print: { id: print } } : {}),
    ...(cut ? { knobs: { [cut]: 0.5 } } : {}),
  }
}

/** Nothing worn in a slot, on purpose. */
const BARE: [RegExp, LookSlot, string][] = [
  [/\b(?:bald|hairless)\b/, 'hair', 'bald'],
  [/\b(?:clean[- ]shaven|beardless)\b/, 'beard', 'clean-shaven'],
  [/\b(?:shirtless|topless|bare[- ]chested)\b/, 'upper', 'shirtless'],
  [/\b(?:barefoot|bare[- ]footed)\b/, 'feet', 'barefoot'],
]

/** A cut and a colour can sit between a style and its hair: "long white hair". */
const HAIR_STYLE: [RegExp, string][] = [
  [/\blong\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_long'],
  [/\bshort\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_short'],
  [/\bcurly\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_curly'],
  [/\bspiky\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_spiky'],
  [/\b(?:messy|shaggy)\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_unkempt'],
  [/\bslicked\s+(?:[\p{L}-]+\s+)?hair\b/u, 'hair_slicked'],
]

/**
 * The wardrobe a prompt names, from the library's tags: one item a slot, longer phrases first, the colours, material,
 * print and cut said just before each item, both hands for a pair ("twin daggers"), and garments the library lacks as
 * wishes to generate. What the prompt names outright comes first; a kind of hero ("a samurai") fills what's left.
 * Quoted text is a skill's name, so it never dresses anyone.
 */
export function wearFromPrompt(prompt: string): WearWish[] {
  const text = prompt.toLowerCase().replace(/["“”][^"“”]*["“”]/g, ' ')
  const hits = hitsIn(text)
  const out: WearWish[] = []
  const has = (slot: LookSlot) => out.some((w) => w.slot === slot)
  const wears = (id: string) => out.some((w) => w.item === id)
  const add = (wish: Omit<WearWish, 'rung'>) => out.push({ ...wish, rung: rungOfWish(wish) })

  const place = (hit: Hit, archetype: boolean) => {
    const words = modifiersOf(text, hit, hits)
    // a full-body item first, so "karate gi" is the whole uniform before it's a top
    const items = [...hit.term.items].sort((a, b) => Number(b.slot === 'full') - Number(a.slot === 'full'))
    if (!items.length && hit.term.slot) {
      const { said, ...look } = described(undefined, words)
      if (!has(hit.term.slot) && !clashes(out, hit.term.slot)) add({ slot: hit.term.slot, phrase: [said, hit.term.words].filter(Boolean).join(' '), ...look })
      return
    }
    for (const entry of items) {
      if (archetype && wears(entry.id)) continue
      const slots = slotsFor(entry.slot)
      const { said, ...look } = described(entry, words)
      const phrase = archetype ? entry.name.toLowerCase() : [said, text.slice(hit.at, hit.end)].filter(Boolean).join(' ')
      if (entry.slot === 'hand' || entry.slot === 'offhand') {
        // a pair fills both hands; a kind of hero only ever fills the hand it starts in
        const pair = entry.slot === 'hand' && !archetype && (hit.plural || /\b(?:dual|twin|two|pair of)\s+$/.test(text.slice(0, hit.at)))
        const free = slots.filter((s) => !has(s))
        for (const slot of pair ? free : archetype ? free.filter((s) => s === slots[0]) : free.slice(0, 1)) add({ slot, phrase, item: entry.id, ...look })
        continue
      }
      const slot = slots[0]
      if (has(slot) || clashes(out, slot)) continue
      add({ slot, phrase, item: entry.id, ...look })
    }
  }

  for (const hit of hits) if (!hit.term.archetype) place(hit, false)
  for (const [re, id] of HAIR_STYLE) if (!has('hair') && re.test(text)) add({ slot: 'hair', phrase: text.match(re)![0], item: id })
  for (const [re, slot, phrase] of BARE) if (!has(slot) && re.test(text)) out.push({ slot, phrase, bare: true, rung: 'wear' })
  for (const hit of hits) if (hit.term.archetype) place(hit, true)
  // "short sleeves" cuts whatever top has sleeves to cut
  if (/\bshort[- ]sleeve(?:s|d)?\b/.test(text)) {
    const top = out.find((w) => (w.slot === 'upper' || w.slot === 'full') && w.item && libraryItem(w.item)?.knobs.includes('sleeve'))
    if (top) Object.assign(top, { knobs: { ...top.knobs, sleeve: 0.5 }, rung: 'restyle' as const })
  }
  return out.sort((a, b) => LOOK_SLOTS.indexOf(a.slot) - LOOK_SLOTS.indexOf(b.slot))
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

// ------------------------------------------------------------------------------------------------ corrections

const DROP = /\b(?:no|without|remove|lose|drop|ditch|take off)\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|their\s+|its\s+)?([\p{L}-]+(?:\s[\p{L}-]+)?)/gu

/** What a dropped word leaves in its slot: nothing for a hat, plain clothes where armour or a jacket was. */
const DROPPED: [RegExp, LookSlot, string | undefined][] = [
  [/^(?:hats?|helmets?|helm|caps?|hoods?|crowns?|headwear|headgear)$/, 'head', undefined],
  [/^(?:capes?|cloaks?|wings|backpack)$/, 'back', undefined],
  [/^(?:beard|moustache|mustache|stubble)$/, 'beard', undefined],
  [/^hair$/, 'hair', undefined],
  [/^(?:mask|glasses|shades|eyepatch|visor|goggles)$/, 'face', undefined],
  [/^(?:shoes|boots|sandals)$/, 'feet', undefined],
  [/^(?:shirt|top)$/, 'upper', undefined],
  [/^(?:armou?r|plate|breastplate|jacket|coat|hoodie|robes?)$/, 'upper', 'longsleeve'],
  [/^(?:trousers|pants|jeans|skirt)$/, 'lower', undefined],
]

/**
 * The wardrobe after a correction: "no hat" takes the hat off (and keeps the head bare, whatever the role would put on
 * it), and what the note names replaces the wish in its slot, a full-body item replacing the top and trousers.
 */
export function correctWear(wishes: readonly WearWish[], note: string): WearWish[] {
  const lower = note.toLowerCase()
  let out = [...wishes]
  for (const m of lower.matchAll(DROP)) {
    const words = m[1].split(' ')
    const named = (w: WearWish) => words.some((d) => d.length > 2 && (w.phrase.split(' ').includes(d) || (w.item && libraryItem(w.item)?.tags.some((t) => t.split(' ').includes(d)))))
    out = out.filter((w) => !named(w))
    const left = DROPPED.find(([re]) => re.test(words[0]))
    if (!left) continue
    const [, slot, plain] = left
    out = out.filter((w) => w.slot !== slot)
    out.push(plain ? { slot, phrase: `no ${words[0]}`, item: plain, rung: 'wear' } : { slot, phrase: `no ${words[0]}`, bare: true, rung: 'wear' })
  }
  for (const wish of wearFromPrompt(lower.replace(DROP, ' '))) {
    const covers = (s: LookSlot) => s === wish.slot || (wish.slot === 'full' && (s === 'upper' || s === 'lower')) || ((wish.slot === 'upper' || wish.slot === 'lower') && s === 'full')
    out = [...out.filter((w) => !covers(w.slot)), wish]
  }
  return out.sort((a, b) => LOOK_SLOTS.indexOf(a.slot) - LOOK_SLOTS.indexOf(b.slot))
}

