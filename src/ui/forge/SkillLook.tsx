import { swapOptions, type Build } from '../../charter/build'
import {
  CAST_POSES,
  CHARGES,
  CHARGE_LABEL,
  ELEMENTS,
  ELEMENT_LABEL,
  ELEMENT_LOOKS,
  FORM_AURAS,
  FORM_AURA_LABEL,
  FORM_AVATARS,
  FORM_AVATAR_LABEL,
  FORM_ENTRIES,
  FORM_ENTRY_LABEL,
  FORM_GROWTHS,
  FORM_GROWTH_LABEL,
  FORM_LABEL,
  FORM_TRAILS,
  FORM_TRAIL_LABEL,
  IMPACTS,
  IMPACT_LABEL,
  MOTIFS,
  MOTIF_LABEL,
  POSE_LABEL,
  TRAILS,
  TRAIL_LABEL,
  formOf,
  formsFor,
  type Element,
  type FormBody,
  type SkillLook,
  type TransformationLook,
} from '../../charter/skill-look'
import { SIZES } from '../../charter/sizes'
import { getTemplate, poolFor } from '../../charter/templates/catalog'
import type { BuildSlot, Delivery, Template } from '../../charter/types'
import { formLookOf } from '../../arena/recipes/looks'
import { transformOf } from '../../forge/form'
import { LIBRARY } from '../../kit/wear/library'
import { isRigid } from './wardrobe'
import { SLOT_LABEL } from './labels'

/** A select over a list, with an optional first choice for "none" or "as the element has it". */
function Pick<T extends string>({ label, text = label, value, options, labels, empty, onChange }: { label: string; text?: string; value: T | undefined; options: readonly T[]; labels: Record<T, string>; empty?: string; onChange: (value: T | undefined) => void }) {
  return (
    <label className="look-pick">
      <span>{text}</span>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {labels[o]}
          </option>
        ))}
      </select>
    </label>
  )
}

const PALETTE = ['Core', 'Glow', 'Accent'] as const

/**
 * How a skill looks, beside what it does: its element and palette, the form it takes for its delivery (three beams can
 * share a template and look nothing alike), and, folded away, the cast pose, charge, impact, trail and callout. Never
 * a number: the hit area is the template's.
 */
export function SkillLookRow({ slot, look, kind, onLook }: { slot: BuildSlot; look: SkillLook; kind: Delivery['kind']; onLook: (change: (look: SkillLook) => SkillLook) => void }) {
  const name = SLOT_LABEL[slot]
  const set = (patch: Partial<SkillLook>) => onLook((l) => ({ ...l, ...patch }))
  return (
    <div className="skill-look" role="group" aria-label={`${name} look`}>
      <div className="skill-look-main">
        <Pick label={`${name} element`} text="Element" value={look.element} options={ELEMENTS} labels={ELEMENT_LABEL} onChange={(element?: Element) => element && onLook((l) => ({ ...l, element, palette: [...ELEMENT_LOOKS[element].palette] }))} />
        <Pick label={`${name} form`} text="Form" value={formOf(look, kind)} options={formsFor(kind)} labels={FORM_LABEL} onChange={(form) => set({ form })} />
        <div className="palette" role="group" aria-label={`${name} palette`}>
          {PALETTE.map((part, i) => (
            <input
              key={part}
              type="color"
              title={part}
              aria-label={`${name} ${part.toLowerCase()} colour`}
              value={look.palette[i]}
              onChange={(e) => {
                const value = e.target.value
                onLook((l) => ({ ...l, palette: l.palette.map((c, k) => (k === i ? value : c)) as SkillLook['palette'] }))
              }}
            />
          ))}
        </div>
      </div>
      <details className="skill-look-more">
        <summary>More of the look</summary>
        <div className="skill-look-grid">
          <Pick label="Cast pose" value={look.pose} options={CAST_POSES} labels={POSE_LABEL} empty="As it fits" onChange={(pose) => set({ pose })} />
          <Pick label="Charge" value={look.charge} options={CHARGES} labels={CHARGE_LABEL} empty="None" onChange={(charge) => set({ charge })} />
          <Pick label="Impact" value={look.impact} options={IMPACTS} labels={IMPACT_LABEL} empty="The element's" onChange={(impact) => set({ impact })} />
          <Pick label="Trail" value={look.trail} options={TRAILS} labels={TRAIL_LABEL} empty="The element's" onChange={(trail) => set({ trail })} />
          {look.trail === 'motif' && <Pick label="Motif" value={look.motif} options={MOTIFS} labels={MOTIF_LABEL} empty="The element's" onChange={(motif) => set({ motif })} />}
          <label className="look-check">
            <input type="checkbox" checked={!!look.callout} onChange={(e) => set({ callout: e.target.checked || undefined })} />
            <span>Call out its name</span>
          </label>
          <label className="slider compact">
            <span>Brightness</span>
            <input type="range" min={0.5} max={2} step={0.05} aria-label={`${name} brightness`} value={look.intensity ?? 1} onChange={(e) => set({ intensity: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })} />
          </label>
        </div>
      </details>
    </div>
  )
}

/** A colour a form may change or leave alone: off keeps the hero's own, on picks the new one. */
function OptionalColor({ label, text, value, fallback, onChange }: { label: string; text: string; value: string | undefined; fallback: string; onChange: (value: string | undefined) => void }) {
  return (
    <span className="look-check">
      <input type="checkbox" aria-label={text} checked={!!value} onChange={(e) => onChange(e.target.checked ? fallback : undefined)} />
      <span>{text}</span>
      {value && <input type="color" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />}
    </span>
  )
}

