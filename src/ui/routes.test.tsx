// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { proposeBuild } from '../charter/build'
import { legacyRoute } from './App'
import { CreditsScreen, creditsOf } from './credits/CreditsScreen'
import { GachaReveal, REVEAL_BEATS } from './create/GachaReveal'

afterEach(cleanup)

describe('routes (GAME.md §11)', () => {
  it('the old query-flag addresses go to the routes that replaced them, keeping the rest of the query', () => {
    expect(legacyRoute('?arena')).toBe('/lobby')
    expect(legacyRoute('?loadout')).toBe('/')
    expect(legacyRoute('?bench&webgl')).toBe('/dev/bench?webgl')
    expect(legacyRoute('?soak&minutes=2')).toBe('/dev/soak?minutes=2')
    expect(legacyRoute('?wardrobe')).toBe('/dev/wardrobe')
    expect(legacyRoute('?physique&body=f')).toBe('/dev/physique?body=f')
    expect(legacyRoute('')).toBeUndefined()
    expect(legacyRoute('?style=rifle')).toBeUndefined()
  })
})

const LICENCES = {
  rpm: { title: 'Ready Player Me animation library', licence: 'agreement', url: 'https://example.com/a' },
  mixamo: { title: 'Mixamo', licence: 'terms', url: 'https://example.com/b' },
  '100style': { title: '100STYLE dataset', licence: 'CC BY 4.0', url: 'https://example.com/c', credit: 'Ian Mason, Sebastian Starke, Taku Komura (2022)' },
  cmu: { title: 'CMU Graphics Lab Motion Capture Database', licence: 'Free for any use', url: 'https://example.com/d', credit: 'The data used in this project was obtained from mocap.cs.cmu.edu.' },
}

describe('credits', () => {
  it('names exactly the sources that ask for credit, with their credit line, and no supplier that does not', async () => {
    expect(creditsOf(LICENCES).map((c) => c.key)).toEqual(['100style', 'cmu'])
    render(
      <MemoryRouter>
        <CreditsScreen load={() => Promise.resolve(LICENCES)} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('100STYLE dataset')).toBeTruthy()
    expect(screen.getByText(/Ian Mason, Sebastian Starke, Taku Komura/)).toBeTruthy()
    expect(screen.getByText(/mocap\.cs\.cmu\.edu/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Ready Player Me|Mixamo/)
  })
})

describe('the gacha reveal', () => {
  const build = { ...proposeBuild({ heroName: 'Ada Vex', roleId: 'support', skills: {} }).build, sizeClass: 'small' as const }

  it('drops the capsule, pops it open, then shows the new hero, and Forge the kit carries on', () => {
    vi.useFakeTimers()
    try {
      const done = vi.fn()
      render(<GachaReveal build={build} onDone={done} />)
      expect(screen.queryByText('Ada Vex')).toBeNull()
      act(() => void vi.advanceTimersByTime(REVEAL_BEATS.drop + 10))
      expect(screen.queryByText('Ada Vex')).toBeNull()
      act(() => void vi.advanceTimersByTime(REVEAL_BEATS.pop + 10))
      expect(screen.getByText('Ada Vex')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Forge the kit' }))
      expect(done).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('a click skips straight to the card', () => {
    render(<GachaReveal build={build} onDone={() => {}} />)
    fireEvent.click(screen.getByRole('dialog'))
    expect(screen.getByText('Ada Vex')).toBeTruthy()
  })
})
