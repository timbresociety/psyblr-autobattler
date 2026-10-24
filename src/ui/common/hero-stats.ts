import { ENGINE } from '../../arena/engine/calibration.js'
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
  /** The basic attack's damage per hit, and its type. */
  perHit: number
  damageType: DamageType
  /** Basic attacks a second: attack speed for a swing, fire rate for a shot. */
  rate: number
  ranged: boolean
  /** How far the basic attack reaches, in metres, the way the engine measures it. */
  reach: number
  /** The basic attack's damage a second before resist. */
  dps: number
  spiritPower: number
  regen: number
  lifesteal: number
  /** Cooldown reduction in %, as the engine caps it. */
  cooldownCut: number
  move: number
  flight: number
  /** The derived sheet these come from, for the skills' own numbers. */
  sheet: SecondarySheet
}

const cut = (resist: number) => Math.max(ENGINE.resistFloor, Math.min(ENGINE.resistCap, resist))

export function heroStats(build: Build, mods: TraitMods = {}): HeroStats {
  const { sheet, kit } = prepareHero(build, 1, 0, mods)
  const basic = kit.basic
  const ranged = basic.delivery.range > 4
  // per hit the way the skill's own tooltip works it out, so the card and the kit list agree (the engine rounds a
  // retuned skill's numbers, which can sit a fraction of a point away)
  const spec = build.slots.basic
  const hit = getTemplate(spec.templateId).effects.find((e): e is Extract<typeof e, { kind: 'damage' }> => e.kind === 'damage')
  const perHit = hit ? (hit.amount + hit.ratio * sheet[hit.scaling]) * retuneFactor(spec.retuneSteps) : 0
  const rate = ranged ? sheet.fireRate : sheet.attackSpeed
  const size = SIZES[build.sizeClass ?? 'medium']
  const reach = ranged ? basic.delivery.range : basic.delivery.range + ENGINE.meleeSlack + size.reachBonus + ENGINE.capsule.radius * size.scale
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
    flight: move.flight,
    sheet,
  }
}
