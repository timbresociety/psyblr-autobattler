# Session 2 handoff: build the locked kit, and John's test lab

2026-11-11. Session 2 of the four that close the game. The plan is `docs/plans/2026-11-10-session-2-plan.md`; the
locked library it builds is GAME.md §4, signed 2026-11-10. `docs/GAME.md` is the only spec. The session 1 handoff
(`docs/plans/2026-11-05-session-1-handoff.md`) and the clip audit report (`docs/reference/2026-11-05-clip-audit.md`)
are the background.

## The goal and the exit

Owner's brief, 2026-11-10:

> Create a way for me to test all possible character kit interactions on John: a character called John, one of every
> weapon, ranged and melee, and every skill and R interaction. Sessions 3 and 4 fix the cosmetics, so by the end of
> session 2 all traversal and combat mechanics must work properly.

And 2026-11-11: "when I said John I meant a John character that covers all sizes and sets so I can test each one."

**Exit:** every row of the lab's checklist works on John, in the owner's hands, on the current map, on the smallest,
the medium and the largest John and in each attitude set. Looks don't count yet: a plain mesh, stand-in effects and
stand-in clips are fine as long as the mechanic behaves right.

**Out of scope:** map rebuild (session 3), the forge and final effects (session 4), and anything that needs clips the
library hasn't got: those wait for the custom animation pipeline after session 4 (below).

## Where things stand

On `main` (production deploys from `main` through Vercel's Git integration; working branch
`rework/game-md`).

**Done before session 2 proper (2026-11-11):**

- **Deep links:** `vercel.json` serves the app for `/range`, `/lobby`, `/match/...`, `/forge/...` on a reload; `/api`,
  `/dev` and files are untouched.
- **The API on Vercel:** every `/api` route had answered 500 since 2026-11-04. Three JSON imports lacked `with {
  type: 'json' }`, which Node needs for an ES module (`src/kit/rig/standard.ts`, `src/kit/rig/limits.ts`,
  `src/arena/engine/timing.ts`). Fixed; checked by compiling the API and loading the router in plain Node. Any new JSON
  import the server can reach needs the attribute too.
- **Carry sockets** (GAME.md §4, "Where weapons are carried"): `back_r`, `back_l`, `back_flat`, `lower_back`,
  `hip_l`, `hip_r`, `thigh_l`, `thigh_r` in `SOCKETS` (`src/kit/rig/metarig.ts`). Each is measured off the body's own
  skin plus 3 cm (`src/kit/body/carry.ts`, `carrySockets`), on every body (`body-model.ts` through `upgradeRig`) and
  every rebound generated hero (`hero-file.ts` through `hangCarry`). A carried piece's +y runs to the grip and its +z
  away from the body; the back diagonals lean 35° over their shoulder. Checked on all 12 body files and the generated
  heroes; nothing hangs a weapon in them yet.
- **Attitude sets** (GAME.md §4, "Attitude sets"): neutral, brute, swagger, low, strut, as a layer over the library's
  clips, because the library's 100STYLE style walks don't carry their style.
  - Data: `src/kit/anim/attitude.ts`. Rest-pose turns: `src/arena/client/metarig/attitude.ts`.
  - Gait swing per axis, faded by tier: `swung` in `library-gait.ts`. Brute's heavy landing: `libraryMoves`.
  - Feet on the floor under bent knees: `groundClip` in `anim-library.ts`, per hips key.
  - Moves in `PLAIN` (`library-gait.ts`: landings, rolls, slide, dive, fall, prone, ultimate, hangs, climb, mantle)
    fit to the rest without the attitude.
  - A look carries it (`HeroLook.attitude`), and so do generated heroes (`characters.ts`, when `buildModel` declines
    the mesh).
  - Measured: every library move on every set within 2 cm of neutral's floor contact, on the medium body and on John.
    Brute and low read clearly, swagger moderately, strut subtly.

**From session 1, still true:**

- John is rebound and in the audit hero list (`.scratch/tripo-in/audit.json`: `john/john-rig.glb`, 1.85 m, m). The
  mesh stays in `.scratch`, never committed or deployed.
