import { HEIGHT_RANGE, JIGGLE_PRESETS, POSTURES, PRESETS, presetDials, REGIONAL_DIALS, type ArchetypeId, type NumericDial, type PhysiqueDials, type RegionalDial } from '../../kit/body/physique.js'
import { GENDER_LABEL, LOOK_COLOR_LABEL, type HeroLook, type LookColor } from '../../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../../kit/body/shape.js'

/** The physique sliders: where each runs from and to. Weight and muscle sit at the middle as made, age at the start. */
const PHYSIQUE: { key: NumericDial; label: string; from: string; to: string }[] = [
  { key: 'weight', label: 'Weight', from: 'Slight', to: 'Heavy' },
  { key: 'muscle', label: 'Muscle', from: 'Soft', to: 'Built' },
  { key: 'age', label: 'Age', from: 'Young', to: '75' },
]

/** Structure (GAME.md §9.3): bone lengths and placement. Each runs 0 to 1 with the middle the body as made. */
const STRUCTURE: { key: NumericDial; label: string; from: string; to: string }[] = [
  { key: 'head', label: 'Head', from: 'Heroic', to: 'Chibi' },
  { key: 'legs', label: 'Legs', from: 'Short', to: 'Long' },
  { key: 'arms', label: 'Arms', from: 'Short', to: 'Long' },
  { key: 'torso', label: 'Torso', from: 'Short', to: 'Long' },
  { key: 'shoulders', label: 'Shoulders', from: 'Narrow', to: 'Broad' },
  { key: 'chestDepth', label: 'Chest depth', from: 'Flat', to: 'Deep' },
  { key: 'ribcage', label: 'Rib cage', from: 'Narrow', to: 'Wide' },
  { key: 'hipWidth', label: 'Hip width', from: 'Narrow', to: 'Wide' },
  { key: 'pelvisTilt', label: 'Pelvis tilt', from: 'Tucked', to: 'Arched' },
  { key: 'neck', label: 'Neck length', from: 'Short', to: 'Long' },
  { key: 'neckThickness', label: 'Neck thickness', from: 'Thin', to: 'Bull' },
  { key: 'hands', label: 'Hands', from: 'Small', to: 'Big' },
  { key: 'feet', label: 'Feet', from: 'Small', to: 'Big' },
]

/** Volume (§9.3): mass and shape, past weight, muscle and age. `adult` dials are for an adult figure only. */
const VOLUME: { key: NumericDial; label: string; from: string; to: string; adult?: boolean; women?: boolean }[] = [
  { key: 'definition', label: 'Definition', from: 'Smooth', to: 'Cut' },
  { key: 'waist', label: 'Waist', from: 'Narrow', to: 'Wide' },
  { key: 'belly', label: 'Belly', from: 'Flat', to: 'Round' },
  { key: 'hipCurve', label: 'Hips', from: 'Straight', to: 'Curved', adult: true },
  { key: 'glutes', label: 'Glutes', from: 'Flat', to: 'Full', adult: true },
  { key: 'thighs', label: 'Thighs', from: 'Slim', to: 'Thick' },
  { key: 'bustSize', label: 'Bust size', from: 'Small', to: 'Large', adult: true, women: true },
  { key: 'bustShape', label: 'Bust shape', from: 'Round', to: 'Teardrop', adult: true, women: true },
  { key: 'bustSpacing', label: 'Bust spacing', from: 'Close', to: 'Wide', adult: true, women: true },
  { key: 'bustLift', label: 'Bust lift', from: 'Low', to: 'High', adult: true, women: true },
]

const REGION_LABEL: Record<RegionalDial, string> = { traps: 'Traps', delts: 'Shoulders', pecs: 'Chest', arms: 'Arms', forearms: 'Forearms', lats: 'Back', glutes: 'Glutes', quads: 'Thighs', calves: 'Calves', abs: 'Abs and obliques' }
const POSTURE_LABEL: Record<(typeof POSTURES)[number], string> = { upright: 'Upright', heroic: 'Heroic', hunched: 'Hunched', stoop: 'Stooped' }
const JIGGLE_LABEL: Record<(typeof JIGGLE_PRESETS)[number], string> = { off: 'Off', realistic: 'Realistic', anime: 'Anime' }

const BODY_COLORS: LookColor[] = ['skin', 'iris', 'brow']

/** One 0-to-1 dial. */
function Dial({ label, from, to, value, min = 0, max = 1, step = 0.01, shown, onChange }: { label: string; from: string; to: string; value: number; min?: number; max?: number; step?: number; shown?: string; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {shown && <output>{shown}</output>}
      <small aria-hidden="true">
        <span>{from}</span>
        <span>{to}</span>
      </small>
    </label>
  )
}

interface Props {
  /** The look as drawn, every colour filled in. */
  look: HeroLook & { colors: Record<LookColor, string> }
  /** True when a reference image has a face the hero can wear. */
  canFace: boolean
  onLook: (change: (look: HeroLook) => HeroLook) => void
  onFace: (on: boolean) => void
}

/**
 * The hero's body, all of it cosmetic: man or woman, how it's built (the size picker sets how big), its skin, eyes and
 * brows, and a photo face with how much of the photo's shape it takes. Heroes are drawn bare (2026-11-04).
 */
