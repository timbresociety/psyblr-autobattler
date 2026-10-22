import { ROLES, getRole } from '../../charter/roles'
import type { RoleId } from '../../charter/types'

/** Roles are standard and engine-assigned; the player can change how the hero fights (R9, R10). */
export function RoleSwitcher({ roleId, onChange }: { roleId: RoleId; onChange: (role: RoleId) => void }) {
  return (
    <label className="role">
      <span>Role</span>
      <select aria-label="Role" value={roleId} onChange={(e) => onChange(e.target.value as RoleId)}>
        {ROLES.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <small>{getRole(roleId).description}</small>
    </label>
  )
}
