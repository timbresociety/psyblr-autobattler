import { preset, type Archetype, type ArchetypeId } from '../body/physique.js'

/** The physique bench's key clips (GAME.md §9.7) by the library's names; undefined where the library has none yet. */
export const BENCH_CLIPS: Readonly<Record<string, string | undefined>> = {
  combo: 'punch_combo',
  heavy: 'two_hand_sword_combo',
  block: 'standing_block_idle',
  cast: 'magic_standing_2h_cast_spell_01',
  jog: 'jog',
  run: 'run',
  sprint: 'sprint_forward',
  slide: 'running_slide_pose',
  mantle: undefined,
  landRoll: 'falling_to_roll',
  hitReact: 'hit_to_body',
  getUp: 'getting_up',
  jump: 'jump',
}

/** The clip audit's bodies: tiny, medium and huge, each gender, on the presets nearest them. */
export interface AuditBodySpec extends Pick<Archetype, 'gender' | 'body' | 'dials'> {
  label: string
  id: ArchetypeId
}

const dialsOf = (id: ArchetypeId) => preset(id).dials

export const AUDIT_BODIES: readonly AuditBodySpec[] = [
  { label: 'm-tiny', id: 'small', gender: 'm', body: 'tiny', dials: dialsOf('small') },
  { label: 'm-medium', id: 'athletic', gender: 'm', body: 'medium', dials: dialsOf('athletic') },
  { label: 'm-huge', id: 'bodybuilder', gender: 'm', body: 'huge', dials: dialsOf('bodybuilder') },
  { label: 'f-tiny', id: 'athleticHeroine', gender: 'f', body: 'tiny', dials: dialsOf('athleticHeroine') },
  { label: 'f-medium', id: 'heroine', gender: 'f', body: 'medium', dials: dialsOf('heroine') },
  { label: 'f-huge', id: 'heavyweight', gender: 'f', body: 'huge', dials: dialsOf('heavyweight') },
]

/** A generated test hero: Tripo Max, rigged there and rebound to our skeleton (rebind.ts). `file` is under .scratch/tripo-in. */
export interface AuditHero { label: string; gender: 'm' | 'f'; height: number; file: string }

/** Where the generated test heroes are listed: a local file, never in source, so the meshes and their names stay on this machine. */
export const AUDIT_HEROES_FILE = '.scratch/tripo-in/audit.json'
