import { memo, useEffect, useState, type CSSProperties } from 'react'
import type { HudController } from './controller'
import { AbilityIcon } from './icons'
import { KILL_FEED_MAX, KILL_FEED_SECONDS, createKillTracker, type Kill } from './kills'
import type { HudHeroInfo } from './model'
import { Portrait } from './parts'

const KillRow = memo(function KillRow({ kill, heroes }: { kill: Kill; heroes: readonly HudHeroInfo[] }) {
  const victim = heroes[kill.victim]
  const killer = kill.killer !== undefined ? heroes[kill.killer] : undefined
  if (!victim) return null
  const how = killer && kill.slot ? killer.skills[kill.slot] : undefined
  return (
    <li className={`hud-kill team-${killer?.team ?? victim.team}${kill.byStreamer ? ' mine' : ''}${kill.heavy ? ' heavy' : ''}`}>
      {killer && (
        <span className={`hud-kill-who team-${killer.team}`}>
          <Portrait src={killer.portrait} initials={killer.initials} team={killer.team} />
          <span className="hud-kill-name">{killer.short}</span>
        </span>
      )}
      <span className="hud-kill-how" title={how?.name}>
        {how ? <AbilityIcon icon={how.icon} /> : <i className="hud-kill-x" aria-hidden="true" />}
        <span className="hud-sr">{killer ? ' eliminated ' : ' '}</span>
      </span>
      <span className={`hud-kill-who victim team-${victim.team}`}>
        <Portrait src={victim.portrait} initials={victim.initials} team={victim.team} />
        <span className="hud-kill-name">{victim.short}</span>
      </span>
      {!killer && <span className="hud-sr"> fell</span>}
    </li>
  )
})

/** Top right (R38): who took down whom, newest at the bottom; each entry fades out after five seconds. */
export function KillFeed({ controller, heroes }: { controller: Pick<HudController, 'hooks' | 'arena'>; heroes: readonly HudHeroInfo[] }) {
  const [kills, setKills] = useState<Kill[]>([])
  useEffect(() => {
    const tracker = createKillTracker()
    const timers = new Set<number>()
    const off = controller.hooks.on('events', (events) => {
      const found = tracker.read(events, controller.arena.match.human)
      if (!found.length) return
      setKills((k) => [...k, ...found].slice(-KILL_FEED_MAX))
      for (const f of found) {
        const t = window.setTimeout(() => {
          timers.delete(t)
          setKills((k) => k.filter((x) => x.id !== f.id))
        }, KILL_FEED_SECONDS * 1000)
        timers.add(t)
      }
    })
    return () => {
      off()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [controller])
  return (
    <ol className="hud-killfeed" aria-label="Kill feed" aria-live="polite" style={{ '--kill-life': `${KILL_FEED_SECONDS}s` } as CSSProperties}>
      {kills.map((k) => (
        <KillRow key={k.id} kill={k} heroes={heroes} />
      ))}
    </ol>
  )
}
