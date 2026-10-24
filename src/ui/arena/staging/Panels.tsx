import type { ReactNode } from 'react'
import { TRAITS, TRAIT_TIERS, armyTraits, heroMods, roleCounts, traitTier, type Trait } from '../../../charter/traits'
import { BUILD_SLOTS, type Build } from '../../../charter/build'
import { getRole } from '../../../charter/roles'
import { SIZES } from '../../../charter/sizes'
import { ATTRIBUTES, POOL_SIZE } from '../../../charter/stats'
import { getTemplate } from '../../../charter/templates/catalog'
import { renderTooltip } from '../../../charter/tooltip'
import { LOCOMOTION_HINT } from '../../../charter/locomotion'
import type { RoleId } from '../../../charter/types'
import { heroStats } from '../../common/hero-stats'
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

const ATTR_LABEL: Record<(typeof ATTRIBUTES)[number], string> = { strength: 'Str', agility: 'Agi', intellect: 'Int' }

/** The stat icons: line drawings on a 24 grid, one idea each. */
const STAT_ICON: Record<string, ReactNode> = {
  attack: <path d="M5 19l9-9M14 4l6 6-3 3-6-6zM4 20l2-2" />,
  rate: (
    <>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l3 2M9 3h6" />
    </>
  ),
  reach: <path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4" />,
  dps: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  spirit: <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />,
  armor: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
  resist: (
    <>
      <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />
      <path d="M12 8l1.4 3 3 .4-2.2 2 .6 3-2.8-1.6-2.8 1.6.6-3-2.2-2 3-.4z" />
    </>
  ),
  regen: <path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10zM12 9v5M9.5 11.5h5" />,
  lifesteal: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
  move: <path d="M5 18h8l2-4 4-1M7 14l3-6 4 2M13 5a1.5 1.5 0 1 0 0 .1" />,
  flight: <path d="M3 14c4-1 7-4 9-9 2 5 5 8 9 9-4 0-7 1-9 5-2-4-5-5-9-5z" />,
  cooldown: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2" />,
}

