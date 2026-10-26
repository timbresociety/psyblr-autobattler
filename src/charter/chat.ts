import type { StatGoal } from './build.js'
import type { SecondaryStat } from './types.js'

/** Plain words the offline parser understands, each mapped to the stats it moves. */
const STAT_WORDS: [RegExp, SecondaryStat][] = [
  [/\b(agile|agility|fast|faster|quick|speed)\b/, 'moveSpeed'],
  [/\b(armou?r|tank(y|ier)?|defen[cs]e)\b/, 'armor'],
  [/\b(health|hp|tough(er)?|durable)\b/, 'maxHealth'],
  [/\b(damage|hit harder|stronger|power)\b/, 'weaponDamage'],
  [/\b(spirit|magic|spells?|abilit(y|ies))\b/, 'spiritPower'],
  [/\b(cooldowns?)\b/, 'cooldownReduction'],
  [/\b(regen|regenerat\w*|heal(ing)?)\b/, 'regen'],
]

/** Offline fallback: "more X", "less Y", "max Z" for the words above. */
export function parseStatWishes(message: string): Partial<Record<SecondaryStat, StatGoal>> {
  const goals: Partial<Record<SecondaryStat, StatGoal>> = {}
  for (const clause of message.toLowerCase().split(/,|\band\b|;/)) {
    const goal: StatGoal = /\b(less|lower|fewer|reduce|drop)\b/.test(clause) ? 'less' : /\b(max|maximum|all in)\b/.test(clause) ? 'max' : 'more'
    for (const [pattern, stat] of STAT_WORDS) if (pattern.test(clause)) goals[stat] = goal
  }
  return goals
}

