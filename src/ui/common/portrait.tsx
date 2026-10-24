import { memo, useEffect, useReducer } from 'react'
import type { Build } from '../../charter/build.js'
import type { RoleId } from '../../charter/types.js'
import { initials } from '../arena/hud/format'
import { webglAvailable } from './hero-look'

type Busts = typeof import('../arena/staging/loadout')

/**
 * Portraits outside the arena: the same 3D busts the staging row and the HUD use, drawn by the staging module once it
 * loads (it brings three.js, so it stays out of the first screen's bundle). Until then, and without WebGL, initials.
 */

let busts: Busts | undefined
let loading: Promise<void> | undefined
const waiting = new Set<() => void>()
const notify = () => waiting.forEach((redraw) => redraw())

function load() {
  loading ??= import('../arena/staging/loadout')
    .then(async (m) => {
      busts = m
      notify()
      // a body or a photo face that finishes later redraws every portrait that showed a stand-in
      m.onCharacters(notify)
      // stand-ins draw at once; the real characters replace them when their files arrive
      if (await m.preloadBusts()) notify()
    })
    .catch(() => undefined)
}

export interface PortraitHero {
  key: string
  heroName: string
  roleId: RoleId
  hue?: number
  /** The whole build, so the bust wears the hero's own body, look and photo face. */
  build?: Build
}

export function usePortrait(hero: PortraitHero | undefined): string | undefined {
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const wanted = !!hero && webglAvailable()
  useEffect(() => {
    if (!wanted) return
    waiting.add(redraw)
    load()
    return () => {
      waiting.delete(redraw)
    }
  }, [wanted])
  if (!hero || !busts || !wanted) return undefined
  try {
    return busts.portrait(hero)
  } catch {
    return undefined
  }
}

/** A hero's face in its role colour: a reference photo when there is one, else the 3D bust, else initials. */
export const HeroPortrait = memo(function HeroPortrait({ hero, photo, className = '' }: { hero: PortraitHero; photo?: string | null; className?: string }) {
  // the offline providers' placeholder sheets are flat SVG tiles; the hero's own bust says more
  const real = photo && !photo.startsWith('data:image/svg') ? photo : undefined
  const bust = usePortrait(real ? undefined : hero)
  const src = real || bust
  return (
    <span className={`portrait role-${hero.roleId} ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <span className="portrait-initials">{initials(hero.heroName) || '?'}</span>}
    </span>
  )
})
