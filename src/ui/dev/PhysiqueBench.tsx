import { useState } from 'react'
import { defaultLook } from '../../charter/look'
import type { RoleId } from '../../charter/types'
import { heroHue } from '../../arena/client/characters'
import { ARKIT_SHAPES, type ArkitShape } from '../../kit/head/head'
import { PRESETS, presetDials, type ArchetypeId } from '../../kit/body/physique'
import { BENCH_CLIPS } from '../../kit/bench/clips'
import bench from '../../../docs/bench/physique-bench.json'
import { HeroStage } from '../common/HeroStage'

/**
 * The physique test bench's page (?physique, dev builds only; GAME.md §9.7). Face: the head up close on both genders,
 * every face shape one at a time (§9.1). Bench: any archetype on any key clip, beside its scores from
 * docs/bench/physique-bench.json (BENCH_WRITE=1 vitest run src/kit/bench), and the jiggle test (a jump on the anime
 * heroine). &shape=jawOpen, &facing=0.6, &tab=bench&arch=heavyweight&clip=run start there.
 */
const HEADS: { name: string; role: RoleId; gender: 'm' | 'f' }[] = [
  { name: 'Bench M', role: 'fighter', gender: 'm' },
  { name: 'Bench F', role: 'mage', gender: 'f' },
]

interface Scores {
  limits: { violations: number; worst: number }
  penetration: { worst: number; frames: number }
  grip?: number
}
type ClipScore = { clip: string; frames: number; raw: Scores; fixed: Scores; footSlide: number; ground?: number } | 'missing'
const SCORES = (bench as unknown as { scores: { archetype: ArchetypeId; body: string; spread: { arm: number; leg: number }; clips: Record<string, ClipScore> }[] }).scores

export function PhysiqueBench() {
  const params = new URLSearchParams(window.location.search)
  const [tab, setTab] = useState<'face' | 'bench'>(params.get('tab') === 'bench' ? 'bench' : 'face')
  return (
    <main style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['face', 'bench'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'face' ? 'Face' : 'Bench'}
          </button>
        ))}
      </div>
      {tab === 'face' ? <FaceBench params={params} /> : <BodyBench params={params} />}
    </main>
  )
}

function FaceBench({ params }: { params: URLSearchParams }) {
  const [shape, setShape] = useState<ArkitShape | undefined>((params.get('shape') as ArkitShape | null) ?? undefined)
  const facing = Number(params.get('facing') ?? 0) || 0
  const face = shape ? { [shape]: 1 } : {}
  return (
    <>
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
    </>
  )
}

const cell = { padding: '2px 8px', textAlign: 'right' as const }

function BodyBench({ params }: { params: URLSearchParams }) {
  const [arch, setArch] = useState<ArchetypeId>((params.get('arch') as ArchetypeId | null) ?? 'athletic')
  const [key, setKey] = useState(params.get('clip') ?? 'run')
  const p = PRESETS.find((a) => a.id === arch)!
  // a key clip by its bench key, or any library clip by its own name (?clip=cmu_wave_hello)
  const clip = key in BENCH_CLIPS ? BENCH_CLIPS[key] : key
  const look = { ...defaultLook('fighter', p.label, heroHue(p.label)), gender: p.gender, physique: presetDials(arch) }
  const scores = SCORES.find((s) => s.archetype === arch)
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {PRESETS.map((a) => (
          <button key={a.id} type="button" data-arch={a.id} aria-pressed={arch === a.id} onClick={() => setArch(a.id)}>
            {a.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {Object.entries(BENCH_CLIPS).map(([k, c]) => (
          <button key={k} type="button" data-clip={k} disabled={!c} aria-pressed={key === k} onClick={() => setKey(k)}>
            {k}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setArch('heroine')
            setKey('jump')
          }}
        >
          jiggle test
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>
        <section style={{ height: 640, display: 'grid', gridTemplateRows: 'auto 1fr' }}>
          <h2 style={{ margin: 0, fontSize: 14 }}>{`${p.label} (${p.gender}-${p.body}) · ${key}${clip ? '' : ' (not in the library yet)'}`}</h2>
          <HeroStage key={arch} look={{ heroName: p.label, roleId: 'fighter', sizeClass: p.body, look }} hue={heroHue(p.label)} play={clip} label={p.label} />
        </section>
        <section>
          <h2 style={{ margin: 0, fontSize: 14 }}>{scores ? `Scores · spread ${scores.spread.arm}° arms, ${scores.spread.leg}° legs` : 'No scores (run the bench)'}</h2>
          {scores && (
            <table style={{ fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>clip</th>
                  <th style={cell}>limits (raw/fixed)</th>
                  <th style={cell}>penetration cm</th>
                  <th style={cell}>foot slide cm/s</th>
                  <th style={cell}>ground cm</th>
                  <th style={cell}>grip cm</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(scores.clips).map(([k, c]) => (
                  <tr key={k} style={{ fontWeight: k === key ? 700 : 400 }}>
                    <td>{k}</td>
                    {c === 'missing' ? (
                      <td colSpan={5}>not in the library yet</td>
                    ) : (
                      <>
                        <td style={cell}>{`${c.raw.limits.violations}/${c.fixed.limits.violations}`}</td>
                        <td style={cell}>{`${c.raw.penetration.worst} → ${c.fixed.penetration.worst}`}</td>
                        <td style={cell}>{c.footSlide}</td>
                        <td style={cell}>{c.ground ?? '–'}</td>
                        <td style={cell}>{c.raw.grip === undefined ? '–' : `${c.raw.grip} → ${c.fixed.grip}`}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  )
}
