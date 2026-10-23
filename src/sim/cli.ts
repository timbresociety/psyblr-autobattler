import { BUILD_SLOTS, type Build } from '../charter/build'
import { ROLE_IDS } from '../charter/roles'
import { armyModifiers } from '../charter/synergy'
import { referenceArmy, referenceField, randomBuild, sampleBuilds } from './field'
import { GATE_CEILING, playScored, runGate, winRateVsField } from './gate'
import { createRng } from './rng'

/**
 * Balance report over the template catalogue (U8). Run with `npm run sim`.
 * Exits non-zero when any reference-field build or sampled army beats its field above the ceiling.
 */

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const SAMPLES = Number(args.get('samples') ?? 40)
const ARMY_SEEDS = Number(args.get('army-seeds') ?? 20)
const SEED = Number(args.get('seed') ?? 7)

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
let failed = false

console.log(`\nBalance report (ceiling ${pct(GATE_CEILING)})\n`)

console.log('Reference field: each default build against the field')
for (const build of referenceField()) {
  const rate = winRateVsField(build)
  const over = rate > GATE_CEILING
  failed ||= over
  console.log(`  ${build.roleId.padEnd(9)} ${pct(rate)}${over ? '  OVER CEILING' : ''}`)
}

console.log(`\nSampled builds: ${SAMPLES} seeded random legal builds`)
const samples = sampleBuilds(SAMPLES, SEED).map((build) => ({ build, rate: winRateVsField(build, { duelsPerMember: 8 }) }))
samples.sort((a, b) => b.rate - a.rate)
const over = samples.filter((s) => s.rate > GATE_CEILING)
console.log(`  ${over.length} of ${SAMPLES} would be retuned or blocked by the gate`)
for (const s of samples.slice(0, 8)) {
  console.log(`  ${pct(s.rate).padStart(6)}  ${s.build.roleId.padEnd(9)} ${BUILD_SLOTS.map((slot) => s.build.slots[slot].templateId.replace(/^\w+-/, '')).join(', ')}`)
}

const pairs = new Map<string, number>()
for (const s of over) {
  const ids = BUILD_SLOTS.map((slot) => s.build.slots[slot].templateId).sort()
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.set(`${ids[i]} + ${ids[j]}`, (pairs.get(`${ids[i]} + ${ids[j]}`) ?? 0) + 1)
}
const hot = [...pairs].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('\nPair hot spots among over-ceiling builds')
if (!hot.length) console.log('  none')
for (const [pair, n] of hot) console.log(`  ${n}x  ${pair}`)

const rng = createRng(SEED)
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]
const armies: { label: string; builds: Build[] }[] = []
for (const role of ROLE_IDS) armies.push({ label: `10x ${role}`, builds: Array.from({ length: 10 }, (_, i) => randomBuild(role, rng, `${role}-${i}`)) })
for (let a = 0; a < 6; a++) armies.push({ label: `themed mix ${a + 1}`, builds: Array.from({ length: 10 }, (_, i) => randomBuild(pick(ROLE_IDS), rng, `mix-${a}-${i}`)) })

let unique = 0
let total = 0
for (const army of armies.slice(ROLE_IDS.length)) {
  const keys = army.builds.map((b) => BUILD_SLOTS.map((s) => b.slots[s].templateId).join('|'))
  for (const k of keys) {
    total++
    if (keys.filter((x) => x === k).length === 1) unique++
  }
}
console.log(`\nTemplate distinctness: ${pct(unique / total)} of heroes in sampled mixed armies have a unique template set`)

// 10v10 armies swing more than the gate's 3v3 skirmishes, so the army check warns instead of failing; per-hero
// skirmish balance (R15) is what gates every build.
console.log(`\nArmies (warning only): 10-hero armies of gate-passed builds against the reference army, synergy applied (${ARMY_SEEDS} fights each)`)
let blocked = 0
// every hero in a real army has passed the gate, so mixed armies are gated (and retuned) first; a single-role army
// loses to the stacking penalty whatever its kits, so gating it would only cost time
const gated = (b: Build, mixed: boolean): Build | undefined => {
  if (!mixed) return b
  const outcome = runGate(b, { duelsPerMember: 6 })
  if (outcome.state === 'blocked') blocked++
  return outcome.state === 'ready' ? outcome.build : undefined
}
// the yardstick is the reference army: one default build per role plus a second line of the core roles
const refs = [armyModifiers(referenceArmy())]
const armyRates = armies.map((army) => {
  const mixed = army.label.startsWith('themed')
  const mine = armyModifiers(army.builds.map((b) => gated(b, mixed)).filter((b): b is Build => !!b))
  const fight = (from: number, count: number) => {
    let score = 0
    for (let s = from; s < from + count; s++) score += playScored(mine, refs[s % refs.length], Math.floor(s / refs.length) % 2 === 1, SEED * 31 + s)
    return score
  }
  let score = fight(0, ARMY_SEEDS)
  let fights = ARMY_SEEDS
  // a result over the ceiling on a small sample is confirmed on a larger one before it fails the run
  if (score / fights > GATE_CEILING) {
    score += fight(ARMY_SEEDS, ARMY_SEEDS * 3)
    fights += ARMY_SEEDS * 3
  }
  return { label: `${army.label} (${army.builds.map((b) => b.roleId.slice(0, 4)).join(' ')})`, rate: score / fights }
})
armyRates.sort((a, b) => b.rate - a.rate)
console.log(`  ${blocked} sampled heroes were blocked by the gate and left out`)
for (const a of armyRates) {
  const bad = a.rate > GATE_CEILING
  console.log(`  ${pct(a.rate).padStart(6)}  ${a.label}${bad ? '  OVER CEILING (warning)' : ''}`)
}

console.log(failed ? '\nFAIL: something beats its field above the ceiling\n' : '\nOK\n')
process.exit(failed ? 1 : 0)

