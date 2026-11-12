import { retuneFactor } from './budget.js'
import { SIZES } from './sizes.js'
import type { Effect, SecondarySheet, Template } from './types.js'

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
      return effect.stat === 'attack' ? `Attack speed −${num(effect.pct)}% for ${num(effect.duration)} s` : `Slow ${num(effect.pct)}% for ${num(effect.duration)} s`
    case 'displace':
      return `Knock back ${num(effect.distance)} m`
    case 'mobility':
      return `Move ${num(effect.distance)} m${effect.invulnerable ? `, untouchable for ${num(effect.invulnerable)} s` : ''}`
    case 'buff':
      return `+${num(effect.pct * factor)}% ${effect.stat.replace(/([A-Z])/g, ' $1').toLowerCase()}${permanent ? '' : ` for ${num(effect.duration)} s`}${effect.target === 'allies' ? ' to allies' : ''}`
    case 'execute':
      return `+${num(effect.bonusPct * factor)}% damage to targets under ${num(effect.thresholdPct)}% health`
    case 'resize':
      return `Becomes ${SIZES[effect.sizeClass].label} for ${num(effect.duration)} s`
    case 'form':
      return `Transforms for ${num(effect.duration)} s, keeping its size`
    case 'control':
      return `${CONTROL_LINE[effect.type]} ${num(effect.duration)} s${CONTROL_NOTE[effect.type] ?? ''}`
    case 'knockup':
      return `Knock up ${num(effect.height)} m, helpless for ${num(effect.duration)} s`
    case 'pull':
      return `Pull ${num(effect.distance)} m`
    case 'debuff':
      return DEBUFF_LINE[effect.type](num(effect.amount), num(effect.duration))
    case 'state': {
      const who = effect.target === 'self' ? '' : effect.target === 'ally' ? ' on an ally' : ' on nearby allies'
      return effect.type === 'cleanse' ? `Cleanse control and debuffs${who}` : `${STATE_LINE[effect.type]} ${num(effect.duration)} s${who}`
    }
    case 'refresh':
      return `Other cooldowns −${num(effect.seconds)} s`
    case 'field':
      return `Lingers ${num(effect.duration)} s, landing again every ${num(effect.interval)} s`
    case 'wall':
      return `Raises a wall ${num(effect.length)} m long and ${num(effect.height)} m tall for ${num(effect.duration)} s (${num(effect.health)} to break)`
    case 'reveal':
      return `Reveals for ${num(effect.duration)} s: no hiding, seen through walls`
    case 'swapHealth':
      return `Trades health shares with the target (at most ${num(effect.cap * 100)}% of max health each)`
    case 'steal':
      return `The target's spell waits ${num(effect.seconds)} s more; this hero's, ${num(effect.seconds)} s less`
    case 'rewind':
      return `An ally gets back the health it lost in the last ${num(effect.seconds)} s`
    case 'trap':
      return `Waits up to ${num(effect.lifetime)} s for an enemy to step in, armed after ${num(effect.arm)} s`
    case 'turret':
      return `Turret: ${effect.type === 'spirit' ? 'spirit' : 'physical'} damage ${scaled(effect.amount, effect.ratio, effect.scaling, sheet, factor)} every ${num(effect.interval)} s for ${num(effect.duration)} s, ${num(effect.range)} m range`
    case 'counter':
      return `For ${num(effect.duration)} s the next hit is ${COUNTER_LINE[effect.answer]}`
    case 'summon':
      return `Summons ${effect.count > 1 ? `${effect.count} ` : 'a '}${SUMMON_LINE[effect.what]}${effect.count > 1 ? 's' : ''} for ${num(effect.duration)} s`
    case 'barrier':
      return `Raises a one-way barrier ${num(effect.length)} m long for ${num(effect.duration)} s: enemy shots stop, your side's pass`
    case 'terrain':
      return `Raises a ${effect.shape} ${num(effect.length)} m long to walk on for ${num(effect.duration)} s`
    case 'portal':
      return `Opens a pair of portals for ${num(effect.duration)} s`
    case 'copyKit':
      return `Takes the target's kit for ${num(effect.duration)} s`
    case 'possess':
      return `Takes control of the target for ${num(effect.duration)} s`
    case 'lift':
      return `Lifts the target ${num(effect.height)} m, holds it ${num(effect.hold)} s, then throws it ${num(effect.distance)} m`
    case 'revive':
      return `Revives ${effect.target === 'ally' ? 'a downed ally' : 'every downed ally in reach'} at ${num(effect.share * 100)}% health`
    case 'element':
      return `Every hit carries ${effect.element}`
    case 'lockon':
      return `Locks on and lands ${effect.hits} blows over ${num(effect.duration)} s`
    case 'kitSwitch':
      return `Switches to a second kit for ${num(effect.duration)} s`
    case 'fuse':
      return `Merges with the nearest ally for ${num(effect.duration)} s`
    case 'traverse':
      return TRAVERSE_LINE[effect.how](num(effect.distance), num(effect.duration))
  }
}

