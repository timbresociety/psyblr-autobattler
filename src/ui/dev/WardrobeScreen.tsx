import { useState } from 'react'
import { defaultLook, wearUrl, type Gender, type LookSlot, type Worn } from '../../charter/look'
import type { RoleId } from '../../charter/types'
import { heroHue } from '../../arena/client/characters'
import { STARTERS, starterBuild } from '../../arena/starters'
import { BUILT_IN_ITEMS } from '../../kit/wear/library.gen'
import { HeroStage } from '../common/HeroStage'
import type { StageClip } from '../common/hero-look'
import { HeroPortrait } from '../common/portrait'

/**
 * A dev bench for the wardrobe (?wardrobe, dev builds only): outfits from the library on the shared bodies, to check
 * how items sit and how their loose cloth swings. ?wardrobe=kimono,hair_long,geta wears just the listed items,
 * &gender=m or f picks the body, &facing=3.14 holds it turned (radians; that one shows the back), &speed=0.25 plays
 * in slow motion. &hero=3 shows the fourth starter instead, its bust and its whole body. &generated=full:<id>,feet:<id> also wears garments the dev server generated
 * (.dev-store/wear), and &recolor=#1f2a44,#c9a227 recolours their channels.
 */

const PRESETS: { name: string; role: RoleId; items: string[] }[] = [
  { name: 'Kimono', role: 'mage', items: ['kimono', 'hair_long', 'geta'] },
  { name: 'Cape', role: 'fighter', items: ['tee', 'trousers', 'cape', 'hair_ponytail', 'boots'] },
  { name: 'Skirt', role: 'support', items: ['tank_top', 'skirt', 'hair_bob', 'sneakers'] },
]

const CLIPS: StageClip[] = ['run', 'slash', 'cast', 'hurt']

function wearing(ids: string[], generated: string | null, recolor: string | null): Partial<Record<LookSlot, Worn>> {
  const out: Partial<Record<LookSlot, Worn>> = {}
  for (const id of ids) {
    const item = BUILT_IN_ITEMS.find((i) => i.id === id)
    if (item) out[item.slot as LookSlot] = { id, url: wearUrl(id) }
  }
  for (const pair of generated?.split(',') ?? []) {
    const [slot, id] = pair.split(':')
    if (!slot || !id) continue
    out[slot as LookSlot] = { id, url: `/dev-store/wear/${id}.glb`, ...(recolor ? { colors: recolor.split(',') } : {}) }
    // a full-body item replaces the upper and lower ones
    if (slot === 'full') {
      delete out.upper
      delete out.lower
    }
  }
  return out
}

export function WardrobeScreen() {
  const params = new URLSearchParams(window.location.search)
  const listed = params.get('wardrobe')
  const asked = params.get('gender')
  const gender: Gender | undefined = asked === 'm' || asked === 'f' ? asked : undefined
  const facing = params.has('facing') ? Number(params.get('facing')) : undefined
  const speed = Number(params.get('speed') ?? 1) || 1
  const outfits = listed ? [{ name: 'Listed', role: 'fighter' as RoleId, items: listed.split(',').map((s) => s.trim()) }] : PRESETS
  const generated = params.get('generated')
  const recolor = params.get('recolor')
  const [cue, setCue] = useState<{ clip: StageClip; at: number }>()
  const pick = params.get('hero')
  if (pick !== null && STARTERS[Number(pick)]) return <StarterBench index={Number(pick)} {...(facing === undefined ? {} : { facing })} />
  return (
    <main style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        {CLIPS.map((clip) => (
          <button key={clip} type="button" onClick={() => setCue({ clip, at: performance.now() })}>
            {clip}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${outfits.length}, minmax(0, 1fr))`, gap: 12 }}>
        {outfits.map((o) => {
          const look = { ...defaultLook(o.role, o.name, heroHue(o.name)), ...(gender ? { gender } : {}), wear: wearing(o.items, generated, recolor) }
          return (
            <section key={o.name} style={{ height: 560, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
              <h2 style={{ margin: 0, fontSize: 14 }}>{`${o.name}: ${o.items.join(', ')}`}</h2>
              <HeroStage look={{ heroName: o.name, roleId: o.role, sizeClass: 'medium', look }} hue={heroHue(o.name)} {...(cue ? { cue } : {})} {...(facing === undefined ? {} : { facing })} speed={speed} label={o.name} />
            </section>
          )
        })}
      </div>
    </main>
  )
}

/** One starter as the game draws it: the bust the staging row and the HUD show, and the whole body on the plinth. */
function StarterBench({ index, facing }: { index: number; facing?: number }) {
  const hero = STARTERS[index]
  const build = starterBuild(hero)
  return (
    <main style={{ padding: 16, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <HeroPortrait hero={{ key: `bench:${index}`, heroName: build.heroName, roleId: build.roleId, hue: hero.hue, build }} className="bench-bust" />
      <section style={{ width: 480, height: 720 }}>
        <HeroStage look={{ heroName: build.heroName, roleId: build.roleId, ...(build.sizeClass ? { sizeClass: build.sizeClass } : {}), ...(build.look ? { look: build.look } : {}) }} hue={hero.hue} {...(facing === undefined ? {} : { facing })} label={build.heroName} />
      </section>
    </main>
  )
}