- Floor depth over 8 cm on John: 34 of 270 clips and 9 of 45 moves before the leg fix, 20 and 4 with it (audit call
  5). The fix itself is still to be built.
- The locked library, the carry table (100 pairs, no clash) and the stow table are signed.

**Not started:** `/dev/john`, the weapon meshes, the chain physics, the new mechanics marked "New" in GAME.md §4, the
checklist and sweep, the catalogue re-cut.

## Start of session: confirm with the owner

Ask in one AskUserQuestion batch, recommended option first; record the answers in the session 2 plan with the date.

1. **How John spans sizes.** Recommended: John's own rebound mesh at each of the six size classes through the game's
   size scale (tiny 0.8 to colossal 1.6, `src/charter/sizes.ts`), plus our own bodies for the female and physique
   variants, labelled as John. Alternative: generate a John per size in Tripo (more credits, closer shapes).
2. **Weapon spend.** 18 Tripo meshes at about 1,100 credits (the plan's table). Check the balance before starting.
3. **Order.** Recommended: the lab and the body panel first (so every later piece is checked on all sizes as it
   lands), then weapons, then mechanics.

## The work, in order

### 1. The John lab: `/dev/john`

- John on the current map, with a dummy, an enemy bot and an ally bot, and a ledge, a column, a zipline, a wall and a
  jump pad within a few steps. Bots can be set to block, fire a beam, stand still or fight.
- **Body panel:** size class, gender, physique preset, attitude set. Live, no reload. Start from what exists:
  - `heroes.ts` already reads a DEV `?attitude=` for hero 0 (`arenaCharacter`): turn that into lab state.
  - `/dev/try?mesh=john` already plays John in the arena; `reboundFile` (`src/kit/bench/hero-file.ts`) builds him.
  - Rebuilding a hero mid-match: find how the forge staging swaps a look (`src/ui/arena/staging`) before writing a
    new path.
- **Loadout panel:** any V family, LMB family, Q family, E kind, F aura and R shape; weapons stow and draw through the
  carry slots by the carry table's ranking.
- **Checklist:** one row per interaction (the plan lists them), pass or fail with a note, kept in localStorage. Each row
  on the small, medium and large John and each attitude.

### 2. One weapon per family (18 meshes)

The plan's table: twin short swords, arming sword and round shield, katana, greatsword, scythe, warhammer, spear, bo
staff, whip; kunai, pistol (twice for paired), assault rifle, rocket launcher, recurve bow and quiver, wand, mage staff.

- **Generation:** Tripo, in ONE new tab of the owner's Chrome on 9335, opened with `/json/new` and closed when done,
  never `Browser.close`. Stop at a CAPTCHA; never type credentials. Downloads land in `~/Downloads`: move only our own
  files, each into its own new directory under `.scratch`, and treat them as untrusted (`python3 -I`).
- **Fit:** each piece modelled like a held one (`gear.ts`): +y to the grip, +z away. Scale to real length. Grip,
  muzzle and tip points per piece for `hand_r`, `muzzle`, `weapon_tip`.
- **Whip:** a bone chain with rope physics (owner's choice), held at `hand_r`, stowed coiled at `hip_r`.
- Weapon meshes are original, not named characters' gear; they can be committed under `public/kit` once checked, if
  under the size rules below.

### 3. Sinking bodies (audit call 5)

Hips move by leg length, feet are levelled, ground poses lifted by each body's depth. Judge on the audit heroes and on
John at every size. The floor tables (below) are the measure.

### 4. The new mechanics

Everything marked "New" in GAME.md §4: the V moveset (light chain, charged heavy, guard, dash attack, air attack and
slam, launcher and juggle, grab and throw), LMB firing modes and flights, the Q families, E kinds and the four enhanced
shared moves, the F aura meter, the 8 R shapes (Kit switch, Titan summon, Strike lock-on, Rally's mass revive among
them), team-ups, fusion, beam clash, the spendable power meter, ability charges, hold-to-charge, jump pads.

### 5. The automated sweep

A headless pass that drives every checklist row through the seat (memory: `seat-and-replay`), logs engine events (hit
landed, state entered, no exception) and draws contact sheets for the rows a picture can judge. The owner's marks are
the exit; the sweep catches regressions between them.

### 6. The rest of the plan

Re-cut the catalogue (`src/charter/templates`, 307 entries) onto the locked library; the strafe splice and the audit's
clip trims and swaps; the clip per size class, default kits per role, and which weapon families each body may hold;
render quality on capable devices (session 1 step 1, still open).

## How to check

- **Dev server:** `npm run dev` on port 3110.
- **Probes:** a private headless Chrome on 9444, `bringToFront`, killed when done (memory: `agent-chrome`).
- **Clip sheets:** `node scripts/clip-sheets.mjs <asks.json>` with `SHEET_OUT=<dir>`, and optionally
  `SHEET_QUERY='?heroes=1&attitudes=brute,swagger,low,strut'`. It renders `/dev/clips` for the six audit bodies, the
  audit heroes with `heroes`, and each body or hero again per attitude (`m-medium+brute`, `john+low`).
  - An ask is `{"name", "clip" | "move", "columns", "view", "bodies"}`.
  - Add `"low": true` and it writes `low.json` instead of a picture: per body, `depth` (deepest skin under the floor)
    and `touch` (the lowest point at its highest frame: feet that never reach the floor show here).
- **In the arena:** `/dev/try?mesh=john&attitude=brute`.
- **Gates:** `npx tsc --noEmit -p .`; `npx vitest run --exclude 'src/sim/**'` (1024 tests; six server tests in accounts, gate-cache, pieces and store time
  out under full-run load and pass alone); `npm run
  build`, then confirm `dist` holds no `.scratch`. The balance gate (`src/sim/gate.test.ts`) when bot or combat paths
  change; it times out under load, so run it alone.
- **Senses:** every change is judged on renders, filmstrips and floor numbers as well as tests.

## Rules that carry over

- **Git:**
  - Never push, merge into main or touch other branches without the owner's go-ahead for that push.
  - Commit only when asked. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; log each hash
    in `.scratch/rework-progress.md`.
  - Check `du -sh public/anim` (101 MB now): stop past 300 MB or any file over 50 MB. No GLBs of generated heroes in
    `public/`.
- **Named characters and debug data:**
  - The owner's local audit heroes (named-character meshes for their course benchmark) and John's mesh stay in
    gitignored `.scratch` only: never in `src`, `public`, committed docs, deploys or GitHub. Committed docs say "the
    owner's local heroes".
  - Traces, drill results and floor tables stay local.
- **Browsers:** 9335 is the owner's own browsing, used only for the one Tripo tab above; probes on 9444; never the
  Claude-in-Chrome tools.
- **Outbound:** sending data to an outside service needs the owner's go-ahead (Tripo is approved; ChatGPT for images
  and Gemini Omni Flash for video are the owner's tools for generation). Never commit keys.
- **Assets:** free or generated only; no ripped game assets.
- **Working style:** at most two heavy processes at once; subagents sparingly; no vendor names in player-facing text;
  they/them for the owner; docs are local files.

## Known leftovers

- **Strut** is the subtlest set; it could take a stronger hip drop if the owner wants it louder.
- **Sheet floors versus the game's:** the dive (62 cm) and the climb (39 cm) read deep on the sheet's flat floor on
  every body, neutral included. They play off a ledge or onto a mat in the game. John's roll reads 10.7 cm on every set.
- **The heavy landing** opens upright at the moment of contact, then drops into the crouch in 0.1 s. That's the clip;
  the crossfade from the fall covers it.
- **`/dev/try`'s camera** starts far out; a lab needs its own framing on John.
- **From session 1:**
  - a small red speck at the back of the Stocky preset's neck;
  - full-height jumps clear 4.5 m walls (session 3 ledges go higher);
  - one Skill 2 clip turns the hero from the camera;
  - Sketchfab CC-BY packs need the owner's token.

## After session 4 (owner, 2026-11-11)

A custom animation pipeline for what the library can't give: each attitude's own clips (a brute's walk, not a walk
with a brute's posture), idles and poses per set, styled strafes, the staff, thrust and flexible clips if the phone
video-to-motion route falls short, and clean replacements for the broken 100STYLE takes. Don't build it before then.
