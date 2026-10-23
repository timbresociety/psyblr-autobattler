import type { BuildSlot, Template } from '../../charter/types'
import { AbilityIcon, iconFor, toneFor } from '../arena/hud/icons'
import { SLOT_KEY } from '../arena/hud/model'

const KEY_LABEL: Partial<Record<string, string>> = { SHIFT: 'Shift' }

/**
 * A skill's icon outside the match: the HUD's art for its mechanic, in its tone, with the key that casts it in the
 * arena (LMB, Q, E, R, Shift), so the kit reads the same here as in a fight.
 */
export function SkillIcon({ template, slot, size = 'md', showKey = size === 'md' }: { template: Pick<Template, 'slot' | 'delivery' | 'effects'>; slot: BuildSlot; size?: 'xs' | 'sm' | 'md'; showKey?: boolean }) {
  const key = SLOT_KEY[slot]
  const shape = slot === 'ultimate' ? ' is-ult' : slot === 'passive' ? ' is-passive' : ''
  return (
    <span className={`ab-icon tone-${toneFor(template)}${size === 'md' ? '' : ` ${size}`}${shape}`} aria-hidden="true">
      <AbilityIcon icon={iconFor(template)} />
      {showKey && key && <kbd className="ab-key">{KEY_LABEL[key] ?? key}</kbd>}
    </span>
  )
}
