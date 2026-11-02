import type { CoverPiece, MapLine } from './cover.js'
import { cos, sin } from './maths.js'

/**
 * The House of Instinct in grey boxes (GAME.md §8, the first deliverable): Roulette Court → Chip Stacks → Card Ramp →
 * VIP Balcony → Chandelier Route, cut down to the 112 × 84 m arena for 10 v 10. Blue musters at -z and red at +z; the
 * halves mirror each other through the middle, so each side has the same routes.
 *
 * Four bands: the lower routes on the ground (the Diamond Mines trench on +x, the Crypto Catacombs on -x, the service
 * tunnel and the House Vault under the court), the main floor at 4.5 m (4 m of headroom under its decks), the
 * balconies at 11 m and the aerial routes at 16.5 m. Every change of band has a ramp, a stair or a chain of platforms a baseline jump reaches (§7 rule 1). The
 * heights are spaced on the measured jumps (ENGINE.move: 4.2 m, a second 3.4 m more, and a 1.4 m mantle): the chip
 * stacks climb in §8's 1.2 m steps, a balcony is a stair, a ramp or a double jump from a table, and the chandelier is
 * reached only by the Chart Climb and the zip lines: the riskier route is the faster one (§7 rule 5). Ramps are
 * 20–25°.
 */

export const LEVEL = { low: 0, main: 4.5, up: 11, air: 16.5 } as const
/** How thick the decks are: a deck over a tunnel leaves 4 m of headroom below the main floor. */
const DECK = 0.5

const pieces: CoverPiece[] = []
const lines: MapLine[] = []

const box = (x0: number, x1: number, z0: number, z1: number, top: number, look: CoverPiece['look'], base = 0, extra: Partial<CoverPiece> = {}) =>
  pieces.push({ shape: { kind: 'block', x: (x0 + x1) / 2, z: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hz: Math.abs(z1 - z0) / 2 }, base, top, look, ...extra })
const disc = (x: number, z: number, r: number, top: number, look: CoverPiece['look'], base = 0) => pieces.push({ shape: { kind: 'column', x, z, r }, base, top, look })
/** A ramp over [x0, x1] × [z0, z1] climbing from `low` to `top` toward `rise`. */
const ramp = (x0: number, x1: number, z0: number, z1: number, low: number, top: number, rise: NonNullable<CoverPiece['slope']>['rise'], base = low) =>
  box(x0, x1, z0, z1, top, 'ramp', Math.min(base, low), { slope: { rise, low } })

// the main floor: slabs over everything but the two flank trenches, the service tunnel and the vault
const { main, up, air } = LEVEL
box(-56, -48, -42, 42, main, 'grey')
box(48, 56, -42, 42, main, 'grey')
box(-38, -8, -42, 42, main, 'grey')
box(8, 38, -42, 42, main, 'grey')
for (const s of [-1, 1]) {
  const z = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a])
  // the strips beside the service tunnel, between the vault and the far end
  box(-8, -3, ...z(6, 42), main, 'grey')
  box(3, 8, ...z(6, 42), main, 'grey')
  // the trenches' ends and the tunnel's end, at the main floor
  box(-48, -38, ...z(34, 42), main, 'grey')
  box(38, 48, ...z(34, 42), main, 'grey')
  box(-3, 3, ...z(32, 42), main, 'grey')
  // ramps down into each trench and the tunnel, from the main floor at the far end
  ramp(-48, -38, ...z(23, 34), 0, main, s > 0 ? 'z+' : 'z-')
  ramp(38, 48, ...z(23, 34), 0, main, s > 0 ? 'z+' : 'z-')
  ramp(-3, 3, ...z(21, 32), 0, main, s > 0 ? 'z+' : 'z-')
  // the tunnel's roof between the vault and the court's edge, and bridges across both trenches
  box(-3, 3, ...z(6, 16), main, 'grey', main - DECK)
  for (const at of [8, 20]) {
    box(-48, -38, ...z(at - 1.5, at + 1.5), main, 'grey', main - DECK)
    box(38, 48, ...z(at - 1.5, at + 1.5), main, 'grey', main - DECK)
  }
}
// the bridge over both trenches at the middle, and the vault's roof under the court
box(-48, -38, -1.5, 1.5, main, 'grey', main - DECK)
box(38, 48, -1.5, 1.5, main, 'grey', main - DECK)
box(-8, 8, -6, 6, main, 'grey', main - DECK)

// Roulette Court: the raised centre, two stairs up to it, chip-stack shortcuts beside it, and a ring of low posts with
// a gap on each axis for the four entrances
disc(0, 0, 5, main + 2.5, 'chip', main)
ramp(5, 11, -1.5, 1.5, main, main + 2.5, 'x-', main)
ramp(-11, -5, -1.5, 1.5, main, main + 2.5, 'x+', main)
for (const s of [-1, 1]) disc(0, 8 * s, 1.3, main + 1.3, 'chip', main)
for (let k = 0; k < 16; k++) {
  if (k % 4 === 0) continue
  const a = (k / 16) * Math.PI * 2
  disc(16 * sin(a), 16 * cos(a), 0.8, main + 1.1, 'grey', main)
}