export function BodyPanel({ look, canFace, onLook, onFace }: Props) {
  const physique: PhysiqueDials = { ...NEUTRAL_PHYSIQUE, ...look.physique }
  const set = (change: Partial<PhysiqueDials>) => onLook((l) => ({ ...l, physique: { ...NEUTRAL_PHYSIQUE, ...l.physique, ...change } }))
  const pick = (id: ArchetypeId) => {
    const p = PRESETS.find((a) => a.id === id)!
    onLook((l) => ({ ...l, gender: p.gender, physique: presetDials(id) }))
  }
  const value = (key: NumericDial) => (typeof physique[key] === 'number' ? (physique[key] as number) : 0.5)
  const strength = look.face?.strength ?? 1
  return (
    <section className="look-panel body-panel" aria-label="Body and face">
      <header className="look-head">
        <h2 className="section-title">Body</h2>
        <p className="muted">Cosmetic only. The size picker sets how big the hero is; this sets how it's built.</p>
      </header>
      <div className="look-rows">
        <div className="look-row">
          <span className="field-label">Body</span>
          <div className="seg" role="radiogroup" aria-label="Body">
            {(['m', 'f'] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={look.gender === g} className={look.gender === g ? 'on' : ''} onClick={() => onLook((l) => ({ ...l, gender: g }))}>
                {GENDER_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Build</span>
          <div className="seg wrap" role="radiogroup" aria-label="Build">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={physique.preset === p.id} className={physique.preset === p.id ? 'on' : ''} title={p.examples.join(' · ')} onClick={() => pick(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Face</span>
          {canFace ? (
            <div className="face-row">
              <div className="seg">
                <button type="button" aria-pressed={!!look.face} className={look.face ? 'on' : ''} onClick={() => onFace(!look.face)}>
                  Photo face
                </button>
              </div>
              {look.face && (
                <label className="slider compact">
                  <span>Likeness</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    aria-label="Likeness"
                    value={strength}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      onLook((l) => (l.face ? { ...l, face: { ...l.face, strength: value } } : l))
                    }}
                  />
                  <output>{Math.round(strength * 100)}%</output>
                </label>
              )}
            </div>
          ) : (
            <span className="muted look-hint">Add a clear, front-on photo and your hero wears that face.</span>
          )}
        </div>
      </div>
      <div className="sliders">
        {PHYSIQUE.map(({ key, label, from, to }) => (
          <label key={key} className="slider">
            <span>{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              aria-label={label}
              value={physique[key]}
              onChange={(e) => {
                const value = Number(e.target.value)
                onLook((l) => ({ ...l, physique: { ...NEUTRAL_PHYSIQUE, ...l.physique, [key]: value } }))
              }}
            />
            <small aria-hidden="true">
              <span>{from}</span>
              <span>{to}</span>
            </small>
          </label>
        ))}
      </div>
      <details className="look-more">
        <summary>Structure</summary>
        <div className="sliders">
          <Dial label="Height" from={`${HEIGHT_RANGE[0]} m`} to={`${HEIGHT_RANGE[1]} m`} min={HEIGHT_RANGE[0]} max={HEIGHT_RANGE[1]} value={physique.height ?? 1.8} shown={`${(physique.height ?? 1.8).toFixed(2)} m`} onChange={(v) => set({ height: v })} />
          {STRUCTURE.map(({ key, label, from, to }) => (
            <Dial key={key} label={label} from={from} to={to} value={value(key)} onChange={(v) => set({ [key]: v })} />
          ))}
        </div>
        <div className="look-row">
          <span className="field-label">Posture</span>
          <div className="seg" role="radiogroup" aria-label="Posture">
            {POSTURES.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={(physique.posture ?? 'upright') === p} className={(physique.posture ?? 'upright') === p ? 'on' : ''} onClick={() => set({ posture: p })}>
                {POSTURE_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      </details>
      <details className="look-more">
        <summary>Volume</summary>
        <div className="sliders">
          {VOLUME.filter((d) => !(d.adult && physique.child) && !(d.women && look.gender !== 'f')).map(({ key, label, from, to }) => (
            <Dial key={key} label={label} from={from} to={to} value={value(key)} onChange={(v) => set({ [key]: v })} />
          ))}
        </div>
        <p className="muted">Muscle by region, against the overall muscle above.</p>
        <div className="sliders">
          {REGIONAL_DIALS.map((r) => (
            <Dial key={r} label={REGION_LABEL[r]} from="Less" to="More" value={physique.regional?.[r] ?? 0.5} onChange={(v) => set({ regional: { ...physique.regional, [r]: v } })} />
          ))}
        </div>
      </details>
      <div className="look-row">
        <span className="field-label">Jiggle</span>
        <div className="seg" role="radiogroup" aria-label="Jiggle">
          {JIGGLE_PRESETS.map((j) => (
            <button key={j} type="button" role="radio" aria-checked={(physique.jiggle ?? 'realistic') === j} className={(physique.jiggle ?? 'realistic') === j ? 'on' : ''} onClick={() => set({ jiggle: j })}>
              {JIGGLE_LABEL[j]}
            </button>
          ))}
        </div>
      </div>
      <div className="swatches">
        {BODY_COLORS.map((region) => (
          <label key={region} className="swatch">
            <input type="color" aria-label={`${LOOK_COLOR_LABEL[region]} colour`} value={look.colors[region]} onChange={(e) => onLook((l) => ({ ...l, colors: { ...l.colors, [region]: e.target.value } }))} />
            <span>{LOOK_COLOR_LABEL[region]}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
