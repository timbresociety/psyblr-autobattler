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
import type { HeroLook, LookColor } from '../../charter/look'
import { elementLook, type SkillLook } from '../../charter/skill-look'
import { skillLookOf } from '../../arena/recipes/looks'
import { BUILT_IN, type PieceEntry } from '../../kit/pieces'
import type { LibraryEntry } from '../../kit/wear/library'
import type { GearGap } from '../../kit/resolve'
import { buildFromReading, type GearWish, type Reading } from '../../forge/reading'
import { liveDeps, UPLOAD_MESSAGES, type BuildRecord, type ForgeDeps } from '../api'
import { prefersReducedMotion } from '../arena/hud/format'
import { castClip, heroHue, webglAvailable, type StageClip } from '../common/hero-look'
import { PREP_MESSAGES } from '../common/image-prep'
import { SkillIcon } from '../common/SkillIcon'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { GateStatus } from './GateStatus'
import { ImageDrop, imageFiles, type RefImage } from './ImageDrop'
import { BodyPanel } from './BodyPanel'
import { WardrobePanel } from './WardrobePanel'
import { wardrobeCatalog } from './wardrobe'
import { facePhoto, gapsOf, matchWishes, photoColours, readingLook, resolvedLook, wornGear, type FaceCandidate, type GearChoice } from './look'
import { ReadingBar, ReadingCard } from './ReadingCard'
import { RoleSwitcher } from './RoleSwitcher'
import { SizePicker } from './SizePicker'
import { SkillCard } from './SkillCard'
import { StatSplit } from './StatSplit'
import { describeLimit } from './labels'
import './forge.css'

