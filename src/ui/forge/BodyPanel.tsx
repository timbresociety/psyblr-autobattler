import { GENDER_LABEL, LOOK_COLOR_LABEL, type HeroLook, type LookColor } from '../../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../../kit/body/shape.js'

/** The physique sliders: where each runs from and to. Weight and muscle sit at the middle as made, age at the start. */
const PHYSIQUE: { key: keyof Physique; label: string; from: string; to: string }[] = [
  { key: 'weight', label: 'Weight', from: 'Slight', to: 'Heavy' },
  { key: 'muscle', label: 'Muscle', from: 'Soft', to: 'Built' },
  { key: 'age', label: 'Age', from: 'Young', to: '75' },
]

const BODY_COLORS: LookColor[] = ['skin', 'iris', 'brow']

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
 * brows, and a photo face with how much of the photo's shape it takes. What it wears is the Wardrobe's.
 */
export function BodyPanel({ look, canFace, onLook, onFace }: Props) {
  const physique = { ...NEUTRAL_PHYSIQUE, ...look.physique }
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
