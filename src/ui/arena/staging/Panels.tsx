import { DIVERSITY_MIN, STACK_THRESHOLD, TEAM_BONUS, describeSynergy } from '../../../charter/synergy'
import { BUILD_SLOTS, type Build } from '../../../charter/build'
import { getRole } from '../../../charter/roles'
import { SIZES } from '../../../charter/sizes'
import { deriveSheet } from '../../../charter/stats'
import { getTemplate } from '../../../charter/templates/catalog'
import { renderTooltip } from '../../../charter/tooltip'
import { LOCOMOTION_HINT } from '../../../charter/locomotion'
import { SLOT_LABEL } from '../../creator/labels'

/** The left panel (R4): the army's synergies, lit as the deployed heroes meet them. */
export function SynergyPanel({ builds }: { builds: Build[] }) {
  const s = describeSynergy(builds)
  const counts = new Map<string, number>()
  for (const b of builds) counts.set(b.roleId, (counts.get(b.roleId) ?? 0) + 1)
  return (
    <section className="arena-panel synergy" aria-label="Synergies">
      <h3>Synergies</h3>
      <p className={s.teamBonus ? 'lit' : ''} data-testid="team-bonus">
        Mixed army: {s.distinctRoles} of {DIVERSITY_MIN} roles · +{Math.round(TEAM_BONUS * 100)}% damage {s.teamBonus ? 'active' : 'when met'}
      </p>
      <ul>
        {[...counts].map(([role, n]) => {
          const penalty = s.penalties.find((p) => p.role === role)
          return (
            <li key={role} className={penalty ? 'warn' : n > 1 ? 'lit' : ''}>
              {getRole(role as Build['roleId']).name} ×{n}
              {penalty ? ` · stacked past ${STACK_THRESHOLD}: power ×${penalty.scale.toFixed(2)}` : ''}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** The right panel (R5): the selected hero's details and its skills' real numbers. */
export function DetailsPanel({ build }: { build?: Build }) {
  if (!build) return <section className="arena-panel details" aria-label="Hero details"><p className="muted">Select or drag a hero to see its details.</p></section>
  const role = getRole(build.roleId)
  const sheet = deriveSheet(role, build.spread, build.sizeClass).sheet
  return (
    <section className="arena-panel details" aria-label="Hero details">
      <h3>{build.heroName}</h3>
      <p className="muted">
        {role.name} · {SIZES[build.sizeClass ?? 'medium'].label} · {Math.round(sheet.maxHealth)} health ·{' '}
        <span title={LOCOMOTION_HINT}>locomotion {sheet.moveSpeed.toFixed(1)}</span>
      </p>
      <ul className="skills">
        {BUILD_SLOTS.map((slot) => {
          const spec = build.slots[slot]
          const tip = renderTooltip(getTemplate(spec.templateId), spec, sheet, spec.retuneSteps)
          return (
            <li key={slot}>
              <strong>
                {SLOT_LABEL[slot]}: {tip.title}
              </strong>
              <span>{tip.lines.join(' · ')}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
