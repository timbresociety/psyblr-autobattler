/**
 * The traversal and combat course (docs/plans/2026-11-13-combat-traversal.md): John in his lab (`/dev/john`), driven
 * from the seat through each of the acceptance sequences, a frame at a time at a display's own rate, in a private
 * headless Chrome on port 9444 (never the owner's 9335). Each sequence writes a filmstrip (the player's view with a
 * side view inset) and a row per frame: the engine's state, the clips playing and their weights, and where the feet,
 * hips and hands are from the engine's own position, so contact can be read off numbers as well as seen.
 *
 *     node scripts/course.mjs [--out dir] [--fps 60] [--john body:medium] [--gender m] [--physique id]
 *                             [--attitude neutral] [--motion pack|library] [--only run-jump,mantle] [--every 3]
 *                             [--v blade] (John's melee family: unarmed, blade, greatsword, ...)
 *
 * Needs the dev server (COURSE_BASE, default http://localhost:3110). Output is local debug data: keep it in .scratch.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const BASE = process.env.COURSE_BASE ?? 'http://localhost:3110'
const PORT = Number(process.env.COURSE_CHROME ?? 9444)
const FPS = Number(arg('fps', '60'))
const EVERY = Number(arg('every', String(Math.max(1, Math.round(FPS / 20)))))
const OUT = arg('out', '.scratch/course/run')
const ONLY = arg('only', '')?.split(',').filter(Boolean)
const MOTION = arg('motion', '')
const JOHN = arg('john', 'body:medium')
const V = arg('v', 'blade')
const prefs = { john: JOHN, gender: arg('gender', 'm'), attitude: arg('attitude', 'neutral'), ...(arg('physique', '') ? { physique: arg('physique', '') } : {}) }
mkdirSync(OUT, { recursive: true })

const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(process.env.CLAUDE_JOB_DIR ?? tmpdir(), 'tmp', 'course-chrome')}`,
  '--headless=new', '--window-size=1600,900', '--enable-unsafe-webgpu', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  // a small machine: nothing fetched or kept that the course doesn't use (the profile once grew past 500 MB)
  '--disk-cache-size=33554432', '--media-cache-size=1', '--disable-component-update', '--disable-background-networking', '--disable-sync', '--disable-extensions',
  '--no-first-run', '--no-default-browser-check', '--mute-audio', '--disable-features=OptimizationGuideModelDownloading,OptimizationHints,Translate,MediaRouter',
  'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
// a run that is stopped takes its Chrome with it: an orphan keeps a core busy and spoils the next run's timings
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(1))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let target
for (let i = 0; i < 40 && !target; i++) {
  await wait(500)
  target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((t) => t.find((x) => x.type === 'page')).catch(() => undefined)
}
if (!target) throw new Error('no chrome')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => (socket.onopen = r))
let id = 0
const pending = new Map()
const errors = []
socket.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) pending.get(m.id)(m)
  else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
  else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
}
const cdp = (method, params = {}) => new Promise((resolve) => {
  pending.set(++id, resolve)
  socket.send(JSON.stringify({ id, method, params }))
})
const run = async (expression) => {
  const m = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? m.result.exceptionDetails.text)
  return m.result?.result?.value
}

await cdp('Page.enable')
await cdp('Runtime.enable')
await cdp('Page.bringToFront')
// the lab reads its picks from this browser's storage: set them on the origin first
await cdp('Page.navigate', { url: `${BASE}/dev` })
await wait(1500)
await run(`(() => { const p = { ...JSON.parse(localStorage.getItem('john-lab:prefs') ?? '{}'), ...${JSON.stringify(prefs)} }; p.kit = { basic: 'v-blade', active1: 'lmb-pistol-single-straight', active2: 'q-stun', movement: 'e-dash', passive: 'f-flame', ultimate: 'r-strike', ...(p.kit ?? {}), basic: 'v-${V}' }; if (!${JSON.stringify(prefs)}.physique) delete p.physique; localStorage.setItem('john-lab:prefs', JSON.stringify(p)) })(); 0`)
const query = new URLSearchParams()
if (MOTION) query.set('motion', MOTION)
// `--fitting off`: weapons as modelled, not sized to the hero's hands (fit.ts), to set beside the fitted ones
if (arg('fitting', '')) query.set('fit', arg('fitting', ''))
// `--cast john,large-john`: generated heroes for the match's first heroes (heroes.ts localCast; local files)
if (arg('cast', '')) query.set('cast', arg('cast', ''))
const ENTRY = arg('entry', 'lab')
if (ENTRY === 'lab') {
  await cdp('Page.navigate', { url: `${BASE}/dev/john${query.size ? `?${query}` : ''}` })
  for (let i = 0; i < 180; i++) {
    await wait(1000)
    if (await run('!!window.__arena && window.__arena.arena.match.tick > 5 && window.__arena.arena.match.human === 0').catch(() => false)) break
    if (i === 179) throw new Error(`the lab never started: ${errors.slice(-3).join(' | ').slice(0, 600) || (await run('document.body.innerText.slice(0, 300)').catch(() => 'no page'))}`)
  }
} else {
  // an ordinary match, as a player starts one: the lobby, the blue side, the starter squads, Start; then the first
  // blue hero that fights hand to hand is taken
  await cdp('Page.navigate', { url: `${BASE}/lobby${query.size ? `?${query}` : ''}` })
  const click = (label) => run(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${label}.test(x.textContent)); if (b) setTimeout(() => b.click(), 0); return !!b })()`)
  const until = async (what, test) => {
    for (let i = 0; i < 120; i++) {
      await wait(1000)
      if (await test().catch(() => false)) return
    }
    throw new Error(`the lobby never got to ${what}`)
  }
  await until('the side', () => click('/blue side/i'))
  await until('the squads', () => click('/Johns vs Legends/'))
  await wait(2000)
  await until('Start', () => click('/^\\s*Start\\s*$/'))
  await until('the match', () => run('!!window.__arena && window.__arena.arena.match.tick > 10'))
  await run(`(() => { const a = window.__arena, m = a.arena.match; for (let i = 0; i < m.heroes.length; i++) if (m.heroes[i].alive && m.heroes[i].team === 0 && a.arena.setups[i].kit.basic.delivery.kind === 'melee' && a.take(i)) return (window.__courseHero = i) })()`)
}

// the seat's own driver: held actions become the played hero's command, as the keys would; a side camera rides along
const INSTALL = `(() => {
  const a = window.__arena
  a.seat.hold(true)
  document.head.insertAdjacentHTML('beforeend', '<style>.john-lab-panel,.john-lab-toggle,.arena-overlay,.hud-controls-hint{display:none!important}</style>')
  const C = (window.__course = { h: window.__courseHero ?? 0, name: 'John', held: new Set(), yaw: 0, pitch: 0, sideYaw: Math.PI / 2, dist: 4.4, side: a.camera.clone(), inset: true })
  C.side.fov = 40
  C.rect = [0.5, 0, 0.5, 0.8]
  C.show = (on) => a.insets(on ? [{ camera: C.side, rect: C.rect }] : [])
  C.show(true)
  C.name = a.arena.setups[C.h].build.heroName
  const MOVES = { jump: 1, dash: 2, crouch: 4, dodge: 8, prone: 16, block: 32, interact: 64 }
  const SLOTS = { basic: 1, active1: 2, active2: 4, passive: 8, ultimate: 16, movement: 32 }
  const TAU = Math.PI * 2
  const steps = (x) => (((Math.round((x / TAU) * 4096) % 4096) + 4096) % 4096)
  a.hooks.human = () => {
    const h = (k) => (C.held.has(k) ? 1 : 0)
    const me = a.arena.match.heroes[C.h]
    // hanging, the camera swings to the wall and forward means into it, as it does for a player
    if (me.hang) C.yaw = a.cameras.yaw
    else a.cameras.yaw = C.yaw
    a.cameras.pitch = C.pitch
    // walk held: the stick part way, a walk
    const stick = h('walk') ? 0.4 : 1
    const f = (h('forward') - h('back')) * stick
    const r = (h('right') - h('left')) * stick
    let moves = 0
    let buttons = 0
    for (const k in MOVES) if (C.held.has(k)) moves |= MOVES[k]
    for (const k in SLOTS) if (C.held.has(k)) buttons |= SLOTS[k]
    return { moveX: Math.sin(C.yaw) * f - Math.cos(C.yaw) * r, moveZ: Math.cos(C.yaw) * f + Math.sin(C.yaw) * r, moves, buttons, aimYaw: steps(C.yaw), aimPitch: steps(C.pitch) }
  }
  a.hooks.on('frame', () => {
    const p = a.positions()[C.h]
    const s = a.views[C.h].root.scale.x || 1
    const d = C.dist * Math.max(1, a.arena.match.heroes[C.h].size === 'colossal' ? 1.6 : a.arena.match.heroes[C.h].size === 'huge' ? 1.35 : 1)
    // level: the height the side view holds, so a climb reads as a climb; otherwise it rides with the hero
    const y = C.level ?? p.y
    if (C.hand) {
      // close on a hand and what it holds, from a turn round it, as far off as the hero is big
      const sock = model()?.root.getObjectByName('socket:' + C.hand.slot)
      const head = model()?.root.getObjectByName('Head')
      if (sock && head) {
        const k = (C.hand.dist * (head.getWorldPosition(v).y - p.y)) / 1.57
        sock.getWorldPosition(v)
        C.side.position.set(v.x + Math.sin(C.hand.yaw) * k, v.y + k * (C.hand.up ?? 0.3), v.z + Math.cos(C.hand.yaw) * k)
        C.side.lookAt(v)
      }
    } else if (C.fixed) {
      C.side.position.set(...C.fixed.from)
      C.side.lookAt(...C.fixed.to)
    } else {
      C.side.position.set(p.x + Math.sin(C.sideYaw) * d, y + 1.15, p.z + Math.cos(C.sideYaw) * d)
      C.side.lookAt(p.x, y + 1.0, p.z)
    }
    void s
  })
  const v = C.side.position.clone()
  // the played hero's own body: the one drawn under its view in this match (the staging board draws its own of the same name)
  const under = (o, top) => { for (let p = o; p; p = p.parent) if (p === top) return true; return false }
  const model = () => (window.__fix ?? []).filter((f) => f.hero === C.name && f.root.visible && under(f.root, a.views[C.h].root)).pop()
  const r3 = (x) => Math.round(x * 1000) / 1000
  C.model = model
  C.probe = () => {
    const m = a.arena.match
    const h = m.heroes[C.h]
    const p = a.positions()[C.h]
    const fix = model()
    const at = (name) => {
      const b = fix?.root.getObjectByName(name)
      if (!b) return undefined
      b.getWorldPosition(v)
      return [r3(v.x - p.x), r3(v.y - p.y), r3(v.z - p.z)]
    }
    const y = (name) => at(name)?.[1]
    const low = Math.min(...['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase', 'LeftToe_End', 'RightToe_End'].map((n) => y(n) ?? Infinity))
    const cam = a.camera.position
    // where the hero's middle is on screen, as shares of the view: the framing
    v.set(p.x, p.y + 1, p.z).project(a.camera)
    const screen = [r3((v.x + 1) / 2), r3((1 - v.y) / 2)]
    return {
      tick: m.tick, pos: [r3(p.x), r3(p.y), r3(p.z)], engine: [r3(h.position.x), r3(h.position.y), r3(h.position.z)], vel: [r3(h.velocity.x), r3(h.velocity.y), r3(h.velocity.z)],
      air: h.airborne, stance: h.stance,
      is: [h.roll && 'roll', h.slide && (h.slide.prone ? 'dive' : 'slide'), h.mantle && 'mantle', h.hang && 'hang', h.zip && 'zip', h.wallRun && 'wallrun', h.launch && 'launch', h.down && 'down', h.blocking && 'block', h.sprinting && 'sprint', h.travel && 'travel', h.traverse && h.traverse.how, m.tick < h.dashUntil && 'dash', h.stunnedUntil > m.tick && 'stun'].filter(Boolean).join('+'),
      action: h.action ? h.action.slot + (h.action.released ? ':rec' : ':prep') + (h.action.melee ? ':' + (h.action.melee.kind ?? (h.action.melee.heavy !== undefined ? 'heavy' : 's' + h.action.melee.step)) : '') : '',
      combo: h.combo.step, stamina: r3(h.stamina),
      pose: (() => { const st = window.__lod?.animators?.[C.h]?.state; return st ? st.kind + (st.phase ? ':' + st.phase : '') + (st.tail ? ':tail' : '') + (st.low === true ? ':low' : '') : window.__lod?.poses?.[C.h] })(), t: (() => { const st = window.__lod?.animators?.[C.h]?.state; return st && typeof st.t === 'number' ? Math.round(st.t * 100) / 100 : undefined })(), squash: Math.round((window.__lod?.animators?.[C.h]?.squash ?? 0) * 1000) / 1000, mode: window.__lod?.modes?.[C.h],
      playing: fix?.playing() ?? [],
      // the clip that leads, by the library's own name for it (a move plays under the engine's name)
      lead: (() => {
        C.leadAt = undefined
        const top = (fix?.playing() ?? []).map((p) => /^(.*?)(:top|:legs)?\\((.*?)s\\):([\\d.]+)$/.exec(p)).filter((m) => m && m[2] !== ':legs' && !/^(walk|jog|run)(_|$)|^idle($|-)|^air(_|$)/.test(m[1])).sort((x, y) => Number(y[4]) - Number(x[4]))[0]
        if (!top) return undefined
        // and where in that clip it is, in the clip's own seconds as the library has it (its marks are written in those)
        const src = fix.clip(top[1])?.userData?.source
        const time = fix.time?.(top[1]) ?? 0
        C.leadAt = r3(src ? src.from + time * src.rate : time)
        return src?.clip ?? top[1]
      })(),
      leadAt: C.leadAt,
      // where an effect would leave the hero this frame, by the effects' own rule (effects/player.ts muzzleOf: the far
      // end of what the right hand holds, else the leading palm), with what it is measured against: each palm, each
      // elbow, the chest, the aim, and what is in each hand
      fx: (() => {
        const V = v.constructor
        const view = a.views[C.h]
        const aim = new V(Math.sin(h.yaw) * Math.cos(h.pitch), Math.sin(h.pitch), Math.cos(h.yaw) * Math.cos(h.pitch))
        const world = (name) => { const b = fix?.root.getObjectByName(name); return b ? b.getWorldPosition(new V()) : undefined }
        const palmOf = (side) => { const w = world(side + 'Hand'); const e = world(side + 'ForeArm'); return w && e ? w.clone().lerp(e, -0.35) : w }
        const lead = view.hand?.(aim, new V())
        const tipAt = view.tip?.(new V())
        // (the effects' own check, by the body's size: effects/player.ts muzzleOf)
        const far = 2 * ({ tiny: 0.8, small: 0.9, medium: 1, large: 1.15, huge: 1.3, colossal: 1.6 }[h.size] ?? 1)
        const origin = tipAt && lead && tipAt.distanceToSquared(lead) < far * far ? tipAt : lead
        const rel = (q) => (q ? [r3(q.x - p.x), r3(q.y - p.y), r3(q.z - p.z)] : undefined)
        const inHand = (slot) => (fix?.root.getObjectByName('socket:' + slot)?.children ?? []).map((c) => c.name.replace(/^arm:/, ''))
        return { aim: [r3(aim.x), r3(aim.y), r3(aim.z)], origin: rel(origin), from: origin && origin === tipAt ? 'tip' : 'palm', tip: rel(tipAt), palms: [rel(palmOf('Left')), rel(palmOf('Right'))], elbows: [rel(world('LeftForeArm')), rel(world('RightForeArm'))], chest: rel(world('Spine2')), sock: rel(world('socket:hand_r')), bore: (() => { const o = fix?.root.getObjectByName('socket:hand_r'); if (!o) return undefined; const e = o.matrixWorld.elements; const n = Math.hypot(e[8], e[9], e[10]) || 1; return [r3(e[8] / n), r3(e[9] / n), r3(e[10] / n)] })(), held: [inHand('hand_l'), inHand('hand_r')], fixups: fix?.state ? { aimLeft: r3(fix.state.aimLeft), grip: r3(fix.state.grip) } : undefined, tall: ({ tiny: 0.8, small: 0.9, medium: 1, large: 1.15, huge: 1.3, colossal: 1.6 }[h.size] ?? 1) }
      })(),
      // how the right hand's piece points: each of its socket's own axes as [ahead (+x here), up], a blade running up its +y
      grip: (() => {
        const sock = fix?.root.getObjectByName('socket:hand_r')
        if (!sock) return undefined
        const e = sock.matrixWorld.elements
        const n = (i) => Math.hypot(e[i], e[i + 1], e[i + 2]) || 1
        return [0, 4, 8].map((i) => [r3(e[i] / n(i)), r3(e[i + 1] / n(i))])
      })(),
      feetAt: [at('LeftFoot'), at('RightFoot')],
      // the dummy the audit strikes: what holds it, and how it is drawn
      foe: (() => { const f = m.heroes[2]; if (!f) return undefined; const st = window.__lod?.animators?.[2]?.state; return [f.down && 'down', f.downed && 'downed', f.launch && 'launch', f.knockback && 'knockback', f.grabbedBy !== undefined && 'grabbed', f.stunnedUntil > m.tick && 'stunned', !f.alive && 'dead'].filter(Boolean).join('+') + '|' + (st?.kind ?? '') })(),
      tip: (() => { const t = a.views[C.h].tip?.(v); return t ? [r3(t.x - p.x), r3(t.y - p.y), r3(t.z - p.z)] : undefined })(),
      hipsAt: at('Hips'),
      low: r3(low), hips: y('Hips'), feet: [y('LeftFoot'), y('RightFoot')], toes: [y('LeftToeBase'), y('RightToeBase')], hands: [at('LeftHand'), at('RightHand')], head: y('Head'),
      rim: h.hang ? [r3(h.hang.x - p.x), r3(h.hang.y - p.y), r3(h.hang.z - p.z)] : h.mantle ? [r3(h.mantle.x1 - p.x), r3(h.mantle.y1 - p.y), r3(h.mantle.z1 - p.z)] : undefined,
      cam: { at: [r3(cam.x - p.x), r3(cam.y - p.y), r3(cam.z - p.z)], screen, close: a.cameras.tooClose(), shown: a.views[C.h].root.visible },
    }
  }
  C.frame = async (seconds) => {
    await a.seat.frame(seconds)
    return C.probe()
  }
  C.place = (x, y, z, yaw) => {
    const h = a.arena.match.heroes[C.h]
    Object.assign(h, { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 }, airborne: false, yaw, stamina: 3, stance: 'stand', roll: undefined, slide: undefined, mantle: undefined, hang: undefined, zip: undefined, wallRun: undefined, launch: undefined, action: undefined, dashUntil: 0, airJumps: 0, hangAfter: 0, zipAfter: 0, wallRunAfter: 0, combo: { step: 0, until: 0 }, nextAttackAt: 0, basicSince: -1, buttonsHeld: 0, held: 0, queued: undefined, buffer: undefined, stunnedUntil: 0, knockback: undefined, down: undefined, floored: undefined, slam: undefined, grab: undefined, blocking: false, travel: undefined, traverse: undefined, charging: undefined, burst: undefined, beam: undefined, lunge: undefined, chase: undefined, reloadUntil: 0, energy: 1, power: 1, passiveOn: false })
    h.ammo = a.arena.setups[C.h].magazine
    for (const k in h.cooldowns) h.cooldowns[k] = 0
    h.hp = h.maxHp
    C.held.clear()
    C.yaw = yaw
    C.pitch = 0
  }
  /** Put another hero somewhere, standing still. */
  C.stand = (i, x, y, z, yaw = 0) => {
    const h = a.arena.match.heroes[i]
    Object.assign(h, { position: { x, y, z }, velocity: { x: 0, y: 0, z: 0 }, airborne: false, yaw, launch: undefined, knockback: undefined, down: undefined, stunnedUntil: 0 })
    h.hp = h.maxHp
  }
  // what happened to the played hero, tick by tick, for the kit audit: its casts, releases, blows and moves
  C.events = []
  a.hooks.on('events', (events) => {
    for (const e of events) if (e.hero === C.h || e.source === C.h) C.events.push({ tick: a.arena.match.tick, type: e.type, slot: e.slot, what: e.what ?? e.move ?? e.phase, target: e.target, amount: e.amount })
  })
  /** The lab's options, as its own library lists them. */
  C.options = async () => {
    const lib = await import('/src/arena/lab/library.ts')
    const pick = (list) => list.map((o) => ({ id: o.id, label: o.label, group: o.group }))
    return { v: pick(lib.V_OPTIONS), families: lib.LMB_FAMILIES.map((f) => ({ id: f.id, label: f.label })), modes: lib.LMB_MODES.map((m) => ({ id: m.id, label: m.label })), q: pick(lib.Q_OPTIONS), e: pick(lib.E_OPTIONS), f: pick(lib.F_OPTIONS), r: pick(lib.R_OPTIONS) }
  }
  /**
   * The fit check's numbers: the hero's hands and frame (fit.ts), and each weapon it carries: where it is, its scale in
   * the world, its length, how thick it is where the hand takes it, and how far the fingers' joints of the hand that
   * holds it stand from its grip's line, in hand lengths (the same on every body when it fits the same).
   */
  C.fitRead = () => {
    const fix = model()
    const V = v.constructor
    const p = a.positions()[C.h]
    const world = (name) => { const b = fix.root.getObjectByName(name); return b ? b.getWorldPosition(new V()) : undefined }
    const chain = (names) => names.slice(1).reduce((sum, n, i) => sum + (world(names[i]) && world(n) ? world(names[i]).distanceTo(world(n)) : 0), 0)
    const hand = chain(['RightHand', 'RightHandMiddle1', 'RightHandMiddle2', 'RightHandMiddle3', 'RightHandMiddle4'])
    const pieces = []
    fix.root.traverse((o) => {
      if (!/^(arm|gear):/.test(o.name)) return
      o.updateWorldMatrix(true, true)
      const inv = o.matrixWorld.clone().invert()
      const lo = new V(Infinity, Infinity, Infinity), hi = new V(-Infinity, -Infinity, -Infinity)
      const glo = new V(Infinity, Infinity, Infinity), ghi = new V(-Infinity, -Infinity, -Infinity)
      const q = new V()
      o.traverse((m) => {
        if (!m.isMesh) return
        const pos = m.geometry.getAttribute('position')
        const to = inv.clone().multiply(m.matrixWorld)
        for (let i = 0; i < pos.count; i++) {
          q.fromBufferAttribute(pos, i).applyMatrix4(to)
          lo.min(q); hi.max(q)
          if (q.length() < 0.05) { glo.min(q); ghi.max(q) }
        }
      })
      const scale = o.getWorldScale(new V()).x
      const size = hi.clone().sub(lo), grip = ghi.clone().sub(glo)
      const slot = (o.parent?.name ?? '').replace('socket:', '')
      const row = { piece: o.name.replace(/^(arm|gear):/, ''), slot, scale: r3(scale), length: r3(Math.max(size.x, size.y, size.z) * scale), thick: Number.isFinite(grip.x) ? r3(Math.min(grip.x, grip.y, grip.z) * scale) : undefined }
      if (/^hand_/.test(slot)) {
        // the grip's line: the socket's own up, through it
        const side = slot === 'hand_r' ? 'Right' : 'Left'
        const at = o.parent.getWorldPosition(new V())
        const e = o.parent.matrixWorld.elements
        const up = new V(e[4], e[5], e[6]).normalize()
        const off = (name) => { const w = world(side + name); if (!w) return undefined; const d = w.sub(at); return r3(d.sub(up.clone().multiplyScalar(d.dot(up))).length() / hand) }
        row.fingers = ['HandIndex2', 'HandIndex4', 'HandMiddle2', 'HandMiddle4', 'HandPinky4', 'HandThumb4'].map(off)
        row.palm = off('Hand')
      }
      pieces.push(row)
    })
    return { fit: fix.fit ? { hand: r3(fix.fit.hand), body: r3(fix.fit.body) } : undefined, hand: r3(hand), stature: r3((world('Head')?.y ?? 0) - p.y), root: r3(fix.root.getWorldScale(new V()).x), pieces }
  }
  /** Put a lab option on the played hero's button now, as the lab's panel does for a pick that needs no restart. */
  C.equip = async (slot, id) => (await import('/src/arena/engine/lab.ts')).equip(a.arena, slot, id, true)
})()`
await run(INSTALL)

const size = await run('window.__arena.arena.match.heroes[window.__course.h].size')
const label = `${ENTRY === 'lab' ? JOHN : await run('window.__course.name + " in an ordinary match, full kit " + window.__arena.arena.match.fullKit')} ${prefs.gender}${prefs.physique ? ` ${prefs.physique}` : ''} ${prefs.attitude} ${size} v-${V} @${FPS}fps${MOTION ? ` ${MOTION}` : ''}`
console.log('lab up:', label)

/** The kit audit keeps its own frames: the recorder's filmstrips are off while it runs. */
let QUIET = false

/** One sequence's frames and rows, and the helpers a sequence plays with. */
function recorder(name) {
  const rows = []
  const shots = []
  const views = []
  let n = 0
  const api = {
    rows,
    hold: (...actions) => run(`(() => { const C = window.__course; C.held = new Set(${JSON.stringify(actions)}) })()`),
    aim: (yaw, pitch = 0) => run(`(() => { const C = window.__course; C.yaw = ${yaw}; C.pitch = ${pitch} })()`),
    side: (yaw, dist = 4.4, level) => run(`(() => { const C = window.__course; C.sideYaw = ${yaw}; C.dist = ${dist}; C.level = ${level === undefined ? 'undefined' : level} })()`),
    place: (x, y, z, yaw) => run(`window.__course.place(${x}, ${y}, ${z}, ${yaw})`),
    stand: (i, x, y, z, yaw = 0) => run(`window.__course.stand(${i}, ${x}, ${y}, ${z}, ${yaw})`),
    js: run,
    /** Draw one frame of the display's time; every EVERY-th is kept on the filmstrip. */
    async frame(note = '') {
      const row = await run(`window.__course.frame(${1 / FPS})`)
      row.note = note
      row.n = n
      rows.push(row)
      if (!QUIET && n % EVERY === 0) {
        // the side view, where contact shows
        const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 76, clip: { x: 800, y: 0, width: 800, height: 720, scale: 0.625 } })
        shots.push({ n, row, data: Buffer.from(shot.result.data, 'base64') })
      }
      if (!QUIET && n % (EVERY * 4) === 0) {
        // the player's own view, without the inset: the camera's framing
        await run('window.__course.show(false)')
        await run('window.__arena.seat.frame(0)')
        const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: 1600, height: 900, scale: 0.3125 } })
        views.push({ n, row, data: Buffer.from(shot.result.data, 'base64') })
        await run('window.__course.show(true)')
      }
      n++
      return row
    },
    /** Frames for `seconds` of match time. */
    async play(seconds, note = '') {
      let row
      for (let i = 0; i < Math.round(seconds * FPS); i++) row = await api.frame(note)
      return row
    },
    /** Frames until `done(row)` or `most` seconds; returns the last row, with `timedOut` when it never came. */
    async until(done, most = 3, note = '') {
      let row
      for (let i = 0; i < Math.round(most * FPS); i++) {
        row = await api.frame(note)
        if (done(row)) return row
      }
      return { ...row, timedOut: true }
    },
    /** A tap: the action held for two ticks' worth of frames, then let go (the rest stay held). */
    async tap(action, note = action) {
      const held = await run('[...window.__course.held]')
      await api.hold(...held, action)
      await api.play(Math.max(2 / 60, 1 / FPS), note)
      await api.hold(...held.filter((k) => k !== action))
    },
    async finish(summary) {
      writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ name, label, fps: FPS, summary, rows }))
      await sheet(name, shots, 500, 450, 4)
      await sheet(`${name}.view`, views, 500, 281, 4)
    },
  }
  return api
}

/** The filmstrip: every kept frame in a grid, each captioned with its tick, pose and the clip that leads. */
async function sheet(name, shots, W, tall, columns) {
  let H = tall
  if (!shots.length) return
  const cols = Math.min(columns, shots.length)
  const rowsN = Math.ceil(shots.length / cols)
  const esc = (s) => String(s).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c])
  const BAR = 38
  const tiles = await Promise.all(
    shots.map(async ({ row, data }, i) => {
      const lead = [...(row.playing ?? [])].sort((a, b) => Number(b.split(':').pop()) - Number(a.split(':').pop()))[0] ?? ''
      const text = `${row.n} t${row.tick} ${row.pose ?? ''}${row.t !== undefined ? ` ${row.t}` : ''}${row.is ? ` [${row.is}]` : ''}${row.action ? ` {${row.action}}` : ''} ${row.note ?? ''}`
      const caption = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${BAR}"><rect width="${W}" height="${BAR}" fill="#161a22"/><text x="6" y="15" font-family="Menlo, monospace" font-size="12" fill="#fff">${esc(text)}</text><text x="6" y="31" font-family="Menlo, monospace" font-size="11" fill="#9fe">${esc(lead)} low ${row.low} hips ${row.hips}${row.squash ? ` sink ${row.squash}` : ''}</text></svg>`)
      const tile = await sharp({ create: { width: W, height: H + BAR, channels: 3, background: '#161a22' } }).composite([{ input: await sharp(data).resize(W, H).toBuffer(), left: 0, top: 0 }, { input: caption, left: 0, top: H }]).jpeg({ quality: 80 }).toBuffer()
      return { input: tile, left: (i % cols) * W, top: Math.floor(i / cols) * (H + BAR) }
    }),
  )
  H += BAR
  // sheets of at most 5 rows, so each can be read at full size
  const per = 5 * cols
  for (let s = 0; s * per < tiles.length; s++) {
    const part = tiles.slice(s * per, (s + 1) * per).map((t) => ({ ...t, top: t.top - s * 5 * H }))
    const rows = Math.ceil(part.length / cols)
    await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#111' } }).composite(part).jpeg({ quality: 80 }).toFile(join(OUT, `${name}${tiles.length > per ? `-${s + 1}` : ''}.jpg`))
  }
  void rowsN
}