/** A transformation template's size change against the hero's own: grow, keep or shrink, and to what. */
function sizeLabel(template: Template, own: keyof typeof SIZES): string {
  const size = transformOf(template)?.size
  if (!size) return 'Keep its size'
  const [to, from] = [SIZES[size].scale, SIZES[own].scale]
  return `${to > from ? 'Grow' : to < from ? 'Shrink' : 'Stay'} · ${SIZES[size].label}`
}

const HAIR = LIBRARY.filter((e) => e.slot === 'hair')
// what a form can put on over the outfit: built-in surface items for the head, the body and the back
const FORM_WEAR = LIBRARY.filter((e) => ['head', 'upper', 'full', 'back'].includes(e.slot) && !isRigid(e) && e.source === 'built-in')
const byId = <T extends { id: string; name: string }>(list: readonly T[]) => Object.fromEntries(list.map((e) => [e.id, e.name])) as Record<string, string>

/**
 * A transformation's two halves. The template sets the size it takes (grow, keep or shrink), priced and balance-checked;
 * the look sets everything else: how it arrives, what surrounds the hero, how a size change plays, what it leaves as
 * it moves, an avatar, and what changes about the body. Titan, Ant-Man, Nine-Tails and Super Saiyan are all here.
 */
export function FormCard({ build, look, onSwap, onLook }: { build: Build; look: SkillLook | undefined; onSwap: (templateId: string) => void; onLook: (change: (look: SkillLook) => SkillLook) => void }) {
  const current = getTemplate(build.slots.ultimate.templateId)
  // the role's transformations, in the library's order, that the slot can swap to
  const allowed = new Set([current.id, ...swapOptions(build, 'ultimate').map((t) => t.id)])
  const options = poolFor(build.roleId, 'ultimate').filter((t) => transformOf(t) && allowed.has(t.id))
  const own = build.sizeClass ?? 'medium'
  const form = formLookOf(look)
  const body = form.body ?? {}
  const resizes = !!transformOf(current)?.size
  const set = (patch: Partial<TransformationLook>) => onLook((l) => ({ ...l, transformation: { ...formLookOf(l), ...patch } }))
  const setBody = (patch: Partial<FormBody>) => onLook((l) => ({ ...l, transformation: { ...formLookOf(l), body: { ...formLookOf(l).body, ...patch } } }))
  const worn = body.wear?.[0]
  return (
    <fieldset className="form-card">
      <legend>Transformation</legend>
      {options.length > 1 && (
        <div className="seg" role="radiogroup" aria-label="Transformation size">
          {options.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === current.id} className={t.id === current.id ? 'on' : ''} title={t.name} onClick={() => t.id !== current.id && onSwap(t.id)}>
              {sizeLabel(t, own)}
            </button>
          ))}
        </div>
      )}
      <div className="skill-look-grid">
        <Pick label="Entry" value={form.entry} options={FORM_ENTRIES} labels={FORM_ENTRY_LABEL} onChange={(entry) => entry && set({ entry })} />
        <Pick label="Aura" value={form.aura} options={FORM_AURAS} labels={FORM_AURA_LABEL} empty="None" onChange={(aura) => set({ aura })} />
        {resizes && <Pick label="Change of size" value={form.growth} options={FORM_GROWTHS} labels={FORM_GROWTH_LABEL} onChange={(growth) => growth && set({ growth })} />}
        <Pick label="Trail" value={form.trail} options={FORM_TRAILS} labels={FORM_TRAIL_LABEL} empty="None" onChange={(trail) => set({ trail })} />
        <Pick label="Avatar" value={form.avatar} options={FORM_AVATARS} labels={FORM_AVATAR_LABEL} empty="None" onChange={(avatar) => set({ avatar })} />
        <Pick label="Form hair" value={body.hair} options={HAIR.map((e) => e.id)} labels={byId(HAIR)} empty="Its own hair" onChange={(hair) => setBody({ hair })} />
        <OptionalColor label="Form hair colour" text="Dye the hair" value={body.hairColor} fallback="#ffd23a" onChange={(hairColor) => setBody({ hairColor })} />
        <OptionalColor label="Form eye colour" text="Change the eyes" value={body.eyes} fallback="#3ad2ff" onChange={(eyes) => setBody({ eyes })} />
        <label className="look-check">
          <input type="checkbox" checked={body.marks === 'whiskers'} onChange={(e) => setBody({ marks: e.target.checked ? 'whiskers' : undefined })} />
          <span>Whisker marks</span>
        </label>
        <Pick label="Form wears" value={worn?.id} options={FORM_WEAR.map((e) => e.id)} labels={byId(FORM_WEAR)} empty="Nothing more" onChange={(id) => setBody({ wear: id ? [{ id, ...(worn?.colors ? { colors: worn.colors } : {}) }] : undefined })} />
        {worn && (
          <label className="swatch inline">
            <input type="color" aria-label="Form wears colour" value={worn.colors?.[0] ?? FORM_WEAR.find((e) => e.id === worn.id)?.channels[0]?.color ?? '#ff7400'} onChange={(e) => setBody({ wear: [{ ...worn, colors: [e.target.value, ...(worn.colors?.slice(1) ?? [])] }] })} />
            <span>Colour</span>
          </label>
        )}
      </div>
    </fieldset>
  )
}
