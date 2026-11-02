import { GENDER_LABEL, LOOK_COLOR_LABEL, type HeroLook, type LookColor } from '../../../charter/look.js'
import { NEUTRAL_PHYSIQUE, type Physique } from '../../../kit/body/shape.js'

/** Skin tones from the fairest to the deepest, and eye and brow colours, for one click; a picker takes any other. */
const TONES: Record<'skin' | 'iris' | 'brow', { hex: string; name: string }[]> = {
  skin: [
    ['#f6dcc8', 'Porcelain'],
    ['#f0cdb1', 'Ivory'],
    ['#e8bd9b', 'Sand'],
    ['#dcab86', 'Beige'],
    ['#cf9a73', 'Honey'],
    ['#c08661', 'Golden'],
    ['#b07351', 'Caramel'],
    ['#9c6244', 'Bronze'],
    ['#87533a', 'Chestnut'],
    ['#734530', 'Mocha'],
    ['#5e3826', 'Umber'],
    ['#4b2b1d', 'Espresso'],
    ['#3a2117', 'Ebony'],
    ['#2c1811', 'Onyx'],
  ].map(([hex, name]) => ({ hex, name })),
  iris: [
    ['#3a2414', 'Dark brown'],
    ['#5a3a22', 'Brown'],
    ['#8a6a3a', 'Hazel'],
    ['#b07a28', 'Amber'],
    ['#4f7a4a', 'Green'],
    ['#4a7aa8', 'Blue'],
    ['#7a98b8', 'Blue grey'],
    ['#8d8f94', 'Grey'],
    ['#1c1412', 'Black'],
  ].map(([hex, name]) => ({ hex, name })),
  brow: [
    ['#1a1210', 'Black'],
    ['#3b2416', 'Dark brown'],
    ['#5e3d24', 'Brown'],
    ['#8a6a44', 'Light brown'],
    ['#c9a46a', 'Blond'],
    ['#a03a1e', 'Auburn'],
    ['#d8d2c8', 'Grey'],
  ].map(([hex, name]) => ({ hex, name })),
}

const TONE_TITLE: Record<'skin' | 'iris' | 'brow', string> = { skin: 'Skin tone', iris: 'Eyes', brow: 'Brows' }

interface LookProps {
  /** The look as drawn, every colour filled in. */
  look: HeroLook & { colors: Record<LookColor, string> }
  onLook: (change: (look: HeroLook) => HeroLook) => void
}

