import type { BuildRecord } from '../api'

/** Every hero this device has built or added. */
export function Loadout({ builds, activeId, onOpen }: { builds: BuildRecord[]; activeId?: string; onOpen: (record: BuildRecord) => void }) {
  if (!builds.length) return null
  return (
    <section className="panel loadout" aria-label="Your loadout">
      <h2>Your loadout</h2>
      <ul>
        {builds.map((record) => (
          <li key={record.id}>
            <button className={record.id === activeId ? 'active' : ''} onClick={() => onOpen(record)}>
              {record.build.heroName} <small>{record.build.roleId}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
