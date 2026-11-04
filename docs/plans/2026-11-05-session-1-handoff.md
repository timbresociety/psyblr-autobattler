# Session 1 handoff: clip audit, a locked kit library, the first generated meshes

2026-11-05. Session 1 of the four that close the game. The plan, with every button's library, the MECE map and
all four sessions, is `docs/plans/2026-11-04-kit-library-and-four-sessions.html`. To serve it locally, run
`python3 -m http.server --bind 127.0.0.1 8765` from `docs/plans`. The findings behind it are in
`docs/reference/2026-11-04-kit-library-coverage.md`. `docs/GAME.md` is the only spec.

## The goal and the exit

Know that every clip we play reads right on every body, including bodies Meshy generates. Turn the six button
libraries into one locked list. Settle where each weapon goes during every move.

**Exit:** the owner signs three things:
- the locked library in GAME.md §4;
- the weapon carry table;
- an audit report in which every clip in use passes or has its replacement named.

The report covers our bodies and three generated test heroes.

Out of scope: feel-matching to MHUR, map work, building the new mechanics (session 2), and the Forge UI (session 4).

## Start of session: ask the owner first

The owner asked for these questions at the start of session 1, not before. Ask them in batches with
AskUserQuestion, recommended option first, and record every answer in GAME.md with the date.

1. **New mechanics, from the MECE map:** yes, no or later on each.
   - **Movement (E):** teleport to a mark or target, swap places, homing dash, swing on a line, flight and hover,
     glide, wall-crawl, burrow, carry or ride an ally.
   - **Combat (V and shared):** counter or parry, perfect guard, grab and throw, launcher with an air juggle, dash
     attack, air attack and slam, knockdown and get-up, wall-jump, jump pads.
   - **Spells (Q):** real summons and clones, constructs (a one-way barrier, walkable terrain, portals), copying a
     kit, possession.
   - **Ranged (LMB):** paired guns, body emitters (eye beams, breath), hold to charge, full auto, lobbed, bouncing,
     returning and homing shots.
   - **F and R:** forms that change the moveset, switching between two kits, revive, titan summons, a cinematic
     lock-on ultimate.
   - **Systems:** team-ups, fusion, beam clashes, a spendable power meter.
2. **The form rule.** Recommended: F holds forms on its meter, and R holds a bigger, timed form that changes the
   moveset, under different names.
3. **E's duplicates.** Recommended: drop Wall Run, Combat Roll, Power Slide and Zipline, because every hero has them.
4. **Melee families.** Split spear, whip and chain, and paired weapons out of "Axe or staff" and "Unarmed"? Axes join
   two-hand heavy.
