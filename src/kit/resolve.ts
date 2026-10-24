import { SLOT_KINDS, type GearSlot, type PieceKind } from '../charter/look.js'
import { heroPart } from '../forge/prompt.js'
import { slotFor, type PieceEntry } from './pieces.js'

/** Something the prompt asked for that no piece in the repository matches: a candidate to generate. */
export interface GearGap {
  /** The words as the prompt put them, such as "straw hat". */
  phrase: string
  kind: PieceKind
}

export interface GearMatch {
  gear: Partial<Record<GearSlot, PieceEntry>>
  gaps: GearGap[]
}

// words that name gear, by kind; a phrase built on one of these that no piece matched is a gap
const NOUNS: [PieceKind, RegExp][] = [
  ['head', /\b(hat|cap|helmet|helm|crown|tiara|beret|bandana|turban|headdress|headband|circlet)s?\b/g],
  ['face', /\b(glasses|goggles|monocle|visor|sunglasses|eyepatch|mask)\b/g],
  ['hand', /\b(sword|katana|blade|axe|spear|lance|staff|wand|gun|pistol|rifle|dagger|knife|hammer|mace|scythe|whip|trident|scepter|sceptre|guitar|microphone|lantern|torch|rapier|sabre|saber|cutlass|sickle|flail|halberd)s?\b/g],
  ['offhand', /\b(shield|bow|buckler|crossbow)s?\b/g],
  ['back', /\b(wings|jetpack|backpack|quiver|sheath)\b/g],
]
// words that never describe the piece itself
const FILLER = new Set(['a', 'an', 'the', 'with', 'and', 'his', 'her', 'their', 'its', 'some', 'of', 'in', 'on', 'wearing', 'holding', 'wields', 'wielding', 'carrying', 'who', 'that', 'plus', 'two', 'twin', 'dual', 'pair', 'big', 'giant', 'huge', 'tiny', 'small', 'very', 'or'])

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Put the repository's pieces on what a prompt describes. Tags match as whole words, the longest first, so "top hat"
 * beats "hat" and "viking" beats "king". Each slot takes one piece; a word that names an archetype ("angel") can dress
 * several slots at once, and a plural hand piece ("twin katanas") fills both hands. Gear words nothing matched become
 * gaps: "a samurai with a katana and a straw hat" wears the katana and asks for a straw hat.
 */
export function resolveGear(prompt: string, catalog: readonly PieceEntry[]): GearMatch {
  const text = heroPart(prompt).toLowerCase()
  const hits: { entry: PieceEntry; start: number; end: number; plural: boolean }[] = []
  for (const entry of catalog) {
    for (const tag of entry.tags) {
      for (const m of text.matchAll(new RegExp(`\\b${escape(tag.toLowerCase())}(s?)\\b`, 'g'))) hits.push({ entry, start: m.index, end: m.index + m[0].length, plural: m[1] === 's' })
    }
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const gear: GearMatch['gear'] = {}
  const claimed: [number, number][] = []
  const overlaps = (s: number, e: number) => claimed.some(([cs, ce]) => s < ce && e > cs && !(s === cs && e === ce))
  const worn = new Set<string>()
  for (const hit of hits) {
    if (overlaps(hit.start, hit.end)) continue
    if (worn.has(hit.entry.id)) {
      // another word for a piece already worn ("a samurai with a katana") is covered, not a gap
      claimed.push([hit.start, hit.end])
      continue
    }
    const slots: GearSlot[] = hit.entry.kind === 'hand' ? ['hand_r', 'hand_l'] : [slotFor(hit.entry.kind)]
    const slot = slots.find((s) => !gear[s] && SLOT_KINDS[s].includes(hit.entry.kind))
    if (!slot) continue
    gear[slot] = hit.entry
    worn.add(hit.entry.id)
    claimed.push([hit.start, hit.end])
    if (hit.plural && slot === 'hand_r' && !gear.hand_l) gear.hand_l = hit.entry
  }
  const gaps: GearGap[] = []
  for (const [kind, re] of NOUNS) {
    for (const m of text.matchAll(re)) {
      if (claimed.some(([cs, ce]) => m.index < ce && m.index + m[0].length > cs)) continue
      // up to two describing words before the noun: "straw hat", "flaming red sword"
      const before = text.slice(0, m.index).split(/[^a-z-]+/).filter(Boolean).slice(-2)
      const words: string[] = []
      for (let i = before.length - 1; i >= 0 && !FILLER.has(before[i]); i--) words.unshift(before[i])
      const phrase = [...words, m[1]].join(' ')
      const slot = kind === 'hand' ? (['hand_r', 'hand_l'] as const).find((s) => !gear[s]) : slotFor(kind)
      if (!slot || gear[slot] || gaps.some((g) => g.phrase === phrase)) continue
      gaps.push({ phrase, kind })
    }
  }
  return { gear, gaps }
}
