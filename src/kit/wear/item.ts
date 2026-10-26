import type { Binding } from './bind.js'

/**
 * A wardrobe item as the game reads it: a garment, hairstyle, beard or hat bound to the shared body surface, so one
 * file fits all twelve bodies, every physique and every face. Items are GLB files (public/kit/wear/<id>.glb, or a
 * player's generated one) written by the fit pipeline (src/kit/fit/): the mesh as it sits on the reference body, plus
 * custom attributes holding each vertex's binding, and the item's metadata in the primitive's extras.
 *
 *   _TRI    vec3   the welded body triangle under the vertex
 *   _ST     vec2   where on that triangle
 *   _LIFT   float  how far out along the surface's normal
 *   _NLOCAL vec3   the vertex normal in the surface's frame (tangent, normal, bitangent)
 *   _CHANNEL float which of the item's colour channels the vertex takes (0 to 3)
 *   _LEN    float  along a strand, 0 at the root to 1 at the longest tip (hair, skirts, capes; optional)
 *   _CHAIN  vec3   for loose cloth: which of the item's chain groups the vertex hangs from (-1 for none), across that
 *                  group's columns, and down its levels (0 at the root); optional
 *
 * Rigid items (a top hat, a jetpack) are ordinary models hung on a body socket (src/arena/client/gear.ts); their
 * extras carry the same metadata, so a hat still flattens the hair under it.
 */

/** Where an item goes. The six wardrobe slots, hair and beard, and the gear slots (face, either hand, the off hand). */
export const ITEM_SLOTS = ['hair', 'beard', 'head', 'upper', 'lower', 'full', 'back', 'feet', 'face', 'hand', 'offhand'] as const
export type ItemSlot = (typeof ITEM_SLOTS)[number]

/** How a channel's cloth (or metal, or light) reads. */
export const FINISHES = ['cotton', 'silk', 'denim', 'knit', 'leather', 'metal', 'glow'] as const
export type Finish = (typeof FINISHES)[number]

/** Cuts a player can make on an item that allows them, each 0 (shortest) to 1 (as made). */
export const KNOBS = ['sleeve', 'hem', 'leg', 'length'] as const
export type Knob = (typeof KNOBS)[number]

/** The four rungs to any look, cheapest first: wear an item as made, recolour it, restyle it, or generate a new one. */
export const RUNGS = ['wear', 'recolour', 'restyle', 'generate'] as const
export type Rung = (typeof RUNGS)[number]

/**
 * Loose cloth (a skirt, a cape, a kimono sleeve, long hair) hangs from short chains of particles that sway and
 * collide with the body (src/kit/physics/). A group is a row of columns hanging side by side, each with `levels`
 * particles below its root; `closed` groups wrap round (a skirt's last column links back to its first).
 */
export interface ChainGroup {
  columns: number
  levels: number
  closed: boolean
  /** 0 floppy to 1 holding its shape. */
  stiff: number
}

export interface ItemChannel {
  name: string
  /** '#rrggbb' as made. */
  color: string
  finish: Finish
}

/** An item file's metadata (its primitive's extras). */
export interface ItemMeta {
  format: 'psyblr-wear'
  version: 1
  id: string
  name: string
  slot: ItemSlot
  mode: 'surface' | 'rigid'
  /** Whether the item hides the skin and inner layers it covers (clothes do; hair, with gaps between locks, doesn't). */
  hides: boolean
  channels: ItemChannel[]
  knobs: Knob[]
  /** Welded body vertices the item lies over. */
  covers: number[]
  /** Per covered vertex, the item's inner and outer distance out along the surface normal, in tenths of a millimetre. */
  shell: number[]
  /**
   * The covered vertices it hides: where it lies close and doesn't hang, so nothing under it can ever show. Absent,
   * a hiding item hides all it covers.
   */
  hidden?: number[]
  chains?: ChainGroup[]
  /**
   * Rides one bone whole, the one most of it leans on: a hard hat moves with the head and never bends, though the
   * skin nearest a kasa's back brim is the shoulders'. It still fits each body through its binding.
   */
  hard?: boolean
  /** For a rigid item: the body socket it hangs on. */
  socket?: string
}

/** A surface item ready to dress a body with. */
export interface SurfaceItem {
  meta: ItemMeta
  /** Vertices. */
  count: number
  index: Uint32Array
  binding: Binding
  /** Per vertex, its normal in the surface frame. */
  normal: Float32Array
  uv: Float32Array
  channel: Uint8Array
  len?: Float32Array
  /** Per vertex: chain group (-1 for none), column, level. */
  chain?: Float32Array
  /** Per vertex, where it sits on the reference body (the file's mesh): loose cloth drapes from here (see dress.ts). */
  rest?: Float32Array
}

/** What a covering item (surface or rigid) gives the layers: the vertices it lies over and its shell there. */
export interface Cover {
  slot: ItemSlot
  hides: boolean
  /** Per welded vertex: the inner and outer lift where covered, NaN elsewhere. */
  inner: Float32Array
  outer: Float32Array
  /** Per welded vertex: 1 where the item hides it. */
  hide: Uint8Array
}

const HEX = /^#[0-9a-f]{6}$/

