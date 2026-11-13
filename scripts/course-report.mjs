/**
 * The course's before-and-after page (scripts/course.mjs): the runs under a folder, side by side, as one local page.
 *
 *     node scripts/course-report.mjs [.scratch/course]      (expects before-60, after-60, after-60-library, match-60)
 *
 * The page and its pictures are local debug data: they stay in .scratch.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const root = process.argv[2] ?? '.scratch/course'
const order = (f) => parseInt(f.match(/-(\d+)\.jpg$/)?.[1] ?? '1')
const sheets = (dir, seq) => (existsSync(`${root}/${dir}`) ? readdirSync(`${root}/${dir}`).filter((f) => new RegExp(`^${seq}(-\\d+)?\\.jpg$`).test(f)).sort((a, b) => order(a) - order(b)) : [])
const res = (dir) => JSON.parse(readFileSync(`${root}/${dir}/results.json`, 'utf8'))
const pairs = [
  ['run-jump-land', 'Run, jump, land, run on', 'Before: the landing is skipped; the feet are 27 cm off the floor at touchdown and the legs stretch to it after. After: take-off, rise, top and fall by the body’s own speed; the feet meet the floor; the hips sink 16 cm over legs that keep running.'],
  ['jump-ceiling', 'Jump under the slab', 'Before: the take-off pose holds for its 0.42 s while the body has already stopped and fallen. After: over the top and falling the moment the head stops.'],
  ['melee-interrupt', 'A blow in the air; a dodge out of a blow', 'Before: the roll plays in the blow’s pose for its whole length, and the blow lands from inside it. After: the roll is a roll, and the blow is given up.'],
  ['mantle', 'Low mantle', 'Before: the lab’s block was not drawn; the body sinks 38 cm into it and snaps upright. After (the pack’s clip): the block is drawn; the body goes up and over along the clip’s own path, fitted to the block, and rises into the run.'],
  ['hang', 'Catch, hang, shimmy, climb, let go', 'Hands on the rim through the hang and both shimmies.'],
  ['melee-chain', 'Three-blow chain', 'Before: everything after the contact is squeezed into 0.18 s. After: the contact meets the release tick and the follow-through plays at its own pace into the next blow.'],
]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const col = (dir, seq) => sheets(dir, seq).map((f) => `<img loading="lazy" src="${dir}/${f}" alt="${seq}, ${dir}">`).join('\n')
const table = (dir) => Object.entries(res(dir).results).map(([name, r]) => `<tr><td>${name}</td><td>${r.ok ? 'ran' : 'FAILED'}</td><td>${esc((r.poses ?? []).join(' › '))}</td><td>${(r.errors ?? []).length}</td></tr>`).join('\n')
const runs = readdirSync(root).filter((d) => existsSync(`${root}/${d}/results.json`)).sort()
const views = existsSync(`${root}/match-60`) ? readdirSync(`${root}/match-60`).filter((f) => /view/.test(f)).sort() : []
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Combat and traversal: before and after</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; background: #12151b; color: #e8edf5; font: 15px/1.5 -apple-system, system-ui, sans-serif; }
main { max-width: 1500px; margin: 0 auto; padding: 24px 16px 80px; }
h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 19px; margin: 44px 0 6px; } h3 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: #ffd27a; margin: 0 0 6px; }
p { margin: 6px 0 12px; max-width: 75ch; color: #c4cbd6; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
img { width: 100%; height: auto; display: block; margin-bottom: 8px; border-radius: 4px; }
.scroll { overflow-x: auto; } table { border-collapse: collapse; width: 100%; font-size: 13px; } td, th { text-align: left; padding: 5px 8px; border-bottom: 1px solid #2a3140; vertical-align: top; } th { color: #9fb0c8; font-weight: 600; }
code { background: #1e2430; padding: 1px 5px; border-radius: 3px; }
@media (max-width: 800px) { .pair { grid-template-columns: 1fr; } }
</style></head><body><main>
<h1>Combat and traversal: before and after</h1>
<p>Local evidence for the pass recorded in <code>docs/plans/2026-11-13-combat-traversal.md</code>. Every strip is the side view of John on the course, a frame every 3 at 60 Hz; under each frame are its tick, the animator's state, the clip that leads, and how far the lowest foot and the hips are from the engine's position. This page and its pictures stay on this machine.</p>
${pairs.map(([seq, title, note]) => `<h2>${esc(title)}</h2><p>${esc(note)}</p><div class="pair"><div><h3>Before</h3>${col('before-60', seq)}</div><div><h3>After</h3>${col('after-60', seq)}</div></div>`).join('\n')}
<h2>The licensed library alone (what a build ships)</h2><p>The same course with <code>?motion=library</code>: no pack clip plays. The landing is fixed here too; the mantle is the library's own clip, which still sinks into the block.</p>
<div class="pair"><div><h3>Run, jump, land</h3>${col('after-60-library', 'run-jump-land')}</div><div><h3>Low mantle</h3>${col('after-60-library', 'mantle')}</div></div>
<h2>An ordinary match from the lobby</h2><p>The player's own view: the camera's framing through a run, a jump, a rail, a roll and a blow.</p>${views.map((f) => `<img loading="lazy" src="match-60/${f}" alt="ordinary match">`).join('\n')}
<h2>Every run</h2>
${runs.map((d) => `<h3 style="margin-top:22px">${d}: ${esc(res(d).label)}${res(d).errors?.length ? `, ${res(d).errors.length} page errors` : ''}</h3><div class="scroll"><table><tr><th>Sequence</th><th>Engine</th><th>States shown, in order</th><th>Page errors</th></tr>${table(d)}</table></div>`).join('\n')}
</main></body></html>`
writeFileSync(`${root}/report.html`, html)
console.log(`${root}/report.html: ${runs.length} runs`)
