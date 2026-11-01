import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { HeroLook } from '../../../charter/look.js'
import { HEAD_SHAPES, HEAD_SHAPE_LABEL, REGION_LABEL, SCULPT_FEATURES, SCULPT_REGIONS, shapeId, type HeadShape, type Sculpt, type SculptFeature, type SculptRegion } from '../../../kit/body/sculpt.js'

/** The two features each region's pad moves: across, then up. */
const PAD: Record<SculptRegion, [string, string]> = {
  head: ['head_width', 'head_length'],
  forehead: ['forehead_temples', 'forehead_height'],
  brows: ['brow_angle', 'brow_height'],
  eyes: ['eye_spacing', 'eye_height'],
  ears: ['ear_size', 'ear_position'],
  nose: ['nose_width', 'nose_length'],
  cheeks: ['cheek_volume', 'cheekbones'],
  mouth: ['mouth_width', 'mouth_height'],
  jaw: ['chin_width', 'chin_height'],
  neck: ['neck_width', 'neck_length'],
}

const FEATURE = new Map(SCULPT_FEATURES.map((f) => [f.id, f]))
const round = (v: number) => Math.round(Math.min(1, Math.max(-1, v)) * 100) / 100

/** The look with one feature set (0 takes it off), and nothing left behind when the whole sculpt is back to as made. */
export function withSculpt(look: HeroLook, changes: Sculpt): HeroLook {
  const sculpt: Sculpt = { ...look.sculpt }
  for (const [id, v] of Object.entries(changes)) {
    if (v) sculpt[id] = round(v)
    else delete sculpt[id]
  }
  const { sculpt: _old, ...rest } = look
  return Object.keys(sculpt).length ? { ...rest, sculpt } : rest
}

interface Props {
  /** The look as drawn. */
  look: HeroLook
  /** True when a reference image has a face the hero can wear. */
  canFace: boolean
  onLook: (change: (look: HeroLook) => HeroLook) => void
  onFace: (on: boolean) => void
  /** The region being sculpted, so the stage can frame it. */
  onRegion?: (region: SculptRegion) => void
}

/**
 * The face, sculpted like a player creator's head editor: the photo face and how much of its shape the hero takes,
 * then region by region (the head's shape, eyes, nose, mouth, cheeks, jaw and chin) a pad that moves two features at
 * once and a slider for each. Every slider runs from one end to the other with the face as made, or as the photo
 * fitted it, in the middle; a double-click puts one back.
 */
export function SculptPanel({ look, canFace, onLook, onFace, onRegion }: Props) {
  const [region, setRegion] = useState<SculptRegion>('head')
  const sculpt = look.sculpt ?? {}
  const strength = look.face?.strength ?? 1
  const set = (changes: Sculpt) => onLook((l) => withSculpt(l, changes))
  const features = SCULPT_FEATURES.filter((f) => f.region === region)
  const touched = (r: SculptRegion) => SCULPT_FEATURES.some((f) => f.region === r && sculpt[f.id]) || (r === 'head' && HEAD_SHAPES.some((s) => sculpt[shapeId(s)]))
  const shape = HEAD_SHAPES.find((s) => sculpt[shapeId(s)])
  const pick = (r: SculptRegion) => {
    setRegion(r)
    onRegion?.(r)
  }

  return (
    <div className="sculpt">
      <div className="maker-group">
        <div className="maker-row">
          <span className="field-label">Photo face</span>
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
            <span className="muted look-hint">Add a clear, front-on photo and your hero wears that face. Photos go in Ask; sculpt the face from there.</span>
          )}
        </div>
      </div>

      <div className="region-tabs" role="tablist" aria-label="Face regions">
        {SCULPT_REGIONS.map((r) => (
          <button key={r} type="button" role="tab" aria-selected={region === r} className={`region-tab${region === r ? ' on' : ''}`} onClick={() => pick(r)}>
            {REGION_LABEL[r]}
            {touched(r) && <i className="worn-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>

      <div className="region" role="tabpanel" aria-label={REGION_LABEL[region]}>
        {region === 'head' && (
          <div className="maker-group">
            <span className="field-label">Shape</span>
            <div className="shape-tiles" role="radiogroup" aria-label="Head shape">
              <button type="button" role="radio" aria-checked={!shape} className={`shape-tile${shape ? '' : ' on'}`} onClick={() => set(Object.fromEntries(HEAD_SHAPES.map((s) => [shapeId(s), 0])))}>
                <HeadOutline shape={undefined} />
                <span>Natural</span>
              </button>
              {HEAD_SHAPES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={shape === s} className={`shape-tile${shape === s ? ' on' : ''}`} onClick={() => set(Object.fromEntries(HEAD_SHAPES.map((o) => [shapeId(o), o === s ? (sculpt[shapeId(s)] ?? 0.6) : 0])))}>
                  <HeadOutline shape={s} />
                  <span>{HEAD_SHAPE_LABEL[s]}</span>
                </button>
              ))}
            </div>
            {shape && (
              <label className="sculpt-slider">
                <span className="sculpt-label">How far</span>
                <input type="range" min={0} max={1} step={0.01} aria-label={`${HEAD_SHAPE_LABEL[shape]} head`} value={sculpt[shapeId(shape)] ?? 0} onChange={(e) => set({ [shapeId(shape)]: Math.max(0.01, Number(e.target.value)) })} />
                <output>{Math.round((sculpt[shapeId(shape)] ?? 0) * 100)}</output>
              </label>
            )}
          </div>
        )}

        <Pad x={FEATURE.get(PAD[region][0])!} y={FEATURE.get(PAD[region][1])!} sculpt={sculpt} onChange={set} />

        <div className="sculpt-sliders">
          {features.map((f) => (
            <SculptSlider key={f.id} feature={f} value={sculpt[f.id] ?? 0} onChange={(v) => set({ [f.id]: v })} />
          ))}
        </div>

        <div className="maker-actions">
          <button
            type="button"
            className="btn sm ghost"
            disabled={!touched(region)}
            onClick={() => set(Object.fromEntries([...features.map((f) => [f.id, 0]), ...(region === 'head' ? HEAD_SHAPES.map((s) => [shapeId(s), 0]) : [])]))}
          >
            Reset {REGION_LABEL[region].toLowerCase()}
          </button>
          <button type="button" className="btn sm ghost" disabled={!look.sculpt} onClick={() => onLook((l) => withSculpt(l, Object.fromEntries(Object.keys(l.sculpt ?? {}).map((id) => [id, 0]))))}>
            Reset whole face
          </button>
        </div>
      </div>
    </div>
  )
}

