import type { HudHero } from '../../../arena/client/match-view'
import type { Team } from '../../../arena/engine/state'
import { TEAM_NAME } from './format'
import { CARD_SLOTS, SLOT_KEY, type HudHeroInfo } from './model'
import { AbilityChip, HpBar, Portrait } from './parts'

const FALLBACK_NOTE = 'This hero’s model failed to load; it fights as a stand-in.'

function Abilities({ hero, info, size }: { hero: HudHero; info: HudHeroInfo; size: 'xs' | 'sm' }) {
  return (
    <span className="hud-abs">
      {CARD_SLOTS.map((s) => (
        <AbilityChip key={s} skill={info.skills[s]} left={hero.alive ? (hero.cooldowns[s]?.left ?? 0) : 0} total={hero.cooldowns[s]?.total} keyLabel={SLOT_KEY[s]} size={size} />
      ))}
    </span>
  )
}

/** Bottom left (R38): the streamer's heroes in key order 1-0, the one being steered lifted and lit. */
/** What a roster card does on a click while watching: the camera follows that hero. */
interface Follow {
  followed?: number
  onFollow?: (id: number) => void
}

const followProps = (id: number, { onFollow }: Follow) =>
  onFollow ? { role: 'button', tabIndex: 0, onClick: () => onFollow(id), onKeyDown: (e: { key: string }) => e.key === 'Enter' && onFollow(id) } : {}

export function AllyRoster({ heroes, info, controlled, side, followed, onFollow }: { heroes: HudHero[]; info: readonly HudHeroInfo[]; controlled?: number; side: Team } & Follow) {
  return (
    <ol className={`hud-roster side-${side}`} aria-label="Your heroes">
      {heroes.map((h, i) => {
        const me = info[h.id]
        const steering = controlled === h.id
        return (
          <li key={h.id} className={`hud-card team-${h.team}${h.alive ? '' : ' dead'}${steering ? ' controlled' : ''}${h.fallback ? ' fallback' : ''}${onFollow && h.alive ? ' follows' : ''}${followed === h.id ? ' followed' : ''}`} title={h.fallback ? FALLBACK_NOTE : onFollow ? `Follow ${me.short}` : undefined} {...(h.alive ? followProps(h.id, { onFollow }) : {})}>
            <span className="hud-card-face">
              <Portrait src={me.portrait} initials={me.initials} team={h.team} />
              <kbd className="hud-card-key">{(i + 1) % 10}</kbd>
              {steering && <span className="hud-card-tag">You</span>}
            </span>
            <span className="hud-card-name">{me.short}</span>
            <HpBar hp={h.alive ? h.hp : 0} maxHp={h.maxHp} />
            <Abilities hero={h} info={me} size="sm" />
          </li>
        )
      })}
    </ol>
  )
}

/** Right edge: the other side, same numbers as the streamer's own (R38), without keys since they cannot be taken. */
export function EnemyRoster({ heroes, info, team, followed, onFollow }: { heroes: HudHero[]; info: readonly HudHeroInfo[]; team: Team } & Follow) {
  const alive = heroes.filter((h) => h.alive).length
  return (
    <section className={`hud-enemies team-${team}`} aria-label="Enemy team">
      <div className="hud-enemies-head" aria-hidden="true">
        <span>{TEAM_NAME[team]} · enemy</span>
        <b>
          {alive}/{heroes.length}
        </b>
      </div>
      <ol aria-label="Enemy heroes">
        {heroes.map((h) => {
          const foe = info[h.id]
          return (
            <li key={h.id} className={`hud-foe team-${h.team}${h.alive ? '' : ' dead'}${onFollow && h.alive ? ' follows' : ''}${followed === h.id ? ' followed' : ''}`} title={h.fallback ? FALLBACK_NOTE : onFollow ? `Follow ${foe.short}` : undefined} {...(h.alive ? followProps(h.id, { onFollow }) : {})}>
              <Portrait src={foe.portrait} initials={foe.initials} team={h.team} />
              <span className="hud-foe-main">
                <span className="hud-foe-name">{foe.short}</span>
                <HpBar hp={h.alive ? h.hp : 0} maxHp={h.maxHp} />
              </span>
              <Abilities hero={h} info={foe} size="xs" />
            </li>
          )
        })}
      </ol>
    </section>
  )
}
