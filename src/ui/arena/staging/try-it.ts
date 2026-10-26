import { proposeBuild, type Build } from '../../../charter/build'
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
