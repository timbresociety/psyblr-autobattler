import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILD_SLOTS,
  changeRole,
  editSkillText,
  proposedSpread,
  allocate,
  setStatTarget,
  swapTemplate,
  type Build,
  type OpResult,
  type SkillText,
} from '../../charter/build'
import { locomotion } from '../../charter/locomotion'
import { getRole } from '../../charter/roles'
import { SIZES } from '../../charter/sizes'
import { POOL_SIZE, deriveSheet, spentPoints } from '../../charter/stats'
import { getTemplate } from '../../charter/templates/catalog'
import type { BuildSlot, LimitHit, RoleId, SecondaryStat, Template } from '../../charter/types'
import { liveDeps, type BuildRecord, type CreatorDeps, type HeroResult } from '../api'
import { prefersReducedMotion } from '../arena/hud/format'
import { castClip, heroHue, webglAvailable, type StageClip } from '../common/hero-look'
import { SkillIcon } from '../common/SkillIcon'
import { Loadout } from './Loadout'
import { LoadoutSearch } from './LoadoutSearch'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { GateStatus } from './GateStatus'
import { RoleSwitcher } from './RoleSwitcher'
import { SkillCard } from './SkillCard'
import { StatSplit } from './StatSplit'
import { describeLimit } from './labels'
import './creator.css'

// the live 3D preview brings three.js, so it loads after the screen is up
const HeroStage = lazy(() => import('../common/HeroStage'))

/** The plinth: the hero in 3D where WebGL runs, its initials where it does not. */
function Stage({ build, cue }: { build?: Build; cue?: { clip: StageClip; at: number } }) {
  const name = build?.heroName ?? ''
  const label = name || 'your hero'
  const backdrop = <div className={`hero-stage${build ? ` role-${build.roleId}` : ' is-empty'}`} role="img" aria-label={`3D preview of ${label}`} />
  if (!webglAvailable()) return backdrop
  return (
    <Suspense fallback={backdrop}>
      <HeroStage look={build ? { heroName: name, roleId: build.roleId } : undefined} hue={heroHue(name)} cue={cue} size={build?.sizeClass ?? 'medium'} label={label} />
    </Suspense>
  )
}

