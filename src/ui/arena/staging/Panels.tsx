import { DIVERSITY_MIN, STACK_THRESHOLD, TEAM_BONUS, describeSynergy } from '../../../charter/synergy'
import { BUILD_SLOTS, type Build } from '../../../charter/build'
import { ROLES, getRole } from '../../../charter/roles'
import { SIZES } from '../../../charter/sizes'
import { deriveSheet } from '../../../charter/stats'
import { getTemplate } from '../../../charter/templates/catalog'
import { renderTooltip } from '../../../charter/tooltip'
import { LOCOMOTION_HINT } from '../../../charter/locomotion'
import type { RoleId } from '../../../charter/types'
import { RoleBadge, RoleIcon } from '../../common/RoleIcon'
import { headline } from '../../common/skill-numbers'
import { SkillIcon } from '../../common/SkillIcon'
import { SLOT_LABEL } from '../../creator/labels'
import { FACTION_NAME } from './presets'
import type { LoadoutEntry } from './loadout'

/** The left panel (R4): the army's synergies, lit as the deployed heroes meet them. Used in the match HUD too. */
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

/**
 * Staging's army panel (R4): every role with its count, the mixed-army bonus as pips toward its four roles, and a
 * warning on any role stacked past the threshold.
 */
export function ArmyPanel({ builds, title }: { builds: Build[]; title: string }) {
  const s = describeSynergy(builds)
  const counts = new Map<RoleId, number>()
  for (const b of builds) counts.set(b.roleId, (counts.get(b.roleId) ?? 0) + 1)
  return (
    <section className="stage-card army" aria-label="Synergies">
      <h3 className="card-title">{title}</h3>
      <div className={`bonus${s.teamBonus ? ' lit' : ''}`}>
        <div className="bonus-pips" aria-hidden="true">
          {Array.from({ length: DIVERSITY_MIN }, (_, i) => (
            <i key={i} className={i < s.distinctRoles ? 'on' : ''} />
          ))}
        </div>
        <p className={s.teamBonus ? 'lit' : ''} data-testid="team-bonus">
          {s.teamBonus ? `Mixed army: ${s.distinctRoles} roles · +${Math.round(TEAM_BONUS * 100)}% damage active` : `Mixed army: ${s.distinctRoles} of ${DIVERSITY_MIN} roles · +${Math.round(TEAM_BONUS * 100)}% damage when met`}
        </p>
      </div>
      <ul className="role-counts">
        {ROLES.map((role) => {
          const n = counts.get(role.id) ?? 0
          const penalty = s.penalties.find((p) => p.role === role.id)
          return (
            <li key={role.id} className={`role-${role.id}${n ? '' : ' none'}${penalty ? ' warn' : ''}`}>
              <RoleIcon role={role.id} />
              <span className="role-line">
                {role.name} ×{n}
                {penalty ? ` · stacked past ${STACK_THRESHOLD}: power ×${penalty.scale.toFixed(2)}` : ''}
              </span>
              <span className="role-pips" aria-hidden="true">
                {Array.from({ length: Math.min(n, 10) }, (_, i) => (
                  <i key={i} className={i >= STACK_THRESHOLD ? 'over' : ''} />
                ))}
              </span>
            </li>
          )
        })}
      </ul>
      <p className="card-foot">
        {DIVERSITY_MIN} different roles light the bonus. More than {STACK_THRESHOLD} of one role weaken each other.
      </p>
    </section>
  )
}

/** The right panel (R5): the selected hero, its numbers and its kit with real numbers. */
export function DetailsPanel({ build, entry, portrait, view3d = false }: { build?: Build; entry?: LoadoutEntry; portrait?: string; view3d?: boolean }) {
  if (!build)
    return (
      <section className="stage-card details is-empty" aria-label="Hero details">
        <h3 className="card-title">Hero details</h3>
        <p className="muted">Select or drag a hero to see its details.</p>
        <ul className="how-to">
          <li>
            <b>Place</b> Pick a hero in the row, then click spots on your half. Or drag it onto the board.
          </li>
          <li>
            <b>Move</b> Drag a hero on the board. Drag it off the board to send it back.
          </li>
          {view3d && (
            <li>
              <b>View</b> Right-drag or Shift-drag turns the arena. Scroll zooms in where you point.
            </li>
          )}
          <li>
            <b>Remove</b> Select it on the board and press Delete.
          </li>
          <li>
            <b>Keys</b> The numbers are the keys 1 to 0 that take a hero over in the fight.
          </li>
        </ul>
      </section>
    )
  const role = getRole(build.roleId)
  const sheet = deriveSheet(role, build.spread, build.sizeClass).sheet
  return (
    <section className="stage-card details" aria-label="Hero details">
      <header className="details-head">
        <span className={`portrait role-${build.roleId}`} aria-hidden="true">
          {portrait ? <img src={portrait} alt="" draggable={false} /> : <span className="portrait-initials">{build.heroName.slice(0, 1)}</span>}
        </span>
        <div className="details-who">
          <h3>{build.heroName}</h3>
          <div className="details-tags">
            <RoleBadge role={build.roleId} />
            {entry?.faction && <small>{FACTION_NAME[entry.faction]}</small>}
            {entry && !entry.faction && <small>{entry.pkg ? 'Forged' : 'Your hero'}</small>}
          </div>
        </div>
      </header>
      <dl className="details-facts">
        <div>
          <dt>Health</dt>
          <dd>{Math.round(sheet.maxHealth)}</dd>
        </div>
        <div title={LOCOMOTION_HINT}>
          <dt>Locomotion</dt>
          <dd>
            {sheet.moveSpeed.toFixed(1)}
            <small>m/s</small>
          </dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{SIZES[build.sizeClass ?? 'medium'].label}</dd>
        </div>
      </dl>
      <ul className="details-kit">
        {BUILD_SLOTS.map((slot) => {
          const spec = build.slots[slot]
          const template = getTemplate(spec.templateId)
          const tip = renderTooltip(template, spec, sheet, spec.retuneSteps)
          const numbers = headline(template, sheet, spec.retuneSteps)
          return (
            <li key={slot}>
              <SkillIcon template={template} slot={slot} size="sm" />
              <div className="kit-text">
                <span className="kit-slot">{SLOT_LABEL[slot]}</span>
                <strong>
                  {tip.title}
                  {tip.title !== tip.mechanic && <small> · {tip.mechanic}</small>}
                </strong>
                {numbers.length > 0 && (
                  <span className="kit-numbers">
                    {numbers.map((item) => (
                      <span key={item.label}>
                        <b>
                          {item.value}
                          {item.unit && <small>{item.unit}</small>}
                        </b>{' '}
                        {item.label.toLowerCase()}
                      </span>
                    ))}
                  </span>
                )}
                <span className="kit-lines">{tip.lines.join(' · ')}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
