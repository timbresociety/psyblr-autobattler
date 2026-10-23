// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HudHero, HudState } from '../../arena/client/match-view'
import { Countdown, FIGHT_SPLASH_MS } from './Countdown'
import { LOADING_TIPS, Loading } from './Loading'
import { PauseMenu } from './PauseMenu'
import { Result, resultReason } from './Result'

afterEach(() => (cleanup(), vi.useRealTimers()))

const hero = (id: number, team: 0 | 1, alive: boolean, damageDealt = 100): HudHero => ({ id, name: `Hero ${id}`, team, alive, hp: alive ? 50 : 0, maxHp: 100, damageDealt, airborne: false, fallback: false, cooldowns: {} as HudHero['cooldowns'] })
const state = (over: Partial<HudState>): HudState => ({ seconds: 300, timerSeconds: 300, paused: false, quality: 'full', healthShare: [0.5, 0.4], heroes: [], ...over })

describe('countdown (U18)', () => {
  it('calls onDone only after three seconds', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    render(<Countdown onDone={done} />)
    expect(screen.getByRole('status').textContent).toBe('3')
    // each second's timer starts once the previous number has rendered
    for (const shown of ['2', '1']) {
      act(() => void vi.advanceTimersByTime(1000))
      expect(screen.getByRole('status').textContent).toBe(shown)
    }
    act(() => void vi.advanceTimersByTime(900))
    expect(done).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(100))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('shows FIGHT! once the match runs, then finishes without calling onDone again', () => {
    vi.useFakeTimers()
    const [done, finished] = [vi.fn(), vi.fn()]
    render(<Countdown from={1} onDone={done} onFinished={finished} />)
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByRole('status').textContent).toBe('Fight!')
    expect(done).toHaveBeenCalledTimes(1)
    act(() => void vi.advanceTimersByTime(FIGHT_SPLASH_MS))
    expect(finished).toHaveBeenCalledTimes(1)
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('loading (R40)', () => {
  it('reports progress and turns over a tip every few seconds', () => {
    vi.useFakeTimers()
    render(<Loading done={3} total={21} />)
    expect(screen.getByRole('status').textContent).toBe('Loading heroes… 3 of 21')
    expect(screen.getByText(LOADING_TIPS[0])).toBeTruthy()
    act(() => void vi.advanceTimersByTime(4000))
    expect(screen.getByText(LOADING_TIPS[1])).toBeTruthy()
  })
})

describe('pause menu (U18, AE9)', () => {
  it('offers resume, restart and back to staging', () => {
    const [onResume, onRestart, onBack] = [vi.fn(), vi.fn(), vi.fn()]
    render(<PauseMenu onResume={onResume} onRestart={onRestart} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restart with this setup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to staging' }))
    expect([onResume, onRestart, onBack].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy()
  })
})

describe('result (U18, R13)', () => {
  it('names the reason: wipe, heroes alive, or health left', () => {
    expect(resultReason(state({ winner: 0, reason: 'wipe' }))).toBe('Last side standing')
    expect(resultReason(state({ winner: 0, reason: 'time', heroes: [hero(0, 0, true), hero(1, 0, true), hero(2, 1, true)] }))).toBe('Time out · 2 heroes alive to 1')
    expect(resultReason(state({ winner: 0, reason: 'time', heroes: [hero(0, 0, true), hero(2, 1, true)] }))).toBe('Time out · same heroes alive, more health left (50% to 40%)')
  })

  it('lists every hero by damage and offers a rematch', () => {
    const rematch = vi.fn()
    render(<Result state={state({ winner: 1, reason: 'wipe', heroes: [hero(0, 0, false, 10), hero(1, 1, true, 900)] })} side={0} onRematch={rematch} onBack={() => {}} />)
    expect(screen.getByRole('heading').textContent).toBe('Enemy side wins')
    const rows = screen.getAllByRole('row')
    expect(rows[1].textContent).toContain('Hero 1')
    expect(rows[2].textContent).toContain('Down')
    fireEvent.click(screen.getByRole('button', { name: 'Rematch' }))
    expect(rematch).toHaveBeenCalled()
  })

  it('puts the top damage dealer on an MVP card', () => {
    render(<Result state={state({ winner: 0, reason: 'wipe', seconds: 100, heroes: [hero(0, 0, true, 300), hero(1, 1, false, 1250), hero(2, 0, true, 40)] })} side={0} onRematch={() => {}} onBack={() => {}} />)
    expect(screen.getByRole('heading').textContent).toBe('Your side wins')
    const mvp = screen.getByText('Most valuable:').closest('.hud-mvp')!
    expect(mvp.textContent).toContain('Hero 1')
    expect(mvp.textContent).toContain('1,250')
    expect(mvp.textContent).toContain('13')
    expect(mvp.className).toContain('team-1')
  })
})
