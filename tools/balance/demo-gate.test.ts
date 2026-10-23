import { writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { DEMO_HEROES, demoBuild } from '../../src/arena/demo/roster'
import { runGate } from '../../src/sim/gate'

// throwaway: the balance gate on every demo hero's persona kit, as a forged hero would get it
it('demo gate', () => {
  const faction = process.env.FACTION as 'mogul' | 'leader'
  const out: Record<string, { state: string; steps: number; rate: number; slot?: string }> = {}
  const only = process.env.ONLY?.split('|')
  for (const hero of DEMO_HEROES.filter((h) => (only ? only.some((o) => h.heroName.includes(o)) : h.faction === faction))) {
    const result = runGate(demoBuild({ ...hero, retune: 0 }))
    const steps = result.build.slots.basic.retuneSteps
    out[hero.heroName] = { state: result.state, steps, rate: Math.round(result.winRate * 1000) / 1000, ...(result.strongestSlot ? { slot: result.strongestSlot } : {}) }
    console.log('GATE', hero.heroName.padEnd(36), result.state, 'steps', steps, 'rate', (result.winRate * 100).toFixed(1), result.strongestSlot ?? '')
  }
  writeFileSync(`tools/balance/out/demo-${process.env.ONLY ? 'only' : faction}.json`, JSON.stringify(out, null, 1))
}, 3_600_000)
