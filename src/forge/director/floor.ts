import { OFFENDING, keywordFlags } from '../keywords.js'
import { route, type Registry } from '../providers/router.js'
import type { ModerationProvider } from '../providers/types.js'
import type { ContentFlags, SpecSheet } from '../types.js'

/**
 * The legal floor (R25, KTD10). Everything legal is allowed, including real people, parody and memes.
 * It removes only sexual depictions of real people, anything involving minors, and real people shown endorsing
 * the game. It does not trust the director's flags alone: a separate moderation call and a keyword check both vote.
 */

const REASONS = {
  sexual: 'sexual depictions of real people are not allowed',
  minors: 'content involving minors is not allowed',
  endorsement: 'showing a real person endorsing the game is not allowed',
}

export function specText(spec: SpecSheet): string {
  return [spec.heroName, spec.description, spec.silhouette, ...spec.signatureElements, ...spec.skills.map((s) => `${s.name} ${s.theme}`), spec.passiveElement ?? ''].join('\n')
}

async function moderate(registry: Registry, request: { text?: string; imageUrl?: string }): Promise<ContentFlags> {
  const routed = await route<ModerationProvider, ContentFlags>(registry, 'moderation', (p) => p.classify(request))
  return routed.ok === true ? routed.value : keywordFlags(request.text ?? '')
}

const anyFlag = (...flags: ContentFlags[]): ContentFlags => ({
  realPerson: flags.some((f) => f.realPerson),
  sexual: flags.some((f) => f.sexual),
  minors: flags.some((f) => f.minors),
  endorsement: flags.some((f) => f.endorsement),
})

function strip(text: string, pattern: RegExp): string {
  // drop the sentence or phrase that carries the offending words
  return text
    .split(/(?<=[.!?])\s+|,\s*/)
    .filter((part) => !pattern.test(part))
    .join(', ')
}

export interface FloorResult {
  spec: SpecSheet
  /** True when something flagged could not be removed; the stage must not proceed. */
  blocked: boolean
}

export async function applyFloor(spec: SpecSheet, registry: Registry, imageUrls: string[] = []): Promise<FloorResult> {
  const text = specText(spec)
  const moderated = await Promise.all([moderate(registry, { text }), ...imageUrls.map((imageUrl) => moderate(registry, { imageUrl }))])
  const votes = [spec.flags, keywordFlags(text, spec.flags.realPerson), ...moderated]
  const flags = anyFlag(...votes)
  const breaches = (['sexual', 'minors', 'endorsement'] as const).filter((k) => flags[k] && (k === 'minors' || flags.realPerson))
  if (!breaches.length) return { spec: { ...spec, flags }, blocked: false }

  let next: SpecSheet = { ...spec, removed: [...spec.removed] }
  for (const k of breaches) {
    const pattern = OFFENDING[k]
    const removedElements = next.signatureElements.filter((e) => pattern.test(e))
    next = {
      ...next,
      description: strip(next.description, pattern),
      silhouette: strip(next.silhouette, pattern),
      signatureElements: next.signatureElements.filter((e) => !pattern.test(e)),
      skills: next.skills.map((s) => (pattern.test(`${s.name} ${s.theme}`) ? { ...s, name: 'Signature Move', theme: 'signature move' } : s)),
      passiveElement: next.passiveElement && pattern.test(next.passiveElement) ? undefined : next.passiveElement,
    }
    next.removed.push({ element: removedElements.join(', ') || k, reason: REASONS[k] })
  }
  // whatever the keyword pass could not find (a subtle request a model flagged) blocks the stage outright
  const after = keywordFlags(specText(next), flags.realPerson)
  const residual = breaches.some((k) => after[k] || !OFFENDING[k].test(text))
  return { spec: { ...next, flags: { ...flags, sexual: false, minors: false, endorsement: false } }, blocked: residual }
}

/** The R25 breach an image carries, judged by the moderation adapter alone (KTD10), or undefined when clean. */
export async function imageBreach(registry: Registry, imageUrl: string, realPerson: boolean): Promise<string | undefined> {
  // an image nobody could screen never passes: there is no keyword fallback for pixels
  const routed = await route<ModerationProvider, ContentFlags>(registry, 'moderation', (p) => p.classify({ imageUrl }))
  if (routed.ok !== true) return 'the image could not be screened, so it was not kept'
  const flags = routed.value
  const real = realPerson || flags.realPerson
  if (flags.minors) return REASONS.minors
  if (real && flags.sexual) return REASONS.sexual
  if (real && flags.endorsement) return REASONS.endorsement
  return undefined
}