// the live 3D preview brings three.js, so it loads after the screen is up
const HeroStage = lazy(() => import('../common/HeroStage'))
// the arena comes in only when the player tries the hero
const TryIt = lazy(() => import('../arena/ArenaScreen').then((m) => ({ default: m.TryIt })))

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
  // community pieces seen so far (the most worn, search results, generated ones) and what the prompt asked for that the
  // repository lacks
  const [community, setCommunity] = useState<PieceEntry[]>([])
  // the community's wardrobe items seen so far: the most worn, search results and generated ones
  const [items, setItems] = useState<LibraryEntry[]>([])
  const [trying, setTrying] = useState(false)
  const [gaps, setGaps] = useState<GearGap[]>([])
  const [cue, setCue] = useState<{ clip: StageClip; at: number }>()
  // the Forge reads before it builds: the reading of the first prompt, that prompt, and the gear it asked for
  const [reading, setReading] = useState<Reading>()
  const [prompt, setPrompt] = useState('')
  const [choices, setChoices] = useState<GearChoice[]>([])
  // bumped on every change the player makes; an async result started before a change is discarded
  const edits = useRef(0)
  const changed = () => {
    edits.current++
  }
  const photoUrls = images.flatMap((img) => (img.status === 'ready' && img.url ? [img.url] : []))
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
          const outfit = await deps.outfitColours(prepared.blob, finding).catch(() => ({}))
          patchImage(id, { status: 'ready', url: uploaded.url, face: finding ?? null, outfit })
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

  const addCommunity = useCallback((entries: PieceEntry[]) => setCommunity((have) => [...have, ...entries.filter((e) => e.source === 'community' && !have.some((h) => h.id === e.id))]), [])
  const catalog = useMemo(() => [...BUILT_IN, ...community], [community])
  useEffect(() => {
    deps.pieces.searchPieces('').then(addCommunity, () => undefined)
  }, [deps, addCommunity])
  const addItems = useCallback((entries: LibraryEntry[]) => setItems((have) => [...have, ...entries.filter((e) => e.source === 'community' && !have.some((h) => h.id === e.id))]), [])
  const wardrobe = useMemo(() => wardrobeCatalog(items), [items])
  useEffect(() => {
    deps.pieces.searchItems('').then(addItems, () => undefined)
  }, [deps, addItems])

  /** A reading's gear the built-ins lack, looked up among the community's pieces; a match is worn like any other. */
  async function findNear(wishes: GearWish[]) {
    const missing = matchWishes(wishes, catalog).filter((c) => !c.entry)
    const found = (await Promise.all(missing.slice(0, 3).map((c) => deps.pieces.searchPieces(c.wish.phrase, c.wish.kind).catch(() => [] as PieceEntry[])))).flat()
    if (found.length) addCommunity(found)
  }

  /** A blank slate for the next hero; saved heroes stay in the Loadout. */
  function newHero() {
    changed()
    setGaps([])
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
    setReading(undefined)
    setPrompt('')
    setChoices([])
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

  /** Read the hero from a prompt, or read it again with a correction on top of the last reading. */
  async function read(text: string, note?: string) {
    setBusy(true)
    const started = edits.current
    try {
      const res = await deps.read({ prompt: text, ...(heroName.trim() ? { heroName: heroName.trim() } : {}), photoUrls, faceFound: !!candidate, ...(note && reading ? { note, previous: reading } : {}) })
      if (edits.current !== started) return
      const next = res.reading
      if (!next) {
        say(`${res.refused} Change the prompt and I'll read it again.`)
        return
      }
      changed()
      setPrompt(text)
      setReading(next)
      void findNear(next.gear)
      const asks = next.questions.length
      say(
        note
          ? `Read again with your note.${asks ? ` ${asks === 1 ? 'One question is' : `${asks} questions are`} still open.` : ''} Build when it looks right.`
          : `Here's how I read ${next.heroName}. ${asks ? `I have ${asks === 1 ? 'one question' : `${asks} questions`}, then ` : ''}check the look, the gear and the kit, change anything, and press Build hero.`,
      )
    } catch {
      say('Something went wrong on my side. Try again.')
    } finally {
      setBusy(false)
    }
  }

  /** The hero the reading describes, dressed in its look: from here the editor takes over. */
  function buildHero() {
    if (!reading) return
    changed()
    const forged = buildFromReading(reading)
    setBuild(setLook(forged, readingLook(reading, candidate, outfit, wornGear(choices))))
    setGaps(gapsOf(choices))
    setHeroName(reading.heroName)
    setOffline(reading.source === 'offline')
    setAlternatives(undefined)
    setReading(undefined)
    say(`Built ${reading.heroName} as a ${getRole(forged.roleId).name.toLowerCase()}. Change anything on the right, then press Ready for the balance check.`)
  }

  async function send(text: string) {
    setMessages((m) => [...m, { from: 'you', text }])
    if (!build) {
      // the first message is read back before anything is built; while a reading is open, a message corrects it
      await read(reading ? prompt : text, reading ? text : undefined)
      return
    }
    setBusy(true)
    const started = edits.current
    const stale = () => edits.current !== started
    try {
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
  const preview = (slot: BuildSlot) => build && setCue({ clip: castClip(getTemplate(build.slots[slot].templateId), slot, skillLookOf(build, slot)), at: performance.now() })
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
  /** The outfit colours off the first image that has any, for an offline reading. */
  const outfit = useMemo<Partial<Record<LookColor, string>>>(() => images.find((i) => i.status === 'ready' && i.outfit && Object.keys(i.outfit).length)?.outfit ?? {}, [images])
  // the reading's gear against the repository as it grows, keeping what the player switched off
  const wishes = reading?.gear
  useEffect(() => {
    setChoices((before) => (wishes ? matchWishes(wishes, catalog, before) : []))
  }, [wishes, catalog])
  const onGearChoice = (index: number, wear: boolean) => setChoices((list) => list.map((c, i) => (i === index ? { ...c, wear } : c)))
  const readingSubject: Subject | undefined = reading ? { heroName: reading.heroName, roleId: reading.roleId, sizeClass: reading.look.size, look: readingLook(reading, candidate, outfit, wornGear(choices)) } : undefined

  /** A change to the look as drawn: the first one writes down what the role gave the hero, in the colours it wears. */
  const onLook = (change: (look: HeroLook) => HeroLook) => setBuild((b) => b && setLook(b, change(resolvedLook(b.look, b.roleId, b.heroName, heroHue(b.heroName)))))
  /** A change to how a skill looks, starting from the look it's drawn with now. */
  const onSkillLook = (slot: BuildSlot, change: (look: SkillLook) => SkillLook) =>
    setBuild((b) => {
      if (!b) return b
      const base = lookOf(b)
      return setLook(b, { ...base, skills: { ...base.skills, [slot]: change(skillLookOf(b, slot) ?? elementLook('energy')) } })
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
  const drawn = build && resolvedLook(build.look, build.roleId, build.heroName, heroHue(build.heroName))

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
        reading={!!reading}
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
          {!build && reading ? (
            <ReadingCard
              reading={reading}
              stage={<Stage subject={readingSubject} />}
              gear={choices}
              look={resolvedLook(readingSubject!.look, reading.roleId, reading.heroName, heroHue(reading.heroName))}
              canFace={!!candidate}
              onChange={(next) => {
                changed()
                setReading(next)
              }}
              onGear={onGearChoice}
            />
          ) : !build ? (
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
                    <span>In the chat, as much as you like. I read it back, ask what I can't tell, and build when you say so.</span>
                  </li>
                </ol>
              </div>
            </section>
          ) : (
            <>
              <section className="showcase">
                {/* the arena takes the GPU while the hero is tried */}
                {trying ? <div className={`hero-stage role-${build.roleId}`} aria-hidden="true" /> : <Stage subject={build} cue={cue} />}
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
                  <button className="btn ghost try-it-open" onClick={() => setTrying(true)}>
                    Try it on a training dummy
                  </button>
                  {spentPoints(build.spread) === 0 && (
                    <button className="btn primary suggest" onClick={() => apply(allocate(build, proposedSpread(build.roleId)))}>
                      Use suggested split
                    </button>
                  )}
                </div>
              </section>
              <BodyPanel look={drawn!} canFace={!!candidate} onLook={onLook} onFace={onFace} />
              <WardrobePanel look={drawn!} catalog={wardrobe} onLook={onLook} pieces={deps.pieces} gaps={gaps} referenceUrl={images.find((i) => i.status === 'ready' && i.url)?.url} onFound={addItems} />
              <StatSplit build={build} onTarget={(stat: SecondaryStat, value: number) => apply(setStatTarget(build, stat, value))} />
              <section className="kit" aria-label="Kit">
                <header className="kit-head">
                  <h2 className="section-title">Kit</h2>
                  <p className="muted">Your names and looks on the engine’s mechanics. Point at a skill to see the hero use it.</p>
                </header>
                <div className="skills">
                  {BUILD_SLOTS.map((slot) => (
                    <SkillCard key={slot} build={build} slot={slot} onEdit={onEdit} onSwap={(s, id) => apply(swapTemplate(build, s, id))} onPreview={preview} onLook={onSkillLook} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
        {!build && reading && <ReadingBar busy={busy} questions={reading.questions.length} onCorrect={send} onBuild={buildHero} />}
        {build && trying && (
          <div className="try-it">
            <Suspense fallback={null}>
              <TryIt build={build} onClose={() => setTrying(false)} />
            </Suspense>
          </div>
        )}
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
