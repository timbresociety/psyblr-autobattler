import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import type { HudHero, HudState } from '../../../arena/client/match-view'
import { createStore } from '../../../arena/client/store'
import { capsule, type Team } from '../../../arena/engine/state'
import { getRole } from '../../../charter/roles'
import type { HudController } from './controller'
import { segmentSize } from './format'
import { createKillTracker } from './kills'
import { CARD_SLOTS, SLOT_KEY, type HudHeroInfo } from './model'
import { AbilityChip, HpBar, Portrait } from './parts'
import { project, screenPoint, stickyTarget } from './world'
import { inReach } from '../../../arena/client/range'

/**
 * The HUD while the streamer steers a hero (R14, R42): an Overwatch-style health block bottom left, the ability
 * cluster bottom right, a crosshair that kicks on the hero's own hits, and a frame for the enemy under the crosshair.
 */

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

/** The reticle. Hits land from the event hook and show on the next frame by swapping between two identical animations. */
export function Crosshair({ controller }: { controller?: Pick<HudController, 'hooks' | 'arena'> }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!controller) return
    const kills = createKillTracker()
    // 0 nothing, 1 a hit, 2 a heavy hit, 3 a kill
    let level = 0
    let flip = false
    const offEvents = controller.hooks.on('events', (events) => {
      const me = controller.arena.match.human
      const fallen = kills.read(events, me)
      if (me === undefined) return
      for (const e of events) if (e.type === 'hit' && e.source === me) level = Math.max(level, e.heavy ? 2 : 1)
      if (fallen.some((k) => k.byStreamer)) level = 3
    })
    // gold while an enemy stands where the next basic attack would land (the floor ring agrees)
    let lit = false
    const offFrame = controller.hooks.on('frame', () => {
      const el = ref.current
      if (!el) return
      const { match, setups } = controller.arena
      const me = match.human !== undefined ? match.heroes[match.human] : undefined
      const ready = !!me?.alive && !!me.position && !!setups?.[me.id]?.kit?.basic
      const on = ready && !!inReach(match, setups, me!, me!.yaw, me!.pitch)
      if (on !== lit) el.classList.toggle('in-range', (lit = on))
      if (!level) return
      flip = !flip
      el.classList.remove('kick-a', 'kick-b', 'heavy', 'kill')
      el.classList.add(flip ? 'kick-a' : 'kick-b')
      if (level === 2) el.classList.add('heavy')
      if (level === 3) el.classList.add('kill')
      level = 0
    })
    return () => (offEvents(), offFrame())
  }, [controller])
  return (
    <div ref={ref} className="hud-crosshair" aria-hidden="true">
      <i className="hud-ch-dot" />
      <span className="hud-ch-ticks">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="hud-hitmark">
        <i />
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}

/** Health as Overwatch draws it: big numbers, then one block per 250 health; shields add white blocks on the end. */
export function HealthBlock({ hero, info, shield }: { hero: HudHero; info: HudHeroInfo; shield: number }) {
  const seg = segmentSize(hero.maxHp)
  const blocks: { grow: number; fill: number; shield?: boolean }[] = []
  const count = Math.max(1, Math.ceil(hero.maxHp / seg - 1e-9))
  for (let i = 0; i < count; i++) {
    const lo = i * seg
    const hi = Math.min(hero.maxHp, lo + seg)
    blocks.push({ grow: (hi - lo) / seg, fill: clamp01((hero.hp - lo) / Math.max(1e-6, hi - lo)) })
  }
  for (let i = 0; i < Math.min(6, Math.ceil(shield / seg - 1e-9)); i++) blocks.push({ grow: Math.min(1, (shield - i * seg) / seg), fill: 1, shield: true })
  const low = hero.hp / hero.maxHp < 0.3
  return (
    <div className={`hud-health team-${hero.team}${low ? ' low' : ''}`}>
      <Portrait src={info.portrait} initials={info.initials} team={hero.team} className="big" />
      <div className="hud-health-main">
        <span className="hud-health-name">
          {info.short}
          <small>{getRole(info.role).name}</small>
        </span>
        <span className="hud-health-num">
          <b>{Math.ceil(Math.max(0, hero.hp))}</b>
          <small>/ {Math.round(hero.maxHp)}</small>
          {shield >= 1 && <em>+{Math.round(shield)}</em>}
        </span>
        <span className="hud-blocks" role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={Math.round(hero.maxHp)} aria-valuenow={Math.ceil(Math.max(0, hero.hp))}>
          {blocks.map((b, i) => (
            <i key={i} className={`hud-block${b.shield ? ' sh' : ''}${b.fill <= 0 ? ' empty' : ''}`} style={{ flexGrow: b.grow, '--f': b.fill.toFixed(3) } as CSSProperties} />
          ))}
        </span>
        <span className="hud-health-hint">
          <kbd>Tab</kbd> hands back · <kbd>Esc</kbd> frees the mouse · <kbd>Space</kbd> flies
        </span>
      </div>
    </div>
  )
}

const CLUSTER = ['basic', 'movement', 'active1', 'active2'] as const