/** Check untrusted metadata (a generated item's file); throws on anything an item can't be. */
export function checkMeta(raw: unknown, vertices: number): ItemMeta {
  const m = raw as Partial<ItemMeta> | undefined
  const fail = (why: string): never => {
    throw new Error(`item metadata: ${why}`)
  }
  if (!m || typeof m !== 'object' || m.format !== 'psyblr-wear' || m.version !== 1) fail('not a psyblr wardrobe item')
  if (typeof m!.id !== 'string' || !/^[a-z0-9][a-z0-9_:-]{0,63}$/.test(m!.id)) fail('bad id')
  if (typeof m!.name !== 'string' || m!.name.length > 60) fail('bad name')
  if (!(ITEM_SLOTS as readonly string[]).includes(m!.slot as string)) fail('bad slot')
  if (m!.mode !== 'surface' && m!.mode !== 'rigid') fail('bad mode')
  if (typeof m!.hides !== 'boolean') fail('bad hides')
  if (m!.hard !== undefined && typeof m!.hard !== 'boolean') fail('bad hard')
  const channels = m!.channels
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 4) fail('one to four channels')
  for (const c of channels!) {
    if (!c || typeof c.name !== 'string' || c.name.length > 24 || typeof c.color !== 'string' || !HEX.test(c.color) || !(FINISHES as readonly string[]).includes(c.finish)) fail('bad channel')
  }
  if (!Array.isArray(m!.knobs) || !m!.knobs.every((k) => (KNOBS as readonly string[]).includes(k))) fail('bad knobs')
  const covers = m!.covers
  const shell = m!.shell
  if (!Array.isArray(covers) || !covers.every((v) => Number.isInteger(v) && v >= 0 && v < vertices)) fail('bad covers')
  if (!Array.isArray(shell) || shell.length !== covers!.length * 2 || !shell.every((v) => Number.isFinite(v) && Math.abs(v) < 20000)) fail('bad shell')
  const inCovers = new Set(covers)
  if (m!.hidden !== undefined && (!Array.isArray(m!.hidden) || !m!.hidden.every((v) => inCovers.has(v)))) fail('bad hidden')
  const chains = m!.chains
  if (chains !== undefined) {
    if (!Array.isArray(chains) || chains.length > 8) fail('bad chains')
    for (const g of chains!) {
      const whole = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi
      if (!g || !whole(g.columns, 1, 32) || !whole(g.levels, 1, 6) || typeof g.closed !== 'boolean' || !(g.stiff >= 0 && g.stiff <= 1)) fail('bad chain group')
    }
  }
  if (m!.socket !== undefined && (typeof m!.socket !== 'string' || m!.socket.length > 16)) fail('bad socket')
  return m as ItemMeta
}

/** A cover from an item's metadata, over a body of `vertices` welded vertices. */
export function coverOf(meta: ItemMeta, vertices: number): Cover {
  const inner = new Float32Array(vertices).fill(NaN)
  const outer = new Float32Array(vertices).fill(NaN)
  const hide = new Uint8Array(vertices)
  meta.covers.forEach((v, i) => {
    inner[v] = meta.shell[i * 2] / 1e4
    outer[v] = meta.shell[i * 2 + 1] / 1e4
  })
  if (meta.hides) for (const v of meta.hidden ?? meta.covers) hide[v] = 1
  return { slot: meta.slot, hides: meta.hides, inner, outer, hide }
}

/** A surface item from its file's arrays (custom attributes as three.js or gltf-transform hands them over). */
export function surfaceItem(
  raw: { extras: unknown; index: ArrayLike<number>; tri: ArrayLike<number>; st: ArrayLike<number>; lift: ArrayLike<number>; normal: ArrayLike<number>; uv: ArrayLike<number>; channel?: ArrayLike<number>; len?: ArrayLike<number>; chain?: ArrayLike<number>; rest?: ArrayLike<number> },
  vertices: number,
): SurfaceItem {
  const count = raw.lift.length
  const meta = checkMeta(raw.extras, vertices)
  if (meta.mode !== 'surface') throw new Error(`${meta.id} is not a surface item`)
  if (raw.tri.length !== count * 3 || raw.st.length !== count * 2 || raw.normal.length !== count * 3 || raw.uv.length !== count * 2 || (raw.rest && raw.rest.length !== count * 3)) throw new Error(`${meta.id}: attribute sizes disagree`)
  const tri = Uint16Array.from(raw.tri, (v) => Math.round(v))
  if (tri.some((v) => v >= vertices)) throw new Error(`${meta.id}: binds past the body's vertices`)
  const index = Uint32Array.from(raw.index)
  if (index.some((i) => i >= count)) throw new Error(`${meta.id}: index past its vertices`)
  const channel = Uint8Array.from(raw.channel ?? new Float32Array(count), (c) => Math.min(meta.channels.length - 1, Math.max(0, Math.round(c))))
  let chain: Float32Array | undefined
  if (raw.chain && meta.chains?.length) {
    if (raw.chain.length !== count * 3) throw new Error(`${meta.id}: chain size disagrees`)
    chain = Float32Array.from(raw.chain)
    const groups = meta.chains
    for (let k = 0; k < count; k++) {
      const g = Math.round(chain[k * 3])
      // anything off the item's groups rides the body
      if (!(g >= 0 && g < groups.length)) {
        chain[k * 3] = -1
        continue
      }
      chain[k * 3] = g
      chain[k * 3 + 1] = Math.min(groups[g].columns - (groups[g].closed ? 1e-4 : 1), Math.max(0, chain[k * 3 + 1] || 0))
      chain[k * 3 + 2] = Math.min(groups[g].levels, Math.max(0, chain[k * 3 + 2] || 0))
    }
  }
  return {
    meta,
    count,
    index,
    binding: { tri, st: Float32Array.from(raw.st), lift: Float32Array.from(raw.lift) },
    normal: Float32Array.from(raw.normal),
    uv: Float32Array.from(raw.uv),
    channel,
    ...(raw.len ? { len: Float32Array.from(raw.len) } : {}),
    ...(chain ? { chain } : {}),
    ...(raw.rest ? { rest: Float32Array.from(raw.rest) } : {}),
  }
}
