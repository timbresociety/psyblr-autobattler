import { useCallback, useEffect, useState } from 'react'
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
import type { BuildSlot, LimitHit, RoleId, SecondaryStat, Template } from '../../charter/types'
import { liveDeps, type BuildRecord, type CreatorDeps, type HeroResult } from '../api'
import { Loadout } from './Loadout'
import { LoadoutSearch } from './LoadoutSearch'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { GateStatus } from './GateStatus'
import { RoleSwitcher } from './RoleSwitcher'
import { SkillCard } from './SkillCard'
import { StatSplit } from './StatSplit'
import { describeLimit } from './labels'
import './creator.css'

/** The conversational hero creator (U11): chat on the left, the live kit, stats and balance check on the right. */
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

  const refreshLoadout = useCallback(() => {
    deps.listBuilds().then(setLoadout, () => setLoadout([]))
  }, [deps])
  useEffect(refreshLoadout, [refreshLoadout])
  const search = useCallback((q: string) => deps.search(q), [deps])

  function open(record: BuildRecord) {
    setBuild(record.build)
    setBuildId(record.id)
    setHeroName(record.build.heroName)
    setAlternatives(undefined)
    setNotice(undefined)
  }

  async function addFromLoadout(hero: HeroResult) {
    try {
      const record = await deps.addHero(hero.id)
      open(record)
      if (hero.photo) setPhotos([hero.photo])
      say(`Added ${hero.name} for free. The look is shared; this build is yours to tune.`)
      refreshLoadout()
    } catch {
      say(`Couldn't add ${hero.name} right now. Try again in a moment.`)
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
      say('Saved to your loadout.')
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
      setBuild(result.build)
      setAlternatives(undefined)
      showLimits(result.limits)
    } else showLimits(result.errors)
    return result
  }

  async function send(text: string) {
    setMessages((m) => [...m, { from: 'you', text }])
    setBusy(true)
    try {
      if (!build) {
        const res = await deps.propose({ heroName: heroName.trim(), description: text, skills: {}, photoUrls })
        setBuild({ ...res.build, heroName: heroName.trim() })
        setOffline(res.offline)
        showLimits(res.limits)
        say(`Forged as a ${res.build.roleId}. Rename and describe each skill below, or ask me for changes. The engine sets every number.`)
        return
      }
      const res = await deps.chat(build, text)
      setOffline(res.offline)
      if (!res.understood) {
        say(res.offline ? 'Offline: I can only read simple stat requests right now. Use the controls on the right.' : "I couldn't turn that into a change. Try naming a stat.")
        return
      }
      setBuild(res.build)
      showLimits(res.limits)
      say(res.limits.length ? `Done, within the limits: ${[...new Set(res.limits.map(describeLimit))].join(' ')}` : 'Done.')
    } finally {
      setBusy(false)
    }
  }

  async function addPhoto(file: File) {
    setPhotos((p) => [...p, URL.createObjectURL(file)])
    const url = await deps.uploadPhoto(file)
    if (url) setPhotoUrls((p) => [...p, url])
  }

  async function ready() {
    if (!build) return
    setChecking(true)
    try {
      const outcome = await deps.runGate(build)
      setBuild(outcome.build)
      setAlternatives(outcome.alternatives)
    } finally {
      setChecking(false)
    }
  }

  const onRole = (role: RoleId) => {
    if (!build) return
    const changed = changeRole(build, role)
    if (!changed.ok) return
    apply(changed)
    setNotice(`All ${30} points are back in the pool. Drag the stats, or use the suggested split.`)
  }
  const onEdit = (slot: BuildSlot, text: SkillText, replace = false) => {
    if (!build) return {}
    const result = editSkillText(build, slot, text, replace)
    if (result.ok && result.needsConfirm) return { needsConfirm: true }
    apply(result)
    return {}
  }

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
          if (build) setBuild({ ...build, heroName: n })
        }}
        onPhoto={addPhoto}
        onSend={send}
        search={!build && <LoadoutSearch query={heroName} search={search} onAdd={addFromLoadout} onBuildOwn={() => undefined} />}
      />
      <div className="kit">
        <Loadout builds={loadout} activeId={buildId} onOpen={open} />
        {offline && (
          <p className="offline" role="status">
            Offline mode: the engine is matching skills by keywords until the AI is back.
          </p>
        )}
        {!build ? (
          <section className="panel empty">
            <h1>Forge a hero</h1>
            <p>Give a name, add up to three reference photos, then describe your hero. You own the look and the names; the engine keeps every fight fair.</p>
          </section>
        ) : (
          <>
            <header className="panel hero-head">
              <div className="avatar">{photos[0] ? <img src={photos[0]} alt="" /> : <span>{(build.heroName || '?').slice(0, 1)}</span>}</div>
              <div className="hero-meta">
                <h1>{build.heroName}</h1>
                <RoleSwitcher roleId={build.roleId} onChange={onRole} />
                {build.spread.strength + build.spread.agility + build.spread.intellect === 0 && (
                  <button className="ghost" onClick={() => apply(allocate(build, proposedSpread(build.roleId)))}>
                    Use suggested split
                  </button>
                )}
              </div>
            </header>
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            <StatSplit build={build} onTarget={(stat: SecondaryStat, value: number) => apply(setStatTarget(build, stat, value))} />
            <div className="skills">
              {BUILD_SLOTS.map((slot) => (
                <SkillCard key={slot} build={build} slot={slot} onEdit={onEdit} onSwap={(s, id) => apply(swapTemplate(build, s, id))} />
              ))}
            </div>
            <GateStatus build={build} checking={checking} alternatives={alternatives} onReady={ready} onSwap={(s, id) => apply(swapTemplate(build, s, id))} />
            {build.gate.state === 'ready' && (
              <button className="primary save" onClick={save} disabled={saving}>
                {buildId ? 'Save changes' : 'Save to loadout'}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  )
}