/** Bottom right: basic, movement and both actives with their keys, then the ultimate as a ring of its own. */
export function AbilityCluster({ hero, info }: { hero: HudHero; info: HudHeroInfo }) {
  const ult = info.skills.ultimate
  const ultLeft = hero.cooldowns.ultimate?.left ?? 0
  return (
    <div className={`hud-cluster team-${hero.team}`}>
      <span className="hud-cluster-row">
        {CLUSTER.map((s) => (
          <AbilityChip key={s} skill={info.skills[s]} left={hero.cooldowns[s]?.left ?? 0} total={hero.cooldowns[s]?.total} keyLabel={SLOT_KEY[s]} size="md" />
        ))}
      </span>
      <span className={`hud-ult${ultLeft > 0.05 ? '' : ' ready'}`}>
        <AbilityChip skill={ult} left={ultLeft} total={hero.cooldowns.ultimate?.total} keyLabel="R" size="lg" />
        <span className="hud-ult-name">{ultLeft > 0.05 ? ult.name : 'Ultimate ready'}</span>
      </span>
    </div>
  )
}

/**
 * Which enemy the crosshair is on, worked out each frame from projected positions and handed to React through a
 * store that speaks at most ten times a second, and only when the answer changes.
 */
function useAimTarget(controller: HudController | undefined, ids: readonly number[]) {
  const store = useMemo(() => createStore<number | undefined>(undefined, 10), [])
  useEffect(() => {
    if (!controller) return
    const points = controller.arena.match.heroes.map(screenPoint)
    let current: number | undefined
    const off = controller.hooks.on('frame', () => {
      const { camera } = controller
      const { match } = controller.arena
      const drawn = controller.positions()
      camera.updateMatrixWorld()
      // only proportions matter here, so a virtual 1000 px tall screen avoids reading the layout every frame
      const h = 1000
      const w = h * (camera.aspect || 1)
      for (const i of ids) {
        const hero = match.heroes[i]
        const at = drawn[i]
        const p = points[i]
        if (!p) continue
        if (!hero?.alive || !at) p.visible = false
        else project(camera, at.x, at.y + capsule(hero).height * 0.55, at.z, w, h, p, 0)
      }
      current = stickyTarget(points, ids, current, w, h)
      store.set(current)
    })
    return () => {
      off()
      store.set(undefined)
      store.flush()
    }
  }, [controller, ids, store])
  return useSyncExternalStore(store.subscribe, store.get)
}

/** Top centre under the banner: the enemy under the crosshair, its health and what it has ready. */
export function TargetFrame({ controller, state, heroes, team }: { controller?: HudController; state: HudState; heroes: readonly HudHeroInfo[]; team: Team }) {
  const enemies = useMemo(() => heroes.filter((h) => h.team !== team).map((h) => h.id), [heroes, team])
  const target = useAimTarget(controller, enemies)
  const hero = target !== undefined ? state.heroes[target] : undefined
  const info = target !== undefined ? heroes[target] : undefined
  if (!hero?.alive || !info) return null
  const shield = controller?.arena.match.heroes[hero.id]?.shield ?? 0
  return (
    <section className={`hud-target team-${hero.team}`} aria-label="Target">
      <Portrait src={info.portrait} initials={info.initials} team={hero.team} />
      <span className="hud-target-main">
        <span className="hud-target-top">
          <span className="hud-target-name">{info.short}</span>
          <span className="hud-target-role">{getRole(info.role).name}</span>
          <span className="hud-target-num">
            <b>{Math.ceil(hero.hp)}</b> / {Math.round(hero.maxHp)}
          </span>
        </span>
        <HpBar hp={hero.hp} maxHp={hero.maxHp} shield={shield} />
      </span>
      <span className="hud-abs">
        {CARD_SLOTS.map((s) => (
          <AbilityChip key={s} skill={info.skills[s]} left={hero.cooldowns[s]?.left ?? 0} total={hero.cooldowns[s]?.total} keyLabel={SLOT_KEY[s]} size="sm" />
        ))}
      </span>
    </section>
  )
}

/**
 * Under the reticle: the flight meter while it is in use (flying costs it, landing refills it), and whatever is on
 * the hero right now, so a silence or a root is never a mystery.
 */
export function SelfStatus({ hero }: { hero: HudHero }) {
  const flight = hero.flight ?? 1
  const showMeter = hero.airborne || flight < 0.995
  const statuses = hero.statuses ?? []
  if (!showMeter && !statuses.length) return null
  return (
    <div className="hud-self" aria-live="polite">
      {statuses.length > 0 && (
        <span className="hud-self-status">
          {statuses.map((s) => (
            <i key={s.key} className={`hud-oh-chip tone-${s.tone}`}>
              {s.label}
            </i>
          ))}
        </span>
      )}
      {showMeter && (
        <span className={`hud-flight${flight < 0.12 ? ' low' : ''}`} role="meter" aria-label="Flight" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(flight * 100)}>
          <i style={{ transform: `scaleX(${flight.toFixed(3)})` }} />
          <small>Flight</small>
        </span>
      )}
    </div>
  )
}
