import { useRef, useState } from 'react'
import { swapAlternatives, swapOptions, type Build, type SkillText } from '../../charter/build'
import { FAMILIES, FAMILY_LABEL, primaryFamily } from '../../charter/families'
import { getRole } from '../../charter/roles'
import { deriveSheet } from '../../charter/stats'
import { getTemplate } from '../../charter/templates/catalog'
import { renderTooltip } from '../../charter/tooltip'
import type { BuildSlot } from '../../charter/types'
import { elementLook, type SkillLook } from '../../charter/skill-look'
import { skillLookOf } from '../../arena/recipes/looks'
import { transformOf } from '../../forge/form'
import { toneFor } from '../arena/hud/icons'
import { headline } from '../common/skill-numbers'
import { SkillIcon } from '../common/SkillIcon'
import { SLOT_LABEL } from './labels'
import { FormCard, SkillLookRow } from './SkillLook'

interface Props {
  build: Build
  slot: BuildSlot
  onEdit: (slot: BuildSlot, text: SkillText, replace?: boolean) => { needsConfirm?: boolean }
  onSwap: (slot: BuildSlot, templateId: string) => void
  /** The player is looking at this skill: the preview hero can show it. */
  onPreview?: (slot: BuildSlot) => void
  /** Change how the skill looks (free, and never a number); without it the card shows no look controls. */
  onLook?: (slot: BuildSlot, change: (look: SkillLook) => SkillLook) => void
}

/** One skill: the player's name, flavour and visuals on top of the engine's mechanic and its real numbers (R3, R6, R7). */
export function SkillCard({ build, slot, onEdit, onSwap, onPreview, onLook }: Props) {
  const spec = build.slots[slot]
  const template = getTemplate(spec.templateId)
  const sheet = deriveSheet(getRole(build.roleId), build.spread, build.sizeClass).sheet
  const tip = renderTooltip(template, spec, sheet, spec.retuneSteps)
  const numbers = headline(template, sheet, spec.retuneSteps)
  // the closest swaps first, then the role's whole library for this slot, one group per effect family
  const near = swapAlternatives(build, slot)
  const library = swapOptions(build, slot).slice(near.length)
  const groups = FAMILIES.map((family) => ({ family, items: library.filter((t) => primaryFamily(t) === family).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length)
  const [flavour, setFlavour] = useState(spec.flavour)
  const [pending, setPending] = useState<string | undefined>()
  const [lastSeen, setLastSeen] = useState(spec.flavour)
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined)
  // the look the skill is drawn with: the player's own, or the one its words and template give it
  const look = skillLookOf(build, slot) ?? elementLook('energy')
  if (spec.flavour !== lastSeen) {
    setLastSeen(spec.flavour)
    setFlavour(spec.flavour)
  }

  const commitFlavour = () => {
    if (flavour === spec.flavour) return
    const result = onEdit(slot, { flavour })
    if (result.needsConfirm) setPending(flavour)
  }
  // a short rest on the card before the hero performs it, so sweeping the mouse across the kit stays calm
  const enter = () => {
    clearTimeout(hover.current)
    if (onPreview) hover.current = setTimeout(() => onPreview(slot), 220)
  }
  const leave = () => clearTimeout(hover.current)

  return (
    <article id={`skill-${slot}`} className={`skill tone-${toneFor(template)} slot-${slot}`} aria-label={SLOT_LABEL[slot]} onPointerEnter={enter} onPointerLeave={leave}>
      <header className="skill-head">
        <SkillIcon template={template} slot={slot} />
        <div className="skill-title">
          <span className="skill-slot">
            {SLOT_LABEL[slot]} <em className="skill-family">{FAMILY_LABEL[primaryFamily(template)]}</em>
          </span>
          <input className="skill-name" aria-label={`${SLOT_LABEL[slot]} name`} value={spec.name} placeholder={template.name} maxLength={40} onChange={(e) => onEdit(slot, { name: e.target.value })} onFocus={() => onPreview?.(slot)} />
        </div>
      </header>
      <div className="tooltip" aria-label={`${SLOT_LABEL[slot]} tooltip`}>
        <p className="mechanic">
          {tip.mechanic}
          {tip.retuned && <span className="badge">retuned</span>}
        </p>
        {numbers.length > 0 && (
          <dl className="numbers">
            {numbers.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>
                  {item.value}
                  {item.unit && <small>{item.unit}</small>}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <ul className="lines">
          {tip.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <label className="swap">
        <span>
          Mechanic <small>{near.length + library.length + 1} in the library</small>
        </span>
        <select aria-label={`${SLOT_LABEL[slot]} mechanic`} value={spec.templateId} onChange={(e) => onSwap(slot, e.target.value)}>
          <option value={spec.templateId}>{template.name}</option>
          {near.length > 0 && (
            <optgroup label="Closest to your words">
              {near.map((alt) => (
                <option key={alt.id} value={alt.id}>
                  {alt.name}
                </option>
              ))}
            </optgroup>
          )}
          {groups.map((g) => (
            <optgroup key={g.family} label={FAMILY_LABEL[g.family]}>
              {g.items.map((alt) => (
                <option key={alt.id} value={alt.id}>
                  {alt.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <textarea className="flavour" aria-label={`${SLOT_LABEL[slot]} description`} value={flavour} placeholder="Describe it in your own words" maxLength={280} rows={2} onChange={(e) => setFlavour(e.target.value)} onBlur={commitFlavour} />
      {pending !== undefined && (
        <div className="confirm" role="alertdialog" aria-label="Replace mechanic">
          <p>You picked this mechanic by hand. Replace it to match the new description?</p>
          <div className="row">
            <button className="btn sm primary" onClick={() => { onEdit(slot, { flavour: pending }, true); setPending(undefined) }}>Replace</button>
            <button className="btn sm ghost" onClick={() => { onEdit(slot, { flavour: pending }); setPending(undefined) }}>Keep mechanic</button>
          </div>
        </div>
      )}
      <input className="visual" aria-label={`${SLOT_LABEL[slot]} visuals`} value={spec.visual} placeholder="Look: animation, aura, effects" maxLength={200} onChange={(e) => onEdit(slot, { visual: e.target.value })} />
      {onLook && (
        <>
          <SkillLookRow slot={slot} look={look} kind={template.delivery.kind} onLook={(change) => onLook(slot, change)} />
          {transformOf(template) && <FormCard build={build} look={look} onSwap={(id) => onSwap(slot, id)} onLook={(change) => onLook(slot, change)} />}
        </>
      )}
    </article>
  )
}
