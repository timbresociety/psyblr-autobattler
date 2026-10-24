import { useEffect, useState } from 'react'
import { defaultLook, wearUrl, type FacePhoto, type Gender, type LookSlot, type Worn } from '../../charter/look'
import type { RoleId } from '../../charter/types'
import { heroHue } from '../../arena/client/characters'
import { BUILT_IN_ITEMS } from '../../kit/wear/library.gen'
import { HeroStage } from '../common/HeroStage'
import type { StageClip } from '../common/hero-look'

/**
 * A dev bench for the wardrobe (?wardrobe, dev builds only): outfits from the library on the shared bodies, to check
 * how items sit and how their loose cloth swings. ?wardrobe=kimono,hair_long,geta wears just the listed items,
 * &gender=m or f picks the body, &facing=3.14 holds it turned (radians; that one shows the back), &speed=0.25 plays
 * in slow motion and &face=musk wears a demo portrait's face (tools/blender/portraits): its photo and fitted shape.
 */

const PRESETS: { name: string; role: RoleId; items: string[] }[] = [
  { name: 'Kimono', role: 'mage', items: ['kimono', 'hair_long', 'geta'] },
  { name: 'Cape', role: 'fighter', items: ['tee', 'trousers', 'cape', 'hair_ponytail', 'boots'] },
  { name: 'Skirt', role: 'support', items: ['tank_top', 'skirt', 'hair_bob', 'sneakers'] },
]

const CLIPS: StageClip[] = ['run', 'slash', 'cast', 'hurt']

function wearing(ids: string[]): Partial<Record<LookSlot, Worn>> {
  const out: Partial<Record<LookSlot, Worn>> = {}
  for (const id of ids) {
    const item = BUILT_IN_ITEMS.find((i) => i.id === id)
    if (item) out[item.slot as LookSlot] = { id, url: wearUrl(id) }
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
  const portrait = params.get('face')
  const [face, setFace] = useState<FacePhoto>()
  const [cue, setCue] = useState<{ clip: StageClip; at: number }>()
  useEffect(() => {
    if (!portrait) return
    void fetch(`/tools/blender/portraits/${portrait}.lm.json`)
      .then((r) => r.json() as Promise<{ width: number; height: number; points: number[][] }>)
      .then((lm) => setFace({ url: `/tools/blender/portraits/${portrait}.webp`, width: lm.width, height: lm.height, points: lm.points.flatMap((p) => [p[0], p[1]]) }))
  }, [portrait])
  if (portrait && !face) return <p className="screen-loading">Loading the face…</p>
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
          const look = { ...defaultLook(o.role, o.name, heroHue(o.name)), ...(gender ? { gender } : {}), wear: wearing(o.items), ...(face ? { face } : {}) }
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