/** The conversational hero creator (U11): chat on the left, the hero on its plinth, its stats, kit and balance check. */
export function CreatorScreen({ deps = liveDeps, initial }: { deps?: CreatorDeps; initial?: Build }) {
  const [heroName, setHeroName] = useState(initial?.heroName ?? '')
  const [photos, setPhotos] = useState<string[]>([])
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [build, setBuild] = useState<Build | undefined>(initial)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [checking, setChecking] = useState(false)
  const [alternatives, setAlternatives] = useState<Template[]>()
  const [buildId, setBuildId] = useState<string>()
  const [loadout, setLoadout] = useState<BuildRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [cue, setCue] = useState<{ clip: StageClip; at: number }>()
  // bumped on every change the player makes; an async result started before a change is discarded
  const edits = useRef(0)
  const changed = () => {
    edits.current++
  }

  const refreshLoadout = useCallback(() => {
    deps.listBuilds().then(setLoadout, () => setLoadout([]))
  }, [deps])
  useEffect(refreshLoadout, [refreshLoadout])
  const search = useCallback((q: string) => deps.search(q), [deps])

  function open(record: BuildRecord) {
    changed()
    setPhotos([])
    setPhotoUrls([])
    setBuild(record.build)
    setBuildId(record.id)
    setHeroName(record.build.heroName)
    setAlternatives(undefined)
    setNotice(undefined)
  }

  /** A blank slate for the next hero; saved heroes stay in the loadout. */
  function newHero() {
    changed()
    setPhotos([])
    setPhotoUrls([])
    setBuild(undefined)
    setBuildId(undefined)
    setHeroName('')
    setAlternatives(undefined)
    setNotice(undefined)
    setOffline(false)
    setMessages([])
  }

  async function addFromLoadout(hero: HeroResult) {
    if (adding) return
    setAdding(true)
    try {
      const record = await deps.addHero(hero.id)
      open(record)
      if (hero.photo) setPhotos([hero.photo])
      say(`Added ${hero.name} for free. The look is shared; this build is yours to tune.`)
      refreshLoadout()
    } catch {
      say(`Couldn't add ${hero.name} right now. Try again in a moment.`)
    } finally {
      setAdding(false)
    }
  }

  async function save() {
    if (!build) return
    setSaving(true)
    try {
      if (buildId) {
        const record = await deps.saveBuild(buildId, build)
        setBuild(record.build)
      } else {
        const created = await deps.createHero(build, photoUrls)
        setBuildId(created.buildId)
      }
      say('Saved to your loadout. It’s ready to place in the Arena.')
      refreshLoadout()
    } catch {
      say("Couldn't save right now. Your hero stays here; try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

  const say = (text: string) => setMessages((m) => [...m, { from: 'engine', text }])
  const showLimits = (limits: LimitHit[]) => setNotice(limits.length ? [...new Set(limits.map(describeLimit))].join(' ') : undefined)

  const apply = (result: OpResult) => {
    if (result.ok) {
      changed()
      setBuild(result.build)
      setAlternatives(undefined)
      showLimits(result.limits)
    } else showLimits(result.errors)
    return result
  }

  async function send(text: string) {
    setMessages((m) => [...m, { from: 'you', text }])
    setBusy(true)
    const started = edits.current
    const stale = () => edits.current !== started
    try {
      if (!build) {
        const res = await deps.propose({ heroName: heroName.trim(), description: text, skills: {}, photoUrls })
        if (stale()) return
        changed()
        setBuild({ ...res.build, heroName: heroName.trim() })
        setOffline(res.offline)
        showLimits(res.limits)
        say(`Forged as a ${res.build.roleId}. Rename and describe each skill, or ask me for changes. The engine sets every number.`)
        return
      }
      const res = await deps.chat(build, text)
      if (stale()) {
        say('You changed the hero while I was thinking, so I left your edits as they are. Ask again if you still want that change.')
        return
      }
      setOffline(res.offline)
      if (!res.understood) {
        say(res.offline ? 'Offline: I can only read simple stat requests right now. Use the controls on the right.' : "I couldn't turn that into a change. Try naming a stat.")
        return
      }
      changed()
      setBuild(res.build)
      showLimits(res.limits)
      say(res.limits.length ? `Done, within the limits: ${[...new Set(res.limits.map(describeLimit))].join(' ')}` : 'Done.')
    } catch {
      say('Something went wrong on my side. Your hero is unchanged; try again.')
    } finally {
      setBusy(false)
    }
  }

  async function addPhoto(file: File) {
    const preview = URL.createObjectURL(file)
    setPhotos((p) => [...p, preview])
    const url = await deps.uploadPhoto(file)
    if (url) {
      setPhotoUrls((p) => [...p, url])
      return
    }
    // an upload that failed must not look attached
    setPhotos((p) => p.filter((src) => src !== preview))
    URL.revokeObjectURL(preview)
    say("Couldn't upload that photo. Try again in a moment.")
  }

  async function ready() {
    if (!build) return
    setChecking(true)
    const started = edits.current
    try {
      const outcome = await deps.runGate(build)
      if (edits.current !== started) {
        say('The hero changed during the balance check. Press Ready to check the new version.')
        return
      }
      setBuild(outcome.build)
      setAlternatives(outcome.alternatives)
    } catch {
      say("Couldn't run the balance check. Try again.")
    } finally {
      setChecking(false)
    }
  }

  const onRole = (role: RoleId) => {
    if (!build) return
    const changed = changeRole(build, role)
    if (!changed.ok) return
    apply(changed)
    setNotice(`All ${POOL_SIZE} points are back in the pool. Drag the stats, or use the suggested split.`)
  }
  const onEdit = (slot: BuildSlot, text: SkillText, replace = false) => {
    if (!build) return {}
    const result = editSkillText(build, slot, text, replace)
    if (result.ok && result.needsConfirm) return { needsConfirm: true }
    apply(result)
    return {}
  }
  const preview = (slot: BuildSlot) => build && setCue({ clip: castClip(getTemplate(build.slots[slot].templateId), slot), at: performance.now() })
  /** From the kit row: the hero performs the skill and its card comes into view. */
  const showSkill = (slot: BuildSlot) => {
    preview(slot)
    document.getElementById(`skill-${slot}`)?.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
  }

  const facts = useMemo(() => {
    if (!build) return undefined
    const sheet = deriveSheet(getRole(build.roleId), build.spread, build.sizeClass).sheet
    const move = locomotion(sheet.moveSpeed)
    return { health: Math.round(sheet.maxHealth), ground: move.ground, flight: move.flight, size: SIZES[build.sizeClass ?? 'medium'].label }
  }, [build])

  return (
    <main className="creator">
      <ChatPanel
        started={!!build}
        heroName={heroName}
        photos={photos}
        messages={messages}
        busy={busy}
        onName={(n) => {
          setHeroName(n)
          if (build) {
            changed()
            setBuild({ ...build, heroName: n })
          }
        }}
        onPhoto={addPhoto}
        onSend={send}
        search={!build && <LoadoutSearch query={heroName} search={search} onAdd={addFromLoadout} adding={adding} />}
      />
      <section className="workbench">
        <Loadout builds={loadout} activeId={buildId} onOpen={open} onNew={build ? newHero : undefined} />
        <div className="bench-scroll">
          {offline && (
            <p className="offline" role="status">
              Offline mode: the engine is matching skills by keywords until the AI is back.
            </p>
          )}
          {!build ? (
            <section className="showcase is-empty">
              <Stage />
              <div className="hero-info intro">
                <h1 className="hero-name">Forge a hero</h1>
                <p className="lead">Give a name, add up to three reference photos, then describe your hero. You own the look and the names; the engine keeps every fight fair.</p>
                <ol className="steps">
                  <li className={heroName.trim() ? 'done' : 'now'}>
                    <b>Name it</b>
                    <span>Anyone: Jensen, Goku, a superintelligence.</span>
                  </li>
                  <li className={photos.length ? 'done' : ''}>
                    <b>Add photos</b>
                    <span>Up to three, so the look lands. Optional.</span>
                  </li>
                  <li className={heroName.trim() ? 'now' : ''}>
                    <b>Describe it</b>
                    <span>One sentence in the chat. The engine drafts a role, six skills and a stat split.</span>
                  </li>
                </ol>
              </div>
            </section>
          ) : (
            <>
              <section className="showcase">
                <Stage build={build} cue={cue} />
                <div className="hero-info">
                  <h1 className={`hero-name${build.heroName.length > 16 ? ' long' : ''}`}>{build.heroName}</h1>
                  <RoleSwitcher roleId={build.roleId} onChange={onRole} />
                  {facts && (
                    <dl className="facts">
                      <div>
                        <dt>Health</dt>
                        <dd>{facts.health}</dd>
                      </div>
                      <div>
                        <dt>Speed</dt>
                        <dd>
                          {facts.ground.toFixed(1)}
                          <small>m/s</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Flight</dt>
                        <dd>
                          {facts.flight.toFixed(1)}
                          <small>m/s</small>
                        </dd>
                      </div>
                      <div>
                        <dt>Size</dt>
                        <dd>{facts.size}</dd>
                      </div>
                    </dl>
                  )}
                  <ul className="kit-glance" aria-label="Kit at a glance">
                    {BUILD_SLOTS.map((slot) => {
                      const spec = build.slots[slot]
                      const template = getTemplate(spec.templateId)
                      return (
                        <li key={slot}>
                          <button className="glance" title={`${spec.name.trim() || template.name}: ${template.name}`} onClick={() => showSkill(slot)} onPointerEnter={() => preview(slot)}>
                            <SkillIcon template={template} slot={slot} />
                            <span>{spec.name.trim() || template.name}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  {notice && (
                    <p className="notice" role="status">
                      {notice}
                    </p>
                  )}
                  {spentPoints(build.spread) === 0 && (
                    <button className="btn primary suggest" onClick={() => apply(allocate(build, proposedSpread(build.roleId)))}>
                      Use suggested split
                    </button>
                  )}
                </div>
              </section>
              <StatSplit build={build} onTarget={(stat: SecondaryStat, value: number) => apply(setStatTarget(build, stat, value))} />
              <section className="kit" aria-label="Kit">
                <header className="kit-head">
                  <h2 className="section-title">Kit</h2>
                  <p className="muted">Your names and looks on the engine’s mechanics. Point at a skill to see the hero use it.</p>
                </header>
                <div className="skills">
                  {BUILD_SLOTS.map((slot) => (
                    <SkillCard key={slot} build={build} slot={slot} onEdit={onEdit} onSwap={(s, id) => apply(swapTemplate(build, s, id))} onPreview={preview} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
        {build && (
          <GateStatus build={build} checking={checking} alternatives={alternatives} onReady={ready} onSwap={(s, id) => apply(swapTemplate(build, s, id))}>
            {build.gate.state === 'ready' && (
              <button className="btn primary big save" onClick={save} disabled={saving}>
                {buildId ? 'Save changes' : 'Save to loadout'}
              </button>
            )}
          </GateStatus>
        )}
      </section>
    </main>
  )
}
