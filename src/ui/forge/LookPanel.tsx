import { BEARD_LABEL, BEARD_STYLES, GENDER_LABEL, HAIR_LABEL, HAIR_STYLES, LOOK_COLOR_LABEL, type HeroLook, type LookColor } from '../../charter/look.js'

const SWATCHES: LookColor[] = ['skin', 'hair', 'iris', 'suit', 'trim', 'pants', 'cape', 'metal']

interface Props {
  /** The look as drawn, every colour filled in. */
  look: HeroLook & { colors: Record<LookColor, string> }
  /** True when a reference image has a face the hero can wear. */
  canFace: boolean
  onChange: (patch: Partial<Omit<HeroLook, 'colors' | 'face'>> & { colors?: Partial<Record<LookColor, string>> }) => void
  onFace: (on: boolean) => void
}

/**
 * How the hero looks, all of it cosmetic: the body (its size comes from the size picker), hair, beard, armour and cape, the
 * photo face, and a colour for each part. Nothing here changes a number, so the balance check keeps its result.
 */
export function LookPanel({ look, canFace, onChange, onFace }: Props) {
  return (
    <section className="look-panel" aria-label="Look">
      <header className="look-head">
        <h2 className="section-title">Look</h2>
        <p className="muted">Cosmetic only. The engine never reads any of it.</p>
      </header>
      <div className="look-rows">
        <div className="look-row">
          <span className="field-label">Body</span>
          <div className="seg" role="radiogroup" aria-label="Body">
            {(['m', 'f'] as const).map((g) => (
              <button key={g} type="button" role="radio" aria-checked={look.gender === g} className={look.gender === g ? 'on' : ''} onClick={() => onChange({ gender: g })}>
                {GENDER_LABEL[g]}
              </button>
            ))}
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Hair</span>
          <div className="seg" role="radiogroup" aria-label="Hair">
            {HAIR_STYLES.map((h) => (
              <button key={h} type="button" role="radio" aria-checked={look.hair === h} className={look.hair === h ? 'on' : ''} onClick={() => onChange({ hair: h })}>
                {HAIR_LABEL[h]}
              </button>
            ))}
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Beard</span>
          <div className="seg" role="radiogroup" aria-label="Beard">
            {BEARD_STYLES.map((b) => {
              const on = (look.beard ?? 'none') === b
              return (
                <button key={b} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} onClick={() => onChange({ beard: b })}>
                  {BEARD_LABEL[b]}
                </button>
              )
            })}
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Wear</span>
          <div className="seg">
            <button type="button" aria-pressed={look.armour} className={look.armour ? 'on' : ''} onClick={() => onChange({ armour: !look.armour })}>
              Armour
            </button>
            <button type="button" aria-pressed={look.cape} className={look.cape ? 'on' : ''} onClick={() => onChange({ cape: !look.cape })}>
              Cape
            </button>
          </div>
        </div>
        <div className="look-row">
          <span className="field-label">Face</span>
          {canFace ? (
            <div className="seg">
              <button type="button" aria-pressed={!!look.face} className={look.face ? 'on' : ''} onClick={() => onFace(!look.face)}>
                Photo face
              </button>
            </div>
          ) : (
            <span className="muted look-hint">Add a clear, front-on photo and your hero wears that face.</span>
          )}
        </div>
      </div>
      <div className="swatches">
        {SWATCHES.map((region) => (
          <label key={region} className="swatch">
            <input type="color" aria-label={`${LOOK_COLOR_LABEL[region]} colour`} value={look.colors[region]} onChange={(e) => onChange({ colors: { [region]: e.target.value } })} />
            <span>{LOOK_COLOR_LABEL[region]}</span>
          </label>
        ))}
      </div>
    </section>
  )
}
