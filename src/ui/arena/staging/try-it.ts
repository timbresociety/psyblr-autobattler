import { proposeBuild, type Build } from '../../../charter/build'
import { STARTERS } from '../../../arena/starters'
import { roleSymbol, starterEntry } from './loadout'
import type { StagingResult } from './Staging'

/** What the training dummy is: a plain tank in nothing but its base layer, the colour of a wooden mannequin. */
const DUMMY: Build = {
  ...proposeBuild({ heroName: 'Training dummy', roleId: 'tank', skills: {} }).build,
  look: { gender: 'm', hair: 'none', armour: false, cape: false, colors: { skin: '#c9b28b', iris: '#3a2e22', brow: '#c9b28b' }, wear: {} },
}

/** A 1v1 in the lane between the ruins' fallen block and its columns: the hero being made, and the dummy to try it on. */
export const tryItStaging = (build: Build): StagingResult => ({
  side: 0,
  formation: [[{ hero: 0, x: 5, z: -5 }], [{ hero: 1, x: 5, z: 5 }]],
  loadout: [
    { key: 'try', build, symbol: roleSymbol(build.roleId) },
    { key: 'dummy', build: DUMMY, symbol: roleSymbol('tank') },
  ],
  dummy: true,
})

/**
 * Try it in the arena: a 3v3 in the same lane, the hero with two starters beside it against three, each side a front
 * line, a damage dealer and a back line where the hero leaves room (its role takes the place of the one it shares).
 */
export const arenaStaging = (build: Build): StagingResult => {
  // the first of each squad's starters in the role
  const starter = (squad: 'vanguard' | 'outlaws', role: string) => starterEntry(STARTERS.find((s) => s.squad === squad && s.roleId === role)!)
  const allies = ['tank', 'support', 'marksman'].map((role) => starter('vanguard', role)).filter((e) => e.build.roleId !== build.roleId).slice(0, 2)
  const enemies = ['tank', 'marksman', 'support'].map((role) => starter('outlaws', role))
  return {
    side: 0,
    formation: [
      [0, 1, 2].map((hero, i) => ({ hero, x: 5 + (i - 1) * 3, z: -6 - (i === 0 ? 0 : 2) })),
      [3, 4, 5].map((hero, i) => ({ hero, x: 5 + (i - 1) * 3, z: 6 + (i === 1 ? 0 : 2) })),
    ],
    loadout: [{ key: 'try', build, symbol: roleSymbol(build.roleId) }, ...allies, ...enemies],
  }
}

/**
 * The range's traversal course (GAME.md §11): the hero alone at the blue muster and the dummy at the red one, the
 * whole House of Instinct between them to cross by its ramps, stairs, ledges and zip lines.
 */
export const courseStaging = (build: Build): StagingResult => ({
  ...tryItStaging(build),
  formation: [[{ hero: 0, x: 0, z: -36 }], [{ hero: 1, x: 0, z: 36 }]],
})
