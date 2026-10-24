import { useEffect, useRef, useState } from 'react'
import { WEAR_SLOTS, type HeroLook, type LookSlot, type PieceKind, type WearSlot, type Worn, type WornPrint } from '../../charter/look.js'
import { PIECE_PRICE } from '../../forge/pricing.js'
import { slotFor } from '../../kit/pieces.js'
import type { GearGap } from '../../kit/resolve.js'
import { FINISHES, type Finish, type ItemChannel, type Knob } from '../../kit/wear/item.js'
import type { LibraryEntry } from '../../kit/wear/library.js'
import { PRINTS, PRINT_LABEL, PRINT_SCALE, drawPrint, inkFor, type PrintId } from '../../kit/wear/prints.js'
import type { PieceDeps } from '../api'
import { PieceGenerator } from './PieceGenerator'
import { FINISH_LABEL, KNOB_LABEL, LOOK_SLOT_LABEL, RUNGS, RUNG_LABEL, WARDROBE_TABS, asMade, editWorn, isRigid, itemOfPiece, itemsFor, rungOf, setChannel, wardrobeOf, wearIn, type Rung, type WardrobeTab } from './wardrobe'

interface Props {
  /** The look as drawn (a look from before the wardrobe is read into items in its colours). */
  look: HeroLook
  /** Every item the strips can offer: the library, then community items from the repository. */
  catalog: readonly LibraryEntry[]
  onLook: (change: (look: HeroLook) => HeroLook) => void
  /** The repository: search it and generate what it lacks. Without it the strips offer the library alone. */
  pieces?: PieceDeps
  /** What the prompt asked for that the repository doesn't have. */
  gaps?: GearGap[]
  /** An uploaded reference image: a print can be lifted from it, and a new item modelled on it. */
  referenceUrl?: string
  /** Items found in a search or just generated, for the catalog. */
  onFound?: (entries: LibraryEntry[]) => void
}

/** What a gear slot's generated piece is made as; the six wardrobe slots make garments instead. */
const PIECE_KIND: Partial<Record<LookSlot, PieceKind>> = { head: 'head', back: 'back', face: 'face', hand_r: 'hand', hand_l: 'hand' }
const isWearSlot = (slot: LookSlot): slot is WearSlot => (WEAR_SLOTS as readonly string[]).includes(slot)
const canGenerate = (slot: LookSlot) => isWearSlot(slot) || !!PIECE_KIND[slot]
const tabOf = (slot: LookSlot): WardrobeTab => WARDROBE_TABS.find((t) => (t.slots as readonly LookSlot[]).includes(slot))!.id

/** Where a gap from the prompt goes: a hand piece in the first free hand. */
const gapSlot = (gap: GearGap, wear: Partial<Record<LookSlot, Worn>>): LookSlot => (gap.kind === 'hand' && wear.hand_r ? 'hand_l' : slotFor(gap.kind))

/** A worn community item the catalog hasn't loaded (a saved hero's): enough to show it, its thumbnail beside its file. */
const stub = (worn: Worn, slot: LookSlot): LibraryEntry => ({ id: worn.id, name: 'Community item', slot: slot === 'hand_r' || slot === 'hand_l' ? 'hand' : slot, tags: [], url: worn.url, thumb: worn.url.replace(/\.glb$/, '.webp'), source: 'community', channels: [], knobs: [] })

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
/** A channel's colour control, named for the item, and for the channel when the item has more than one part. */
const channelLabel = (entry: LibraryEntry, c: ItemChannel) => (entry.channels.length === 1 || c.name.toLowerCase() === entry.name.toLowerCase() ? entry.name : `${entry.name} ${c.name}`)

interface Making {
  slot: LookSlot
  phrase?: string
  kind?: PieceKind
}

/**
 * The wardrobe: hair and beard, the six slots (over the head, upper body, lower body, full body, back, feet) and gear
 * on the face and in the hands, a tab each, with search across the library and the community's items. What's worn
 * shows the four rungs: wear it as made, recolour its parts and finishes, restyle it with a print and its cuts, or
 * generate a new one for credits. All free but the last, and all cosmetic.
 */
