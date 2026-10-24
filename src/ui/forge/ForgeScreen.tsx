import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILD_SLOTS,
  MAX_PHOTOS,
  changeRole,
  editSkillText,
  proposedSpread,
  allocate,
  setLook,
  setSize,
  setStatTarget,
  swapTemplate,
  type Build,
  type OpResult,
  type SkillText,
} from '../../charter/build'
import { locomotion } from '../../charter/locomotion'
import { getRole } from '../../charter/roles'
import { SIZES, type SizeClass } from '../../charter/sizes'
import { POOL_SIZE, deriveSheet, spentPoints } from '../../charter/stats'
import { getTemplate } from '../../charter/templates/catalog'
import type { BuildSlot, LimitHit, RoleId, SecondaryStat, Template } from '../../charter/types'
import type { HeroLook } from '../../charter/look'
import { nameFromPrompt, sizeFromPrompt, skillsFromPrompt } from '../../forge/prompt'
import { liveDeps, UPLOAD_MESSAGES, type BuildRecord, type ForgeDeps, type HeroResult } from '../api'
import { prefersReducedMotion } from '../arena/hud/format'
import { castClip, heroHue, webglAvailable, type StageClip } from '../common/hero-look'
import { PREP_MESSAGES } from '../common/image-prep'
import { SkillIcon } from '../common/SkillIcon'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { GateStatus } from './GateStatus'
import { ImageDrop, imageFiles, type RefImage } from './ImageDrop'
import { LookPanel } from './LookPanel'
import { facePhoto, firstLook, photoColours, resolvedLook, type FaceCandidate } from './look'
import { LoadoutSearch } from './LoadoutSearch'
import { RoleSwitcher } from './RoleSwitcher'
import { SizePicker } from './SizePicker'
import { SkillCard } from './SkillCard'
import { StatSplit } from './StatSplit'
import { describeLimit } from './labels'
import './forge.css'

// the live 3D preview brings three.js, so it loads after the screen is up
const HeroStage = lazy(() => import('../common/HeroStage'))

type Subject = Pick<Build, 'heroName' | 'roleId' | 'sizeClass' | 'look'>

/** The plinth: the hero in 3D where WebGL runs, its initials where it does not. */
function Stage({ subject, cue }: { subject?: Subject; cue?: { clip: StageClip; at: number } }) {
  const name = subject?.heroName ?? ''
  const label = name || 'your hero'
  const backdrop = <div className={`hero-stage${subject ? ` role-${subject.roleId}` : ' is-empty'}`} role="img" aria-label={`3D preview of ${label}`} />
  if (!webglAvailable()) return backdrop
  return (
    <Suspense fallback={backdrop}>
      <HeroStage look={subject} hue={heroHue(name)} cue={cue} size={subject?.sizeClass ?? 'medium'} label={label} />
    </Suspense>
  )
}

/** A look to change: the hero's own, or, the first time, what its role gave it (colours stay its defaults until picked). */
function lookOf(build: Build): HeroLook {
  if (build.look) return build.look
  const { colors: _defaults, ...rest } = resolvedLook(undefined, build.roleId, build.heroName, heroHue(build.heroName))
  return { ...rest, colors: {} }
}

/** The look with a photo face on, and the photo's colours. */
const withFace = (look: HeroLook, face: FaceCandidate): HeroLook => ({ ...look, colors: { ...look.colors, ...photoColours(face.finding) }, face: facePhoto(face) })

function withoutFace(look: HeroLook): HeroLook {
  const { face: _face, ...rest } = look
  return rest
}

let nextImage = 0

const dragsFiles = (e: { dataTransfer: DataTransfer }) => [...e.dataTransfer.types].includes('Files')

/**
 * The Forge (R13): reference images, a name and a prompt go in, a hero comes out, and every part of it can be tweaked by
 * hand. Chat on the left, the hero on its plinth with its size, stats, kit and balance check. `record` opens a hero
 * from the Loadout for editing; `initial` starts from a build that isn't saved yet, such as a remix.
 */
