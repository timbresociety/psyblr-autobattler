import { outfitOf, type HeroLook, type LookSlot, type Worn } from '../../charter/look.js'
import type { PieceEntry } from '../../kit/pieces.js'
import type { Finish, Knob, Rung } from '../../kit/wear/item.js'
import { LIBRARY, slotsFor, type LibraryEntry } from '../../kit/wear/library.js'

/**
 * The wardrobe as the Forge edits it: tabs of slots, an item worn in each, and the rungs that make it the player's own.
 * Wear an item as made, recolour its channels, restyle it with a print and its cuts, or generate a new one. Every
 * change is cosmetic, so none of it touches the balance check.
 */

export const LOOK_SLOT_LABEL: Record<LookSlot, string> = {
  hair: 'Hair',
  beard: 'Beard',
  head: 'Over the head',
  upper: 'Upper body',
  lower: 'Lower body',
  full: 'Full body',
  back: 'Back',
  feet: 'Feet',
  face: 'Face',
  hand_r: 'Right hand',
  hand_l: 'Left hand',
}

export const WARDROBE_TABS = [
  { id: 'hair', label: 'Hair & beard', slots: ['hair', 'beard'] },
  { id: 'head', label: 'Head', slots: ['head'] },
  { id: 'upper', label: 'Upper', slots: ['upper'] },
  { id: 'lower', label: 'Lower', slots: ['lower'] },
  { id: 'full', label: 'Full', slots: ['full'] },
  { id: 'back', label: 'Back', slots: ['back'] },
  { id: 'feet', label: 'Feet', slots: ['feet'] },
  { id: 'gear', label: 'Gear', slots: ['face', 'hand_r', 'hand_l'] },
] as const satisfies readonly { id: string; label: string; slots: readonly LookSlot[] }[]
export type WardrobeTab = (typeof WARDROBE_TABS)[number]['id']

export const KNOB_LABEL: Record<Knob, string> = { sleeve: 'Sleeves', hem: 'Hem', leg: 'Legs', length: 'Length' }
export const FINISH_LABEL: Record<Finish, string> = { cotton: 'Cotton', silk: 'Silk', denim: 'Denim', knit: 'Knit', leather: 'Leather', metal: 'Metal', glow: 'Glow' }

export { RUNGS, type Rung } from '../../kit/wear/item.js'
export const RUNG_LABEL: Record<Rung, string> = { wear: 'Wear', recolour: 'Recolour', restyle: 'Restyle', generate: 'Generate' }

/** A rigid piece hangs on a socket and takes one colour; a surface item has channels, finishes, cuts and prints. */
export const isRigid = (entry: Pick<LibraryEntry, 'url'>): boolean => /\/pieces\//.test(entry.url)

/** How far up the rungs a worn item has come: a print or a cut is a restyle, a colour or a finish a recolour. */
export function rungOf(worn: Worn): Exclude<Rung, 'generate'> {
  if (worn.print || (worn.knobs && Object.keys(worn.knobs).length)) return 'restyle'
  if (worn.colors?.some(Boolean) || worn.finishes?.some(Boolean)) return 'recolour'
  return 'wear'
}

/** What a look wears, slot by slot (a look from before the wardrobe is read into items). */
export const wardrobeOf = (look: HeroLook): Partial<Record<LookSlot, Worn>> => outfitOf(look)

/** The look with a wardrobe of its own: the first change to a look from before the wardrobe writes its items down. */
function withWear(look: HeroLook, wear: Partial<Record<LookSlot, Worn>>): HeroLook {
  const { gear: _gear, ...rest } = look
  return { ...rest, wear }
}

/**
 * Wear `entry` in `slot` as it was made, or nothing there. A full-body item takes the upper and lower ones off, and an
 * upper or lower one takes a full-body item off.
 */
export function wearIn(look: HeroLook, slot: LookSlot, entry: Pick<LibraryEntry, 'id' | 'url'> | undefined): HeroLook {
  const wear = { ...wardrobeOf(look) }
  if (!entry) delete wear[slot]
  else {
    wear[slot] = { id: entry.id, url: entry.url }
    if (slot === 'full') {
      delete wear.upper
      delete wear.lower
    } else if (slot === 'upper' || slot === 'lower') delete wear.full
  }
  return withWear(look, wear)
}

/** Change what's worn in `slot` (nothing happens when the slot is empty). */
export function editWorn(look: HeroLook, slot: LookSlot, change: (worn: Worn) => Worn): HeroLook {
  const wear = wardrobeOf(look)
  const worn = wear[slot]
  return worn ? withWear(look, { ...wear, [slot]: change(worn) }) : look
}

/** One channel's colour or finish, the rest as they were; null puts the item's own back. */
export function setChannel(worn: Worn, channel: number, patch: { color?: string | null; finish?: Finish | null }): Worn {
  const next = { ...worn }
  if ('color' in patch) {
    const colors = [...(worn.colors ?? [])]
    colors[channel] = patch.color ?? null
    next.colors = Array.from(colors, (c) => c ?? null)
  }
  if ('finish' in patch) {
    const finishes = [...(worn.finishes ?? [])]
    finishes[channel] = patch.finish ?? null
    next.finishes = Array.from(finishes, (f) => f ?? null)
  }
  if (next.colors && !next.colors.some(Boolean)) delete next.colors
  if (next.finishes && !next.finishes.some(Boolean)) delete next.finishes
  return next
}

/** The item as it was made: no colours, finishes, cuts or print of the player's. */
export const asMade = (worn: Worn): Worn => ({ id: worn.id, url: worn.url })

/** The items a slot can take, in the library's order, that match a search on their name or tags. */
export function itemsFor(slot: LookSlot, catalog: readonly LibraryEntry[], query = ''): LibraryEntry[] {
  const q = query.trim().toLowerCase()
  return catalog.filter((e) => slotsFor(e.slot).includes(slot) && (!q || e.name.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q))))
}

/** The library with the community's items after it, each once. */
export function wardrobeCatalog(community: readonly LibraryEntry[]): LibraryEntry[] {
  const out = [...LIBRARY]
  const seen = new Set(out.map((e) => e.id))
  for (const e of community) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

/** A generated piece of gear as the wardrobe lists it: worn in the slot of its kind, with one colour when it takes one. */
export const itemOfPiece = (p: PieceEntry): LibraryEntry => ({
  id: p.id,
  name: p.name,
  slot: p.kind,
  tags: p.tags,
  url: p.url,
  thumb: p.thumb,
  source: p.source,
  channels: p.tint ? [{ name: 'primary', color: p.tint, finish: 'cotton' }] : [],
  knobs: [],
})