export function WardrobePanel({ look, catalog, onLook, pieces, gaps = [], referenceUrl, onFound }: Props) {
  const [tab, setTab] = useState<WardrobeTab>('hair')
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState<Making | null>(null)
  const wear = wardrobeOf(look)
  const q = query.trim().toLowerCase()
  const found = useRef(onFound)
  found.current = onFound

  // the community's items for a search, a moment after typing stops
  useEffect(() => {
    if (!pieces || !q) return
    const timer = setTimeout(() => {
      pieces.searchItems(q).then((items) => found.current?.(items), () => undefined)
    }, 250)
    return () => clearTimeout(timer)
  }, [q, pieces])

  // a gap whose slot the player has since filled is no longer missing
  const open = gaps.filter((g) => !(g.kind === 'hand' ? wear.hand_r && wear.hand_l : wear[slotFor(g.kind)]))
  const current = WARDROBE_TABS.find((t) => t.id === tab)!

  const generator = (slot: LookSlot) =>
    pieces &&
    making?.slot === slot && (
      <PieceGenerator
        deps={pieces}
        slot={isWearSlot(slot) ? slot : undefined}
        slotLabel={LOOK_SLOT_LABEL[slot]}
        start={{ phrase: making.phrase ?? '', kind: making.kind ?? PIECE_KIND[slot] ?? 'head' }}
        referenceUrl={referenceUrl}
        onClose={() => setMaking(null)}
        onDone={(made) => {
          const entry = 'slot' in made ? made : itemOfPiece(made)
          // a piece goes where its kind is worn (the player may have changed where it goes): a hand piece in this hand
          const target = 'slot' in made || (made.kind === 'hand' && (slot === 'hand_r' || slot === 'hand_l')) ? slot : slotFor(made.kind)
          onFound?.([entry])
          onLook((l) => wearIn(l, target, entry))
          setTab(tabOf(target))
          setMaking(null)
        }}
      />
    )

  return (
    <section className="look-panel wardrobe" aria-label="Wardrobe">
      <header className="look-head gear-head">
        <h2 className="section-title">Wardrobe</h2>
        <p className="muted">Wear, recolour and restyle anything in the library free. Generate what it lacks.</p>
        <input className="gear-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the wardrobe" aria-label="Search the wardrobe" />
      </header>
      {pieces && open.length > 0 && !making && (
        <div className="gear-gaps">
          <span className="field-label">Not in the repository yet</span>
          {open.map((g) => (
            <button
              key={g.phrase}
              type="button"
              className="gap-chip"
              onClick={() => {
                const slot = gapSlot(g, wear)
                setTab(tabOf(slot))
                setMaking({ slot, phrase: g.phrase, kind: g.kind })
              }}
            >
              {g.phrase}
              <span>Generate</span>
            </button>
          ))}
        </div>
      )}
      <div className="wardrobe-tabs" role="tablist" aria-label="Wardrobe slots">
        {WARDROBE_TABS.map((t) => {
          const worn = (t.slots as readonly LookSlot[]).some((s) => wear[s])
          return (
            <button key={t.id} type="button" role="tab" id={`wardrobe-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="wardrobe-panel" className={`wardrobe-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
              {worn && <i className="worn-dot" aria-hidden="true" />}
            </button>
          )
        })}
      </div>
      <div className="wardrobe-panel" role="tabpanel" id="wardrobe-panel" aria-labelledby={`wardrobe-tab-${tab}`}>
        {(current.slots as readonly LookSlot[]).map((slot) => {
          const worn = wear[slot]
          const entry = worn ? (catalog.find((e) => e.id === worn.id) ?? stub(worn, slot)) : undefined
          const offered = itemsFor(slot, catalog, q)
          if (entry && !offered.some((e) => e.id === entry.id)) offered.unshift(entry)
          return (
            <div key={slot} className="wear-slot">
              <span className="field-label">{LOOK_SLOT_LABEL[slot]}</span>
              <div className="gear-strip" role="radiogroup" aria-label={LOOK_SLOT_LABEL[slot]}>
                <button type="button" role="radio" aria-checked={!worn} className={`gear-tile none${worn ? '' : ' on'}`} title="Nothing" onClick={() => onLook((l) => wearIn(l, slot, undefined))}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M6.5 17.5l11-11" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  <span className="sr-only">Nothing</span>
                </button>
                {offered.map((e) => {
                  const on = worn?.id === e.id
                  return (
                    <button key={e.id} type="button" role="radio" aria-checked={on} className={`gear-tile${on ? ' on' : ''}${e.source === 'community' ? ' community' : ''}`} title={e.source === 'community' ? `${e.name} (from the community)` : e.name} onClick={() => !on && onLook((l) => wearIn(l, slot, e))}>
                      {e.thumb ? <img src={e.thumb} alt="" loading="lazy" draggable={false} /> : <span className="gear-initial" aria-hidden="true">{e.name[0]}</span>}
                      <span className="sr-only">{e.name}</span>
                    </button>
                  )
                })}
              </div>
              {worn && entry ? (
                <WornEditor key={worn.id} slot={slot} worn={worn} entry={entry} onChange={(change) => onLook((l) => editWorn(l, slot, change))} pictureUrl={referenceUrl} onGenerate={pieces && canGenerate(slot) ? () => setMaking({ slot }) : undefined} />
              ) : (
                pieces &&
                canGenerate(slot) &&
                making?.slot !== slot && (
                  <button type="button" className="btn ghost sm gear-make" onClick={() => setMaking({ slot })}>
                    Generate for {LOOK_SLOT_LABEL[slot].toLowerCase()} · {PIECE_PRICE} credits
                  </button>
                )
              )}
              {generator(slot)}
            </div>
          )
        })}
      </div>
    </section>
  )
}

interface EditorProps {
  slot: LookSlot
  worn: Worn
  entry: LibraryEntry
  onChange: (change: (worn: Worn) => Worn) => void
  /** An uploaded picture a print can be lifted from. */
  pictureUrl?: string
  /** Opens the generator for this slot; absent where nothing can be generated. */
  onGenerate?: () => void
}

/** What's worn in a slot, with its rungs: as made, recoloured, restyled, or a new one generated. */
function WornEditor({ slot, worn, entry, onChange, pictureUrl, onGenerate }: EditorProps) {
  const rigid = isRigid(entry)
  const level = rungOf(worn)
  const printable = !rigid && slot !== 'hair' && slot !== 'beard' && entry.channels.length > 0
  const restyles = !rigid && (entry.knobs.length > 0 || printable)
  const rungs = RUNGS.filter((r) => (r !== 'restyle' || restyles) && (r !== 'generate' || onGenerate))
  const [open, setOpen] = useState<Exclude<Rung, 'generate'>>(level === 'wear' ? 'recolour' : level)
  return (
    <div className="worn" aria-label={`${entry.name}, worn`} role="group">
      <div className="worn-head">
        <b>{entry.name}</b>
        {entry.source === 'community' && <span className="worn-tag">Community</span>}
        <div className="rungs" role="group" aria-label={`${entry.name} rungs`}>
          {rungs.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={r === 'generate' ? false : open === r}
              aria-current={r === level ? 'step' : undefined}
              className={`rung${r !== 'generate' && open === r ? ' on' : ''}${r === level ? ' here' : ''}`}
              onClick={() => (r === 'generate' ? onGenerate?.() : r === 'wear' ? (onChange(asMade), setOpen('wear')) : setOpen(r))}
            >
              {RUNG_LABEL[r]}
              <small>{r === 'generate' ? `${PIECE_PRICE} credits` : 'Free'}</small>
            </button>
          ))}
        </div>
      </div>
      {open === 'wear' && <p className="muted worn-note">Worn as it was made. Recolour or restyle it, free.</p>}
      {open === 'recolour' &&
        (entry.channels.length ? (
          <div className="channels">
            {entry.channels.map((c, i) => (
              <div key={i} className="channel">
                <label className="swatch">
                  <input type="color" aria-label={`${channelLabel(entry, c)} colour`} value={worn.colors?.[i] ?? c.color} onChange={(e) => onChange((w) => setChannel(w, i, { color: e.target.value }))} />
                  <span>{title(c.name)}</span>
                </label>
                {!rigid && (
                  <select className="finish" aria-label={`${channelLabel(entry, c)} finish`} value={worn.finishes?.[i] ?? c.finish} onChange={(e) => onChange((w) => setChannel(w, i, { finish: e.target.value === c.finish ? null : (e.target.value as Finish) }))}>
                    {FINISHES.map((f) => (
                      <option key={f} value={f}>
                        {FINISH_LABEL[f]}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted worn-note">This piece keeps its own colours.</p>
        ))}
      {open === 'restyle' && (
        <div className="restyle">
          {entry.knobs.length > 0 && (
            <div className="sliders">
              {entry.knobs.map((k) => (
                <KnobSlider key={k} entry={entry} knob={k} value={worn.knobs?.[k] ?? 1} onChange={(v) => onChange((w) => withKnob(w, k, v))} />
              ))}
            </div>
          )}
          {printable && <PrintPicker entry={entry} worn={worn} onChange={onChange} pictureUrl={pictureUrl} />}
        </div>
      )}
    </div>
  )
}

/** A knob's cut, or the item as made at 1. */
function withKnob(worn: Worn, knob: Knob, value: number): Worn {
  const knobs = { ...worn.knobs }
  if (value >= 1) delete knobs[knob]
  else knobs[knob] = value
  const { knobs: _knobs, ...rest } = worn
  return Object.keys(knobs).length ? { ...rest, knobs } : rest
}

function KnobSlider({ entry, knob, value, onChange }: { entry: LibraryEntry; knob: Knob; value: number; onChange: (value: number) => void }) {
  return (
    <label className="slider">
      <span>{KNOB_LABEL[knob]}</span>
      <input type="range" min={0} max={1} step={0.01} aria-label={`${entry.name} ${KNOB_LABEL[knob].toLowerCase()}`} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <small aria-hidden="true">
        <span>Shortest</span>
        <span>As made</span>
      </small>
    </label>
  )
}

/** A canvas can't be drawn on under jsdom, which the tests run in. */
const canDraw = typeof navigator !== 'undefined' && !navigator.userAgent.includes('jsdom')

/** A print's tile in the item's own colours, as its swatch. */
function PrintSwatch({ id, ground, ink }: { id: PrintId; ground: string; ink: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = canDraw ? canvas.current?.getContext('2d') : null
    if (ctx) drawPrint(ctx, id, 64, ground, ink)
  }, [id, ground, ink])
  return <canvas ref={canvas} width={64} height={64} aria-hidden="true" />
}

/** A print over one of the item's channels: one of the built-ins in an ink of the player's, or their own picture. */
function PrintPicker({ entry, worn, onChange, pictureUrl }: { entry: LibraryEntry; worn: Worn; onChange: EditorProps['onChange']; pictureUrl?: string }) {
  const print = worn.print
  const channel = print?.channel ?? 0
  const ground = worn.colors?.[channel] ?? entry.channels[channel]?.color ?? '#808080'
  const ink = print?.ink ?? inkFor(ground)
  // the channel and the size stay when the pattern changes; an ink only belongs to a built-in print
  const kept = (p: WornPrint | undefined): WornPrint => ({ ...(p?.channel ? { channel: p.channel } : {}), ...(p?.scale ? { scale: p.scale } : {}) })
  const set = (next: WornPrint | undefined) =>
    onChange((w) => {
      const { print: _print, ...rest } = w
      return next ? { ...rest, print: next } : rest
    })
  const patch = (p: Partial<WornPrint>) => print && set({ ...print, ...p })
  return (
    <div className="prints">
      <span className="field-label">Print</span>
      <div className="print-grid" role="radiogroup" aria-label={`${entry.name} print`}>
        <button type="button" role="radio" aria-checked={!print} className={`print-tile none${print ? '' : ' on'}`} title="No print" onClick={() => set(undefined)}>
          <span aria-hidden="true">None</span>
          <span className="sr-only">No print</span>
        </button>
        {PRINTS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={print?.id === id} className={`print-tile${print?.id === id ? ' on' : ''}`} title={PRINT_LABEL[id]} onClick={() => set({ ...kept(print), id, ...(print?.ink ? { ink: print.ink } : {}) })}>
            <PrintSwatch id={id} ground={ground} ink={ink} />
            <span className="sr-only">{PRINT_LABEL[id]}</span>
          </button>
        ))}
        {pictureUrl && (
          <button type="button" role="radio" aria-checked={print?.url === pictureUrl} className={`print-tile picture${print?.url === pictureUrl ? ' on' : ''}`} title="From your picture" onClick={() => set({ ...kept(print), url: pictureUrl })}>
            <img src={pictureUrl} alt="" draggable={false} />
            <span className="sr-only">From your picture</span>
          </button>
        )}
      </div>
      {print && (
        <div className="print-knobs">
          {entry.channels.length > 1 && (
            <label className="inline-field">
              <span>On</span>
              <select aria-label="Print on" value={channel} onChange={(e) => patch({ channel: Number(e.target.value) || undefined })}>
                {entry.channels.map((c, i) => (
                  <option key={i} value={i}>
                    {title(c.name)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {print.id && (
            <label className="swatch inline">
              <input type="color" aria-label="Print ink" value={ink} onChange={(e) => patch({ ink: e.target.value })} />
              <span>Ink</span>
            </label>
          )}
          <label className="slider compact">
            <span>Size</span>
            {/* the slider grows the pattern to the right: fewer repeats per metre */}
            <input type="range" min={PRINT_SCALE.min} max={PRINT_SCALE.max} step={0.5} aria-label="Print size" value={PRINT_SCALE.min + PRINT_SCALE.max - (print.scale ?? PRINT_SCALE.default)} onChange={(e) => patch({ scale: PRINT_SCALE.min + PRINT_SCALE.max - Number(e.target.value) })} />
          </label>
        </div>
      )}
    </div>
  )
}