const COUNTER_LINE = { strike: 'answered with a strike', substitute: 'dodged by slipping behind the striker', reflect: 'turned back on the striker', absorb: 'drunk as health' } as const
const SUMMON_LINE = { minion: 'minion', clone: 'clone', decoy: 'decoy', titan: 'titan' } as const
const TRAVERSE_LINE: Record<import('./types.js').TraverseKind, (d: string, s: string) => string> = {
  teleport: (d) => `Teleports to a mark or a target up to ${d} m away`,
  swap: (d) => `Swaps places with a hero up to ${d} m away`,
  homing: (d) => `Dashes onto a target up to ${d} m away`,
  swing: (d, s) => `Swings on a line from a point up to ${d} m away, for up to ${s} s`,
  flight: (_d, s) => `Flies for up to ${s} s`,
  glide: (_d, s) => `Glides for up to ${s} s`,
  wallCrawl: (_d, s) => `Crawls on any wall for up to ${s} s`,
  burrow: (_d, s) => `Burrows underground for up to ${s} s`,
  ride: (_d, s) => `Rides an ally for up to ${s} s`,
  wallRun: (_d, s) => `Runs along any wall, for longer, for ${s} s`,
  combatRoll: (d) => `A ${d} m roll, untouchable all the way, that reloads`,
  powerSlide: (d) => `A ${d} m slide that knocks down whoever it hits`,
  zipline: (d) => `Fires a line up to ${d} m and rides it`,
}
const CONTROL_LINE = { root: 'Root', silence: 'Silence', disarm: 'Disarm', sleep: 'Sleep', blind: 'Blind', grounded: 'Ground', fear: 'Fear', taunt: 'Taunt', break: 'Break its passive for' } as const
const CONTROL_NOTE: Partial<Record<keyof typeof CONTROL_LINE, string>> = {
  root: ' (it can still fight)',
  silence: ' (no skills)',
  disarm: ' (no basic attacks)',
  sleep: ' (damage wakes it, and that hit deals 50% more)',
  blind: ' (basic attacks miss)',
  grounded: ' (no flight or movement skills)',
  fear: ' (it runs from you)',
  taunt: ' (it must attack you)',
}
const DEBUFF_LINE = {
  armorShred: (a: string, d: string) => `Armour −${a} for ${d} s`,
  spiritShred: (a: string, d: string) => `Spirit resist −${a} for ${d} s`,
  vulnerable: (a: string, d: string) => `Takes ${a}% more damage for ${d} s`,
  wound: (a: string, d: string) => `Healing received −${a}% for ${d} s`,
  mark: (a: string, d: string) => `Marked for ${d} s: your team deals ${a}% more to it and it can't hide`,
} as const
const STATE_LINE = { unstoppable: 'Unstoppable', stealth: 'Stealth', invulnerable: 'Untouchable', reflect: 'Reflects shots' } as const

/** The tooltip shows the player's skill name with the template's real numbers on this hero's sheet (R6). */
export function renderTooltip(template: Template, skill: SkillText, sheet: SecondarySheet, retuneSteps = 0): Tooltip {
  const factor = retuneFactor(retuneSteps)
  // An always-on passive is permanent; its one-second duration is only the budget unit.
  const permanent = template.slot === 'passive' && (template.trigger ?? 'always') === 'always'
  const lines = template.effects.map((effect) => effectLine(effect, sheet, factor, permanent))
  if (template.delivery.kind !== 'self' && template.delivery.kind !== 'aura') lines.push(`Range ${num(template.delivery.range)} m`)
  if (template.delivery.radius) lines.push(`Radius ${num(template.delivery.radius)} m`)
  const d = template.delivery
  if (d.speed) lines.push(`Shot speed ${num(d.speed)} m/s, ${num(d.projectileRadius ?? 0)} m wide`)
  if (d.arcDegrees) lines.push(`Arc ${num(d.arcDegrees)}°`)
  if (d.width) lines.push(`Beam width ${num(d.width)} m`)
  if (template.cooldown > 0) lines.push(`Cooldown ${num(template.cooldown * (1 - sheet.cooldownReduction / 100))} s`)
  if (template.trigger && template.trigger !== 'always') lines.push(`Triggers ${template.trigger.replace(/([A-Z])/g, ' $1').toLowerCase()}`)
  const title = skill.name.trim() || template.name
  return { title, mechanic: template.name, lines, text: `${title} — ${template.name}. ${lines.join('. ')}.`, retuned: retuneSteps > 0 }
}
