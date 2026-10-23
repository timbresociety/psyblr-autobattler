import type { BuildRecord } from '../api'
import { shortName } from '../arena/hud/format'
import { heroHue } from '../common/hero-look'
import { HeroPortrait } from '../common/portrait'
import { RoleIcon, roleName } from '../common/RoleIcon'

/** Every hero this device has built or added, as a row of portraits; "New hero" starts a blank one. */
export function Loadout({ builds, activeId, onOpen, onNew }: { builds: BuildRecord[]; activeId?: string; onOpen: (record: BuildRecord) => void; onNew?: () => void }) {
  if (!builds.length && !onNew) return null
  return (
    <section className="roster" aria-label="Your loadout">
      {builds.length > 0 && <h2 className="roster-title">Your heroes</h2>}
      <ul>
        {builds.map((record) => {
          const { heroName, roleId } = record.build
          return (
            <li key={record.id}>
              <button className={`hero-chip role-${roleId}${record.id === activeId ? ' active' : ''}`} aria-pressed={record.id === activeId} aria-label={`${heroName}, ${roleName(roleId)}`} title={heroName} onClick={() => onOpen(record)}>
                <HeroPortrait hero={{ key: `creator:${heroName}:${roleId}`, heroName, roleId, hue: heroHue(heroName) }} />
                <span className="hero-chip-text">
                  <b>{shortName(heroName)}</b>
                  <small>
                    <RoleIcon role={roleId} />
                    {roleName(roleId)}
                  </small>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {onNew && (
        <button className="btn sm ghost new-hero" onClick={onNew}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
          </svg>
          New hero
        </button>
      )}
    </section>
  )
}
