import { ENGINE } from '../../arena/engine/calibration.js'
import { isRanged } from '../../arena/engine/deliveries.js'
import { prepareHero } from '../../arena/engine/state.js'
import { retuneFactor } from '../../charter/budget.js'
import type { Build } from '../../charter/build.js'
import { locomotion } from '../../charter/locomotion.js'
import { SIZES } from '../../charter/sizes.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { TraitMods } from '../../charter/traits.js'
import type { DamageType, SecondarySheet } from '../../charter/types.js'

/**
 * A hero's fighting numbers the way a unit card shows them (TFT, Underlords): what the engine itself will use, read
 * from the same setup a match builds, with whatever the army's traits add. Damage cuts are the engine's: resist is
 * taken off as a percentage, from its floor up to its cap.
 */
export interface HeroStats {
  health: number
  armor: number
  /** Physical damage taken off, in %. */
  armorCut: number
  spiritResist: number
  /** Spirit damage taken off, in %. */
  spiritCut: number
  /** The main weapon's damage per hit, and its type: the ranged weapon for a role that keeps its range, else the melee style. */
  perHit: number
  damageType: DamageType
  /** Hits a second: attack speed for a swing, the weapon's rate times fire rate for a shot. */
  rate: number
  ranged: boolean
  /** How far the main weapon reaches, in metres, the way the engine measures it. */
  reach: number
  /** The main weapon's damage a second before resist. */
  dps: number
  spiritPower: number
  regen: number
  lifesteal: number
  /** Cooldown reduction in %, as the engine caps it. */
  cooldownCut: number
  move: number
  slide: number
  /** The derived sheet these come from, for the skills' own numbers. */
  sheet: SecondarySheet
}

const cut = (resist: number) => Math.max(ENGINE.resistFloor, Math.min(ENGINE.resistCap, resist))

export function heroStats(build: Build, mods: TraitMods = {}): HeroStats {
  const setup = prepareHero(build, 1, 0, mods)
  const { sheet, kit } = setup
  // every hero carries a melee style and a ranged weapon (§4); the card shows the one its role fights with
  const ranged = isRanged(setup)
  const slot = ranged ? 'active1' : 'basic'
  const weapon = kit[slot]
  // per hit the way the skill's own tooltip works it out, so the card and the kit list agree (the engine rounds a
  // retuned skill's numbers, which can sit a fraction of a point away)
  const spec = build.slots[slot]
  const hit = getTemplate(spec.templateId).effects.find((e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage')
  const perHit = hit ? (hit.amount + hit.ratio * sheet[hit.scaling]) * retuneFactor(spec.retuneSteps) : 0
  const rate = ranged ? (weapon.ranged?.rate ?? 1) * sheet.fireRate : sheet.attackSpeed
  const size = SIZES[build.sizeClass ?? 'medium']
  const reach = ranged ? weapon.delivery.range : weapon.delivery.range + ENGINE.meleeSlack + size.reachBonus + ENGINE.capsule.radius * size.scale
  const move = locomotion(sheet.moveSpeed)
  return {
    health: sheet.maxHealth,
    armor: sheet.armor,
    armorCut: cut(sheet.armor),
    spiritResist: sheet.magicResist,
    spiritCut: cut(sheet.magicResist),
    perHit,
    damageType: hit?.type ?? 'physical',
    rate,
    ranged,
    reach,
    dps: perHit * rate,
    spiritPower: sheet.spiritPower,
    regen: sheet.regen,
    lifesteal: sheet.lifesteal,
    cooldownCut: Math.min(40, sheet.cooldownReduction),
    move: move.ground,
    slide: move.slide,
    sheet,
  }
}
