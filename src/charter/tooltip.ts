import { retuneFactor } from './budget'
import type { Effect, SecondarySheet, Template } from './types'

/** What the player authored for a skill: the name and flavour shown on top of the template (R3, R5). */
export interface SkillText {
  name: string
  flavour: string
  visual?: string
}

export interface Tooltip {
  title: string
  mechanic: string
  lines: string[]
  text: string
  retuned: boolean
}

const STAT_LABEL = { weaponDamage: 'weapon', spiritPower: 'spirit' } as const
const num = (value: number) => String(Math.round(value * 10) / 10)

function scaled(amount: number, ratio: number, stat: keyof typeof STAT_LABEL, sheet: SecondarySheet, factor: number) {
  const total = Math.round((amount + ratio * sheet[stat]) * factor)
  const parts = ratio ? ` (${num(amount * factor)} + ${num(ratio * factor)}× ${STAT_LABEL[stat]})` : ''
  return `${total}${parts}`
}

function effectLine(effect: Effect, sheet: SecondarySheet, factor: number, permanent: boolean): string {
  switch (effect.kind) {
    case 'damage':
      return `${effect.type === 'spirit' ? 'Spirit' : 'Physical'} damage ${scaled(effect.amount, effect.ratio, effect.scaling, sheet, factor)}${effect.overTime ? ` over ${num(effect.overTime)} s` : ''}`
    case 'heal':
      return `Heal ${scaled(effect.amount, effect.ratio, 'spiritPower', sheet, factor)}${effect.target === 'self' ? '' : effect.target === 'ally' ? ' to an ally' : ' to nearby allies'}${effect.overTime ? ` over ${num(effect.overTime)} s` : ''}`
    case 'shield':
      return `Shield ${scaled(effect.amount, effect.ratio, 'spiritPower', sheet, factor)} for ${num(effect.duration)} s${effect.target === 'allies' ? ' on nearby allies' : ''}`
    case 'stun':
      return `Stun ${num(effect.duration)} s`
    case 'slow':
      return `Slow ${num(effect.pct)}% for ${num(effect.duration)} s`
    case 'displace':
      return `Knock back ${num(effect.distance)} m`
    case 'mobility':
      return `Move ${num(effect.distance)} m${effect.invulnerable ? `, untouchable for ${num(effect.invulnerable)} s` : ''}`
    case 'buff':
      return `+${num(effect.pct * factor)}% ${effect.stat.replace(/([A-Z])/g, ' $1').toLowerCase()}${permanent ? '' : ` for ${num(effect.duration)} s`}${effect.target === 'allies' ? ' to allies' : ''}`
    case 'execute':
      return `+${num(effect.bonusPct * factor)}% damage to targets under ${num(effect.thresholdPct)}% health`
  }
}

/** The tooltip shows the player's skill name with the template's real numbers on this hero's sheet (R6). */
export function renderTooltip(template: Template, skill: SkillText, sheet: SecondarySheet, retuneSteps = 0): Tooltip {
  const factor = retuneFactor(retuneSteps)
  // An always-on passive is permanent; its one-second duration is only the budget unit.
  const permanent = template.slot === 'passive' && (template.trigger ?? 'always') === 'always'
  const lines = template.effects.map((effect) => effectLine(effect, sheet, factor, permanent))
  if (template.delivery.kind !== 'self' && template.delivery.kind !== 'aura') lines.push(`Range ${num(template.delivery.range)} m`)
  if (template.delivery.radius) lines.push(`Radius ${num(template.delivery.radius)} m`)
  if (template.cooldown > 0) lines.push(`Cooldown ${num(template.cooldown * (1 - sheet.cooldownReduction / 100))} s`)
  if (template.trigger && template.trigger !== 'always') lines.push(`Triggers ${template.trigger.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
  const title = skill.name.trim() || template.name
  return { title, mechanic: template.name, lines, text: `${title} — ${template.name}. ${lines.join('. ')}.`, retuned: retuneSteps > 0 }
}
