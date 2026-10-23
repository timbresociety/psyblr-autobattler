import { memo, type ReactNode } from 'react'
import { getRole } from '../../charter/roles'
import type { RoleId } from '../../charter/types'

/** Role marks on the same 24 px grid as the HUD's ability icons; colour comes from the badge (`role-<id>`). */
const ART: Record<RoleId, ReactNode> = {
  tank: (
    <>
      <path d="M12 2 20.5 5.2v6.1c0 5.3-3.6 9.2-8.5 10.7-4.9-1.5-8.5-5.4-8.5-10.7V5.2z" />
      <path d="M7 10.2h10" stroke="#000" strokeOpacity=".35" strokeWidth="2.2" />
    </>
  ),
  fighter: (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l11 11M12.5 17.5l5-5M16 16l4 4" />
      <path d="M20 4 9 15M6.5 12.5l5 5M8 16l-4 4" />
    </g>
  ),
  assassin: (
    <>
      <path d="M12 1.8 14.6 12h-5.2z" />
      <path d="M7 12.6h10v1.8H7z" />
      <path d="M11 14.4h2v5.2h-2z" />
      <circle cx="12" cy="21" r="1.6" />
    </>
  ),
  mage: (
    <>
      <path d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z" />
      <circle cx="19" cy="4.5" r="1.6" opacity=".7" />
      <circle cx="5" cy="19" r="1.2" opacity=".7" />
    </>
  ),
  marksman: (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="7" />
      <path d="M12 1.8v5M12 17.2v5M1.8 12h5M17.2 12h5" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </g>
  ),
  support: (
    <>
      <path d="M9.2 3h5.6v6.2H21v5.6h-6.2V21H9.2v-6.2H3V9.2h6.2z" />
      <path d="M10.6 4.4h1.6v6.2h-1.6z" fill="#fff" opacity=".4" />
    </>
  ),
}

export const RoleIcon = memo(function RoleIcon({ role }: { role: RoleId }) {
  return (
    <svg className="role-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" data-role={role}>
      {ART[role] ?? ART.fighter}
    </svg>
  )
})

export const roleName = (role: RoleId) => {
  try {
    return getRole(role).name
  } catch {
    return role
  }
}

/** The role as a coloured badge: icon and name. */
export function RoleBadge({ role, className = '' }: { role: RoleId; className?: string }) {
  return (
    <span className={`role-badge role-${role} ${className}`}>
      <RoleIcon role={role} />
      {roleName(role)}
    </span>
  )
}