/** Skin, eyes and brows: a row of tones each, and a picker for any colour. Under a photo face the skin is the photo's. */
export function SkinPanel({ look, onLook }: LookProps) {
  return (
    <div className="tones">
      {(['skin', 'iris', 'brow'] as const).map((region) => {
        const now = look.colors[region]
        return (
          <div key={region} className="maker-group">
            <span className="field-label">{TONE_TITLE[region]}</span>
            <div className="tone-row" role="radiogroup" aria-label={TONE_TITLE[region]}>
              {TONES[region].map((t) => (
                <button key={t.hex} type="button" role="radio" aria-checked={now === t.hex} aria-label={t.name} title={t.name} className={`tone${now === t.hex ? ' on' : ''}`} style={{ background: t.hex }} onClick={() => onLook((l) => ({ ...l, colors: { ...l.colors, [region]: t.hex } }))} />
              ))}
              <label className="tone custom" title="Any colour">
                <input type="color" aria-label={`${LOOK_COLOR_LABEL[region]} colour`} value={now} onChange={(e) => onLook((l) => ({ ...l, colors: { ...l.colors, [region]: e.target.value } }))} />
              </label>
            </div>
            {region === 'skin' && look.face && <p className="muted look-hint">The face keeps the photo's own skin; this tints the rest of the body to match it.</p>}
          </div>
        )
      })}
    </div>
  )
}

/** The physique sliders: where each runs from and to. Weight and muscle sit at the middle as made, age at the start. */
const PHYSIQUE: { key: keyof Physique; label: string; from: string; to: string }[] = [
  { key: 'weight', label: 'Weight', from: 'Slight', to: 'Heavy' },
  { key: 'muscle', label: 'Muscle', from: 'Soft', to: 'Built' },
  { key: 'age', label: 'Age', from: 'Young', to: '75' },
]

/** Proportions (src/kit/body/proportions.ts): with weight and muscle, a beanpole to a brute. */
const PROPORTION: { key: keyof Physique; label: string; from: string; to: string }[] = [
  { key: 'legs', label: 'Legs', from: 'Short', to: 'Long' },
  { key: 'arms', label: 'Arms', from: 'Short', to: 'Long' },
  { key: 'torso', label: 'Torso', from: 'Short', to: 'Long' },
  { key: 'shoulders', label: 'Shoulders', from: 'Narrow', to: 'Broad' },
  { key: 'neck', label: 'Neck', from: 'Short', to: 'Long' },
  { key: 'head', label: 'Head', from: 'Small', to: 'Big' },
]

/** Whole bodies to start from: each sets every slider, and any can be moved after. */
const SHAPES: { label: string; physique: Physique }[] = [
  { label: 'As made', physique: { weight: 0.5, muscle: 0.5, age: 0, legs: 0.5, arms: 0.5, torso: 0.5, shoulders: 0.5, neck: 0.5, head: 0.5 } },
  { label: 'Beanpole', physique: { weight: 0, muscle: 0.15, age: 0, legs: 1, arms: 1, torso: 0.75, shoulders: 0.2, neck: 0.85, head: 0.45 } },
  { label: 'Athlete', physique: { weight: 0.4, muscle: 0.8, age: 0, legs: 0.6, arms: 0.55, torso: 0.5, shoulders: 0.7, neck: 0.5, head: 0.45 } },
  { label: 'Heavyweight', physique: { weight: 0.95, muscle: 0.6, age: 0, legs: 0.35, arms: 0.45, torso: 0.6, shoulders: 0.75, neck: 0.25, head: 0.5 } },
  { label: 'Brute', physique: { weight: 0.7, muscle: 1, age: 0, legs: 0.55, arms: 0.6, torso: 0.6, shoulders: 1, neck: 0.15, head: 0.2 } },
]

/** The body, cosmetic only: man or woman, and how it's built and how old it looks. */
export function BuildPanel({ look, onLook }: LookProps) {
  const physique = { ...NEUTRAL_PHYSIQUE, ...look.physique }
  return (
    <div className="build-panel">
      <div className="maker-group">
        <span className="field-label">Body</span>
        <div className="seg" role="radiogroup" aria-label="Body">
          {(['m', 'f'] as const).map((g) => (
            <button key={g} type="button" role="radio" aria-checked={look.gender === g} className={look.gender === g ? 'on' : ''} onClick={() => onLook((l) => ({ ...l, gender: g }))}>
              {GENDER_LABEL[g]}
            </button>
          ))}
        </div>
      </div>
      <div className="maker-group">
        <span className="field-label">Start from</span>
        <div className="chip-grid">
          {SHAPES.map((shape) => (
            <button key={shape.label} type="button" className="chip" onClick={() => onLook((l) => ({ ...l, physique: { ...shape.physique, age: l.physique?.age ?? 0 } }))}>
              {shape.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sculpt-sliders">
        {[...PHYSIQUE, ...PROPORTION].map(({ key, label, from, to }) => (
          <label key={key} className="sculpt-slider">
            <span className="sculpt-label">{label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              aria-label={label}
              value={physique[key] ?? 0.5}
              onChange={(e) => {
                const value = Number(e.target.value)
                onLook((l) => ({ ...l, physique: { ...NEUTRAL_PHYSIQUE, ...l.physique, [key]: value } }))
              }}
            />
            <output>{Math.round((physique[key] ?? 0.5) * 100)}</output>
            <small aria-hidden="true">
              <span>{from}</span>
              <span>{to}</span>
            </small>
          </label>
        ))}
      </div>
    </div>
  )
}
