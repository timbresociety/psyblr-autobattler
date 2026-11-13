import { useEffect, useMemo, useRef, useState } from 'react'
import { createEffects } from '../../arena/client/effects/player'
import { canRender, startArena, type ArenaController } from '../../arena/client/match-view'
import { createSoakRecorder, forceUltimates, soakCommand, soakOptions, SOAK_PASS, type SoakOptions, type SoakPhase, type SoakRecorder, type SoakReport } from '../../arena/client/soak'
import { TAU } from '../../arena/engine/maths'
import { Live, matchSetup } from './ArenaScreen'
import { Unsupported } from './Loading'
import { emptyFormation } from './staging/formation'
import { sampleLoadout } from './staging/loadout'
import { matchup } from './staging/presets'
import { textureMb } from '../../arena/client/render/budget.js'
import type { StagingResult } from './staging/Staging'

const noop = () => {}

/** A small seeded generator, so a seed always deploys the same lineup. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/**
 * `?soak` runs the soak test (src/arena/client/soak.ts): the Vanguard against the Outlaws, ten a side, match after match,
 * with waves of ultimates and one hero steered from the third-person camera. `&minutes=10`, `&ults=15` seconds between
 * waves, `&wave=6` ultimates a wave, `&match=150` seconds before a long match is cut off, `&seed=1`. The report is
 * on screen and on `window.__soak`.
 */
export function SoakScreen() {
  const options = useMemo(() => soakOptions(window.location.search), [])
  const recorder = useMemo(
    () =>
      createSoakRecorder(options, {
        userAgent: navigator.userAgent,
        viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
        startedAt: new Date().toISOString(),
      }),
    [options],
  )
  const [match, setMatch] = useState(0)
  const [report, setReport] = useState<SoakReport>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    // the frame clock for the whole run, apart from the game's own loop, so loading the next match counts too
    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      recorder.frame(now - last)
      last = now
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    const timer = setInterval(() => {
      recorder.sample()
      const r = recorder.report()
      ;(window as unknown as { __soak?: SoakReport }).__soak = r
      setReport(r)
      if (r.finished) {
        clearInterval(timer)
        cancelAnimationFrame(raf)
      }
    }, 10_000)
    return () => {
      clearInterval(timer)
      cancelAnimationFrame(raf)
    }
  }, [recorder])

  if (!canRender()) return <Unsupported />
  const running = !error && !report?.finished
  return (
    <div className="arena">
      {running && <SoakMatch key={match} index={match} options={options} recorder={recorder} onDone={() => setMatch((m) => m + 1)} onError={setError} />}
      <SoakPanel options={options} report={report} error={error} />
    </div>
  )
}

