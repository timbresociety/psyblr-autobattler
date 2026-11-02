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
