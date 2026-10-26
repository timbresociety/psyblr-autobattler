import { useState } from 'react'
import { swapAlternatives, type Build, type SkillText } from '../../charter/build'
import { getRole } from '../../charter/roles'
import { deriveSheet } from '../../charter/stats'
import { getTemplate } from '../../charter/templates/catalog'
import { renderTooltip } from '../../charter/tooltip'
import type { BuildSlot } from '../../charter/types'
import { SLOT_LABEL } from './labels'

interface Props {
  build: Build
  slot: BuildSlot
  onEdit: (slot: BuildSlot, text: SkillText, replace?: boolean) => { needsConfirm?: boolean }
  onSwap: (slot: BuildSlot, templateId: string) => void
}

/** One skill: the player's name, flavour and visuals on top of the engine's mechanic and its real numbers (R3, R6, R7). */
export function SkillCard({ build, slot, onEdit, onSwap }: Props) {
  const spec = build.slots[slot]
  const template = getTemplate(spec.templateId)
  const sheet = deriveSheet(getRole(build.roleId), build.spread, build.sizeClass).sheet
  const tip = renderTooltip(template, spec, sheet, spec.retuneSteps)
  const alternatives = swapAlternatives(build, slot)
  const [flavour, setFlavour] = useState(spec.flavour)
  const [pending, setPending] = useState<string | undefined>()
  const [lastSeen, setLastSeen] = useState(spec.flavour)
  if (spec.flavour !== lastSeen) {
    setLastSeen(spec.flavour)
    setFlavour(spec.flavour)
  }

  const commitFlavour = () => {
    if (flavour === spec.flavour) return
    const result = onEdit(slot, { flavour })
    if (result.needsConfirm) setPending(flavour)
  }

  return (
    <article className="panel skill" aria-label={SLOT_LABEL[slot]}>
      <header className="skill-head">
        <span className="slot">{SLOT_LABEL[slot]}</span>
        <input className="skill-name" aria-label={`${SLOT_LABEL[slot]} name`} value={spec.name} placeholder={template.name} maxLength={40} onChange={(e) => onEdit(slot, { name: e.target.value })} />
      </header>
      <textarea aria-label={`${SLOT_LABEL[slot]} description`} value={flavour} placeholder="Describe it in your own words" maxLength={280} rows={2} onChange={(e) => setFlavour(e.target.value)} onBlur={commitFlavour} />
      {pending !== undefined && (
        <div className="confirm" role="alertdialog" aria-label="Replace mechanic">
          <p>You picked this mechanic by hand. Replace it to match the new description?</p>
          <button onClick={() => { onEdit(slot, { flavour: pending }, true); setPending(undefined) }}>Replace</button>
          <button className="ghost" onClick={() => { onEdit(slot, { flavour: pending }); setPending(undefined) }}>Keep mechanic</button>
        </div>
      )}
      <input className="visual" aria-label={`${SLOT_LABEL[slot]} visuals`} value={spec.visual} placeholder="Animation, aura, effects" maxLength={200} onChange={(e) => onEdit(slot, { visual: e.target.value })} />
      <div className="tooltip" aria-label={`${SLOT_LABEL[slot]} tooltip`}>
        <p className="mechanic">
          {tip.mechanic}
          {tip.retuned && <span className="badge">retuned</span>}
        </p>
        <ul>
          {tip.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <label className="swap">
        <span>Mechanic</span>
        <select aria-label={`${SLOT_LABEL[slot]} mechanic`} value={spec.templateId} onChange={(e) => onSwap(slot, e.target.value)}>
          <option value={spec.templateId}>{template.name}</option>
          {alternatives.map((alt) => (
            <option key={alt.id} value={alt.id}>
              {alt.name}
            </option>
          ))}
        </select>
      </label>
    </article>
  )
}
