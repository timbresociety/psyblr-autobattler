/**
 * The clip audit on the generated test heroes: every clip in use and every named replacement, on each hero rebound to
 * our skeleton (src/kit/bench/rebind.ts). Writes .scratch/clip-audit/heroes.json. Run scripts/clip-audit.ts first; the heroes are listed in .scratch/tripo-in/audit.json.
 *
 *     npx tsx scripts/clip-audit-heroes.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import * as THREE from 'three'
import { fileClip, kinematics, onBody, readIndex, type AuditBody, type Kinematics } from '../src/kit/bench/clip-audit.js'
import { libraryMoves } from '../src/arena/client/library-gait.js'
import { AUDIT_HEROES_FILE, type AuditHero } from '../src/kit/bench/clips.js'
import { benchModel } from '../src/kit/bench/model.js'
import { onFloor, ourBone, rebuildSkeleton, standing } from '../src/kit/bench/rebind.js'

const OUT = '.scratch/clip-audit'
// the library's fetches read the public folder: the moves below come out as the game cuts them
globalThis.fetch = (async (url: string) => {
  const body = readFileSync(`public${url}`, 'utf8')
  return { ok: true, status: 200, json: async () => JSON.parse(body) }
}) as unknown as typeof fetch

const idx = readIndex()
const scores = JSON.parse(readFileSync(`${OUT}/scores.json`, 'utf8')) as { rows: { clip: string; uses: unknown[]; bodies: Record<string, unknown> }[] }
const clips = scores.rows.filter((r) => r.uses.length || Object.keys(r.bodies).length > 2).map((r) => r.clip)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
interface Scored { now: Kinematics; legs: Kinematics }
const out: Record<string, { hips: number; legs: number; rows: Record<string, Scored>; moves: Record<string, Scored> }> = {}

const heroes = JSON.parse(readFileSync(AUDIT_HEROES_FILE, 'utf8')) as AuditHero[]
for (const hero of heroes) {
  const doc = await io.read(`.scratch/tripo-in/${hero.file}`)
  const root = doc.getRoot()
  const node = root.listNodes().find((n) => n.getSkin())!
  const position = node.getMesh()!.listPrimitives()[0].getAttribute('POSITION')!
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix())
  const box = new THREE.Box3(new THREE.Vector3(...position.getMin([0, 0, 0])), new THREE.Vector3(...position.getMax([0, 0, 0]))).applyMatrix4(world)
  const fit = standing(box, hero.height)
  const joints = new Map(root.listSkins()[0].listJoints().map((j) => [ourBone(j.getName()), onFloor(new THREE.Vector3(...j.getWorldTranslation()), fit)]))
  const { model: reference } = await benchModel(`public/heroes/v2/${hero.gender}-medium.glb`)
  const ref = idx.genders[hero.gender]!
  idx.bones.forEach((name, k) => reference.getObjectByName(name)?.quaternion.fromArray(ref.rest[k] as number[]))
  const { root: model, bones } = rebuildSkeleton(reference, joints)
  // the mesh has no eyes to turn: stand-ins keep the audit's bone list whole
  for (const eye of ['LeftEye', 'RightEye']) {
    const o = new THREE.Bone()
    o.name = eye
    bones.get('Head')!.add(o)
  }
  const y = (n: string) => bones.get(n)!.getWorldPosition(new THREE.Vector3()).y
  const body: AuditBody = {
    label: hero.label,
    gender: hero.gender,
    model,
    rotations: new Map(idx.bones.map((name, k) => [name, new THREE.Quaternion().fromArray(ref.rest[k] as number[])])),
    hips: bones.get('Hips')!.position.clone(),
    soles: { Left: [y('LeftFoot'), y('LeftToeBase')], Right: [y('RightFoot'), y('RightToeBase')] },
    height: hero.height,
  }
  const rest = { hips: +body.hips.y.toFixed(3), soles: body.soles }
  if (process.env.PROBE) {
    const chain = (o: THREE.Object3D, n: string[]) => n.slice(1).reduce((sum, m, i) => sum + o.getObjectByName(m)!.position.length(), 0)
    const names = ['LeftUpLeg', 'LeftLeg', 'LeftFoot']
    reference.updateMatrixWorld(true)
    const refChain = chain(reference, names), own = chain(model, names)
    console.log(hero.label, 'chain', own.toFixed(3), 'ref', refChain.toFixed(3), 'ratio', (own / refChain).toFixed(3), 'hipsRatio', (body.hips.y / ref.hips[1]).toFixed(3), [...['LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase']].map((n) => bones.get(n)!.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)).join(',')).join(' | '))
    const st = onBody(fileClip('idle', hero.gender, idx), body, idx)
    for (const f of [0.75, 0.85, 0.9, 0.95, 1]) {
      const line = ['crouch_idle', 'walk', 'run', 'run_to_rolling'].map((c) => {
        const clip = onBody(fileClip(c, hero.gender, idx), body, idx).clone()
        const t = clip.tracks.find((x) => x.name === 'Hips.position')!
        for (let i = 1; i < t.values.length; i += 3) t.values[i] = body.hips.y + (t.values[i] - body.hips.y) * f
        return c + ' ' + kinematics(clip, body, idx, ref.tags![c], st).feet.sink
      })
      console.log(' ', f, line.join('  '))
    }
    continue
  }
  // the hips scale with standing height (retarget.ts), which overshoots on a body whose hip joints sit away from its legs' true length: scored both ways
  const names = ['LeftLeg', 'LeftFoot']
  const reach = (o: THREE.Object3D) => names.reduce((sum, n) => sum + o.getObjectByName(n)!.position.length(), 0)
  const legs = reach(model) / reach(reference) / (body.hips.y / ref.hips[1])
  const byLegs = (clip: THREE.AnimationClip) => {
    const out = clip.clone()
    const track = out.tracks.find((t) => t.name === 'Hips.position')!
    const rest = body.hips.toArray()
    for (let i = 0; i < track.values.length; i++) track.values[i] = rest[i % 3] + (track.values[i] - rest[i % 3]) * legs
    return out
  }
  const stance = onBody(fileClip('idle', hero.gender, idx), body, idx)
  const rows: Record<string, Scored> = {}
  for (const clip of clips) {
    if (!ref.tags?.[clip]) continue
    const fitted = onBody(fileClip(clip, hero.gender, idx), body, idx)
    rows[clip] = { now: kinematics(fitted, body, idx, ref.tags[clip], stance), legs: kinematics(byLegs(fitted), body, idx, ref.tags[clip], stance) }
  }
  const moves: Record<string, Scored> = {}
  for (const [move, clip] of await libraryMoves(hero.gender, 'standard')) {
    const fitted = onBody(clip, body, idx)
    moves[move] = { now: kinematics(fitted, body, idx, undefined, stance), legs: kinematics(byLegs(fitted), body, idx, undefined, stance) }
  }
  out[hero.label] = { hips: body.hips.y, legs, rows, moves }
  console.log(hero.label, Object.keys(rows).length, 'clips', Object.keys(moves).length, 'moves, hips', body.hips.y.toFixed(3), 'legs', legs.toFixed(3))
}
writeFileSync(`${OUT}/heroes.json`, JSON.stringify(out))