/** One stat on the hero card: its icon, its name, its value, and a line of context. */
function Stat({ icon, label, value, unit, sub, tip }: { icon: string; label: string; value: string; unit?: string; sub?: string; tip?: string }) {
  return (
    <div className={`stat-tile stat-${icon}`} title={tip}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {STAT_ICON[icon]}
        </g>
      </svg>
      <span className="stat-label">{label}</span>
      <b className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </b>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

/** The right panel (R5): the selected hero, its numbers and its kit with real numbers. */
export function DetailsPanel({ build, entry, portrait, view3d = false, army = [] }: { build?: Build; entry?: LoadoutEntry; portrait?: string; view3d?: boolean; army?: Build[] }) {
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
  // the card shows what the hero fights with on this side: its role's trait in this army, and its numbers with the
  // traits it would get here (a hero not yet deployed shows its own)
  const traits = armyTraits(army)
  const fielded = army.includes(build)
  const stats = heroStats(build, fielded ? heroMods(build, traits) : {})
  const sheet = stats.sheet
  const trait = TRAITS[build.roleId]
  const count = roleCounts(army).get(build.roleId) ?? 0
  const tier = traitTier(count)
  const next = TRAIT_TIERS.find((t) => t > count)
  const n = (v: number, digits = 0) => (Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(digits).replace(/\.0+$/, ''))
  return (
    <section className="stage-card details hero-card" aria-label="Hero details">
      <header className="details-head">
        <span className={`portrait role-${build.roleId}`} aria-hidden="true">
          {portrait ? <img src={portrait} alt="" draggable={false} /> : <span className="portrait-initials">{build.heroName.slice(0, 1)}</span>}
        </span>
        <div className="details-who">
          <h3>{build.heroName}</h3>
          <div className="details-tags">
            <RoleBadge role={build.roleId} />
            <small>{SIZES[build.sizeClass ?? 'medium'].label}</small>
            {entry?.faction && <small>{FACTION_NAME[entry.faction]}</small>}
            {entry && !entry.faction && <small>{entry.pkg ? 'Forged' : 'Your hero'}</small>}
          </div>
        </div>
      </header>
      <p className={`trait-chip role-${build.roleId} tier-${tier}`} title={`${trait.name}: ${trait.blurb}. ${trait.tiers.map((t, i) => `${TRAIT_TIERS[i]}: ${t.text}`).join('. ')}`}>
        <span className={`trait-badge sm role-${build.roleId} tier-${tier}`} aria-hidden="true">
          <RoleIcon role={build.roleId} />
        </span>
        <b>{trait.name}</b>
        <span className="trait-count">
          {count}
          {next ? `/${next}` : ''}
        </span>
        <em>{tier >= 0 ? trait.tiers[tier].text : `${(next ?? 0) - count} more to light it`}</em>
      </p>
      <div className="hp-bar" title="Health, a notch every 250">
        <i style={{ ['--seg' as string]: `${(250 / Math.max(250, stats.health)) * 100}%` }} />
        <span>
          <b>{Math.round(stats.health)}</b> health
        </span>
      </div>
      <div className="card-stats" aria-label="Stats">
        <Stat icon="attack" label="Attack" value={n(stats.perHit)} unit={stats.damageType === 'spirit' ? ' spirit' : ''} tip={`Basic attack damage per hit (${stats.damageType})`} />
        <Stat icon="rate" label={stats.ranged ? 'Fire rate' : 'Atk speed'} value={n(stats.rate, 2)} unit="/s" tip={stats.ranged ? `Fire rate: shots a second, ${n(stats.ammo)} to a magazine` : 'Attack speed: swings a second'} />
        <Stat icon="reach" label="Range" value={n(stats.reach, 1)} unit="m" tip={stats.ranged ? 'How far its shots travel' : 'How far its swing reaches, body and size included'} />
        <Stat icon="dps" label="DPS" value={n(stats.dps)} tip="Basic attack damage a second, before resist" />
        <Stat icon="spirit" label="Spirit" value={n(stats.spiritPower)} tip="Spirit power: scales spells, heals and shields" />
        <Stat icon="armor" label="Armor" value={n(stats.armor)} sub={`${n(stats.armorCut)}% less`} tip="Takes this much off physical damage" />
        <Stat icon="resist" label="Spirit res" value={n(stats.spiritResist)} sub={`${n(stats.spiritCut)}% less`} tip="Spirit resist: takes this much off spirit damage" />
        <Stat icon="regen" label="Regen" value={n(stats.regen, 1)} unit="/s" tip="Health back every second" />
        <Stat icon="lifesteal" label="Lifesteal" value={n(stats.lifesteal, 1)} unit="%" tip="Of its damage it heals back" />
        <Stat icon="move" label="Move" value={n(stats.move, 1)} unit="m/s" tip={LOCOMOTION_HINT} />
        <Stat icon="flight" label="Flight" value={n(stats.flight, 1)} unit="m/s" tip="Flight speed; flying drains the flight meter" />
        <Stat icon="cooldown" label="Cooldowns" value={`−${n(stats.cooldownCut)}`} unit="%" tip="Cooldown reduction, capped at 40%" />
      </div>
      <div className="card-attrs" aria-label="Attribute split">
        {ATTRIBUTES.map((a) => (
          <div key={a} className={`attr attr-${a}`} title={`${build.spread[a]} of ${role.attributeCaps[a]} points (${POOL_SIZE} to spend)`}>
            <span>{ATTR_LABEL[a]}</span>
            <i style={{ ['--v' as string]: `${(build.spread[a] / Math.max(1, role.attributeCaps[a])) * 100}%` }} />
            <b>{build.spread[a]}</b>
          </div>
        ))}
      </div>
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
