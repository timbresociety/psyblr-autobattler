import { BUILD_SLOTS, type Build } from '../charter/build.js'
import { SIZES, type SizeClass } from '../charter/sizes.js'
import { CATALOG, getTemplate, hasTemplate } from '../charter/templates/catalog.js'
import type { BuildSlot, Template } from '../charter/types.js'

/** A template's transformation: the class it takes (none when the hero keeps its own size) and how long it lasts. */
export function transformOf(template: Pick<Template, 'effects'>): { size?: SizeClass; duration: number } | undefined {
  for (const e of template.effects) {
    if (e.kind === 'resize') return { size: e.sizeClass, duration: e.duration }
    if (e.kind === 'form') return { duration: e.duration }
  }
  return undefined
}

/** The slot whose skill transforms the hero, if any (the catalogue keeps transformations to ultimates). */
export function formSlot(build: Pick<Build, 'slots'> | undefined): BuildSlot | undefined {
  return build ? BUILD_SLOTS.find((s) => hasTemplate(build.slots[s].templateId) && transformOf(getTemplate(build.slots[s].templateId))) : undefined
}

/** The size class a hero's transformation reaches, whose body the arena loads for the form; none when it keeps its own. */
export function formSize(build: Pick<Build, 'slots'> | undefined): SizeClass | undefined {
  const slot = formSlot(build)
  return slot ? transformOf(getTemplate(build!.slots[slot].templateId))?.size : undefined
}

/** Every template that transforms the hero, in the catalogue's order: grow, keep or shrink, each with its own numbers. */
export const FORM_TEMPLATES: readonly Template[] = CATALOG.filter((t) => transformOf(t))

/** Words for how a transformation changes size, and the template that changes it that way. The first that fits wins. */
const FORM_WORDS: [RegExp, string][] = [
  [/\b(?:shrinks?|shrinking|shrunk|tiny|ant[- ]?man|miniature|microscopic|pocket[- ]sized)\b/i, 'assassin-shrink-form'],
  [/\b(?:titan|colossal|colossus|giant|gigantic|kaiju|godzilla|skyscraper|mountain[- ]sized)\b/i, 'tank-titan-form'],
  [/\b(?:nine[- ]?tails?|kyuubi|kurama|tailed[- ]beast|avatar|susanoo|spirit (?:body|form)|huge)\b/i, 'fighter-avatar-form'],
  [/\b(?:super saiyan|saiyan|ascend\w*|awaken\w*|aura|golden form|same size|keeps? (?:its|his|her|their) size)\b/i, 'fighter-ascended-form'],
  [/\b(?:grows?|growing|bigger|larger|large|bulks? up|hulks? out|hulk)\b/i, 'fighter-super-form'],
]

/**
 * The transformation a player's words describe by how it changes size: shrinking like Ant-Man, growing colossal like a
 * titan, growing huge into an avatar like Nine-Tails, keeping its size like a Super Saiyan, or growing large. Undefined
 * when the words don't say, so the reader can ask.
 */
export const formFromWords = (words: string): string | undefined => FORM_WORDS.find(([re]) => re.test(words))?.[1]

/** How a transformation changes a hero of this size, in a few words: "grows colossal", "keeps its size", "shrinks to tiny". */
export function formChange(template: Pick<Template, 'effects'>, own: SizeClass): string {
  const size = transformOf(template)?.size
  if (!size) return 'keeps its size'
  const [to, from] = [SIZES[size].scale, SIZES[own].scale]
  const label = SIZES[size].label.toLowerCase()
  return to > from ? `grows ${label}` : to < from ? `shrinks to ${label}` : `stays ${label}`
}