5. **The weapon carry defaults** (below): accept, or change row by row.
6. **Attitude sets:** which walks, idles and poses matter most (strut, swagger, hip sway, a brute's roll), and
   whether the owner wants to record any moves themselves.

## Where things stand

- **Branch:** `rework/game-md`, pushed to `origin/main` on 2026-11-05 with the owner's go-ahead. Pushing again
  needs a new go-ahead.
- **Code:** the only change since the 2026-11-04 push is the neck-hump fix (`src/kit/body/shape.ts`, test in
  `src/kit/body/physique.test.ts`). Everything else since then is docs and decisions.
- **Gates** (all passed at `a2675d2`):
  - type check: `npx tsc --noEmit -p .`;
  - fast suites: `npx vitest run --exclude 'src/sim/**'`;
  - balance gate, run alone: `npx vitest run src/sim`;
  - build: `npm run build`;
  - Vercel-shaped build: copy the tracked and untracked files without `public/anim`, remove the `.vercelignore`
    paths, symlink `node_modules`, then run tsc and `vite build`;
  - a look with our own eyes.
- **Before any commit:** check `du -sh public/anim`. It is at 101 MB; stop if it passes 300 MB or any single file
  passes 50 MB.
- **Servers:** the dev server on port 3110 (`npm run dev`) and the doc server on port 8765.
- **The plan page** is a static file now: its generator lived in a scratchpad that is gone, so edit the HTML
  directly.

## Owner decisions in force (all in GAME.md)

- **Order of the four sessions:**
  1. kit lock;
  2. build it, then the owner checks it on today's map;
  3. map rebuild;
  4. the generative forge.
  No MHUR feel-matching for now. (§13, Plan row)
- **The foundation is settled:**
  - our Mixamo-compatible skeleton (§9.2) is the contract every animation plays on;
  - every hero's mesh is generated with Meshy and rigged onto that skeleton, tested from session 1;
  - MetaHuman and MakeHuman are closed;
  - other games' rigs are studied for their conventions (weapon sockets, carry rules), never copied from their files. (§9)
- **Any look, human-like:** joints in our places, anything on the surface. No tails, wings, four legs or extra
  arms. The head can be its own mesh at the neck socket (§9.1). (§9)
- **The physique dials go** with the generative forge. Size classes stay, and so do the jiggle and muscle helpers,
  placed on each mesh from its own skin. (§9)
- **Players generate anything they ask for,** real and famous people included; the owner's lawyers handle the legal
  side. The one hard line:
  - no nude or sexual depictions of real, identifiable people;
  - nothing sexual involving minors;
  - no real child, ever.

  When a request crosses the line, the Forge explains and offers the nearest thing it can make. Clear bad intent
  gets a firm no and slows the account. Adult characters may have sex appeal, never nudity. Fictional child
  characters may fight, without sex appeal. (§9)
- **Best quality where the device can carry it.** The M1 Air target stays at 60 fps; capable devices render up to
  native resolution. (§10)

## The work, in order

### 1. Best quality on capable devices (small; do it first)

- `src/arena/client/quality.ts` caps the render at `TARGET_PIXELS = 1440 * 900`. `pixelRatioFor` takes the smallest
  of 2, the device pixel ratio, and the ratio that fits the cap. The scaler (`createScaler`, `scaleFor`) only ever
  takes it down.
- **The change:** a device that held 60 fps last match starts at its native ratio, and the scaler brings it down
  under load. A slow or new device starts at today's cap.
- **Check:**
  - the M1 Air still holds 60 fps in the bench and the soak (`/dev/bench`, `/dev/soak`);
  - a screenshot at native resolution on a Retina screen is visibly sharper.

### 2. Meshy: the first generated meshes on our skeleton

- **Key:** the owner provides it. Put it in `.env.local` as `MESHY_API_KEY`; never commit it. External sends are
  approved once the key is set.
- **Read Meshy's API docs before building:**
  - text-to-3D and image-to-3D;
  - T-pose or A-pose output;
  - rigging;
  - text-to-motion and video-to-motion;
  - the licence for using outputs commercially;
  - cost per job.

  Confirm that motion generation exists as the owner expects.
- **Generate three original test heroes:** a giant, a slight caster, and a mascot with a non-human head. Use
  original characters only for our own tests and samples.
- **Downloads are untrusted:**
  - each one goes in its own new directory;
  - scripts live elsewhere;
  - Python that reads them runs with `-I`.
- **Rebind each hero to our skeleton.** Don't keep Meshy's own rig.
  - Find the mesh's joints.
  - Pick its size class and set our bone lengths to match.
  - Copy skin weights from our standard body by nearest point.
  - Bind hard parts stiffly to one bone.
  - The Blender pipeline is in `tools/blender`. The head joins at the neck socket with `blendCollar`
    (`src/kit/head/head.ts`).
- **Run the audit clips on them** (step 3). This is the real test of "every animation works on any generated hero".
- **Try text-to-motion and video-to-motion** as a source for the attitude sets and the missing moves. Check the
  licence first.
- **Meshy is never named in player-facing text.**

### 3. The clip audit harness

- **A script that scores every clip in use without anyone watching:**
  - root drift;
  - hip sway;
  - foot slide;
  - bone pops (jumps between frames);
  - loop seams;
  - the travel line against the move's intended direction;
  - skin passing through itself, and joint-limit breaks. The physique bench already scores these two:
    `src/kit/bench`, `/dev/physique?tab=bench&arch=…&clip=…&facing=1.57`.
- **Contact sheets for each clip:**
  - on tiny, medium and huge bodies;
  - female and male;
  - on the three generated heroes.
- **The clips in use:**
  - `LIBRARY_MOVES` in `src/arena/client/library-gait.ts`;
  - the melee styles' combos, heavies and guards;
  - ranged in each stance;
  - the E kinds, the F toggle and R;
  - hit reacts.
- **Verdict for each clip:** keep, trim, replace or missing.
- **Tools from earlier sessions:**
  - probe scripts in `.scratch/feel2` (`bu-*.py`);
  - `grid.py` for filmstrips;
  - `tools/clipstat.py` for a clip's numbers (`python3 -I .scratch/feel2/tools/clipstat.py <clip> -v`);
  - the seat API (`__arena.seat.hold/step`).

### 4. The weapon carry table

**The owner's open question:** where does a bow or an axe go when the hero is hanging on a ledge? Every weapon
family needs its own animations across combat and traversal, and a rule for when the hands are busy.

**Proposed defaults, to put to the owner:**

| Move | One-hand weapons (pistol, blade, club, wand) | Two-hand weapons (bow, long gun, heavy gun, greatsword, polearm, staff) | Weapon and shield, paired | Fists, kicks, thrown, bare-hand magic |
| --- | --- | --- | --- | --- |
| Walk, run, sprint, jump, roll, dash | In hand, at a low ready | In hand, at a low ready | In hand | Nothing to carry |
| Slide, dive, crouch, prone, crawl | In hand; guns fire from crouch and prone | In hand; a bow can't fire prone | In hand | — |
| Mantle | Kept in the free hand | Stowed for the climb, drawn after | Stowed, drawn after | — |
| Ledge catch, hang, shimmy, climb, drop | Stowed on the hip or thigh | Stowed across the back | Stowed on the back and hips | — |
| Zipline, rail | Kept in the free hand | Stowed across the back | Stowed | — |
| Hit, knock-up, knockdown | Kept | Kept | Kept | — |

- **When stowed weapons come back out:** when the move ends, or instantly when the player attacks. Each gets a short
  stow clip and a draw clip, about 0.2 s, per family.
- **Sockets:** the rig has `hand_r`, `hand_l`, `back` (on `Spine2`), `hips`, `muzzle` and `weapon_tip`
  (`src/kit/rig/metarig.ts`). The table needs more:
  - a diagonal back slot for long weapons;
  - left and right hip slots;
  - a right thigh holster;
  - a quiver;
  - possibly a lower back slot.
- **Study the reference games' conventions by watching gameplay only.**
- **Deliverable:** the table signed by the owner, and the extra sockets added to the rig.

### 5. Attitude sets

- Each hero can carry a walk, run and idle with character, plus Forge and victory poses.
- The library has one strutting walk (`style_strutting_walk`) and about 25 hand-on-hip and leaning poses.
- The rest can come from:
  - free libraries, checking each licence;
  - Meshy's motion tools;
  - our own phone recordings through video-to-motion.

### 6. Lock the library

- **Write the locked grid into GAME.md §4,** one cell per item:
  - the button rule (how it's paid, what it's for);
  - each button's families;
  - the weapon families;
  - the new mechanics the owner said yes to.
- **Map it to bodies and archetypes:**
  - the clip each item plays per size class;
  - the default kits per role;
  - which weapon families each body may hold.
- **Re-cutting the catalogue** (`src/charter/templates`, 307 entries) happens in session 2. Session 1 only signs the
  grid.

## Rules that carry over

- Never push, merge into main or touch other branches without the owner's go-ahead for that push.
- Commits:
  - end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - log each hash in `.scratch/rework-progress.md`.
- Docs are local files, never published artifacts.
- **Chrome:**
  - Chrome on port 9335 is the owner's own browsing: never drive it or bring it to the front.
  - Probes use a private headless Chrome on port 9444, launched with the command in the memory notes; kill it when
    done.
  - Never use the Claude-in-Chrome tools.
  - The Mixamo session token stays in the browser.
- **Assets:**
  - Free downloads only.
  - No ripped game assets, including the Marvel Rivals and MHUR files the owner was offered.
  - No Epic or Fab account.
- **Outbound and running work:**
  - Sending data to an outside service needs the owner's go-ahead. Meshy is approved once its key is set.
  - At most two heavy processes at once.
  - Use subagents sparingly.
- **Player-facing text:** no vendor names.
- **Checking work:** check with the senses (renders, filmstrips, measurements), not just tests.

## Known leftovers

- A small red speck at the back of the Stocky preset's neck (hunched posture), present before the neck fix.
- A full-height jump clears walls up to 4.5 m, so the ledge grab only catches taller walls. The session 3 map should
  put grab ledges above 4.5 m.
- One Skill 2 clip turns the hero away from the camera, and a pillar can block the Forge reel's side view. Re-check
  both in the audit.
- Sketchfab: six small original CC-BY packs (about 50 sword, kick and soldier clips) can be pulled if the owner
  provides a token. Each needs its author credited.
