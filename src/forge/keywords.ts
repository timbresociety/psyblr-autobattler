import type { ContentFlags } from './types'

/** The keyword half of the content floor (R25, KTD10); the moderation adapter is the other half. */
export const OFFENDING: Record<'sexual' | 'minors' | 'endorsement', RegExp> = {
  sexual: /\b(nude|naked|sex|sexual|porn|nsfw|explicit|topless|lingerie|xxx|onlyfans)\b/i,
  minors: /\b(child|children|kid|kids|minor|minors|underage|teen|teenager|schoolgirl|schoolboy|loli|shota)\b/i,
  endorsement: /\b(endorse|endorses|endorsed|sponsored by|official (?:partner|ambassador)|recommends playing)\b/i,
}

/** Keyword moderation: the offline floor and the keyword backstop of KTD10. */
export function keywordFlags(text: string, realPerson = false): ContentFlags {
  return { realPerson, sexual: OFFENDING.sexual.test(text), minors: OFFENDING.minors.test(text), endorsement: OFFENDING.endorsement.test(text) }
}