export function ForgeScreen({ deps = liveDeps, initial, record }: { deps?: ForgeDeps; initial?: Build; record?: BuildRecord }) {
  const start = record?.build ?? initial
  const [heroName, setHeroName] = useState(start?.heroName ?? '')
  const [images, setImages] = useState<RefImage[]>([])
  const [imageError, setImageError] = useState<string>()
  const [build, setBuild] = useState<Build | undefined>(start)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [checking, setChecking] = useState(false)
  const [alternatives, setAlternatives] = useState<Template[]>()
  const [buildId, setBuildId] = useState<string | undefined>(record?.id)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [cue, setCue] = useState<{ clip: StageClip; at: number }>()
  // bumped on every change the player makes; an async result started before a change is discarded
  const edits = useRef(0)
  const changed = () => {
    edits.current++
  }
  const photoUrls = images.flatMap((img) => (img.status === 'ready' && img.url ? [img.url] : []))
  const search = useCallback((q: string) => deps.search(q), [deps])
  const say = (text: string) => setMessages((m) => [...m, { from: 'engine', text }])

  // previews are object URLs, released when their image goes or the screen does
  const previews = useRef(new Set<string>())
  useEffect(() => {
    const live = previews.current
    return () => live.forEach((url) => URL.revokeObjectURL(url))
  }, [])
  // how many images are in, read synchronously, so a burst of drops or pastes never passes the cap
  const count = useRef(0)
  useEffect(() => {
    count.current = images.length
  }, [images])

  const patchImage = (id: string, patch: Partial<RefImage>) => setImages((list) => list.map((img) => (img.id === id ? { ...img, ...patch } : img)))
  const dropImage = useCallback((id: string) => {
    setImages((list) => {
      const gone = list.find((img) => img.id === id)
      if (gone?.preview) {
        URL.revokeObjectURL(gone.preview)
        previews.current.delete(gone.preview)
      }
      // taking away the photo a hero's face came from takes the face off too
      if (gone?.url) setBuild((b) => (b && b.look && b.look.face?.url === gone.url ? setLook(b, withoutFace(b.look)) : b))
      return list.filter((img) => img.id !== id)
    })
    count.current = Math.max(0, count.current - 1)
  }, [])

  /** Shrink each image in the browser, then upload it; one that can't be used is removed, and the drop zone says why. */
  const addImages = useCallback(
    async (files: File[]) => {
      setImageError(undefined)
      const taken = files.slice(0, Math.max(0, MAX_PHOTOS - count.current))
      if (files.length > taken.length) setImageError(`Up to ${MAX_PHOTOS} reference images. Remove one to add another.`)
      if (!taken.length) return
      count.current += taken.length
      const queued = taken.map((file) => ({ file, id: `img${++nextImage}` }))
      setImages((list) => [...list, ...queued.map(({ file, id }) => ({ id, name: file.name || 'Pasted image', status: 'preparing' as const }))])
      await Promise.all(
        queued.map(async ({ file, id }) => {
          const prepared = await deps.prepareImage(file)
          if (!prepared.ok) {
            dropImage(id)
            setImageError(PREP_MESSAGES[prepared.reason])
            return
          }
          const preview = URL.createObjectURL(prepared.blob)
          previews.current.add(preview)
          patchImage(id, { preview, status: 'uploading' })
          // the face is found in the browser while the image uploads
          const [uploaded, finding] = await Promise.all([deps.uploadPhoto(prepared.blob), deps.findFace(prepared.blob).catch(() => undefined)])
          if (!uploaded.ok) {
            dropImage(id)
            setImageError(UPLOAD_MESSAGES[uploaded.reason])
            return
          }
          patchImage(id, { status: 'ready', url: uploaded.url, face: finding ?? null })
          // a face photo added after forging: the hero wears it at once, unless it already wears one
          if (finding) setBuild((b) => (b && !b.look?.face ? setLook(b, withFace(lookOf(b), { url: uploaded.url, finding })) : b))
        }),
      )
    },
    [deps, dropImage],
  )

  // a pasted image lands in the drop zone wherever the page has focus; pasted text stays where it was pasted
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imageFiles(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      addImages(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addImages])

  /** A blank slate for the next hero; saved heroes stay in the Loadout. */
  function newHero() {
    changed()
    images.forEach((img) => img.preview && URL.revokeObjectURL(img.preview))
    count.current = 0
    setImages([])
    setImageError(undefined)
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
      const added = await deps.addHero(hero.id)
      changed()
      setBuild(added.build)
      setBuildId(added.id)
      setHeroName(added.build.heroName)
      setAlternatives(undefined)
      setNotice(undefined)
      say(`Added ${hero.name} to your loadout for free. The look is shared; this build is yours to tune.`)
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
        const saved = await deps.saveBuild(buildId, build)
        setBuild(saved.build)
      } else {
        const created = await deps.createHero(build, photoUrls)
        setBuildId(created.buildId)
      }
      say('Saved to your loadout. Find it in the Loadout tab, or place it in the Arena.')
    } catch {
      say("Couldn't save right now. Your hero stays here; try again in a moment.")
    } finally {
      setSaving(false)
    }
  }

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
        // the prompt names the hero when the name is blank, themes the skills it lists and sets a size it asks for
        const name = heroName.trim() || nameFromPrompt(text)
        const res = await deps.propose({ heroName: name, description: text, skills: skillsFromPrompt(text), photoUrls })
        if (stale()) return
        changed()
        const size = sizeFromPrompt(text)
        const sized = size ? setSize({ ...res.build, heroName: name }, size) : undefined
        const forged = sized?.ok ? sized.build : { ...res.build, heroName: name }
        // the prompt and the photo dress it: "a queen in gold armour" is a woman in gold armour, wearing the photo's face
        setBuild(setLook(forged, firstLook(text, forged.roleId, name, heroHue(name), candidate)))
        setHeroName(name)
        setOffline(res.offline)
        showLimits(res.limits)
        say(`Forged ${name} as a ${res.build.roleId}${size ? `, ${SIZES[size].label.toLowerCase()} sized` : ''}. Rename and describe each skill, change the size or the stats, or ask me for changes. The engine sets every number.`)
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
      // looks are cosmetic, so a look changed while the engine was thinking is kept
      setBuild((b) => ({ ...res.build, look: b?.look ?? res.build.look }))
      showLimits(res.limits)
      say(res.limits.length ? `Done, within the limits: ${[...new Set(res.limits.map(describeLimit))].join(' ')}` : 'Done.')
    } catch {
      say('Something went wrong on my side. Your hero is unchanged; try again.')
    } finally {
      setBusy(false)
    }
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
      setBuild((b) => ({ ...outcome.build, look: b?.look ?? outcome.build.look }))
      setAlternatives(outcome.alternatives)
    } catch {
      say("Couldn't run the balance check. Try again.")
    } finally {
      setChecking(false)
    }
  }

  const onRole = (role: RoleId) => {
    if (!build) return
    const result = changeRole(build, role)
    if (!result.ok) return
    apply(result)
    setNotice(`All ${POOL_SIZE} points are back in the pool. Drag the stats, or use the suggested split.`)
  }
  const onSize = (size: SizeClass) => build && apply(setSize(build, size))
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

  /** The first uploaded reference image with a face on it: what the hero can wear. */
  const candidate = useMemo<FaceCandidate | undefined>(() => {
    const img = images.find((i) => i.status === 'ready' && i.url && i.face)
    return img ? { url: img.url!, finding: img.face! } : undefined
  }, [images])
  const onLook = (patch: Parameters<typeof LookPanel>[0]['onChange'] extends (p: infer P) => void ? P : never) =>
    setBuild((b) => {
      if (!b) return b
      const base = lookOf(b)
      const { colors, ...rest } = patch
      return setLook(b, { ...base, ...rest, colors: { ...base.colors, ...(colors ?? {}) } })
    })
  const onFace = (on: boolean) =>
    setBuild((b) => {
      if (!b) return b
      if (!on) return b.look ? setLook(b, withoutFace(b.look)) : b
      return candidate ? setLook(b, withFace(lookOf(b), candidate)) : b
    })
  // before forging, the plinth already wears a found face, so the photo's effect shows at once
  const facePreview: Subject | undefined = candidate
    ? { heroName: heroName.trim() || 'Your hero', roleId: 'assassin', look: { gender: 'm', hair: 'crop', armour: false, cape: false, colors: photoColours(candidate.finding), face: facePhoto(candidate) } }
    : undefined

  const facts = useMemo(() => {
    if (!build) return undefined
    const sheet = deriveSheet(getRole(build.roleId), build.spread, build.sizeClass).sheet
    const move = locomotion(sheet.moveSpeed)
    return { health: Math.round(sheet.maxHealth), ground: move.ground, flight: move.flight, size: SIZES[build.sizeClass ?? 'medium'].label }
  }, [build])

  const uploading = images.some((img) => img.status !== 'ready')

  return (
    <main
      className="creator"
      onDragOver={(e) => dragsFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!dragsFiles(e)) return
        e.preventDefault()
        const files = imageFiles(e.dataTransfer.files)
        if (files.length) addImages(files)
      }}
    >
      <ChatPanel
        started={!!build}
        heroName={heroName}
        messages={messages}
        busy={busy}
        onName={(n) => {
          setHeroName(n)
          if (build) {
            changed()
            setBuild({ ...build, heroName: n })
          }
        }}
        onSend={send}
        search={!build && <LoadoutSearch query={heroName} search={search} onAdd={addFromLoadout} adding={adding} />}
        refs={<ImageDrop images={images} max={MAX_PHOTOS} onFiles={addImages} onRemove={dropImage} error={imageError} />}
      />
      <section className="workbench">
        {build && (
          <header className="bench-head">
            <span className="bench-title">{buildId ? 'In your loadout' : 'Not saved yet'}</span>
            <button className="btn sm ghost new-hero" onClick={newHero}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              New hero
            </button>
          </header>
        )}
        <div className="bench-scroll">
          {offline && (
            <p className="offline" role="status">
              Offline mode: the engine is matching skills by keywords until the AI is back.
            </p>
          )}
          {!build ? (
            <section className="showcase is-empty">
              <Stage subject={facePreview} />
              <div className="hero-info intro">
                <h1 className="hero-name">Forge a hero</h1>
                <p className="lead">Add reference images, give a name if you have one, then describe your hero. You own the look and the names; the engine keeps every fight fair.</p>
                <ol className="steps">
                  <li className={images.length ? 'done' : ''}>
                    <b>Add images</b>
                    <span>Up to three. Drop, paste or browse. Optional.</span>
                  </li>
                  <li className={heroName.trim() ? 'done' : ''}>
                    <b>Name it</b>
                    <span>Anyone: Jensen, Goku, a superintelligence. Or let the prompt name it.</span>
                  </li>
                  <li className="now">
                    <b>Describe it</b>
                    <span>One sentence in the chat. The engine drafts a role, six skills, a size and a stat split.</span>
                  </li>
                </ol>
              </div>
            </section>
          ) : (
            <>
              <section className="showcase">
                <Stage subject={build} cue={cue} />
                <div className="hero-info">
                  <h1 className={`hero-name${build.heroName.length > 16 ? ' long' : ''}`}>{build.heroName}</h1>
                  <RoleSwitcher roleId={build.roleId} onChange={onRole} />
                  <SizePicker build={build} onChange={onSize} />
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
              <LookPanel look={resolvedLook(build.look, build.roleId, build.heroName, heroHue(build.heroName))} canFace={!!candidate} onChange={onLook} onFace={onFace} />
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
              <button className="btn primary big save" onClick={save} disabled={saving || uploading} title={uploading ? 'Waiting for your images to finish uploading' : undefined}>
                {buildId ? 'Save changes' : 'Save to loadout'}
              </button>
            )}
          </GateStatus>
        )}
      </section>
    </main>
  )
}
