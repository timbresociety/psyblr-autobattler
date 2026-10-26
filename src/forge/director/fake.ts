import { inferRole } from '../../charter/build'
import { tokenize } from '../../charter/match'
import type { SizeClass } from '../../charter/sizes'
import type { RoleId } from '../../charter/types'
import { keywordFlags } from '../keywords'
import type { Suggestion, Tone } from '../types'
import { findCulture, type CultureEntry } from './culture'
import type { DirectorInput, DirectorOutput, DraftSkill } from './schema'

/**
 * The offline director brain (KTD4): reads tone, fills blindspots from the culture table, and drafts a spec
 * once the intent is clear. Deterministic, so it doubles as the test oracle.
 */

const MEME = /\b(meme|memes|circle jerk|stonks|lol|lmao|troll|cursed|shitpost|cringe|copium|ratio|skibidi)\b/i
const HEROIC = /\b(god|gods|alpha|powerful|legendary|epic|ultimate|unstoppable|titan|overlord|chosen)\b/i

export function readTone(text: string, answer?: string): { tone: Tone; confidence: number } {
  if (answer === 'heroic' || answer === 'meme' || answer === 'mixed') return { tone: answer, confidence: 1 }
  const meme = MEME.test(text)
  const heroic = HEROIC.test(text)
  if (meme && heroic) return { tone: 'mixed', confidence: 0.8 }
  if (meme) return { tone: 'meme', confidence: 0.8 }
  if (heroic) return { tone: 'heroic', confidence: 0.8 }
  return { tone: 'unsure', confidence: 0.3 }
}

/** Skill themes the player named: "skills around CUDA, Circle Jerk, Stonks and other memes". */
export function namedThemes(prompt: string): string[] {
  const match = /(?:skills?|abilities|powers?)\s+(?:around|like|based on|about)\s+(.+)/i.exec(prompt)
  if (!match) return []
  return match[1]
    .split(/,|\band\b/i)
    .map((s) => s.replace(/\b(other|relevant|cultural|memes?|etc\.?)\b/gi, '').trim())
    .filter((s) => s.length > 1)
}

function heroNameOf(input: DirectorInput, culture: CultureEntry[]): string {
  if (input.heroName?.trim()) return input.heroName.trim()
  if (culture[0]) return culture[0].names[0].replace(/\b\w/g, (c) => c.toUpperCase())
  const word = /\b([A-Z][a-z]{2,})\b/.exec(input.prompt)
  return word?.[1] ?? 'Unnamed Hero'
}

function sizeOf(text: string): SizeClass {
  if (/\b(giant|colossal|titan|huge|kaiju)\b/i.test(text)) return 'huge'
  if (/\b(god|big|massive|towering|large)\b/i.test(text)) return 'large'
  if (/\b(tiny|chibi|pocket)\b/i.test(text)) return 'tiny'
  if (/\b(small|little|short)\b/i.test(text)) return 'small'
  return 'medium'
}

const RANGED: RoleId[] = ['mage', 'marksman', 'support']

let counter = 0
const suggestion = (kind: Suggestion['kind'], text: string, reason: string): Suggestion => ({ id: `s${++counter}`, kind, text, reason, accepted: true })

export function fakeDirectorBrain(raw: Record<string, unknown>): DirectorOutput {
  counter = 0
  const input = raw as unknown as DirectorInput
  const text = [input.prompt, ...(input.referenceCaptions ?? []), ...(input.chat ?? []).map((c) => c.text)].join(' ')
  const culture = findCulture(text)
  const { tone, confidence } = readTone(text, input.answers?.tone)

  const suggestions: Suggestion[] = []
  for (const entry of culture) {
    for (const element of entry.elements.slice(0, 3)) suggestions.push(suggestion(element.includes('hat') ? 'outfit' : 'prop', element, `${entry.names[0]}'s signature look`))
    suggestions.push(suggestion('catchphrase', entry.catchphrases[0], `${entry.names[0]}'s best-known line`))
    suggestions.push(suggestion('color', entry.colors[0], `reads instantly as ${entry.names[0]}`))
  }
  // fusing two references: carry one's signature element in the other's colors
  if (culture.length >= 2) {
    suggestions.push(suggestion('outfit', `${culture[1].elements[0]} crackling with ${culture[0].colors[0]} ${culture[1].key === 'raiden' ? 'lightning' : 'energy'}`, `fuses ${culture[0].names[0]} with ${culture[1].names[0]}`))
  }
  const named = namedThemes(input.prompt)
  const extraThemes = culture.flatMap((c) => c.skillThemes).filter((t) => !named.some((n) => t.toLowerCase().includes(n.toLowerCase())))
  for (const theme of extraThemes.slice(0, 3)) suggestions.push(suggestion('skill-theme', theme, 'fills a slot you did not name'))

  if (tone === 'unsure') {
    return {
      tone,
      confidence,
      questions: [{ id: 'tone', text: `What kind of ${heroNameOf(input, culture)}?`, options: ['heroic', 'meme', 'mixed'] }],
      suggestions,
    }
  }

  const themes = [...named, ...extraThemes]
  while (themes.length < 6) themes.push(['signature strike', 'quick dash', 'power surge', 'finisher', 'aura', 'stance'][themes.length])
  const heroName = heroNameOf(input, culture)
  const lean = culture[0] ? (tone === 'meme' ? culture[0].memeLean : culture[0].heroicLean) : 'a hero forged from your prompt'
  const slots: DraftSkill['slot'][] = ['active1', 'active2', 'ultimate', 'passive', 'basic', 'movement']
  const skills: DraftSkill[] = slots.map((slot, i) => ({ slot, name: themes[i].replace(/\b\w/g, (c) => c.toUpperCase()), theme: themes[i] }))
  const role: RoleId = inferRole(`${heroName} ${input.prompt}`, Object.fromEntries(skills.map((s) => [s.slot, { name: s.name, flavour: s.theme }])))
  const flags = keywordFlags(text, culture.some((c) => c.realPerson))

  return {
    tone,
    confidence,
    questions: [],
    suggestions,
    spec: {
      heroName,
      roleId: role,
      description: `${heroName} as ${lean}. ${tokenize(input.prompt).length > 3 ? `Built from: ${input.prompt}` : ''}`.trim(),
      sizeClass: sizeOf(text),
      silhouette: culture.map((c) => c.elements[0]).join(' with ') || 'a clean heroic silhouette',
      signatureElements: suggestions.filter((s) => s.kind === 'outfit' || s.kind === 'prop').map((s) => s.text),
      basicStyle: RANGED.includes(role) ? 'ranged' : 'melee',
      skills,
      passiveVisual: 'aura',
      flags,
    },
  }
}
