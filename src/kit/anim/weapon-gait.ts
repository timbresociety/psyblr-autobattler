/**
 * Weapon-held locomotion (GAME.md §12): a hero carrying a pistol or a rifle walks, jogs and runs on that weapon's own
 * clips, not the unarmed ones. Each maps the gait's clip names (src/arena/client/gait.ts: a tier and a way) onto the
 * library's, with the stance it stands in; the baker measures each of these clips' gait like the unarmed loops, and a
 * way of turning so its travel faces the way it names. A pistol has no running strafes, so its strafes serve every
 * tier, played quicker.
 */
export const WEAPONS = ['pistol', 'rifle'] as const
export type Weapon = (typeof WEAPONS)[number]

export interface WeaponGait {
  stance: string
  clips: Readonly<Record<string, string>>
}

export const WEAPON_GAIT: Readonly<Record<Weapon, WeaponGait>> = {
  rifle: {
    stance: 'rifle_idle',
    clips: {
      walk: 'rifle_walk_forward',
      walk_left: 'rifle_walk_left',
      walk_back: 'rifle_walk_backward',
      walk_right: 'rifle_walk_right',
      jog: 'rifle_run_forward',
      jog_left: 'rifle_run_left',
      jog_back: 'rifle_run_backward',
      jog_right: 'rifle_run_right',
      run: 'rifle_sprint_forward',
      run_left: 'rifle_sprint_left',
      run_back: 'rifle_sprint_backward',
      run_right: 'rifle_sprint_right',
    },
  },
  pistol: {
    stance: 'pistol_idle',
    clips: {
      walk: 'pistol_walk',
      walk_left: 'pistol_strafe_left',
      walk_back: 'pistol_walk_backward',
      walk_right: 'pistol_strafe_right',
      jog: 'pistol_run',
      jog_left: 'pistol_strafe_left',
      jog_back: 'pistol_run_backward',
      jog_right: 'pistol_strafe_right',
      run: 'pistol_run',
      run_left: 'pistol_strafe_left',
      run_back: 'pistol_run_backward',
      run_right: 'pistol_strafe_right',
    },
  },
}

/** The way each gait name goes from the hips, as yaw turns (a quarter turn is the hero's left). */
export const WAY_OF: Readonly<Record<string, number>> = { '': 0, _left: Math.PI / 2, _back: Math.PI, _right: -Math.PI / 2 }

/** Every weapon loop the baker measures, with the way it goes. */
export const WEAPON_LOOPS: ReadonlyMap<string, number> = new Map(
  Object.values(WEAPON_GAIT).flatMap((w) => Object.entries(w.clips).map(([gait, clip]) => [clip, WAY_OF[gait.replace(/^(walk|jog|run)/, '')]] as const)),
)

/** The weapon a fighting style carries, if it carries one with its own locomotion. */
export const weaponOf = (style: string | undefined): Weapon | undefined => (WEAPONS as readonly string[]).includes(style ?? '') ? (style as Weapon) : undefined

/**
 * The engine's own moves a weapon plays from its set instead of the unarmed library's (library-gait.ts LIBRARY_MOVES):
 * crouching and moving crouched, jumping and hanging in the air, each with the weapon held.
 */
export const WEAPON_MOVES: Readonly<Record<Weapon, Readonly<Record<string, string>>>> = {
  rifle: { crouch: 'rifle_idle_crouching', crouch_move: 'rifle_walk_crouching_forward', jump: 'rifle_jump_up', air: 'rifle_jump_loop' },
  pistol: { crouch: 'pistol_kneeling_idle', jump: 'pistol_jump' },
}
