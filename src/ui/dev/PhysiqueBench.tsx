import { useState } from 'react'
import { defaultLook } from '../../charter/look'
import type { RoleId } from '../../charter/types'
import { heroHue } from '../../arena/client/characters'
import { ARKIT_SHAPES, type ArkitShape } from '../../kit/head/head'
import { HeroStage } from '../common/HeroStage'

/**
 * The physique test bench's page (?physique, dev builds only; GAME.md §9.7): the head up close on both genders, with
 * every face shape to try one at a time, for the visual check of the head (§9.1: real eyes, lids that close over them,
 * teeth and tongue, brows and lashes). &shape=jawOpen starts with a shape held; &facing=0.6 turns the heads.
 */
const HEADS: { name: string; role: RoleId; gender: 'm' | 'f' }[] = [
  { name: 'Bench M', role: 'fighter', gender: 'm' },
  { name: 'Bench F', role: 'mage', gender: 'f' },
]

export function PhysiqueBench() {
  const params = new URLSearchParams(window.location.search)
  const [shape, setShape] = useState<ArkitShape | undefined>((params.get('shape') as ArkitShape | null) ?? undefined)
  const facing = Number(params.get('facing') ?? 0) || 0
  const face = shape ? { [shape]: 1 } : {}
  return (
    <main style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <button type="button" onClick={() => setShape(undefined)} aria-pressed={!shape}>
          rest
        </button>
        {ARKIT_SHAPES.map((s) => (
          <button key={s} type="button" data-shape={s} onClick={() => setShape(s)} aria-pressed={shape === s} style={{ fontSize: 11 }}>
            {s}
          </button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {HEADS.map((h) => {
          const look = { ...defaultLook(h.role, h.name, heroHue(h.name)), gender: h.gender }
          return (
            <section key={h.name} style={{ height: 620, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
              <h2 style={{ margin: 0, fontSize: 14 }}>{`${h.name}${shape ? `: ${shape}` : ''}`}</h2>
              <HeroStage look={{ heroName: h.name, roleId: h.role, sizeClass: 'medium', look }} hue={heroHue(h.name)} studio framing="face" facing={facing} face={face} label={h.name} />
            </section>
          )
        })}
      </div>
    </main>
  )
}
