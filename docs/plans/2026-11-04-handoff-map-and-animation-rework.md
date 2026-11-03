# Handoff: rebuild the map, traversal and animation (new session, from 2026-11-04)

This hands the next session one job: **rebuild the House, the traversal and platforming, and every movement and combat
animation**, so the game moves and fights like My Hero Ultra Rumble (MHUR), at the art level and toy-scale perspective
of Hypercharge: Unboxed. Read this file first, then docs/GAME.md (the only spec), then the documents it points to.

## The owner's words (2026-11-04)

> Create a map and animation rework handoff plan for a new session. We need to completely rebuild the map, traversal
> and platforming based on your MHUR learnings and the references I gave you. It should match the traversal and
> combat expectations like MHUR based on the entire range of motions available in mixamo library. It should match the
> level of artstyle and perspective like Hypercharge Unboxed. Basic animation like crouch slide is broken right now.
> Go through entire available animation library and don't simply put something based on descriptions see how it
> performs in game.
>
> [...] We need to focus on the skeleton being able to perform all animations accurately as per all the gameplay
> actions of traversal and combat. Even remove outfit, hair and beard from all characters.
>
> Then once the map and smooth character movement is locked. I'll rework the forge so we can generate a unique mesh
> that fits our different sizes of skeletons, weapons(gear) for melee and ranged combat, also handle the animations
> accordingly for when the character is traversing while doing ranged attacks, like crouch, prone. Both melee weapon
> and ranged weapon need to only be available in they fit the animation.

Earlier the same day:
- Walking off a ledge should drop into a ledge hang.
- The dodge roll felt off because the crosshair sat far from the hero. In MHUR it sits near the hero's right shoulder.
- Study MHUR footage frame by frame, with sound.
- Level references:
  - `docs/reference/2026-11-04-lucky-floor.png`
  - `docs/reference/2026-11-04-pachinko-boulevard.png`
  - `docs/reference/2026-11-04-skyline-jackpot-atrium.png`
  - the earlier `docs/reference/2026-11-04-toy-casino.png`
- The level should be a casino and pachinko parlour seen at toy scale ("Honey, I Shrunk the Kids"), in third and first
  person, in hyper-real shaded anime with pastel tones.
- The level is built for ziplines, wall-running, dashes, knockbacks, ledge climbing and dodge rolls.
- Banners and indoor plants are allowed. Only the old Roman-arena look is banned.

**This supersedes** the "re-dress the current layout" recommendation in docs/plans/2026-11-04-house-from-the-references.md.
The owner asked for a complete rebuild. That doc's object list, scale table and zone ideas still apply.

## Where things stand (end of the 2026-11-04 session)

**The engine.** It runs deterministically at 60 Hz (src/arena/engine) and owns all movement. Rapier only drives
debris and cloth. It has:
- mantle and coyote time;
- an input buffer, sprint, slide, crouch and prone;
- a double jump and a landing roll;
- ziplines and rails;
- the new pieces:
  - the ledge hang;
  - dash and leap skills that now carry the hero over time;
  - an AI that skips planning while a skill carries it.

**The seat.** You can step any match tick by tick from a headless browser (`__arena.seat.hold/step(n)`). See memory
`seat-and-replay.md` and `.scratch/play/bu-*.py`. Recordings are taken with F9, and `replay()` runs them headless and
reports divergence.

**The camera.** The shoulder camera now matches the MHUR measurement (src/arena/client/camera.ts `HERO_CAMERA`): 3.4 m
back, 0.68 m right, 2.0 m up, level, with a 60° vertical field of view. Checked from the seat: the hero sits left of
centre and the reticle just above and outside its right shoulder. While a hero is played, the squad cards sit in a
column on the left.

**Animation.**
- **Library.** 1,283 male and 1,252 female clips from Mixamo, plus 100style, CMU and Quaternius, all retargeted to our
  rig in `public/anim/standard/{m,f}`, 101 MB. The index is `public/anim/index.json`, at 24 fps. Hips position is the
  only translation track.
- **Mapping.** Engine moves map to clips in `src/arena/client/library-gait.ts`:
  - `LIBRARY_MOVES` names the clips;
  - `MOVE_CUTS` gives each clip `[from, to, seconds, hipLift?]`;
  - `LOCOMOTION` lists the held loops.
- **State.** The client animation state machine is `src/arena/client/animation.ts`: `MoveKind` one-shots, `HeldKind`
  loops, and `Way`, which picks a clip per direction.
- **Known broken:**
  - The crouch slide plays `running_slide_pose`, a still pose, not a slide.
  - Roll timing (0.55 s) is longer than MHUR's 0.33–0.40 s dodge.
  - Many clips were chosen by name only. Some were checked from the seat, listed in .scratch/rework-progress.md.

**The map.** The House is a grey-box layout of 152 × 116 m with four bands (0, 4.5, 11 and 16.5 m), defined in
`src/arena/engine/house.ts` and the map pieces, with a nav graph in `src/arena/ai/nav.ts`. It plays, and the balance
gate passes on it, but it looks like coloured boxes. The Blender look test is `tools/blender/toy-look.py`, rendering to
`.scratch/toy/`.