function SculptSlider({ feature, value, onChange }: { feature: SculptFeature; value: number; onChange: (v: number) => void }) {
  return (
    <label className={`sculpt-slider${value ? ' moved' : ''}`} onDoubleClick={() => onChange(0)} title="Double-click to put it back">
      <span className="sculpt-label">{feature.label}</span>
      <input type="range" min={-1} max={1} step={0.01} aria-label={feature.label} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--v': `${(value + 1) * 50}%` } as CSSProperties} />
      <output>{value > 0 ? '+' : ''}{Math.round(value * 100)}</output>
      <small aria-hidden="true">
        <span>{feature.low}</span>
        <span>{feature.high}</span>
      </small>
    </label>
  )
}

/**
 * Two features on one square: drag the point across for the first and up for the second. The sliders below say the
 * same, so the pad is for the hand and not announced.
 */
function Pad({ x, y, sculpt, onChange }: { x: SculptFeature; y: SculptFeature; sculpt: Sculpt; onChange: (changes: Sculpt) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const vx = sculpt[x.id] ?? 0
  const vy = sculpt[y.id] ?? 0
  const from = (e: ReactPointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    onChange({ [x.id]: round(((e.clientX - r.left) / r.width) * 2 - 1), [y.id]: round(1 - ((e.clientY - r.top) / r.height) * 2) })
  }
  return (
    <div className="pad-wrap" aria-hidden="true">
      <span className="pad-axis top">{y.high}</span>
      <div
        ref={box}
        className="pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId)
          from(e)
        }}
        onPointerMove={(e) => e.buttons & 1 && from(e)}
        onDoubleClick={() => onChange({ [x.id]: 0, [y.id]: 0 })}
      >
        <i className="pad-cross" />
        <i className="pad-puck" style={{ left: `${(vx + 1) * 50}%`, top: `${(1 - vy) * 50}%` }} />
      </div>
      <span className="pad-axis bottom">{y.low}</span>
      <span className="pad-axis left">{x.low}</span>
      <span className="pad-axis right">{x.high}</span>
    </div>
  )
}

/** A head shape's outline, for its tile. */
function HeadOutline({ shape }: { shape: HeadShape | undefined }) {
  const d: Record<HeadShape | 'natural', string> = {
    natural: 'M12 3C8 3 6 6.5 6 10.5S8.5 21 12 21s6-6.5 6-10.5S16 3 12 3z',
    oval: 'M12 2.5C8.2 2.5 6.2 6.5 6.2 11S8.6 21.5 12 21.5 17.8 15.5 17.8 11 15.8 2.5 12 2.5z',
    round: 'M12 3.5c-4.4 0-7 3.6-7 8.2S7.8 20.5 12 20.5s7-4.2 7-8.8S16.4 3.5 12 3.5z',
    square: 'M6 5.5C6 4 7.5 3 12 3s6 1 6 2.5v10c0 2.5-2.5 5.5-6 5.5s-6-3-6-5.5z',
    rectangular: 'M7 3.5C7 2.6 8.5 2 12 2s5 .6 5 1.5v13.5c0 2.5-2 5-5 5s-5-2.5-5-5z',
    triangular: 'M9 3.5c1-.8 5-.8 6 0 1.5 1.5 4 9 4 11.5 0 3-3 6-7 6s-7-3-7-6c0-2.5 2.5-10 4-11.5z',
    invertedtriangular: 'M5.5 6C5.5 3.5 8 3 12 3s6.5.5 6.5 3c0 4-3.5 15-6.5 15S5.5 10 5.5 6z',
    diamond: 'M12 2.5c1.5 0 6.5 5 6.5 8.5S14 21.5 12 21.5 5.5 14.5 5.5 11 10.5 2.5 12 2.5z',
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={d[shape ?? 'natural']} />
    </svg>
  )
}
