import { proposeBuild, type Build } from '../../../charter/build'
import { DEMO_HEROES, demoBuild } from '../../../arena/demo/roster'
import { roleSymbol } from './loadout'
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
  const starter = (id: string) => {
    const hero = DEMO_HEROES.find((h) => h.id === id)!
    return { key: `demo:${hero.id}`, build: demoBuild(hero), symbol: roleSymbol(hero.roleId), faction: hero.faction, hue: hero.hue }
  }
  const allies = ['bezos', 'nadella', 'huang'].map(starter).filter((e) => e.build.roleId !== build.roleId).slice(0, 2)
  const enemies = ['zelenskyy', 'obama', 'ardern'].map(starter)
  return {
    side: 0,
    formation: [
      [0, 1, 2].map((hero, i) => ({ hero, x: 5 + (i - 1) * 3, z: -6 - (i === 0 ? 0 : 2) })),
      [3, 4, 5].map((hero, i) => ({ hero, x: 5 + (i - 1) * 3, z: 6 + (i === 1 ? 0 : 2) })),
    ],
    loadout: [{ key: 'try', build, symbol: roleSymbol(build.roleId) }, ...allies, ...enemies],
  }
}
