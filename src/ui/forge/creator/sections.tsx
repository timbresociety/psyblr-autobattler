import type { StageFraming } from '../../common/HeroStage'

/**
 * The creator's sections, down its rail the way a football game's player creator lists them: the hero and the chat,
 * then how it looks part by part, then how it plays. Each frames the hero its own way on the stage.
 */

export const SECTION_IDS = ['hero', 'ask', 'face', 'skin', 'hair', 'body', 'outfit', 'gear', 'kit', 'stats'] as const
export type SectionId = (typeof SECTION_IDS)[number]

export interface Section {
  id: SectionId
  label: string
  /** What the section is for, under its title. */
  blurb: string
  framing: StageFraming
  group: 'hero' | 'look' | 'play'
}

export const SECTIONS: readonly Section[] = [
  { id: 'hero', label: 'Hero', blurb: 'Name, role and size. Size is the one part of the body the game reads.', framing: 'body', group: 'hero' },
  { id: 'ask', label: 'Ask', blurb: 'Tell the Forge what to change, in your own words.', framing: 'body', group: 'hero' },
  { id: 'face', label: 'Face', blurb: 'Sculpt the head and face region by region, on the photo or on its own.', framing: 'face', group: 'look' },
  { id: 'skin', label: 'Skin', blurb: 'Skin tone, eyes and brows.', framing: 'face', group: 'look' },
  { id: 'hair', label: 'Hair', blurb: 'Hair and facial hair, in any colour.', framing: 'bust', group: 'look' },
  { id: 'body', label: 'Body', blurb: 'Build and age. Cosmetic: the size picker sets how big the hero is.', framing: 'body', group: 'look' },
  { id: 'outfit', label: 'Outfit', blurb: 'What the hero wears, slot by slot. Wear, recolour and restyle free.', framing: 'body', group: 'look' },
  { id: 'gear', label: 'Gear', blurb: 'Glasses and masks, and what each hand holds.', framing: 'bust', group: 'look' },
  { id: 'kit', label: 'Kit', blurb: 'Every button in one place: its skill, how it moves, how its effect looks. Play any of them on the dummy.', framing: 'body', group: 'play' },
  { id: 'stats', label: 'Stats', blurb: 'Where the points go. The engine keeps every fight fair.', framing: 'body', group: 'play' },
]

export const sectionOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)!

const PATHS: Record<SectionId, string> = {
  hero: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z',
  ask: 'M4 5h16v10H9l-5 4zM8 9h8M8 12h5',
  face: 'M12 3c-4 0-6.5 3-6.5 7.5 0 4.8 3 9.5 6.5 9.5s6.5-4.7 6.5-9.5C18.5 6 16 3 12 3zM9.3 10.5h.01M14.7 10.5h.01M10 15.5c1.2.8 2.8.8 4 0',
  skin: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11zM9.5 14.5a2.5 2.5 0 0 0 2.5 2.5',
  hair: 'M5 13c0-5.5 3-9 7-9s7 3.5 7 9M5 13c1.5-2 3.5-3.6 6-4.4M19 13c-1.6-1.6-3.6-3-6.4-3.6M7.5 13v5M16.5 13v5',
  body: 'M12 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 9l6 1.2L18 9M12 10.2V15M9 21l3-6 3 6',
  outfit: 'M9 4l3 2 3-2 5 3-2 4-2-1v10H8V10l-2 1-2-4z',
  gear: 'M14.5 4l5.5 5.5-9 9H5.5V13zM12 6.5l5.5 5.5M4 20l2.5-2.5',
  kit: 'M13 2L5 13.5h6L10 22l8-11.5h-6z',
  stats: 'M5 20V12M10 20V5M15 20v-9M20 20V8',
}

export function SectionIcon({ id }: { id: SectionId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[id]} />
    </svg>
  )
}
