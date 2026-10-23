import { retuneFactor } from '../../charter/budget'
import { SIZES } from '../../charter/sizes'
import type { Effect, SecondarySheet, Template } from '../../charter/types'

/**
 * The few numbers a skill card shows big, read off the same template, sheet and retune as its tooltip (R6): what it
 * does, how far it reaches and how often. The tooltip underneath keeps every exact line and its scaling.
 */

export interface Headline {
  label: string
  value: string
  unit?: string
}

const n = (value: number) => String(Math.round(value * 10) / 10)

const BUFF_LABEL: Record<Extract<Effect, { kind: 'buff' }>['stat'], string> = {
  damage: 'Damage up',
  attackSpeed: 'Attack speed',
  moveSpeed: 'Speed up',
  damageReduction: 'Damage cut',
  lifesteal: 'Lifesteal',
  evasion: 'Evasion',
}

const CONTROL_LABEL = { root: 'Root', silence: 'Silence', disarm: 'Disarm', sleep: 'Sleep', blind: 'Blind', grounded: 'Ground', fear: 'Fear', taunt: 'Taunt', break: 'Break' } as const
const DEBUFF_LABEL = { armorShred: 'Armour', spiritShred: 'Spirit resist', vulnerable: 'Vulnerable', wound: 'Anti-heal', mark: 'Mark' } as const
const STATE_LABEL = { unstoppable: 'Unstoppable', stealth: 'Stealth', invulnerable: 'Untouchable', cleanse: 'Cleanse' } as const

/** Most telling first: damage, then healing and shields, then control, then the rest. */
const ORDER: Effect['kind'][] = ['damage', 'turret', 'heal', 'shield', 'stun', 'knockup', 'control', 'wall', 'slow', 'debuff', 'pull', 'execute', 'resize', 'state', 'mobility', 'buff', 'displace', 'refresh', 'field', 'trap']

function magnitude(effect: Effect, sheet: SecondarySheet, factor: number): Headline {
  switch (effect.kind) {
    case 'damage':
      return { label: 'Damage', value: String(Math.round((effect.amount + effect.ratio * sheet[effect.scaling]) * factor)), ...(effect.overTime ? { unit: `over ${n(effect.overTime)} s` } : {}) }
    case 'heal':
      return { label: 'Heal', value: String(Math.round((effect.amount + effect.ratio * sheet.spiritPower) * factor)), ...(effect.overTime ? { unit: `over ${n(effect.overTime)} s` } : {}) }
    case 'shield':
      return { label: 'Shield', value: String(Math.round((effect.amount + effect.ratio * sheet.spiritPower) * factor)), unit: `${n(effect.duration)} s` }
    case 'stun':
      return { label: 'Stun', value: n(effect.duration), unit: 's' }
    case 'slow':
      return { label: 'Slow', value: n(effect.pct), unit: '%' }
    case 'displace':
      return { label: 'Knockback', value: n(effect.distance), unit: 'm' }
    case 'mobility':
      return { label: 'Moves', value: n(effect.distance), unit: 'm' }
    case 'buff':
      return { label: BUFF_LABEL[effect.stat], value: `+${n(effect.pct * factor)}`, unit: '%' }
    case 'execute':
      return { label: `Under ${n(effect.thresholdPct)}%`, value: `+${n(effect.bonusPct * factor)}`, unit: '%' }
    case 'resize':
      return { label: 'Becomes', value: SIZES[effect.sizeClass].label, unit: `${n(effect.duration)} s` }
    case 'control':
      return { label: CONTROL_LABEL[effect.type], value: n(effect.duration), unit: 's' }
    case 'knockup':
      return { label: 'Knock-up', value: n(effect.duration), unit: 's' }
    case 'pull':
      return { label: 'Pull', value: n(effect.distance), unit: 'm' }
    case 'debuff':
      return { label: DEBUFF_LABEL[effect.type], value: `${effect.type.endsWith('Shred') ? '−' : ''}${n(effect.amount)}`, unit: effect.type.endsWith('Shred') ? `${n(effect.duration)} s` : '%' }
    case 'state':
      return { label: STATE_LABEL[effect.type], value: effect.type === 'cleanse' ? '✓' : n(effect.duration), ...(effect.type === 'cleanse' ? {} : { unit: 's' }) }
    case 'refresh':
      return { label: 'Cooldowns', value: `−${n(effect.seconds)}`, unit: 's' }
    case 'field':
      return { label: 'Lingers', value: n(effect.duration), unit: 's' }
    case 'wall':
      return { label: 'Wall', value: n(effect.length), unit: 'm' }
    case 'trap':
      return { label: 'Trap', value: n(effect.lifetime), unit: 's' }
    case 'turret':
      return { label: 'Turret', value: String(Math.round((effect.amount + effect.ratio * sheet[effect.scaling]) * factor)), unit: `every ${n(effect.interval)} s` }
  }
}

/** Up to three headline numbers: the main effect, its reach or a second effect, and the cooldown. */
export function headline(template: Template, sheet: SecondarySheet, retuneSteps = 0): Headline[] {
  const factor = retuneFactor(retuneSteps)
  // a movement skill is first about how far it takes the hero
  const rank = (kind: Effect['kind']) => (template.slot === 'movement' && kind === 'mobility' ? -1 : ORDER.indexOf(kind))
  const effects = [...template.effects].sort((a, b) => rank(a.kind) - rank(b.kind))
  const out: Headline[] = []
  if (effects[0]) out.push(magnitude(effects[0], sheet, factor))
  const d = template.delivery
  const reach = d.kind !== 'self' && d.kind !== 'aura' ? { label: 'Range', value: n(d.range), unit: 'm' } : d.radius ? { label: 'Radius', value: n(d.radius), unit: 'm' } : undefined
  const second = reach ?? (effects[1] ? magnitude(effects[1], sheet, factor) : undefined)
  if (second) out.push(second)
  if (template.cooldown > 0) out.push({ label: 'Cooldown', value: n(template.cooldown * (1 - sheet.cooldownReduction / 100)), unit: 's' })
  else if (effects[1] && second !== undefined && second === reach && out.length < 3) out.push(magnitude(effects[1], sheet, factor))
  return out.slice(0, 3)
}