// the balcony loop over the court: four walkways 3.5 m wide in a square ring, on pillars
const ring = 21
const half = 1.75
box(-ring - half, ring + half, ring - half, ring + half, up, 'grey', up - DECK)
box(-ring - half, ring + half, -ring - half, -ring + half, up, 'grey', up - DECK)
box(ring - half, ring + half, -ring + half, ring - half, up, 'grey', up - DECK)
box(-ring - half, -ring + half, -ring + half, ring - half, up, 'grey', up - DECK)
for (const [x, z] of [[-ring, -ring], [ring, -ring], [-ring, ring], [ring, ring], [5, ring], [5, -ring], [ring, 0], [-ring, 0]] as const) box(x - 0.5, x + 0.5, z - 0.5, z + 0.5, up - DECK, 'pillar', main)

for (const s of [-1, 1]) {
  const z = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a])
  const rise = s > 0 ? 'z+' : 'z-'
  // VIP Crescent: a walkway across the back of the half, a lounge pad at each end, glass partitions along its
  // front edge to fight from behind, and a bridge from its middle to the balcony loop
  box(-22, 22, ...z(30, 34), up, 'grey', up - DECK)
  box(-36, -22, ...z(26, 36), up, 'grey', up - DECK)
  box(22, 32, ...z(26, 36), up, 'grey', up - DECK)
  box(-1, 1, ...z(ring + half, 30), up, 'grey', up - DECK)
  for (const x of [-14, 12]) box(x - 2, x + 2, ...z(30, 30.4), up + 1.2, 'grey', up)
  for (const [x, zz] of [[-36, 26], [32, 26], [-36, 36], [32, 36]] as const) box(x - 0.5, x + 0.5, ...z(zz - 0.5, zz + 0.5), up - DECK, 'pillar', main)

  // Card Hall (-x): the card ramp from the main floor up to the lounge pad, a main staircase up to the balcony loop,
  // poker tables to fight on and dealer stations to step and hide behind
  ramp(-34, -30, ...z(10, 26), main, up, rise, main)
  ramp(-37, -ring - half, ...z(2, 5), main, up, 'x+', main)
  box(-29, -23, ...z(10, 14), main + 1.2, 'grey', main)
  box(-29, -23, ...z(18, 22), main + 1.2, 'grey', main)
  box(-37, -35.5, ...z(12, 13.5), main + 1.3, 'grey', main)
  box(-27, -25.5, ...z(6.5, 8), main + 1.3, 'grey', main)
  box(-15, -13.5, ...z(23, 24.5), main + 1.3, 'grey', main)

  // Chip Stacks (+x): chips climbing in 1.2 m steps over 1.2–1.5 m gaps from the floor onto the balcony loop's
  // corner, and two taller stacks outside the ring up to the lounge pad
  const chips = [[12.5, 5.5], [15.5, 8.5], [16.5, 12.6], [16.5, 16.6]] as const
  chips.forEach(([x, zz], i) => disc(x, zz * s, 1.4, main + 1.2 * (i + 1), 'chip', main))
  disc(27, 17.5 * s, 1.4, main + 2.4, 'chip', main)
  disc(27, 22 * s, 1.4, up - 1.7, 'chip', main)

  // Slot Canyon under the +x lounge: slot machines to fight between, too tall to climb
  for (const [x, zz] of [[11, 28], [15, 28], [19, 31], [9, 35]] as const) box(x - 1, x + 1, ...z(zz - 0.75, zz + 0.75), main + 3, 'grey', main)
  // breakable barricades either side of the court's axis entrances
  box(-13, -10, ...z(13, 14), main + 1.4, 'barricade', main, { health: 1200 })
  box(8, 11, ...z(13, 14), main + 1.4, 'barricade', main, { health: 1200 })

  // Chart Climb (+x, the risky way up): candlesticks rising from the lounge pad to the gantry
  disc(31.5, 22.8 * s, 1.25, up + 2, 'chip', main)
  disc(33.5, 18.6 * s, 1.25, up + 3.8, 'chip', main)
  disc(34, 13.8 * s, 1.6, air, 'chip', main)
  // Chandelier Spine: a zip line from each gantry down to just short of the chandelier over the court, so a rider let
  // go at its end carries on onto the platform
  lines.push({ kind: 'zip', a: { x: 34, y: air + 5, z: 13.8 * s }, b: { x: 6, y: air + 3.4, z: 1.5 * s } })
  // and a rail from the VIP walkway down over the court's floor, ridden standing
  lines.push({ kind: 'rail', a: { x: -8, y: up + 0.1, z: 30 * s }, b: { x: -8, y: main + 0.4, z: 12 * s } })
}

// the chandelier: a platform hanging over the court, reached only along the spine
disc(0, 0, 4, air, 'chip', air - DECK)

export const HOUSE: readonly CoverPiece[] = pieces
export const HOUSE_LINES: readonly MapLine[] = lines