function SoakMatch({ index, options, recorder, onDone, onError }: { index: number; options: SoakOptions; recorder: SoakRecorder; onDone: () => void; onError: (e: string) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<{ controller: ArenaController; staged: StagingResult }>()

  useEffect(() => {
    if (!host.current) return
    let cancelled = false
    let controller: ArenaController | undefined
    let timer = 0
    const loadout = sampleLoadout()
    const staged: StagingResult = { side: 0, formation: matchup('squads', loadout, 0, emptyFormation(), seeded(options.seed + index)), loadout }
    const setup = { ...matchSetup(staged), seed: options.seed + index }
    recorder.context({ match: index, phase: 'loading', alive: 0, controlled: false, quality: 'full', pixelRatio: 1, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, textureMb: 0 })
    startArena(host.current, setup)
      .then((c) => {
        controller = c
        if (cancelled) return c.stop()
        const effects = createEffects(c, setup.packages)
        c.hooks.on('events', effects.events)
        c.hooks.on('events', recorder.events)
        c.hooks.timeScale = effects.timeScale
        c.hooks.human = () => (c.arena.match.human === undefined ? undefined : soakCommand(c.arena.match, c.arena.match.human))
        c.hooks.on('frame', (dt) => {
          effects.frame(dt)
          // the scripted player's mouse: the third-person camera swings round behind the hero it steers
          const human = c.arena.match.human
          if (human !== undefined && c.cameras.mode === 'hero') {
            const turn = ((((c.arena.match.heroes[human].yaw - c.cameras.yaw) % TAU) + TAU * 1.5) % TAU) - TAU / 2
            c.cameras.yaw += turn * (1 - Math.exp(-dt * 6))
            c.cameras.pitch = -0.22
          }
          c.camera.position.add(effects.shake())
          c.screen(effects.screen())
        })
        setLive({ controller: c, staged })

        const report = (phase: SoakPhase) => {
          const { render, memory } = c.renderer.info
          const m = c.arena.match
          // live, unlike `__soak`, which updates every 10 s: a runner can collect garbage during the countdown and
          // read the heap with nothing of the fight in it
          ;(window as unknown as { __soakPhase?: { match: number; phase: SoakPhase } }).__soakPhase = { match: index, phase }
          recorder.context({
            match: index,
            phase,
            alive: m.heroes.filter((h) => h.alive).length,
            controlled: m.human !== undefined,
            quality: c.quality(),
            pixelRatio: c.renderer.getPixelRatio(),
            drawCalls: render.drawCalls,
            triangles: render.triangles,
            geometries: memory.geometries,
            textures: memory.textures,
            textureMb: textureMb(c.scene),
          })
        }
        const every = Math.max(1, Math.round(options.ultimateEvery))
        let seconds = 0
        let released = -1
        let ended = -1
        let wave = 0
        // once: the next match mounts in this one's place, and a finished soak just stops
        const next = (more: boolean) => {
          clearInterval(timer)
          if (more) onDone()
        }
        // the real game counts down three seconds over a paused match before anyone moves, and so does the soak
        let countdown = 3
        c.pause()
        report('loading')
        timer = window.setInterval(() => {
          const m = c.arena.match
          if (recorder.finished()) return next(false)
          if (countdown > 0) {
            countdown--
            if (!countdown) c.resume()
            return report(countdown ? 'loading' : 'fight')
          }
          seconds++
          if (seconds >= options.matchSeconds) return next(true)
          if (m.winner !== undefined) {
            if (ended < 0) ended = seconds
            report('result')
            if (seconds - ended >= 3) next(true)
            return
          }
          // a hero always under the scripted player's hands: when it falls, the next one is taken a second later
          if (m.human === undefined) {
            if (released < 0) released = seconds
            const hero = m.heroes.find((h) => h.alive && h.team === staged.side)
            if (seconds - released >= 1 && hero && c.take(hero.id)) {
              c.cameras.set('hero')
              c.cameras.yaw = hero.yaw
              released = -1
            }
          }
          if (seconds % every === 0) recorder.wave(forceUltimates(m, options.ultimatesPerWave, wave++).length)
          if (seconds % every === 4) recorder.waveFired(recorder.ultimatesSince(4))
          report('fight')
        }, 1000)
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
      clearInterval(timer)
      controller?.stop()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div ref={host} className="arena-canvas" />
      {live && <Live controller={live.controller} staged={live.staged} locked={false} help={false} onHelp={noop} paused={false} onLeave={noop} onRematch={noop} back="" />}
    </>
  )
}

const ms = (v: number) => v.toFixed(1)
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function SoakPanel({ options, report, error }: { options: SoakOptions; report?: SoakReport; error?: string }) {
  const last = report?.samples[report.samples.length - 1]
  const good = (ok: boolean) => ({ color: ok ? '#7dffa0' : '#ff8a7d' })
  return (
    <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 60, maxWidth: 460, padding: '10px 14px', background: 'rgba(0,0,0,0.75)', color: '#e8eef8', font: '12px/1.55 ui-monospace, monospace', borderRadius: 8, pointerEvents: 'none' }}>
      {error ? (
        <div style={good(false)}>The soak test stopped: {error}</div>
      ) : !report ? (
        <div>Soak test · {options.minutes} min · first numbers in 10 s</div>
      ) : (
        <>
          <div>
            soak {clock(report.elapsed)} of {clock(options.minutes * 60)} · fight {report.matches} · {report.spikes.length} frames over 33 ms
          </div>
          <div style={good(report.fight.medianMs <= SOAK_PASS.medianMs)}>
            fights: median {ms(report.fight.medianMs)} ms · 95% {ms(report.fight.p95Ms)} · 99% {ms(report.fight.p99Ms)} · worst {ms(report.fight.worstMs)}
          </div>
          {last && (
            <div>
              last 10 s: {last.quality} · scale {last.pixelRatio} · {last.drawCalls} draws · {Math.round(last.triangles / 1000)}k triangles · {last.heapMb ?? '?'} MB heap · {last.ultimates} ultimates
            </div>
          )}
          {report.finished && (
            <>
              <div style={good(report.pass.frames)}>frames {report.pass.frames ? 'pass' : 'fail'}</div>
              <div style={good(report.pass.memory)}>memory {report.pass.memory ? 'flat' : 'check'}</div>
              <div style={good(report.pass.budget)}>budget {report.pass.budget ? 'pass' : 'over'}</div>
              {report.pass.notes.map((n) => (
                <div key={n}>· {n}</div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
