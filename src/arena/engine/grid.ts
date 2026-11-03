import type { HeroState } from './state.js'

/** Tests switch the grids off, so every query is a full scan, to check the grids find exactly the same. */
export const GRIDS = { on: true }

/**
 * The heroes filed by where they stand, in square cells (GAME.md §10, "a spatial grid for hit queries"): built for one
 * moment of a tick, so a hundred shots each look only at the heroes near their path instead of at everyone. A query
 * hands them back in index order, the order a scan of every hero would find them in.
 */
export class HeroGrid {
  private readonly cells = new Map<number, number[]>()

  constructor(
    private readonly heroes: readonly HeroState[],
    private readonly cell = 8,
  ) {
    heroes.forEach((h, i) => {
      if (!h.alive) return
      const key = this.key(Math.floor(h.position.x / cell), Math.floor(h.position.z / cell))
      const list = this.cells.get(key)
      if (list) list.push(i)
      else this.cells.set(key, [i])
    })
  }

  private key(ix: number, iz: number) {
    return (iz + 32768) * 65536 + (ix + 32768)
  }

  /** The living heroes whose feet lie in the cells a box on the ground covers, by index. */
  within(minX: number, maxX: number, minZ: number, maxZ: number): HeroState[] {
    const out: number[] = []
    const ax = Math.floor(minX / this.cell)
    const bx = Math.floor(maxX / this.cell)
    const az = Math.floor(minZ / this.cell)
    const bz = Math.floor(maxZ / this.cell)
    // a box wider than the crowd: every hero
    if ((bx - ax + 1) * (bz - az + 1) > 64) return this.heroes.filter((h) => h.alive)
    for (let iz = az; iz <= bz; iz++)
      for (let ix = ax; ix <= bx; ix++) {
        const list = this.cells.get(this.key(ix, iz))
        if (list) for (const i of list) out.push(i)
      }
    out.sort((a, b) => a - b)
    const found: HeroState[] = []
    for (const i of out) if (this.heroes[i].alive) found.push(this.heroes[i])
    return found
  }
}
