import { useRef, type KeyboardEvent } from 'react'
import { ROLES, getRole } from '../../charter/roles'
import type { RoleId } from '../../charter/types'
import { RoleIcon } from '../common/RoleIcon'

/**
 * Roles are standard and engine-assigned; the player can change how the hero fights (R9, R10). One tile per role, a
 * radio group: arrow keys move between roles.
 */
export function RoleSwitcher({ roleId, onChange }: { roleId: RoleId; onChange: (role: RoleId) => void }) {
  const group = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const i = ROLES.findIndex((r) => r.id === roleId)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = ROLES[(i + step + ROLES.length) % ROLES.length].id
    onChange(next)
    group.current?.querySelector<HTMLButtonElement>(`[data-role-id="${next}"]`)?.focus()
  }
  return (
    <div className="role-switch">
      <div className="role-picker" role="radiogroup" aria-label="Role" ref={group} onKeyDown={onKeyDown}>
        {ROLES.map((r) => {
          const on = r.id === roleId
          return (
            <button key={r.id} type="button" role="radio" aria-checked={on} data-role-id={r.id} tabIndex={on ? 0 : -1} className={`role-tile role-${r.id}${on ? ' on' : ''}`} onClick={() => !on && onChange(r.id)}>
              <RoleIcon role={r.id} />
              <span>{r.name}</span>
            </button>
          )
        })}
      </div>
      <p className="role-desc">{getRole(roleId).description}</p>
    </div>
  )
}
