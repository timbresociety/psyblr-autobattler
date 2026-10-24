import { TRAIT_TIERS, armyTraits, type Trait } from '../../../charter/traits'
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
import { SLOT_LABEL } from '../../forge/labels'
import { FACTION_NAME } from './presets'
import type { LoadoutEntry } from './loadout'

/** A trait's tiers in one line each, for its tooltip. */
const tierLines = (trait: Trait) => trait.tiers.map((t, i) => `${TRAIT_TIERS[i]}: ${t.text}`).join('\n')

/**
 * Role synergies, the way TFT shows traits: every role the army fields, its badge coloured by the tier it has lit, a
 * 2 · 4 · 6 track, and what the lit tier does (or how many more heroes light the first). Staging's left panel, and
 * the panel the match HUD opens; `compact` is the HUD's version.
 */
export function TraitPanel({ builds, title, compact = false }: { builds: Build[]; title?: string; compact?: boolean }) {
  const traits = armyTraits(builds)
  return (
    <section className={compact ? 'arena-panel traits compact' : 'stage-card army traits'} aria-label="Synergies">
      {title && <h3 className="card-title">{title}</h3>}
      {traits.length === 0 ? (
        <p className="muted trait-empty">Deploy heroes and their roles light up here.</p>
      ) : (
        <ul className="trait-list">
          {traits.map(({ trait, count, tier }) => (
            <li key={trait.role} className={`trait role-${trait.role} tier-${tier}`} title={`${trait.name}: ${trait.blurb}\n${tierLines(trait)}`}>
              <span className="trait-badge" aria-hidden="true">
                <RoleIcon role={trait.role} />
              </span>
              <span className="trait-name">
                {trait.name}
                <small>{getRole(trait.role).name}</small>
              </span>
              <span className="trait-track" aria-label={`${count} of ${TRAIT_TIERS.join(', ')}`}>
                {TRAIT_TIERS.map((need) => (
                  <b key={need} className={count >= need ? 'on' : ''}>
                    {need}
                  </b>
                ))}
              </span>
              <p className="trait-effect">{tier >= 0 ? trait.tiers[tier].text : `${TRAIT_TIERS[0] - count} more to light it: ${trait.tiers[0].text}`}</p>
            </li>
          ))}
        </ul>
      )}
      {!compact && <p className="card-foot">Every role is a synergy: {TRAIT_TIERS.join(', ')} heroes of one role light its tiers. Hover one to see them all.</p>}
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