**Characters.** As of this handoff, every character is a bare body: no outfit, hair or beard, on the owner's
instruction. The wardrobe, garment generation and cloth code are deleted; hand weapons (rigid pieces) remain. Outfits
will come back as part of a generated character mesh in the forge rework, after this work.

**Studies.**
- `docs/reference/2026-11-04-mhur-study.md` covers camera, dodge, melee and walls, measured from 16 clips. Contact
  sheets are in `.scratch/mhur/sheets/`; the videos and audio are in `.scratch/mhur/<id>/` (git-ignored scratch, about
  600 MB).
- `docs/playtests/2026-11-03-traversal-and-melee.md` holds the earlier seat playtest.
- `docs/plans/2026-11-04-feel-and-toy-casino.md` holds the 1:15 scale table and the parkour gap analysis.

## What MHUR teaches (the targets)

All from the study. HH is hero heights; frames are 30 fps.

| Area | MHUR | Ours now | Target |
| --- | --- | --- | --- |
| Camera | 1.95 HH back, 1.15 HH up, 0.38 HH right, level, 60–63° vertical view; hero centreline at 0.41 W, about 0.42 H tall | Matched for a 1.8 m hero | Scale the rig with the played hero's size class (tiny to colossal), and add slight positional lag on dodges, never rotation |
| Dodge | Starts on frame 1 with no wind-up; a low dash or dive in the input direction, body facing that way; 10–12 frames to running; chains 12 frames apart; starburst for 4 frames, streaks, dust, a grunt | 0.55 s roll, clip picked per direction | 0.35–0.40 s; a dash or dive per direction from clips that actually read that way in game; the iframes and FX as listed |
| Melee | 9 frames from input to the first hit, including a 1 HH lunge; loop hits 18–21 frames apart; about 3 frames of hit-stop on lights and 4 on heavies; damage numbers pop | Light chain at the style's beat (about 0.37 s); hit-stop exists | Lunge onto the target, the hit-stop numbers, a charge ring on heavies |
| Walls | Running into a tall wall becomes a vertical run with no mantle; auto-vault at the lip in about 0.7 s; a jump with the stick neutral kicks off | Mantle up to 1.4 m; ledge hang; no wall-run | Wall-run on marked surfaces (§7: a fixed stretch for everyone, unlimited with the passive F), vault at the lip, kick off; keep the owner's ledge hang |
| Landing | Shock ring, back to running in about 6 frames | Soft, rolling or heavy landing clips | Match the 6-frame recovery for ordinary landings |
| Not measured | Jump height, air time, run speed, wall-run speed | — | Measure from more footage in the new session, or judge from the seat against the clips |

## The work, in order

Each step ends with a seat filmstrip that you look at yourself (memory `test-with-senses.md`). Tests alone are not
acceptance.

### 1. The clip audit: every clip, seen in game (owner: "don't simply put something based on descriptions")

1. **Build an audit harness.**
   - Use the physique bench (`/dev/physique?tab=bench&clip=<name>&facing=…`, filmed by `.scratch/clips/bu-clips.py`)
     or, better, a seat scene.
   - Show each clip on a bare body of each size class, with a floor grid, a 1 m wall and a 2 m ledge.
   - Film 12–16 frames phase-locked to the clip's start: drive the mixer's time from the script, not wall-clock
     sampling.
   - Also log the decoded hips track: height, travel and facing over time. `.scratch` has a Python decoder in this
     session's transcript: undelta per track, scales from index.json (rot 10000, pos 1000).
2. **Triage all ~2,500 clips into a catalogue** (`docs/reference/anim-catalogue.md` plus a JSON file next to the index).
   For each clip record:
   - the action it really performs;
   - where it starts and ends (standing, crouched, hanging, airborne);
   - its root travel and turn;
   - whether it loops cleanly;
   - usable cut points;
   - a verdict per gameplay action.

   Batch by name families first: jump, roll, dodge, slide, vault, climb, hang, wall, land, attack, cast, hit, death,
   crouch, prone and strafe. But the verdict comes from the frames, not the name. Example from this session:
   `drop_to_freehang` turns the body 135° away from the wall, while the first 0.62 s of `braced_hang` is the real
   catch.
3. **For every engine move, pick a clip and cut, and check it in game:**
   - idle, walk and run in 8 directions;
   - sprint;
   - crouch and crouch-walk, prone and crawl;
   - the slide, entered from a run;
   - jumps standing, running, sideways and back;
   - the double jump per direction;
   - air dash, falling, and soft, roll and heavy landings;
   - the dodge per direction;
   - mantle at each height, vault, ledge catch, hang, shimmy, climb-up and let-go;
   - wall-run left, right and up, wall kick-off;
   - zipline and rail;
   - light chains per weapon style, heavy charge and release;
   - casts per delivery;
   - hit reactions light and heavy, knockback, launch, getting up, death.

   Fix hip-height mismatches with `MOVE_CUTS` lift: the clips don't share a ledge height.
