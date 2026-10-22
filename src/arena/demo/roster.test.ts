import { describe, expect, it } from 'vitest'
import { hydrateBuild } from '../../charter/build'
import { DEMO_HEROES, demoRoster } from './roster'

describe('demo roster (U1)', () => {
  it('has 10 moguls and 10 leaders with unique names', () => {
    expect(DEMO_HEROES.filter((h) => h.faction === 'mogul')).toHaveLength(10)
    expect(DEMO_HEROES.filter((h) => h.faction === 'leader')).toHaveLength(10)
    expect(new Set(DEMO_HEROES.map((h) => h.heroName)).size).toBe(20)
  })

  it('every build passes Charter validation at its own size', () => {
    for (const build of demoRoster()) {
      const result = hydrateBuild(build)
      expect(result.ok, build.heroName).toBe(true)
      expect(result.build.sizeClass ?? 'medium').toBe(build.sizeClass ?? 'medium')
    }
  })
})