const DECK = 4.5
/** An open lane along the south strip, 40 m of flat deck running +x, seen from the south. */
const FLAT = { x: -10, z: -47 }
/** The tower to hang from, west of the lane (engine/lab.ts). */
const TOWER = { x: -16, z: -47, top: 6, half: 1.5 }
const HALF = Math.PI / 2
const flags = (row, f) => (row.is ?? '').split('+').includes(f)
const poses = (rows) => rows.map((r) => r.pose).filter((p, i, all) => p !== all[i - 1])
/** The frames a foot is on the floor in go under it by this much at worst, and float over it by this much. */
const contact = (rows) => {
  const ground = rows.filter((r) => !r.air && !/mantle|hang|zip|wallrun|launch/.test(r.is ?? '') && Number.isFinite(r.low))
  return { under: Math.min(0, ...ground.map((r) => r.low)), over: Math.max(0, ...ground.map((r) => r.low)), frames: ground.length }
}

/**
 * The sequences. Each places John, plays, and returns what it saw, in words a table can hold. `ok` only says the
 * engine did what the sequence is about (it jumped, it hung); whether it looks right is for the filmstrip.
 */
const SEQUENCES = {
  /** The course's pieces, each from above and to one side, John standing by: what the other sequences play on. */
  async survey(c) {
    const look = async (note, at, from, to) => {
      await c.place(...at, 0)
      await c.js(`window.__course.fixed = { from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)} }; 0`)
      await c.play(3 / 60, note)
    }
    await look('low block', [15, DECK, -39], [20.5, DECK + 3.5, -42], [14, DECK + 0.5, -37])
    await look('slab overhead', [19, DECK, -38], [24, DECK + 2, -43], [19, DECK + 1.6, -38])
    await look('tower', [TOWER.x + 3, DECK, TOWER.z], [TOWER.x + 9, DECK + 5, TOWER.z - 9], [TOWER.x, DECK + 3, TOWER.z])
    await look('marked wall', [6.95, DECK, -34], [1, DECK + 4, -38], [7.4, DECK + 2, -27])
    await look('zipline', [-5.5, DECK, -36], [3, DECK + 5, -44], [-5.5, DECK + 3, -32])
    await look('ledge block', [-6, DECK, -15], [0, DECK + 4, -19], [-6, DECK + 1, -11.5])
    await c.js('window.__course.fixed = undefined; 0')
    return { ok: true, poses: [], contact: contact(c.rows) }
  },
  /**
   * An ordinary match, where the hero stands as it starts (the enemy held still, so nothing cuts the moves short): run,
   * jump, land running, dodge, a blow, a blow cut short by a dodge, a second jump.
   */
  async 'match'(c) {
    const at = await c.js('(() => { const h = window.__arena.arena.match.heroes[window.__course.h]; for (const o of window.__arena.arena.match.heroes) if (o.team !== h.team) o.stunnedUntil = 1e9; return [h.position.x, h.position.y, h.position.z, h.yaw] })()')
    await c.place(at[0], at[1], at[2], at[3])
    await c.side(at[3] + HALF)
    await c.play(0.4, 'stand')
    await c.hold('forward')
    await c.play(0.7, 'run')
    await c.tap('jump')
    const landed = await c.until((r) => !r.air, 2.5, 'jump')
    await c.play(0.4, 'run on')
    await c.tap('dodge')
    await c.until((r) => !flags(r, 'roll'), 1.5, 'dodge')
    await c.hold()
    await c.play(0.3, 'stop')
    await c.tap('basic', 'blow')
    await c.until((r) => !r.action, 1.5, 'blow')
    await c.play(0.4, 'after')
    await c.tap('basic', 'blow')
    await c.play(0.08, 'blow')
    await c.hold('forward')
    await c.tap('dodge', 'dodge out of it')
    const rolled = await c.until((r) => flags(r, 'roll'), 0.6, 'dodge out')
    await c.until((r) => !flags(r, 'roll'), 1.2, 'rolling')
    await c.tap('jump')
    await c.until((r) => r.vel[1] < 3, 1, 'jump')
    await c.tap('jump', 'second jump')
    const down = await c.until((r) => !r.air, 3, 'second jump')
    await c.hold()
    await c.play(0.5, 'landed')
    const rolling = c.rows.filter((r) => flags(r, 'roll'))
    return { ok: !landed.timedOut && !rolled.timedOut && !down.timedOut, fullKit: await c.js('window.__arena.arena.match.fullKit === true'), rollPoses: [...new Set(rolling.map((r) => r.pose))], clips: [...new Set(c.rows.flatMap((r) => (r.playing ?? []).map((p) => p.split('(')[0])))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Run, jump, land, run on: the landing keeps the run's speed. */
  /** How the body carries itself: standing, a walk, a run, a sprint, a stop (an attitude's own stance and gait). */
  async carriage(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(1.4, 'stand')
    await c.hold('forward', 'walk')
    await c.play(1.3, 'walk')
    await c.hold('forward')
    await c.play(0.8, 'run')
    await c.hold('forward', 'dash')
    await c.play(0.8, 'sprint')
    await c.hold()
    await c.play(0.8, 'stop')
    const moving = c.rows.filter((r) => /run|walk/.test(r.pose ?? '') && !r.air)
    return { ok: true, poses: poses(c.rows), sunk: Math.min(0, ...moving.map((r) => r.low)), contact: contact(c.rows) }
  },
  async 'run-jump-land'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.3, 'stand')
    await c.hold('forward')
    await c.play(0.9, 'run')
    await c.tap('jump')
    const landed = await c.until((r) => !r.air, 2.5, 'air')
    const speedAtLanding = Math.hypot(landed.vel[0], landed.vel[2])
    await c.play(0.6, 'run on')
    await c.hold()
    await c.play(0.6, 'stop')
    return { ok: !landed.timedOut, speedAtLanding, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** A standing jump straight up, then again with the second jump and a turn in the air. */
  async 'jump-air-jump'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.3, 'stand')
    await c.tap('jump')
    await c.until((r) => !r.air, 2.5, 'jump up')
    await c.play(0.5, 'landed')
    await c.hold('forward')
    await c.play(0.5, 'run')
    await c.tap('jump')
    await c.until((r) => r.vel[1] < 2, 1.5, 'rise')
    await c.hold('back')
    await c.tap('jump', 'air jump back')
    const landed = await c.until((r) => !r.air, 2.5, 'second jump')
    await c.hold()
    await c.play(0.5, 'landed')
    return { ok: !landed.timedOut, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Under the slab: the head meets it, the body falls and lands. */
  async 'jump-ceiling'(c) {
    await c.place(19, DECK, -38, HALF)
    await c.side(0)
    await c.play(0.3, 'stand')
    await c.tap('jump')
    const top = Math.max(...(await (async () => {
      await c.until((r) => !r.air, 2.5, 'under the slab')
      return c.rows.map((r) => r.pos[1])
    })()))
    await c.play(0.5, 'landed')
    return { ok: top - DECK < 3, rise: top - DECK, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Dodge into a run, twice in a row, and a dodge off the low block's edge. */
  async dodge(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.hold('forward')
    await c.play(0.5, 'run')
    await c.tap('dodge')
    await c.until((r) => !flags(r, 'roll'), 1.5, 'roll')
    await c.play(0.25, 'run')
    await c.tap('dodge', 'dodge 2')
    await c.tap('dodge', 'dodge 3 (buffered)')
    await c.until((r) => !flags(r, 'roll'), 1.5, 'roll 2')
    await c.until((r) => !flags(r, 'roll'), 1.5, 'roll 3')
    await c.play(0.4, 'run')
    await c.hold()
    await c.play(0.4, 'stop')
    // off an edge: from the top of the low block, rolling over its side
    await c.place(14, DECK + 1, -37, 0)
    await c.side(HALF)
    await c.play(0.2, 'on the block')
    await c.hold('forward')
    await c.tap('dodge', 'dodge off the edge')
    const off = await c.until((r) => r.air, 1.2, 'roll to the edge')
    const fell = await c.until((r) => !r.air, 1.5, 'falling')
    await c.hold()
    await c.play(0.4, 'landed')
    const falling = c.rows.filter((r) => r.air && r.n > off.n)
    return { ok: !off.timedOut && !fell.timedOut, fallPoses: [...new Set(falling.map((r) => r.pose))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Sprint, slide, and out of it crouched, then standing and running. */
  async slide(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.hold('forward', 'dash')
    await c.play(0.9, 'sprint')
    await c.tap('crouch', 'slide')
    await c.until((r) => !flags(r, 'slide'), 1.6, 'slide')
    await c.play(0.5, 'crouched on')
    await c.tap('crouch', 'stand')
    await c.play(0.5, 'run')
    await c.hold()
    await c.play(0.4, 'stop')
    return { ok: c.rows.some((r) => flags(r, 'slide')), poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Crouch, walk crouched, go prone, crawl, stand. */
  async 'crouch-prone'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.2, 'stand')
    await c.tap('crouch')
    await c.play(0.5, 'crouch')
    await c.hold('forward')
    await c.play(0.8, 'crouch walk')
    await c.hold()
    await c.tap('prone')
    await c.play(0.9, 'prone')
    await c.hold('forward')
    await c.play(1, 'crawl')
    await c.hold()
    await c.tap('jump', 'stand up')
    await c.play(0.6, 'stand')
    return { ok: true, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Walk into the low block and over it, and on. */
  async mantle(c) {
    await c.place(15, DECK, -40.2, 0)
    await c.side(HALF, 6, DECK + 0.1)
    await c.hold('forward')
    const on = await c.until((r) => flags(r, 'mantle'), 2, 'approach')
    const up = await c.until((r) => !flags(r, 'mantle'), 2, 'mantle')
    await c.play(0.5, 'on top, walking on')
    await c.until((r) => !r.air && r.pos[1] < DECK + 0.2, 2, 'off the far side')
    await c.play(0.4, 'run on')
    await c.hold()
    await c.play(0.3, 'stop')
    const during = c.rows.filter((r) => flags(r, 'mantle'))
    // the hands against the top they pull on: how far over or under it, at worst
    const hands = during.map((r) => Math.min(...r.hands.filter(Boolean).map((h) => h[1] - r.rim[1])))
    return { ok: !on.timedOut && !up.timedOut, top: up.pos[1] - DECK, handsOverTop: [Math.min(...hands), Math.max(...hands)], hipsRange: [Math.min(...during.map((r) => r.hips)), Math.max(...during.map((r) => r.hips))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Jump at the tall block: a mantle from the air onto its top. */
  async 'mantle-high'(c) {
    await c.place(-6, DECK, -17, 0)
    await c.side(HALF, 6, DECK + 1)
    await c.hold('forward')
    await c.play(0.45, 'run up')
    await c.tap('jump')
    const on = await c.until((r) => flags(r, 'mantle'), 2, 'jump at the block')
    const up = await c.until((r) => !flags(r, 'mantle'), 2, 'mantle')
    await c.hold()
    await c.play(0.6, 'on top')
    const during = c.rows.filter((r) => flags(r, 'mantle'))
    return { ok: !on.timedOut && !up.timedOut, top: up.pos[1] - DECK, hipsRange: [Math.min(...during.map((r) => r.hips)), Math.max(...during.map((r) => r.hips))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Off the tall block's edge at a walk: catch, hang, shimmy both ways, climb back up; then off again and let go. */
  async hang(c) {
    await c.place(TOWER.x, DECK + TOWER.top, TOWER.z, HALF)
    await c.side(Math.PI, 5.5, DECK + TOWER.top - 1)
    await c.play(0.2, 'on the tower')
    await c.hold('forward')
    const caught = await c.until((r) => flags(r, 'hang'), 2.5, 'walk off')
    await c.hold()
    await c.play(0.7, 'hang')
    await c.hold('left')
    await c.play(0.7, 'shimmy left')
    await c.hold('right')
    await c.play(0.7, 'shimmy right')
    await c.hold()
    await c.play(0.3, 'hang')
    await c.hold('forward')
    const climbing = await c.until((r) => flags(r, 'mantle'), 1.5, 'climb')
    const up = await c.until((r) => !flags(r, 'mantle'), 2, 'climbing')
    await c.hold()
    await c.play(0.5, 'on top')
    const hung = c.rows.filter((r) => flags(r, 'hang') && r.rim)
    const gap = hung.map((r) => Math.max(...r.hands.filter(Boolean).map((h) => Math.hypot(h[0] - r.rim[0], h[1] - r.rim[1], h[2] - r.rim[2]))))
    // again, and let go
    await c.place(TOWER.x, DECK + TOWER.top, TOWER.z, HALF)
    await c.hold('forward')
    await c.until((r) => flags(r, 'hang'), 2.5, 'walk off again')
    await c.hold()
    await c.play(0.4, 'hang')
    await c.tap('crouch', 'let go')
    const down = await c.until((r) => !r.air && !flags(r, 'hang'), 2, 'drop')
    await c.play(0.5, 'landed')
    return { ok: !caught.timedOut && !climbing.timedOut && !up.timedOut && !down.timedOut, handsFromRim: [Math.min(...gap), Math.max(...gap)], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Run at the tower and jump: the hands catch its edge (or a tall jump mantles it), then up. */
  async 'jump-catch'(c) {
    await c.place(TOWER.x + TOWER.half + 4.5, DECK, TOWER.z, -HALF)
    await c.side(Math.PI, 9, DECK + 3)
    await c.hold('forward')
    await c.play(0.45, 'run up')
    await c.tap('jump')
    const on = await c.until((r) => flags(r, 'hang') || flags(r, 'mantle'), 2.5, 'jump at the tower')
    const how = flags(on, 'hang') ? 'hang' : flags(on, 'mantle') ? 'mantle' : 'neither'
    if (how === 'hang') {
      await c.hold()
      await c.play(0.6, 'hang')
      await c.hold('forward')
      await c.until((r) => flags(r, 'mantle'), 1.5, 'climb')
    }
    const up = await c.until((r) => !flags(r, 'mantle') && !flags(r, 'hang'), 2.5, 'up')
    await c.hold()
    await c.play(0.5, 'on top')
    return { ok: how !== 'neither' && !up.timedOut && up.pos[1] > DECK + TOWER.top - 0.1, how, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Along the marked wall and off it with a jump. */
  async 'wall-run'(c) {
    await c.place(6.95, DECK, -36.5, 0)
    await c.side(-HALF, 6.5)
    await c.hold('forward', 'dash')
    await c.until((r) => r.pos[2] > -31.6, 2, 'sprint at the wall')
    await c.hold('forward', 'left', 'dash')
    await c.play(0.12, 'into the wall')
    await c.tap('jump')
    const on = await c.until((r) => flags(r, 'wallrun'), 1.2, 'jump at the wall')
    await c.play(0.45, 'wall run')
    await c.tap('jump', 'wall jump')
    await c.hold('forward')
    const landed = await c.until((r) => !r.air, 2.5, 'off the wall')
    await c.hold()
    await c.play(0.5, 'landed')
    return { ok: !on.timedOut && !landed.timedOut, wallFrames: c.rows.filter((r) => flags(r, 'wallrun')).length, wallPoses: [...new Set(c.rows.filter((r) => flags(r, 'wallrun')).map((r) => r.pose))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Jump to the zipline, ride it to its end, land. */
  async zipline(c) {
    await c.place(-5.5, DECK, -36, 0)
    await c.side(HALF, 7)
    await c.play(0.2, 'under the line')
    await c.hold('forward')
    await c.tap('jump')
    const on = await c.until((r) => flags(r, 'zip'), 1.5, 'jump to the line')
    const off = await c.until((r) => !flags(r, 'zip'), 3, 'riding')
    const landed = await c.until((r) => !r.air, 2.5, 'let go')
    await c.play(0.4, 'run on')
    await c.hold()
    await c.play(0.4, 'stop')
    const riding = c.rows.filter((r) => flags(r, 'zip'))
    return { ok: !on.timedOut && !off.timedOut && !landed.timedOut, rideFrames: riding.length, ridePoses: [...new Set(riding.map((r) => r.pose))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Run, fire on the move, jump while firing, land. */
  async 'run-shoot-jump'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.hold('forward')
    await c.play(0.5, 'run')
    await c.hold('forward', 'active1')
    await c.play(0.8, 'run and fire')
    await c.tap('jump')
    const landed = await c.until((r) => !r.air, 2.5, 'fire in the air')
    await c.play(0.5, 'run and fire')
    await c.hold()
    await c.play(0.5, 'stop')
    const firing = c.rows.filter((r) => r.action.startsWith('active1') && !r.air)
    return { ok: !landed.timedOut && firing.length > 0, shots: new Set(c.rows.filter((r) => r.action.startsWith('active1')).map((r) => r.tick)).size, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** Three light blows on the dummy, the last the finisher, and the recovery. */
  async 'melee-chain'(c) {
    await c.stand(2, FLAT.x + 1.6, DECK, FLAT.z, -HALF)
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.3, 'stand')
    const steps = []
    for (let k = 0; k < 3; k++) {
      await c.tap('basic', `blow ${k + 1}`)
      const began = await c.until((r) => r.action.startsWith('basic'), 0.8, `blow ${k + 1}`)
      steps.push(began.action)
      await c.until((r) => r.action.endsWith(':rec') || !r.action, 1, `blow ${k + 1}`)
      await c.play(0.12, `blow ${k + 1} recovering`)
    }
    await c.until((r) => !r.action, 1.5, 'recovery')
    await c.play(0.7, 'after')
    await c.stand(2, 0, DECK, -36)
    return { ok: steps.length === 3 && steps.every(Boolean), steps, poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** A charged heavy blow let go; then a blow cut short by a dodge, and a hit taken. */
  async 'melee-heavy'(c) {
    await c.stand(2, FLAT.x + 1.6, DECK, FLAT.z, -HALF)
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.2, 'stand')
    await c.hold('basic')
    await c.play(0.9, 'charging')
    await c.hold()
    const began = await c.until((r) => r.action.startsWith('basic'), 0.5, 'let go')
    await c.until((r) => !r.action, 1.5, 'heavy blow')
    await c.play(0.6, 'after')
    await c.stand(2, 0, DECK, -36)
    return { ok: /heavy/.test(began.action ?? ''), blow: began.action, chargePoses: [...new Set(c.rows.filter((r) => r.note === 'charging').map((r) => r.pose))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** The guard held against the enemy bot's blows: each one caught jolts the guard, and the guard holds on. */
  async 'guard-hit'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.stand(3, FLAT.x + 1.5, DECK, FLAT.z, -HALF)
    await c.side(Math.PI)
    await c.js('window.__arena.arena.lab.bots.enemy = "fight"; 0')
    await c.hold('block')
    await c.play(4, 'guarding')
    await c.hold()
    await c.js('window.__arena.arena.lab.bots.enemy = "still"; 0')
    await c.stand(3, -5, DECK, -20)
    await c.play(0.4, 'after')
    const jolts = c.rows.filter((r) => r.pose === 'block_hit')
    return { ok: jolts.length > 0, jolts: new Set(jolts.map((r) => r.tick)).size, jolted: [...new Set(jolts.map((r) => r.lead))], poses: poses(c.rows), contact: contact(c.rows) }
  },
  /** A blow in the air, and a jump straight out of a blow on the ground: nothing of the blow stays on the body. */
  async 'melee-interrupt'(c) {
    await c.place(FLAT.x, DECK, FLAT.z, HALF)
    await c.side(Math.PI)
    await c.play(0.2, 'stand')
    await c.tap('jump')
    await c.until((r) => r.vel[1] < 6, 1, 'rise')
    await c.tap('basic', 'air blow')
    const landed = await c.until((r) => !r.air, 2.5, 'air blow')
    await c.play(0.5, 'landed')
    await c.tap('basic', 'blow')
    await c.play(0.1, 'blow')
    await c.hold('forward')
    await c.tap('dodge', 'dodge out of the blow')
    const rolled = await c.until((r) => flags(r, 'roll'), 0.6, 'dodge')
    await c.until((r) => !flags(r, 'roll'), 1.2, 'rolling')
    await c.hold()
    await c.play(0.5, 'after')
    const rolling = c.rows.filter((r) => flags(r, 'roll'))
    return { ok: !landed.timedOut, rolledOut: !rolled.timedOut, rollPoses: [...new Set(rolling.map((r) => r.pose))], poses: poses(c.rows), contact: contact(c.rows) }
  },
}

if (process.argv.includes('--clips')) {
  await clipTimelines()
  process.exit(0)
}
if (process.argv.includes('--fit')) {
  await fitCheck()
  socket.close()
  chrome.kill()
  process.exit(0)
}
if (process.argv.includes('--kit')) {
  await kitAudit()
  socket.close()
  chrome.kill()
  process.exit(0)
}

const results = {}
for (const [name, play] of Object.entries(SEQUENCES)) {
  if (ONLY.length ? !ONLY.includes(name) : (name === 'match') !== (ENTRY !== 'lab')) continue
  const c = recorder(name)
  const before = errors.length
  try {
    const summary = await play(c)
    summary.errors = errors.slice(before)
    results[name] = summary
    await c.finish(summary)
    console.log(`${summary.ok ? 'ran ' : 'FAIL'} ${name.padEnd(18)} ${JSON.stringify({ ...summary, poses: undefined })}`)
    console.log(`     poses: ${summary.poses.join(' > ')}`)
  } catch (e) {
    results[name] = { ok: false, error: String(e?.message ?? e), errors: errors.slice(before) }
    await c.finish(results[name]).catch(() => {})
    console.log(`FAIL ${name}: ${e?.message ?? e}`)
  }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ label, fps: FPS, results, errors }, null, 1))
if (errors.length) console.log(`page errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 12).join('\n  ')}`)
socket.close()
chrome.kill()
process.exit(0)


/**
 * The kit audit (`--kit`): every action the lab's panel can put on John's buttons, played once and looked at. Each of
 * the V families' eight moves, each LMB family in each way of firing, every Q, E, F and R pick. The lab is started
 * again for each pick (a hero's clips are loaded with it), with one new pick on every button a pass.
 *
 * Each action writes a strip of six frames (as it starts, half way to its contact, the contact, then 0.1 s, 0.3 s and
 * its last frame after) and a row to `audit.json`: the clip that played, whether the engine cast and released, when
 * the hand or the weapon's tip was fastest against when the engine's blow landed, how far the hips left the spot, and
 * how far the feet went under the floor. A number out of line is flagged; whether the motion suits the action is for
 * the strips.
 */
async function kitAudit() {
  QUIET = true
  const opts = await run('window.__course.options()')
  // a way of firing has its own clip, loaded with the hero like any other: every family in every way gets a pass
  const guns = opts.families.flatMap((f) => opts.modes.map((m) => ({ family: f, mode: m })))
  const passes = Math.max(opts.v.length, guns.length, opts.q.length, opts.e.length, opts.f.length, opts.r.length)
  const limit = Number(arg('passes', String(passes)))
  const from = Number(arg('from', '0'))
  const audit = []
  const strips = []
  // `--sect V,E` plays only those buttons' actions, `--move dash,grab` only those V moves; `--frames` keeps every
  // photographed frame of each action, full size, beside its strip
  const SECT = arg('sect', '')?.split(',').filter(Boolean) ?? []
  const MOVES = arg('move', '')?.split(',').filter(Boolean) ?? []
  const want = (section) => !SECT.length || SECT.includes(section)
  const BIG = process.argv.includes('--frames')
  // `--wide` keeps the player's own view beside the side view in those frames
  const WIDE = process.argv.includes('--wide')
  // `--bare` photographs nothing: the numbers alone, several times faster
  const BARE = process.argv.includes('--bare')
  const X = FLAT.x
  const Z = FLAT.z

  /** One action: reset, play, measure, keep six frames. */
  const act = async (section, option, move, play, far = 1.6) => {
    const c = recorder(`${section}-${option.id}-${move}`)
    await c.stand(2, X + far, DECK, Z, -HALF)
    await c.place(X, DECK, Z, HALF)
    await c.side(Math.PI, 4.2)
    await run('window.__course.events.length = 0; 0')
    const shots = []
    const frame = c.frame
    // every frame is kept here, small: the six that matter are chosen once the action is over
    c.frame = async (note) => {
      const row = await frame(note)
      // every other frame is photographed; the one between shows the same picture
      if (BARE) shots.push(undefined)
      else if (shots.length % 2 === 0) {
        const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 70, clip: WIDE ? { x: 0, y: 0, width: 1600, height: 720, scale: 1 } : { x: 800, y: 0, width: 800, height: 720, scale: BIG ? 1 : 0.4 } })
        shots.push(Buffer.from(shot.result.data, 'base64'))
      } else shots.push(shots[shots.length - 1])
      return row
    }
    await c.play(0.15, 'ready')
    const start = c.rows.length
    const before = errors.length
    let failed
    try {
      await play(c)
    } catch (e) {
      failed = String(e?.message ?? e)
    }
    const events = await run('window.__course.events.slice()')
    const rows = c.rows.slice(start)
    const cast = events.find((e) => e.type === 'cast')
    const release = events.find((e) => e.type === 'release')
    // the clip that led while the action itself showed (a cast, a charge, a guard, a toggle): by the library's name
    const led = {}
    const acting = rows.filter((r) => /^(cast|charge|block|toggle)/.test(r.pose ?? ''))
    for (const r of acting.length ? acting : rows) if (r.lead) led[r.lead] = (led[r.lead] ?? 0) + 1
    const clips = Object.entries(led).sort((a, b) => b[1] - a[1]).map(([name]) => name)
    const clip = clips[0]
    // how fast the hand or what it holds moves, frame to frame; a blow's fastest moment should be its contact
    const point = (r) => r.tip ?? r.hands?.[1] ?? r.hands?.[0]
    const speeds = rows.map((r, i) => (i && point(r) && point(rows[i - 1]) ? Math.hypot(...point(r).map((v, k) => v - point(rows[i - 1])[k])) * FPS : 0))
    const releases = events.filter((e) => e.type === 'release').map((e) => rows.findIndex((r) => r.tick >= e.tick)).filter((k) => k >= 0)
    // each blow on its own: from a quarter second before its contact to a fifth after
    const offs = releases.map((k) => {
      const lo = Math.max(0, k - Math.round(0.25 * FPS))
      const window = speeds.slice(lo, k + Math.round(0.2 * FPS))
      return (lo + window.indexOf(Math.max(...window)) - k) / FPS
    })
    const worst = offs.reduce((w, o) => (Math.abs(o) > Math.abs(w) ? o : w), 0)
    // the effect against the body, on each release: where it leaves from (the held piece's far end or the palm), how
    // far that is behind whatever reaches furthest along the aim, how far off the aim the line from the chest to it
    // runs, and how far off the aim the casting forearm points; and what was in each hand
    const dot = (u, w) => u[0] * w[0] + u[1] * w[1] + u[2] * w[2]
    const sub = (u, w) => [u[0] - w[0], u[1] - w[1], u[2] - w[2]]
    const angle = (u, w) => (Math.acos(Math.max(-1, Math.min(1, dot(u, w) / ((Math.hypot(...u) || 1) * (Math.hypot(...w) || 1))))) * 180) / Math.PI
    const effects = releases.map((k) => {
      const f = rows[k]?.fx
      if (!f?.origin || !f.chest) return undefined
      const reachers = [['tip', f.tip], ['left palm', f.palms[0]], ['right palm', f.palms[1]]].filter(([, q]) => q)
      const [leader, at] = reachers.reduce((m, x) => (dot(x[1], f.aim) > dot(m[1], f.aim) ? x : m))
      // the forearm that casts: the one whose palm is nearest where the effect leaves, or leads if it leaves a tip
      const side = f.from === 'tip' ? 1 : Math.hypot(...sub(f.palms[0] ?? f.origin, f.origin)) <= Math.hypot(...sub(f.palms[1] ?? f.origin, f.origin)) ? 0 : 1
      const forearm = f.palms[side] && f.elbows[side] ? angle(sub(f.palms[side], f.elbows[side]), f.aim) : undefined
      // and the arm that reaches furthest along the aim, when that is a palm: is it the one the effect leaves from
      // what points: the arrow's line for a bow (string hand to bow hand), the held piece from grip to far end, else the
      // casting forearm; and how far off the aim it points
      const bow = f.held[0].some((n) => /bow/.test(n))
      // (a gun's barrel is its piece's own +z in the hand; a thrown blade points nowhere in particular as it leaves)
      const gun = f.held[1].some((n) => /pistol|rifle|launcher|gun/.test(n))
      const thrown = f.held[1].some((n) => /kunai|shuriken|knife/.test(n))
      const line = thrown ? undefined : bow && f.palms[0] && f.palms[1] ? sub(f.palms[0], f.palms[1]) : gun && f.bore ? f.bore : f.tip && f.sock && f.held[1].length ? sub(f.tip, f.sock) : f.palms[side] && f.elbows[side] ? sub(f.palms[side], f.elbows[side]) : undefined
      // the off hand on a two-handed weapon: how far its palm is from the weapon's line (grip to far end), in a medium
      // body's metres, and how much of the grip the fix-ups took
      const offHand = f.tip && f.sock && f.palms[0] && f.held[1].length ? (() => { const ab = sub(f.tip, f.sock); const t = Math.max(0, Math.min(1, dot(sub(f.palms[0], f.sock), ab) / (dot(ab, ab) || 1))); return +(Math.hypot(...sub(f.palms[0], [f.sock[0] + ab[0] * t, f.sock[1] + ab[1] * t, f.sock[2] + ab[2] * t])) / (f.tall ?? 1)).toFixed(2) })() : undefined
      return { offHand, grip: f.fixups?.grip, aimLeft: f.fixups?.aimLeft, from: f.from, behind: +(dot(at, f.aim) - dot(f.origin, f.aim)).toFixed(2), leader, off: +angle(sub(f.origin, f.chest), f.aim).toFixed(0), forearm: forearm === undefined ? undefined : +forearm.toFixed(0), points: line ? +angle(line, f.aim).toFixed(0) : undefined, side: +(f.origin[2] - f.chest[2]).toFixed(2), height: f.origin[1], held: f.held }
    }).filter(Boolean)
    // a held action whose clip starts over while it is still held
    let restarts = 0
    for (let k = 1; k < rows.length; k++) if (rows[k].lead && rows[k].lead === rows[k - 1].lead && rows[k].leadAt < rows[k - 1].leadAt * 0.5 && rows[k - 1].leadAt > 0.3 && /^cast/.test(rows[k].pose ?? '')) restarts++
    // how long the engine winds the action up, where its clip is as it lets go, and how long the clip then shows: an
    // action the engine lets go at once plays its clip from its mark on, so a late mark skips the whole gesture
    const k0 = releases[0]
    const shown = k0 === undefined ? [] : rows.slice(k0).filter((r) => r.lead === rows[k0].lead)
    const timing = k0 === undefined || !cast ? undefined : { clip: rows[k0].lead, windUp: +((rows[k0].tick - cast.tick) / 60).toFixed(2), markAt: rows[k0].leadAt, after: +(shown.length / FPS).toFixed(2), endsAt: shown.length ? shown[shown.length - 1].leadAt : undefined }
    // and how far out it reaches: the weapon's tip, or the hand or foot that goes furthest ahead of the body (the hero
    // faces +x here). A blow should be at its reach on its contact; `markReach` is the clip's own second where it is
    const limbs = (r) => [...(r.hands ?? []), ...(r.feetAt ?? [])].filter(Boolean)
    const ahead = (r) => (r.tip && !/fists|kicks/i.test(option.id) ? r.tip[0] : Math.max(-9, ...limbs(r).map((q) => q[0])))
    const reach = section === 'V' || section === 'LMB' ? releases.map((k) => {
      const lo = Math.max(0, k - Math.round(0.3 * FPS))
      const hi = Math.min(rows.length - 1, k + Math.round(0.35 * FPS))
      let best = lo
      for (let j = lo; j <= hi; j++) if (rows[j].lead === rows[k].lead && ahead(rows[j]) > ahead(rows[best])) best = j
      return { clip: rows[k].lead, atBlow: +ahead(rows[k]).toFixed(2), max: +ahead(rows[best]).toFixed(2), off: +((best - k) / FPS).toFixed(2), markNow: rows[k].leadAt, markReach: rows[best].leadAt, windUp: cast ? +((rows[k].tick - cast.tick) / 60).toFixed(2) : undefined }
    }) : []
    const at = releases[0] ?? -1
    const hips0 = rows[0]?.hipsAt
    const drift = hips0 ? Math.max(...rows.filter((r) => r.hipsAt && !r.air && !/travel|roll|dash|mantle/.test(r.is ?? '')).map((r) => Math.hypot(r.hipsAt[0] - hips0[0], r.hipsAt[2] - hips0[2])), 0) : 0
    const grounded = rows.filter((r) => !r.air && Number.isFinite(r.low) && !/prone|down|launched/.test(r.pose ?? ''))
    const under = Math.min(0, ...grounded.map((r) => r.low))
    const found = []
    if (failed) found.push(`threw: ${failed}`)
    if (errors.length > before) found.push(`page error: ${errors[errors.length - 1].slice(0, 80)}`)
    if (!clip) found.push('no clip of its own played')
    // a guard and an F aura are held, and a slam is a plunge the engine lands itself: none of them is a cast
    if (section !== 'F' && move !== 'guard' && move !== 'slam' && !cast) found.push('the engine cast nothing')
    if (move === 'slam' && !events.some((e) => e.what === 'slam-land')) found.push('the slam never landed')
    // (a grab's slam comes down with the throw, a hold after the grab connects: its hand is fastest then by design)
    if (section === 'V' && move !== 'grab' && offs.length && Math.abs(worst) > 0.12) found.push(`fastest ${worst.toFixed(2)} s from its blow`)
    if (drift > 0.6) found.push(`hips ${drift.toFixed(2)} m off the spot`)
    if (under < -0.1) found.push(`feet ${(-under * 100).toFixed(0)} cm under the floor`)
    const row = { section, option: option.id, label: option.label, group: option.group, move, clip, clips, cast: cast?.slot, released: !!release, poses: poses(rows), fastestFromBlow: offs.map((o) => +o.toFixed(2)), reach, timing, effects, restarts, foe: [...new Set(rows.map((r) => r.foe))].slice(0, 6), hidden: rows.filter((r) => r.cam && !r.cam.shown).length, peakSpeed: +Math.max(...speeds).toFixed(1), drift: +drift.toFixed(2), under: +under.toFixed(2), events: [...new Set(events.map((e) => e.type + (e.what ? ':' + e.what : '')))], flags: found }
    audit.push(row)
    // `--rows` keeps every frame's numbers too, to read a blow's reach against its contact
    if (process.argv.includes('--rows')) writeFileSync(join(OUT, `${section}-${option.id}-${move}.rows.json`), JSON.stringify({ row, releases, rows: rows.map((r) => ({ tick: r.tick, pose: r.pose, action: r.action, lead: r.lead, leadAt: r.leadAt, grip: r.grip, fx: r.fx, tip: r.tip, hands: r.hands, feetAt: r.feetAt, hipsAt: r.hipsAt, foe: r.foe, shown: r.cam?.shown })) }))
    if (BIG) {
      const dir = join(OUT, `${section}-${option.id}-${move}`)
      mkdirSync(dir, { recursive: true })
      for (let k = 0; k < rows.length; k += 2) if (shots[start + k]) writeFileSync(join(dir, `${String(k).padStart(3, '0')}-${(rows[k].pose ?? '').replace(/[^a-z_]/g, '')}${k === at ? '-BLOW' : ''}.jpg`), shots[start + k])
    }
    // six frames: the start, half way to the contact, the contact, 0.1 and 0.3 s after, the last
    const n = rows.length
    const hit = at >= 0 ? at : Math.floor(n / 3)
    const picks = [0, Math.floor(hit / 2), hit, Math.min(n - 1, hit + Math.round(0.1 * FPS)), Math.min(n - 1, hit + Math.round(0.3 * FPS)), n - 1]
    strips.push({ row, tiles: picks.map((k) => ({ data: shots[start + k], note: `${rows[k]?.pose ?? ''}${k === hit && at >= 0 ? ' BLOW' : ''}` })) })
    console.log(`${found.length ? 'FLAG' : 'ok  '} ${section.padEnd(3)} ${(option.label + (move ? ': ' + move : '')).padEnd(44)} ${String(clip).padEnd(44)} ${found.join('; ')}`)
  }

  const blow = async (c, wait = 1.5) => {
    await c.until((r) => r.action.startsWith('basic'), 0.8, 'starting')
    await c.until((r) => !r.action, wait, 'blow')
  }
  const V_MOVES = {
    light: async (c) => {
      for (let k = 0; k < 3; k++) {
        await c.tap('basic', `blow ${k + 1}`)
        await c.until((r) => r.action.startsWith('basic'), 0.8, `blow ${k + 1}`)
        await c.until((r) => r.action.endsWith(':rec') || !r.action, 1, `blow ${k + 1}`)
        await c.play(0.1, `blow ${k + 1}`)
      }
      await c.until((r) => !r.action, 1.5, 'recovery')
      await c.play(0.6, 'after')
    },
    heavy: async (c) => {
      await c.hold('basic')
      await c.play(0.9, 'charging')
      await c.hold()
      await blow(c)
      await c.play(0.6, 'after')
    },
    guard: async (c) => {
      await c.hold('block')
      await c.play(0.8, 'guard')
      await c.hold()
      await c.play(0.3, 'after')
    },
    dash: async (c) => {
      await c.stand(2, X + 6, DECK, Z, -HALF)
      await c.hold('forward', 'dash')
      await c.until((r) => flags(r, 'sprint') && r.pos[0] > X + 2.6, 1.5, 'sprint')
      await c.tap('basic', 'dash blow')
      await blow(c)
      await c.hold()
      await c.play(0.5, 'after')
    },
    air: async (c) => {
      await c.tap('jump')
      await c.until((r) => r.vel[1] < 6, 1, 'rise')
      await c.tap('basic', 'air blow')
      await c.until((r) => !r.air, 2.5, 'air blow')
      await c.play(0.4, 'landed')
    },
    slam: async (c) => {
      await c.tap('jump')
      await c.until((r) => r.vel[1] < 5, 1, 'rise')
      await c.hold('basic')
      await c.until((r) => !r.air, 2.5, 'slam')
      await c.hold()
      await c.play(0.8, 'landed')
    },
    launch: async (c) => {
      await c.hold('back')
      await c.tap('basic', 'launcher')
      // let go as the blow starts: held on, the hero backs into the wall behind and the camera, too close, stops drawing it
      await c.until((r) => r.action.startsWith('basic'), 0.8, 'starting')
      await c.hold()
      await c.until((r) => !r.action, 1.5, 'blow')
      await c.play(0.6, 'after')
    },
    grab: async (c) => {
      await c.stand(2, X + 1.1, DECK, Z, -HALF)
      await c.hold('block')
      await c.play(0.05, 'guard up')
      await c.tap('basic', 'grab')
      await c.hold()
      await c.play(1.4, 'grab and throw')
    },
  }

  // `--pick 7,14` runs only those passes (counted from 1, as the sheets are numbered)
  const PICK = arg('pick', '')?.split(',').filter(Boolean).map(Number) ?? []
  for (let i = from; i < Math.min(passes, limit); i++) {
    if (PICK.length && !PICK.includes(i + 1)) continue
    const gun = guns[i % guns.length]
    const family = gun.family
    const kit = { basic: opts.v[i % opts.v.length].id, active1: `lmb-${family.id}-${gun.mode.id}-straight`, active2: opts.q[i % opts.q.length].id, movement: opts.e[i % opts.e.length].id, passive: opts.f[i % opts.f.length].id, ultimate: opts.r[i % opts.r.length].id }
    await run(`(() => { const p = JSON.parse(localStorage.getItem('john-lab:prefs') ?? '{}'); p.kit = ${JSON.stringify(kit)}; p.lmb = { family: '${family.id}', mode: '${gun.mode.id}', flight: 'straight' }; localStorage.setItem('john-lab:prefs', JSON.stringify(p)) })(); 0`)
    await cdp('Page.navigate', { url: `${BASE}/dev/john${query.size ? `?${query}` : ''}` })
    for (let k = 0; k < 180; k++) {
      await wait(1000)
      if (await run('!!window.__arena && !window.__course && window.__arena.arena.match.tick > 5 && window.__arena.arena.match.human === 0').catch(() => false)) break
    }
    await run(INSTALL)
    console.log(`pass ${i + 1}/${passes}: ${JSON.stringify(kit)}`)
    if (i < opts.v.length && want('V')) for (const [move, play] of Object.entries(V_MOVES)) if (!MOVES.length || MOVES.includes(move)) await act('V', opts.v[i], move, play)
    if (i < guns.length && want('LMB')) {
      const mode = gun.mode
      await act('LMB', { id: `${family.id}-${mode.id}`, label: `${family.label}: ${mode.label}`, group: 'LMB' }, '', async (c) => {
        await c.hold('active1')
        await c.play(mode.id === 'charge' ? 1.2 : 0.9, 'firing')
        await c.hold()
        await c.play(0.6, 'after')
      }, 7)
    }
    if (i < opts.q.length && want('Q'))
      await act('Q', opts.q[i], '', async (c) => {
        await c.hold('active2')
        await c.play(0.3, 'cast')
        await c.hold()
        await c.play(1.7, 'after')
      }, 6)
    if (i < opts.e.length && want('E'))
      await act('E', opts.e[i], '', async (c) => {
        await c.hold('forward')
        await c.tap('movement', 'E')
        await c.play(1.4, 'moving')
        await c.hold()
        await c.play(0.3, 'after')
      }, 9)
    if (i < opts.f.length && want('F'))
      await act('F', opts.f[i], '', async (c) => {
        await c.tap('passive', 'on')
        await c.play(1.3, 'on')
      }, 6)
    if (i < opts.r.length && want('R'))
      await act('R', opts.r[i], '', async (c) => {
        await c.tap('ultimate', 'R')
        await c.play(3.4, 'ultimate')
      }, 6)
    writeFileSync(join(OUT, 'audit.json'), JSON.stringify({ label, audit }, null, 1))
    if (!BARE) await kitSheets(strips.splice(0), i)
  }
  const flagged = audit.filter((r) => r.flags.length)
  console.log(`${audit.length} actions, ${flagged.length} flagged`)
}

/**
 * `--fit`: every weapon on this John, in the hand and put away, photographed close and whole, with its numbers
 * (C.fitRead): one row a weapon pair (a melee family with a ranged one), written to fit.json and fit-N.jpg. `--pick 3`
 * runs only those rows.
 */
async function fitCheck() {
  QUIET = true
  const opts = await run('window.__course.options()')
  const melee = opts.v.filter((v) => !/unarmed|kicks/.test(v.id))
  const guns = opts.families.filter((f) => f.id !== 'emitter')
  const PICK = arg('pick', '')?.split(',').filter(Boolean).map(Number) ?? []
  const out = []
  const strips = []
  const X = FLAT.x
  const Z = FLAT.z
  const photo = async () => Buffer.from((await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: 800, y: 0, width: 800, height: 720, scale: 0.75 } })).result.data, 'base64')
  for (let i = 0; i < Math.max(melee.length, guns.length); i++) {
    if (PICK.length && !PICK.includes(i + 1)) continue
    const v = melee[i % melee.length]
    const gun = guns[i % guns.length]
    const kit = { basic: v.id, active1: `lmb-${gun.id}-single-straight` }
    await run(`(() => { const p = JSON.parse(localStorage.getItem('john-lab:prefs') ?? '{}'); p.kit = { ...(p.kit ?? {}), ...${JSON.stringify(kit)} }; p.lmb = { family: '${gun.id}', mode: 'single', flight: 'straight' }; localStorage.setItem('john-lab:prefs', JSON.stringify(p)) })(); 0`)
    await cdp('Page.navigate', { url: `${BASE}/dev/john${query.size ? `?${query}` : ''}` })
    for (let k = 0; k < 180; k++) {
      await wait(1000)
      if (await run('!!window.__arena && !window.__course && window.__arena.arena.match.tick > 5 && window.__arena.arena.match.human === 0').catch(() => false)) break
    }
    await run(INSTALL)
    const c = recorder(`fit-${i}`)
    await c.stand(2, X + 9, DECK, Z, -HALF)
    await c.place(X, DECK, Z, HALF)
    const look = async (hand, yaw, dist) => {
      await run(`window.__course.hand = ${hand ? JSON.stringify(hand) : 'undefined'}; 0`)
      if (!hand) await c.side(yaw, dist)
      await run('window.__arena.seat.frame(0)')
      return photo()
    }
    const held = () => run(`(() => { const r = window.__course.model()?.root; return ['hand_r', 'hand_l'].filter((s) => r?.getObjectByName('socket:' + s)?.children.length) })()`)
    await c.play(0.6, 'ready')
    const tiles = []
    // the melee set in the hand: close from outside the hand and from ahead of it, then whole from the side and behind
    const slot = (await held())[0] ?? 'hand_r'
    tiles.push({ note: `${v.label}: in the hand`, data: await look({ slot, yaw: slot === 'hand_r' ? 0.5 : Math.PI - 0.5, dist: 0.62 }) })
    tiles.push({ note: 'from ahead', data: await look({ slot, yaw: HALF + (slot === 'hand_r' ? -0.25 : 0.25), dist: 0.62 }) })
    tiles.push({ note: `whole; ${gun.label} put away`, data: await look(undefined, 0.35, 3.3) })
    tiles.push({ note: 'from behind', data: await look(undefined, -HALF - 0.5, 3.3) })
    const idle = await run('window.__course.fitRead()')
    // the ranged set out, at its shot
    await run('window.__course.events.length = 0; 0')
    await c.hold('active1')
    await c.until(() => false, 0.05, 'firing')
    let shot
    for (let k = 0; k < FPS * 1.5 && !shot; k++) {
      await c.frame('firing')
      if (await run(`window.__course.events.some((e) => e.type === 'release')`)) shot = true
    }
    await c.play(0.05, 'shot')
    const out2 = (await held()).includes('hand_r') ? 'hand_r' : ((await held())[0] ?? 'hand_r')
    tiles.push({ note: `${gun.label}: at its shot`, data: await look({ slot: out2, yaw: out2 === 'hand_r' ? 0.5 : Math.PI - 0.5, dist: 0.75, up: 0.15 }) })
    tiles.push({ note: `whole; ${v.label} put away`, data: await look(undefined, 0.35, 3.3) })
    tiles.push({ note: 'from behind', data: await look(undefined, -HALF - 0.5, 3.3) })
    const firing = await run('window.__course.fitRead()')
    await c.hold()
    const row = { melee: v.id, ranged: gun.id, fit: idle.fit, hand: idle.hand, stature: idle.stature, root: idle.root, idle: idle.pieces, shot: firing.pieces, fired: !!shot }
    out.push(row)
    strips.push({ title: `${label} | fit hand ${idle.fit?.hand} body ${idle.fit?.body} | ${v.label} + ${gun.label} | ${idle.pieces.concat(firing.pieces.filter((q) => /^hand_/.test(q.slot))).filter((q) => /^hand_/.test(q.slot)).map((q) => `${q.piece} x${q.scale} ${q.length} m`).join(', ')}`, tiles })
    // each photo whole as well, for a closer look than the sheet gives
    mkdirSync(join(OUT, 'tiles'), { recursive: true })
    tiles.forEach((t, j) => writeFileSync(join(OUT, 'tiles', `${String(i + 1).padStart(2, '0')}-${j + 1}.jpg`), t.data))
    console.log(`fit ${i + 1}: ${v.id} + ${gun.id} ${JSON.stringify(row.fit)} ${idle.pieces.map((q) => `${q.piece}@${q.slot} x${q.scale}`).join(' ')}`)
    writeFileSync(join(OUT, 'fit.json'), JSON.stringify({ label, rows: out }, null, 1))
  }
  // the rows, three to a sheet
  const W = 360
  const H = 324
  const BAR = 24
  const esc = (t) => String(t).replace(/[<&>]/g, (ch) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[ch])
  for (let s = 0; s * 3 < strips.length; s++) {
    const part = strips.slice(s * 3, s * 3 + 3)
    const layers = []
    for (const [k, { title, tiles }] of part.entries()) {
      const top = k * (H + BAR)
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 7}" height="${BAR}"><rect width="${W * 7}" height="${BAR}" fill="#232a38"/><text x="8" y="17" font-family="Menlo, monospace" font-size="13" fill="#ffd27a">${esc(title)}</text></svg>`), left: 0, top })
      for (const [j, tile] of tiles.entries()) {
        const note = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20"><rect width="${W}" height="20" fill="rgba(0,0,0,0.55)"/><text x="6" y="14" font-family="Menlo, monospace" font-size="12" fill="#fff">${esc(tile.note)}</text></svg>`)
        layers.push({ input: await sharp(tile.data).resize(W, H).composite([{ input: note, left: 0, top: H - 20 }]).jpeg({ quality: 82 }).toBuffer(), left: j * W, top: top + BAR })
      }
    }
    await sharp({ create: { width: W * 7, height: part.length * (H + BAR), channels: 3, background: '#111' } }).composite(layers).jpeg({ quality: 82 }).toFile(join(OUT, `fit-${s + 1}.jpg`))
  }
}

/**
 * `--clips`: every melee family's clips read through on the body, nothing played (characters.ts `timeline`): which way
 * the weapon points and where the hands and feet are, step by step, written to clips.json beside each clip's mark.
 */
async function clipTimelines() {
  const opts = await run('window.__course.options()')
  const out = {}
  for (const v of opts.v) {
    await run(`(() => { const p = JSON.parse(localStorage.getItem('john-lab:prefs') ?? '{}'); p.kit = { ...(p.kit ?? {}), basic: '${v.id}' }; localStorage.setItem('john-lab:prefs', JSON.stringify(p)) })(); 0`)
    await cdp('Page.navigate', { url: `${BASE}/dev/john${query.size ? `?${query}` : ''}` })
    for (let k = 0; k < 180; k++) {
      await wait(1000)
      if (await run('!!window.__arena && !window.__course && window.__arena.arena.match.tick > 5 && window.__arena.arena.match.human === 0').catch(() => false)) break
    }
    await run(INSTALL)
    await wait(1500)
    const got = await run(`(async () => {
      const sets = (await import('/src/arena/recipes/motions.ts')).MELEE_SETS
      const names = [...new Set(Object.values(sets).flatMap((s) => [...s.chain, s.heavy, s.dash, s.air, s.slam, s.launcher, s.grab, s.flurry]))]
      const fix = window.__course.model()
      const found = {}
      for (const name of names) { const t = fix?.timeline?.(name, 60); if (t) found[name] = t }
      return found
    })()`)
    out[v.id] = got
    console.log(v.id, v.label, Object.keys(got).join(' '))
  }
  writeFileSync(join(OUT, 'clips.json'), JSON.stringify(out))
}

/** The audit's strips, six actions to a sheet: each a row of its six frames under its name and the clip it played. */
async function kitSheets(strips, pass) {
  const W = 320
  const H = 288
  const BAR = 24
  const esc = (t) => String(t).replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' })[c])
  for (let s = 0; s * 6 < strips.length; s++) {
    const part = strips.slice(s * 6, s * 6 + 6)
    const layers = []
    for (const [k, { row, tiles }] of part.entries()) {
      const top = k * (H + BAR)
      const title = `${row.section} | ${row.label}${row.move ? ' | ' + row.move : ''} | clip: ${row.clip ?? 'NONE'}${row.flags.length ? ' | FLAG: ' + row.flags.join('; ') : ''}`
      layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 6}" height="${BAR}"><rect width="${W * 6}" height="${BAR}" fill="${row.flags.length ? '#5a2330' : '#232a38'}"/><text x="8" y="17" font-family="Menlo, monospace" font-size="14" fill="#ffd27a">${esc(title)}</text></svg>`), left: 0, top })
      for (const [j, tile] of tiles.entries()) {
        if (!tile.data) continue
        const note = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20"><rect width="${W}" height="20" fill="rgba(0,0,0,0.55)"/><text x="6" y="14" font-family="Menlo, monospace" font-size="12" fill="${/BLOW/.test(tile.note) ? '#ff8a7a' : '#fff'}">${esc(tile.note)}</text></svg>`)
        layers.push({ input: await sharp(tile.data).resize(W, H).composite([{ input: note, left: 0, top: H - 20 }]).jpeg({ quality: 76 }).toBuffer(), left: j * W, top: top + BAR })
      }
    }
    await sharp({ create: { width: W * 6, height: part.length * (H + BAR), channels: 3, background: '#111' } }).composite(layers).jpeg({ quality: 78 }).toFile(join(OUT, `kit-${String(pass + 1).padStart(2, '0')}-${s + 1}.jpg`))
  }
}