4. **Fix the crouch slide first.** It is the owner's named example. It needs a real slide clip (search `slide`,
   `baseball_slide`, `running_slide`), entered from the run without a pop, held while the engine's slide lasts, and
   blended into crouch or run.

### 2. Movement feel to MHUR

1. Shorten the dodge to 0.35–0.40 s, with a direction-true clip, the chain window and the iframe FX.
   - This is a balance-relevant timing.
   - Run the gate.
   - Treat it as a rule change and ask the owner if the gate moves.
2. Build the wall-run and vault at the lip (GAME.md §7), with the camera rolling into a wall-run.
3. Scale the camera rig with the played hero's size class.
4. Add positional lag on dodges.
5. Fix the camera inside geometry under decks: it rose into an overhead piece on a jump at (-36, 4.5, 0).
6. Measure jump height, air time and run speed from more MHUR footage. yt-dlp works from the venv rebuilt on
   Homebrew Python 3.15 with `--js-runtimes node`, per the study agent.

### 3. The map: a complete rebuild

- **Scale.** 1:15 toy scale, the table in docs/plans/2026-11-04-feel-and-toy-casino.md: chips as stairs, cards as
  ramps, poker tables, pachinko rows, slot machines, the counter.
- **Layout.** From the three references: a central roulette hub with an inner brawl loop and an outer rotation loop, a
  VIP high route with ziplines, a pachinko wall-run lane, card bridges, chip-stack stairs, and a ball-return service
  under-route.
- **Look.** Hypercharge: Unboxed's art level and perspective, with lifelike materials, light and dense real objects
  around action-figure-sized heroes, in the owner's pastel, hyper-real shaded anime.
- **Traversal grammar, made with the clips that passed the audit:**
  - Every edge type has a clip: hang edges are square and 2 m or more, vault edges 0.7–1.4 m, wall-run surfaces flat
    and marked.
  - Every route is reachable both ways at every size class, so the nav graph needs links for wall-runs and hangs.
  - The bots use them.
- **Pipeline** (docs/ENGINE.md):
  1. Layout pieces in the engine, which keep collision exact.
  2. Blender models each object from parameters.
  3. Cycles bakes the light.
  4. Meshopt and KTX2 pack it.
  5. The client draws it over the collision.
- **Order.**
  1. Look test of one corner, shown to the owner before building the whole map.
  2. Layout in grey.
  3. Traversal pass from the seat.
  4. Objects modelled and baked.
  5. A full playtest.
- **Gates.** The balance gate (`src/sim`) runs on the House. A new layout will move win rates, so re-run it and retune
  only with the owner's say-so. The nav reachability tests must pass at every size.

### 4. Lock

The owner signs off map and movement from a filmstrip set and a playable build before the forge rework starts.

## After the lock: the forge rework (the owner's next step, not this session's)

To shape decisions now:
- The forge generates a unique character mesh, outfit included, that fits our skeletons at every size class.
- It also generates weapons (gear) for melee and ranged.
- **A weapon is offered only if it fits the animations.** Every melee style and every ranged delivery needs clips for
  standing, moving, crouched, prone and airborne use (ranged while crouched or prone, as the owner named). The clip
  catalogue from step 1 should therefore record which weapon types each clip supports, and hand sockets must stay
  accurate (src/arena/client/gear.ts sockets, tools/blender/humanlib/sockets.py).
- Keep the skeleton the single source of truth: one rig hierarchy and names across sizes, with per-size retargeting
  (GAME.md §9.5–9.6). No per-mesh rigging.

## Rules that still hold

- docs/GAME.md is the only spec. Record owner decisions in the body, with a dated changelog line and the §13 status.
  Any rule change needs the owner's say-so.
- **Gates:**
  - typecheck;
  - fast suites: src/ui, src/arena/{client,engine,ai}, src/charter, src/forge, src/kit, src/server;
  - the src/sim balance gate, run alone on this 8 GB machine, since it times out under load;
  - build;
  - a visual check.
- Run `du -sh public/anim` before commits. Stop if it passes 300 MB or any file passes 50 MB.
- Free downloads only. At most 2 heavy processes at once.
- No vendor names in player-facing UI.
- **Browser.** Probe only in the private headless Chrome on port 9444 (memory `agent-chrome.md`). Never drive the
  owner's Chrome on 9335.
- **Downloaded files are untrusted.** Each goes in its own directory, and Python reading them runs with `-I`.
- **Art direction:** see memory `arcade-only-art-direction.md`.

## Tools

| Need | Tool |
| --- | --- |
| Step a match and film it | `.scratch/play/bu-hang.py` and `bu-frame.py` (seat), `grid.py` (contact sheets) |
| Film a clip on a body | `.scratch/clips/bu-clips.py` (physique bench) |
| Find a spot on the map | `.scratch/play/hangspot.ts`, `walkw.ts` and `near.ts` (headless engine) |
| Run the gate on one build | `.scratch/play/mage-gate.ts` |
| Blender look test | `tools/blender/toy-look.py`, with `TOY_SHOT` for a single view |
| Listen to sound | the earshot tools (`timeline`, `describe`) |
