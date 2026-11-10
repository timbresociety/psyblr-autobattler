# Clip audit, session 1

2026-11-05. For the owner's sign-off, under step 3 of `docs/plans/2026-11-05-session-1-handoff.md`.

**Where it stands:** every clip in use now has a verdict, and every clip that fails has its fix named, with one
exception: the staff has no clips of its own. Our six bodies are covered, and so are three generated heroes from
Tripo Max (owner, 2026-11-05: no Meshy key). **Of those three, the giant doesn't pass yet.** Its faults come from
fitting the body, not from any clip, so the session's exit needs the owner's call on them: see Generated heroes.
None of these fixes has been made in the game yet; that's session 2.

To browse every clip with its contact sheet, open `.scratch/clip-audit/index.html`.

## The result

| | Keep | Trim | Replace | Total |
| --- | --- | --- | --- | --- |
| Engine moves, as played | 23 | 10 | 12 | 45 |
| Clips the game plays | 151 | 55 | 64 | 270 |
| All clips in the tables, including unplayed coverage clips | 198 | 66 | 73 | 337 |

**Trim** means the clip stays with a named edit: a cut, a re-bake or a move to another slot. **Replace** names
the new clip, or drops the old one where its pool stays full. **Missing** means the library has nothing to use;
those are listed under "Missing" below.

## The biggest faults

1. **Empty hands hold an invisible rifle.** Crouch, prone and the standing, side and back jumps all match the
   rifle set: the hands stay locked a rifle's width apart (0.38-0.44 m). Unarmed and melee heroes play them. Fix: `ual_crouch_idle_loop`, `unarmed_jump`, `female_jump_running_backward`, and a held last frame
   of `prone_forward_stop`.
2. **The forward jump plays run strides, not a leap.** The engine lifts the hero, but the cut (0.25-0.75) stops
   short of the jump, which starts at 0.62. The second jump has the same fault. Fix: one line, cut to 0.62-1.08, rendered on three bodies.
3. **Heroes hang in a near T-pose in the air.** `falling` is the held air pose after a jump's push. Fix: `falling_idle`.
4. **Strafes run side-on.** Measured in the arena, the hips sit 83-103 degrees off the aim and the chest 28-47,
   though `gait.ts` says the hips stay square. Forward and back are within 11 degrees. Fix: the legs of
   `walking_left` and `running_left` with mirrors for right, under the arms of `walk` and `jog`. See call 1 below.
5. **The heavy-blow fallback is a clip of someone being hit.** `surprise_uppercut` launches the hero, who ends
   spread-eagled on the floor. Kicks are as bad: five of the six heavies fail. All have named replacements.
6. **The baker turned whole sets the wrong way.** `scripts/rpm-anim.ts:508` turns a clip with no named way by its
   chest, and a rifle stance's chest sits 45-60 degrees off travel. The engine's `crouch_move` goes +57. The crouch
   walks, standing dodges, `pistol_aim_*` and others are skewed the same way. Fix: the `crouch` set for the crouch
   walks; for the rest, name their ways and re-bake.
7. **The default shot never raises the gun.** `shooting_gun` points the empty left arm while the gun stays at the
   hip. Fix: `pistol_fire`, already in the library.
8. **The greatsword guard pops twice a second.** `gs_great_sword_blocking` is a 0.5 s raise played as a loop.
   Fix: `gs_great_sword_blocking_2`, a steady hold with a clean seam.
9. **The zipline and the ledge catch don't read.** The zip's hands sit at head height, and the catch has no reach.
   Fix: `hanging_by_hands_gently_swaying`, and `drop_to_freehang` cut to 1.04-1.73.
10. **Some clips only work with a partner or a prop.** `flying_shoulder_throw`, `shoulder_throw_aggressor` and
    `knock_off_assailant` sit in the ultimates with nobody to throw. `throwing_dice` is seated. `throw_grenade` is
    prone. All drop.

The handoff's leftover, "one Skill 2 clip turns the hero away", is probably `spell_casting` (-67 degrees) or
`ss_sword_and_shield_casting` (-72). Both are replaced here, but I matched them from numbers and didn't see it
happen in the game. The Forge reel's pillar was not re-checked.

## Generated heroes

The first pass (2026-11-05) ran on three original heroes from Tripo Max, rigged there and rebound to our skeleton,
keeping our bone frames and taking only joint positions and skin weights from Tripo. Every clip below plays on them in
their own skins. Since 2026-11-10 the audit runs on the owner's local heroes instead (answer 4); the faults below are
the same kinds, and session 2's leg and floor fixes are judged on those heroes.

| Hero | Built to test | Height I set | Hip factor |
| --- | --- | --- | --- |
| giant | huge frame, tiny head, big boots | 2.3 m | 0.89 |
| caster | slender, short dress over leggings | 1.65 m | 0.96 |
| mascot | jumpsuit, huge coin for a head, no neck | 1.75 m | 0.92 |

**Result:** the caster passes. The mascot passes except where hands go overhead. **The giant doesn't pass, and no clip
swap can fix it**, because the fault is in how the body is fitted, not in the clips. The fix is named below but not
built, and only part of it is proven.

Count of clips where the skin goes more than 8 cm under the floor, the worst our own bodies reach outside `dive`.
270 played clips, 45 engine moves, 37 shortlisted replacements:

| Hero | Clips, today | Clips, leg fix | Moves, today | Moves, leg fix | Shortlist, leg fix |
| --- | --- | --- | --- | --- | --- |
| giant | 219 | 208 | 30 | 31 | 32 |
| caster | 6 | 1 | 2 | 1 | 1 |
| mascot | 41 | 12 | 6 | 2 | 1 |

### Three faults, in order of size

1. **Hips scale by standing height, not leg length** (`legRatio`, `src/kit/rig/retarget.ts`). A hero whose hip joint
   sits high above its legs drops too far whenever its knees bend. Scaling the hips' movement by the true leg length
   takes the caster from 6 clips to 1 and the mascot from
   41 to 12. On our six bodies the same change moves foot depth by
   at most 1.8 cm on the four clips I tried it on, so it's safe there. It doesn't cure the tiny bodies' sink. Tried only
   in the audit, not in the game. One clip changed after it: `climb` now keeps its hips flat, because its own rise
   stacked on the engine's and took the feet 1.5 to 2 m over the rim (`MOVE_SHIFTS` in `library-gait.ts`).
2. **Big feet go through the floor** (giant). The giant's boots are about twice our foot length on legs only 1.1 times
   ours, so the toe dips under on every push-off. With the leg fix on, shortening its toe bone to 55% took the
   bones' sink from 11 cm to 3 cm on `walk`. That proves the cause, not a fix: the game can't shorten a hero's boots.
   Proposed fix: after `plantFeet`, level any foot whose toe is under the floor. Not built.
3. **Deep bodies on the ground** (giant, some mascot). `prone`, `roll` and `slide` put the hips where a slim body's
   would go, so a big chest or coin goes under. Proposed fix: measure each hero's depth when it's built and lift its
   ground poses by that much. Not built.

Skin depth in cm under the floor, worst ten moves on the giant. Caster and mascot are today / leg fix:

| Move | Our worst body | Giant, today / leg fix | Caster | Mascot |
| --- | --- | --- | --- | --- |
| `dive` | 64 | 90 / 81 | 58 / 56 | 62 / 57 |
| `roll` | 8 | 32 / 22 | 5 / 4 | 10 / 6 |
| `land_roll` | 8 | 31 / 21 | 3 / 1 | 7 / 2 |
| `prone_move` | 6 | 29 / 16 | 9 / 5 | 12 / 5 |
| `prone` | 4 | 28 / 15 | 6 / 3 | 10 / 3 |
| `prone_fire` | 4 | 28 / 15 | 6 / 3 | 9 / 3 |
| `fall` | 5 | 27 / 15 | 7 / 4 | 15 / 9 |
| `land_heavy` | 1 | 26 / 20 | 3 / 1 | 5 / 1 |
| `slide` | 2 | 23 / 13 | 2 / 0 | 6 / 1 |
| `crouch_move` | 6 | 22 / 17 | 3 / 2 | 7 / 4 |

`dive` is the one that also fails on our bodies: head and hands end about 60 cm under the floor on all of them, and
I found no height added in the engine's dive settings. That's worse than the trim above says. Check the new cut against the floor when it's made.

With the leg fix, the clips still over 8 cm that the audit doesn't already replace:

- **Caster:** `cmu_dive_roll` (14).
- **Mascot:** `cmu_dive_roll` (19), `inverted_double_kick_to_kip_up` (17), `running_dive_roll` (14), `stand_to_roll` (12), `dive_roll` (12), `sprint_to_backslide` (10), `sprinting_forward_roll` (10), `falling_back_death` (9), `sweep_fall` (9).
- **Giant:** 156 clips, so faults 2 and 3 have to land first.

### What I saw

I looked at 31 of the 45 moves on all three heroes, at contact-sheet size, plus close views of `hang`, `block` and `prone`.

- **Skin holds up.** I saw no tearing or collapse at that size. The caster's dress stretches over the hips in wide
  stances and stays on the body.
- **Mascot's arms clip the coin's rim:** the coin is as wide as the gap between its raised arms, so they cut into the
  edge in `hang` (seen from the side and front). `hang_left`, `catch` and `climb` hold the same pose, though I saw those
  only from behind. A hand also touches the rim in `block`. It's a small overlap, not arms through the face. `zip`
  is worse, but it's already being replaced.
- **Giant's head sits down between its shoulders** with its arms overhead. From the front it reads fine.
- **Faces and aim read right:** all three face the aim arrow, and the coin's face is forward.

Sheets are in `.scratch/clip-audit/heroes/`. Numbers are in `.scratch/clip-audit/heroes.json` and `heroes/clips/low.json`.

## Calls for the owner

**The owner's answers (2026-11-07):**
1. **Strafes:** build the spliced strafes, as recommended (session 2).
2. **Crouch:** today's crouch works fine and stays.
3. **Staff:** Tripo's motions don't fit our heroes (owner, 2026-11-10), so the pole clips come from phone recordings through video-to-motion.
4. **Test heroes:** the three originals are dropped (2026-11-10). The audit now runs on the owner's own generated heroes, kept as private local fixtures for a course benchmark: the list is `.scratch/tripo-in/audit.json` and the results are in `.scratch/clip-audit`, so neither the meshes nor their names enter the repo.
5. **Sinking bodies:** session 2 builds the leg fix and both floor fixes (2026-11-10).

**Signed by the owner, 2026-11-10.** Staff, thrust and flexible clips come from phone recordings through video-to-motion.


1. **Strafes.** Build the spliced strafes, or accept the side-on run? I recommend building them. There's no
   sideways sprint in the library, so the top tier would be the jog strafe played quicker, as the pistol does
   already. The splice hasn't been built, so nobody has seen it yet.
2. **Crouch height.** No set matches: every still crouch has the hips 0.44-0.59 m down, and every four-way
   moving crouch only 0.2-0.3 m down. The hero already rises 0.2-0.27 m on starting to move, and the engine plays
   one `crouch_move` clip for every direction. I recommend `crouch`: a true forward line, free hands, a clean seam
   and no extra rise, and 0.21-0.26 m down suits the engine's 70% crouch capsule. It reads as a stoop.
   `ual_crouch_fwd_loop` would remove the rise (0.44-0.50 m down), but it only goes forward. A 6.5 m/s hero crouch-walks at
   about 3.6 m/s, so it would play about 5 times too fast (0.7 m/s), where `crouch` plays about 2.2 times (1.6 m/s).
3. **Staff.** See "Missing". Getting real pole clips is the owner's choice of source.
4. **Test heroes.** Which meshes the audit runs on. Answered above: the owner's local heroes.
5. **The giant and the mascot.** Should session 2 build the leg fix and both floor fixes, so a body like the giant
   works? I'd build them: the leg fix is small and already tested in the audit. And is the mascot's raised arms clipping
   its coin's rim acceptable? I'd accept it for now: fixing it means a separate overhead pose for wide heads.

## Missing

- **Staff and pole.** The library has no pole clip at all. Seven of the `axe_*` clips listed under staff read
  one-handed, so they belong to an axe family (owner question 4). That leaves **staff light at 2 of the 3 it
  needs**, and the staff ultimate is an axe clip. `heavy_weapon_swing` cut to 2.2-3.7 is the one
  two-hand swing I found, and it can stand in as a heavy. Sources to try: the Sketchfab CC-BY packs (they need a
  token and credits), any motion tools Tripo offers, or the owner's own recordings. Until then, the
  greatsword's two-handed lights are the nearest stand-in, though I haven't drawn them with a pole.
- **Empty-handed side jumps.** None exist. The fix is the re-baked rifle clip under `unarmed_jump`'s arms.
- **A still, empty-handed prone.** None exists as a loop. The fix is a held frame.
- **Female `gesture_1` and `gesture_2`.** Both are male only, and neither is played yet.

## Engine moves

| Move | Clip now | Verdict | Fix |
| --- | --- | --- | --- |
| `jump` | `standing_jump_running` | trim | MOVE_CUTS 0.62-1.08 (now 0.25-0.75), rendered on three bodies. |
| `jump_up` | `jump_up` | replace | unarmed_jump, cut 0.70-1.20 |
| `jump_left` | `left_strafe_jump` | trim | Re-bake to go left; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `jump_right` | `right_strafe_jump` | trim | Re-bake to go right; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `jump_back` | `backward_jump` | replace | female_jump_running_backward (both genders have it) |
| `air_jump` | `standing_jump_running` | trim | MOVE_CUTS 0.62-1.08, as jump. |
| `air_jump_up` | `jump_up` | replace | unarmed_jump, cut 0.70-1.20 |
| `air_jump_left` | `left_strafe_jump` | trim | Re-bake to go left; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `air_jump_right` | `right_strafe_jump` | trim | Re-bake to go right; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `air_jump_back` | `backward_jump` | replace | female_jump_running_backward (both genders have it) |
| `roll_back` | `standing_dodge_backward` | keep |  |
| `land` | `ual_jump_land` | keep |  |
| `air` | `falling` | replace | falling_idle |
| `dash` | `idle_to_sprint` | keep |  |
| `dash_back` | `standing_dodge_backward` | keep |  |
| `slide` | `running_slide` | keep |  |
| `dive` | `cmu_dive_roll` | trim | End the cut near 0.42 (now 0.50). |
| `slash` | `jab_cross` | trim | Cut to 0-1.0. |
| `shoot` | `shooting_gun` | replace | pistol_fire |
| `cast` | `spell_cast` | keep |  |
| `ultimate` | `jump_attack` | trim | Cut to 0-2.9. |
| `hurt` | `hit_to_body` | keep |  |
| `stunned` | `big_hit_to_head` | keep |  |
| `fall` | `falling_back_death` | keep |  |
| `roll` | `quick_roll_to_run` | keep |  |
| `block` | `standing_block_idle` | keep |  |
| `crouch` | `crouch_idle` | replace | ual_crouch_idle_loop |
| `crouch_move` | `crouch_walk_forward` | replace | crouch |
| `prone` | `prone_idle` | replace | prone_forward_stop, held on its last frame (no still empty-handed prone exists) |
| `prone_move` | `prone_forward` | keep |  |
| `crouch_fire` | `crouch_rapid_fire` | keep | No recoil visible in 16 dense frames. Check it in motion. |
| `prone_fire` | `rifle_prone_fire` | keep | No recoil visible in 16 dense frames. Check it in motion. |
| `launched` | `fall_a_loop` | keep |  |
| `charge` | `standing_block_start` | keep | Plays only for a hero with no heavy blow (characters.ts:742); others hold their heavy wind-up. Reads as a guard entry. |
| `toggle` | `spell_cast` | keep |  |
| `mantle` | `pulling_up_to_a_ledge` | trim | Extend the cut to 0.6-3.3 (now 0.6-2.2), rendered: ends folded over the top. |
| `land_roll` | `falling_to_roll` | keep |  |
| `land_heavy` | `mid_air_falling_to_a_hard_landing` | keep |  |
| `zip` | `hanging` | replace | hanging_by_hands_gently_swaying |
| `catch` | `hanging_from_a_ledge_idle` | replace | drop_to_freehang, cut 1.04-1.73, rendered: ends in the straight hang. |
| `hang` | `hanging_from_a_ledge_idle` | keep |  |
| `hang_left` | `left_shimmy` | keep |  |
| `hang_right` | `right_shimmy` | keep |  |
| `climb` | `braced_hang_to_crouch` | keep |  |
| `rail` | `crouch_idle` | replace | ual_crouch_idle_loop |

## Pool health

Each slot a hero's kit draws from, where the audit changes it. "Needs" is the coverage minimum. Only **staff
light** falls short. A few slots end up with a single clip, which meets the minimum but leaves no variety:
`any block`, `greatsword block`, `greatsword spell` and `pistol heavy`.

| Slot | Before | Dropped | Added | After | Needs |
| --- | --- | --- | --- | --- | --- |
| any block | 2 | 1 | 0 | 1 | 1 |
| any dodge | 7 | 1 | 0 | 6 | 1 |
| any jump | 3 | 2 | 1 | 2 | 1 |
| any knockdown | 13 | 3 | 0 | 10 | 1 |
| any move | 21 | 13 | 0 | 8 | 1 |
| any movement | 8 | 2 | 0 | 6 | 1 |
| any ranged | 8 | 5 | 0 | 3 | 1 |
| any react | 10 | 1 | 1 | 10 | 1 |
| any ultimate | 6 | 4 | 0 | 2 | 1 |
| club light | 5 | 2 | 0 | 3 | 3 |
| greatsword block | 1 | 1 | 1 | 1 | 1 |
| greatsword spell | 2 | 1 | 0 | 1 | 1 |
| kicks heavy | 6 | 5 | 5 | 6 | 1 |
| kicks light | 7 | 3 | 2 | 6 | 3 |
| magic ranged | 9 | 1 | 0 | 8 | 2 |
| magic spell | 9 | 1 | 0 | 8 | 1 |
| pistol heavy | 1 | 1 | 1 | 1 | 1 |
| pistol ranged | 4 | 3 | 2 | 3 | 1 |
| rifle ranged | 4 | 2 | 0 | 2 | 1 |
| shield heavy | 3 | 1 | 1 | 3 | 1 |
| shield light | 7 | 1 | 1 | 7 | 3 |
| shield spell | 3 | 1 | 0 | 2 | 1 |
| staff heavy | 5 | 4 | 1 | 2 | 1 |
| staff light | 5 | 3 | 0 | 2 | 3 |
| unarmed heavy | 3 | 2 | 2 | 3 | 1 |
| unarmed light | 16 | 1 | 2 | 17 | 3 |

## How it was checked

- **Numbers.** `npx tsx scripts/clip-audit.ts` scores all 1283 library clips on medium bodies, and the 337
  clips in the tables on all six: tiny, medium and huge, male and female. It measures drift, sway, foot slide,
  pops, seams, travel line, facing, hand spacing, joint limits and skin through itself. It reproduced four
  documented faults to within 3 cm or 7 degrees, including the dash sway and the roll's turn.
- **Eyes.** Reviewers read all 382 sheets (eight stills per clip per body, plus the 45 moves as cut). I
  re-checked their strongest claims on the sheets, and those held. I overruled them in three kinds of case:
  reviewers kept `crouch_idle`, `prone_idle` and `jump_up`, which the hand spacing fails; they kept the strafes, which
  the arena measurement fails; and they failed the `charge` move, which only plays for a hero with no heavy.
- **Merging.** Where eyes and numbers disagreed, I looked again. Seven clips with 40-66 degree pops were checked
  frame by frame and are real fast swings, so they stay. Joint limits were nearly clean: the worst is 15 degrees on
  three clips, two of them replaced here, and `double_dagger_stab` shows nothing on its sheet. 17 clips carry a
  through-body flag. Every sheet reviewers checked for one showed nothing, so that flag fails nothing here, but it
  isn't proven wrong for all 17.

## What this doesn't prove

- **Generated heroes:** three heroes, on contact sheets and numbers only. None has played in the arena, and the rebind
  isn't in the game. The sheets leave out `plantFeet`, which may lift some of the planted-foot sink. Clips were scored
  with no weapon held. Twist bones aren't bound on these meshes, so forearm twisting wasn't tested. Skin depth samples
  every 16th vertex at 12 frames a second, so true depths can be slightly worse. I chose the heroes' heights.
- **Replacements:** all 37 shortlisted clips exist for both genders and passed the numbers on six bodies, except
  `crawling`, which sinks 12.5 cm and isn't used as a fix. I looked closely at them on the medium male only. Across
  six bodies I saw only 15 of them, at thumbnail size, enough to show their silhouettes hold.
- **Cuts:** only six are rendered: the jump, `unarmed_jump`, the vault, the catch, the mantle and the staff swing.
  Other trim windows are read off stills and may move by a few frames.
- **Fixes:** none has been built. Re-bakes and arm splices are proposals until session 2 renders them.
- **Motion:** this audit reads stills and numbers. In-game layers and fix-ups aren't in the sheets, and only the
  strafes were measured in the arena. `crouch_fire`, `prone_fire` and `pistol_draw` need a look in motion.
- **Small bodies:** feet sink up to 12.5 cm on the tiny bodies (`knocked_down`, `flying_back_death`). That comes
  from the body, not the clip, so no verdict rests on it, but it still needs a fix.

## Every clip that changes

### Replace

| Clip | Played | Why | Fix |
| --- | --- | --- | --- |
| `walk_left` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits +81 off. | Legs of walking_left, arms of walk. |
| `walk_right` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits -79 off. | Mirror of walking_left (walking_right itself goes -34), arms of walk. |
| `jog_left` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits +69 off. | Legs of running_left, arms of jog. |
| `jog_right` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits -80 off. | Mirror of running_left (running_right itself goes -32), arms of jog. |
| `run_left` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits +80 off. | jog_left's replacement played quicker (no sideways sprint exists). |
| `run_right` | yes | Runs side-on: measured in the arena, hips 83-103 degrees off the aim, chest 28-47. The chest in the clip sits -90 off. | jog_right's replacement played quicker. |
| `idle_v10` | yes | Starts and ends 45 degrees off aim while every other idle sits near 0, so it swings on every blend in or out. | Drop. Its pool stays at or above its minimum (see pool health). |
| `jump_up` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | unarmed_jump, cut 0.70-1.20 |
| `backward_jump` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. Also goes -149 by the baker's skew. | female_jump_running_backward (both genders have it) |
| `falling` | yes | Stiff near T-pose hangs in the air on every jump for its 10 s. falling_idle has the same job and a live silhouette. | falling_idle |
| `shooting_gun` | yes | Sheet confirms on all six bodies: the left arm does the pointing while the right (weapon) hand never leaves the thigh. 5.3s with a 1.5s wait. Wrong for engine:shoot; pistol_fire is the clean swap. | pistol_fire |
| `crouch_idle` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | ual_crouch_idle_loop |
| `crouch_walk_forward` | yes | The baker turned it by its chest, not its travel, so it runs off its name. Goes +57, on the engine's crouch_move. | crouch |
| `prone_idle` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. Rifle coverage may keep it. | prone_forward_stop, held on its last frame (no still empty-handed prone exists) |
| `hanging` | yes | Does not read as holding a line: hands are level with the head, and on m-tiny they vanish against it. hanging_by_hands_gently_swaying has straight arms overhead. | hanging_by_hands_gently_swaying |
| `punch_to_elbow_combo` | yes | 5s for a light; hips still leave the spot by 1.8m after travel is removed, and the hero starts and ends at the frame edge. Chest swings to +87 at the blow and ends 43 off aim. | short_hook_punch_to_the_head |
| `surprise_uppercut` | yes | The VICTIM of an uppercut: launched, ends spread-eagled. It is also the hard-coded heavy fallback. | long_hook_punch_to_the_head, in the kit and in meleeSet's fallback |
| `inside_crescent_kick` | yes | Dance-like spin. At the only kick still the chest faces the camera and the leg points away from the arrow, same on all six bodies. Arms-out start and end pose reads as a form, not a fight. | male_thrust_kick_with_the_lead_foot |
| `flip_kick` | yes | No readable kick at the aim, 1.2m off the spot after travel is removed, ends crouched with no recovery. Wrong for a light combo step. | double_front_snap_kick |
| `scissor_kick` | yes | Hero ends turned 176 degrees, facing away from the aim, after lying on the ground. Wrong for a light. | Drop. Its pool stays at or above its minimum (see pool health). |
| `hurricane_kick` | yes | Every still is hovering off the ground: no take-off, no landing, so it pops from stance into the air and back. Needs a clip with both ends or an engine hop. | roundhouse_kick_with_the_rear_foot |
| `spin_flip_kick` | yes | No kick visible in any still; over a second before anything happens, then an acrobatic floor roll. Ends side-on, 51 off aim. | martelo_2 |
| `back_flip_to_uppercut` | yes | 5.8s, hips 1.75m off the spot, the body leaves the cell at 2.5s. Listed in kicks heavy but finishes with a punch and has about a second of tail. | 360_leg_sweep_kick |
| `drop_kick` | yes | No extended kick on any of the six bodies; the legs stay tucked in every still (it may fall between 1.25 and 1.67s). Then about 1.2s on all fours and ends 78 off aim. | male_thrust_kick_with_the_rear_foot |
| `flying_bicycle_kick` | yes | 0.67s fragment of a clip: frozen about a metre off the floor with no take-off, landing or blow. Nothing like a heavy. | standing_melee_kick |
| `club_swing_strike` | yes | 6.9s for a light. From 2.96 to 5.93s the hero just stands with the bar hidden at the hip on every body, then pops back to the start pose. The swing falls between stills. | Drop. Its pool stays at or above its minimum (see pool health). |
| `club_knee_jab` | yes | 6s for a light; knee is held from about 2.5 to 4.3s, half a second of lead and nearly a second of tail. Club barely strikes. | Drop. Its pool stays at or above its minimum (see pool health). |
| `gs_great_sword_power_up` | yes | No release: hands spread only 0.12m in 3.5s and the stills barely differ. Fastest bone is a foot. Nothing for the engine to hang a cast on. | Drop. Its pool stays at or above its minimum (see pool health). |
| `ss_sword_and_shield_casting` | yes | Starts and ends 72 degrees right of aim on all six bodies (flag confirmed), square-on to the sheet camera while idle is not. Likely Skill 2 turned-away report. Use ss_sword_and_shield_casting_2. | Drop. Its pool stays at or above its minimum (see pool health). |
| `shooting_pistol` | yes | Reads as peeking round cover, not a shot: gun stays at the face, never extends, and the head turns toward the camera. Starts and ends 77 degrees right of aim (flag confirmed). | ual_pistol_shoot |
| `gunplay` | yes | 0.21s fragment with no visible motion and the gun at the neck, not on aim. No wind-up, nothing for the clock to map. | Drop. Its pool stays at or above its minimum (see pool health). |
| `fire_rifle` | yes | Crouched pose in standing-only slots (rifle fire, kit:rifle ranged): the hero would drop to a crouch to shoot. Duplicates crouch_rapid_fire. | Drop. Its pool stays at or above its minimum (see pool health). |
| `shoot_rifle` | yes | Legs are a run cycle (1.84m baked out). On a planted hero the feet run on the spot. | Drop. Its pool stays at or above its minimum (see pool health). |
| `pistol_whip` | yes | Listed as the pistol heavy but reads as a short two-hand reach with no whip arc, all six bodies; 0.75s of dead tail. Too small for a charged blow. | hook_punch_with_the_rear_hand |
| `throw_grenade` | yes | Prone clip in standing slots (thrown fire, summon, vision): hero would hit the floor to cast. through-body flag not visible on the f-huge sheet row. | Drop. Its pool stays at or above its minimum (see pool health). |
| `grenade_throw` | yes | Starts and ends crouched, 5.75s, 1.2s tail. Hero drops to the floor for a standing cast and the actual release is hard to find. | Drop. Its pool stays at or above its minimum (see pool health). |
| `run_and_throw_grenade` | yes | 9m of baked travel (flag confirmed). Legs run on the spot for 2.9s if the hero is planted. | Drop. Its pool stays at or above its minimum (see pool health). |
| `frisbee_throw` | yes | Spins 143 degrees and hips leave the spot by 0.92m; starts and ends 74 degrees right of aim (both confirmed). off-aim flag is partly false: the hand is near the arrow, side-on is the throw. | Drop. Its pool stays at or above its minimum (see pool health). |
| `throwing_dice` | yes | Seated in every frame with feet on the floor and nothing under the hips; 2.5s dead. Absurd in a ranged slot. | Drop. Its pool stays at or above its minimum (see pool health). |
| `magic_standing_1h_magic_attack_02` | yes | Dense frames show a wide spin that never squares up; rests 56 degrees off the aim. | Drop. Eight other magic shots remain. |
| `spell_casting` | yes | Starts and ends 67 degrees right of aim on all six bodies (flag confirmed), never squares up, swings about 135 degrees, hips move 0.8m. Likely Skill 2 turned-away report. | Drop. Its pool stays at or above its minimum (see pool health). |
| `charge` | yes | A pointing "charge!" command, mostly standing still, not movement. Wrong for kit:any movement; only usable as an emote. | Drop. Its pool stays at or above its minimum (see pool health). |
| `big_jump` | yes | Not a jump: a tumble that puts the head on the floor at 1.36 s and sits down, on all six bodies. | Drop. Its pool stays at or above its minimum (see pool health). |
| `flying_shoulder_throw` | yes | Partner clip with no partner: reads as being thrown, not throwing. 6.3m travel, 1.75m hip wander, ends mid-run. | Drop. Its pool stays at or above its minimum (see pool health). |
| `shoulder_throw_aggressor` | yes | 6.7s, hips 2.9m off the spot, grabs at empty air. Unusable without a victim. | Drop. Its pool stays at or above its minimum (see pool health). |
| `knock_off_assailant` | yes | Never stands, never strikes; a paired escape with no partner. Same on all six bodies. Not an ultimate. | Drop. Its pool stays at or above its minimum (see pool health). |
| `capoeira` | yes | A dance routine, not an ultimate: far too long and 1.35m of wander. Eight stills cannot show a usable window; pick one by eye in motion if wanted. | Drop. Its pool stays at or above its minimum (see pool health). |
| `standing_dodge_forward` | yes | The out-and-back C the owner rejected for the dash. | idle_to_sprint |
| `gs_great_sword_blocking` | yes | A 0.5 s raise, not a hold: loops twice a second with a 65 degree seam. | gs_great_sword_blocking_2 (steady 1 s hold, seam 0) |
| `hit_to_head` | yes | Not a hit reaction: starts in a running stride, flips, lands seated 4m away, with no recovery to stance. Hero would somersault from a head tap. | receiving_a_medium_hit_to_the_head_from_a_left |
| `stand_up` | yes | Starts seated at chair height, not on the floor: pops from any knockdown end pose. Then 2s dead standing. | Drop. Its pool stays at or above its minimum (see pool health). |
| `flying_back_death` | yes | Starts 99 degrees off aim, so never reads as hit from the front. Sheet: same on all bodies, and curled ending hugs the floor; sink flag (5cm) plausible but not clear. | Drop. Its pool stays at or above its minimum (see pool health). |
| `getting_thrown` | yes | Goes down then gets back up by 4.3s, so it is not a knockdown. Reads as half of a paired throw; 3.4m travel. | Drop. Its pool stays at or above its minimum (see pool health). |
| `jump` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. Only 1.2-2.2 is a jump; the rest is walking. | unarmed_jump |
| `sprint_forward` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | sprint |
| `sprint_forward_left` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Drop. The gait's run strafes cover it. |
| `sprint_forward_right` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Drop. The gait's run strafes cover it. |
| `sprint_backward` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Drop. run_back covers it. |
| `crawl_backwards_in_prone` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | crawling_backwards |
| `prone_right_turn` | yes | Does not turn, and holds the invisible rifle. | Mirror prone_left_turn for rifle heroes; drop for the rest. |
| `crouch_walk_back` | yes | The baker turned it by its chest, not its travel, so it runs off its name. | crouch_back |
| `crouch_walk_left` | yes | The baker turned it by its chest, not its travel, so it runs off its name. | crouch_left |
| `crouch_walk_right` | yes | The baker turned it by its chest, not its travel, so it runs off its name. | crouch_right |
| `aiming_gun` | yes | No aiming at any point: it bends double and stands about 90 deg off the aim. Reads as picking something up. | Drop. Its pool stays at or above its minimum (see pool health). |
| `gs_great_sword_impact` | no | No visible rock: hands spread 0.05m across dense stills. Pose does not match the end of gs_great_sword_blocking either. | Drop. The other guard hits cover it. |
| `pistol_aim_strafe_right` | no | Mirror of the left clip, so the grip flips: gun points well right of the arrow on all six bodies. Rebuild from pistol_strafe_right. | Drop. pistol_strafe_right remains. |
| `pistol_jump_2` | no | Labelled coverage:pistol land but has no landing: it is a duplicate of the running jump. | Drop. The other pistol land remains. |
| `rifle_aim_walk` | no | Not a walk: the hero falls down and stays down. | rifle_walk_forward |
| `rifle_grab_from_back` | no | Dense frames: the hand never reaches back. | Drop. rifle_switch keeps two. |
| `climbing_up_wall` | no | A climbing loop, not a mantle: no top-out, and it rises 1.23 m per cycle, so the seam flag is real if it loops. | Drop from mantle. The other three remain. |
| `jump_over` | no | Not a vault: the hands plant on the floor, not an obstacle, and it ends on its back then kneeling, on all six bodies. | jumping_over_into_combat, cut 1.2-3.0, the only true vault in the library |
| `running_forward_flip` | no | A clean flip, but the owner ruled the second jump is not a flip (2026-11-04). | Drop from doubleJump. The other three remain. |
| `gesture_2` | no | Male only, and the gesture does not read. | Drop. The emote pool keeps six. |

### Trim

| Clip | Played | Why | Fix |
| --- | --- | --- | --- |
| `standing_jump_running` | yes | The cut misses the jump. Clip 0.25-0.75 is run strides; the real leap and tuck is 0.62-1.08 in standing_jump_running, so "a running jump tucks" never shows. | MOVE_CUTS 0.62-1.08 (now 0.25-0.75), rendered on three bodies. |
| `left_strafe_jump` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. Also goes +128 by the baker's skew. | Re-bake to go left; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `right_strafe_jump` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. Also goes -128 by the baker's skew. | Re-bake to go right; splice the arms of unarmed_jump over it. No empty-handed side jump exists. |
| `standing_dodge_backward` | yes | After the hop it returns to the start pose; the engine cut already stops before that. | 0.10-0.95. |
| `cmu_dive_roll` | yes | Overshoots flat: last frames pitch head below feet, hands at floor, so prone takes over from a nose-dive rather than a flat body. | End the cut near 0.42 (now 0.50). |
| `jab_cross` | yes | Nearly a second of standing guard after the blow. Chest flag is normal cross rotation. | Cut 1.05-1.96. |
| `jump_attack` | yes | Holds the roar pose about 0.9s and ends 51 degrees off aim. Blow itself falls between stills. | Cut 2.90-3.79. |
| `pulling_up_to_a_ledge` | yes | Ends with arms pressed straight and legs below the lip, not "feet on top": the crouch on top comes about 3.3 s into the source. | Extend the cut to 0.6-3.3 (now 0.6-2.2), rendered: ends folded over the top. |
| `rifle_walk_crouching_forward` | yes | The baker turned it by its chest, not its travel, so it runs off its name. goes +32, named +0. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `rifle_jump_up` | yes | Arms do hold the rifle. Same 0-0.08 pop as jump_up. | 0.08-0.54. |
| `body_jab_cross` | yes | About 0.7s of standing guard after the blow. | Cut 1.40-2.08. |
| `uppercut_jab` | yes | Blows barely break the silhouette and 3.6s is long for a light; tail is dead guard. | Cut 3.05-3.58. |
| `knee_jabs_to_uppercut` | yes | 5.7s is far too long for a light; 0.5s lead and over a second of guard tail. Even trimmed it is about 4s. | Cut 0-0.50 and 4.55-5.67. |
| `elbow_uppercut_combo` | yes | Listed as the charged heavy but the arms never extend and the silhouette barely changes on all six bodies. Fine as a light, not a heavy. | Move to unarmed light. |
| `flying_knee_punch_combo` | yes | The leap is a good heavy, but it lands on hands and knees and ends mid-run. Cut point is not a stance so it needs a blend out. 3.8m travel must come from the engine. | Cut 1.60-2.67. |
| `slash_advance` | yes | About 0.7s of guard after the blow. Through-body flag not visible on m-tiny. | Cut 1.85-2.50. |
| `club_swing_single` | yes | 0.8s of dead hold before the swing, and it ends mid-stride with no stance to land on. | Cut 0-0.80. |
| `club_swing_double` | yes | About a second of slow lead, and it ends mid-stride. | Cut 0-0.95. |
| `club_swing_homerun` | yes | About a second of slow lead, and it ends mid-step. The swing itself reads very well. | Cut 0-0.90. |
| `ss_sword_and_shield_attack` | yes | Jump slam with 3.5m travel and 1.3m hip wander is listed as a shield light. Reads as a heavy; swap with ss_sword_and_shield_attack_4. | Swap with ss_sword_and_shield_attack_4: this one is the heavy. |
| `ss_sword_and_shield_attack_4` | yes | Listed as the charged heavy but it is the smallest clip in the shield set, feet planted. Good light; swap with ss_sword_and_shield_attack. | Swap with ss_sword_and_shield_attack: this one is the light. |
| `axe_standing_melee_attack_horizontal` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_attack_downward` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_attack_backhand` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_attack_360_high` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_attack_360_low` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_combo_attack_ver_1` | yes | Best staff fit of the axe set: both hands on the shaft at 1.33 and 2.00s on all bodies. Pop not visible. About 0.7s of tail. | Cut 3.95-4.67. |
| `axe_standing_melee_combo_attack_ver_2` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_combo_attack_ver_3` | yes | Listed under staff, but reads as a one-hand axe. No staff clip exists. | Move to an axe family (owner question 4). Clean as an axe clip. |
| `axe_standing_melee_run_jump_attack` | yes | Starts and ends about 2.5m from the landing spot, off the cell edge. Keep the leap and slam only. | Cut 0-0.50 and 2.70-3.67. |
| `axe_standing_taunt_battlecry` | yes | About 0.9s of nothing at the end. Pop flag at 0.46s is the arm throw, not a visible fault. | Cut 1.9-2.83s. |
| `pistol_aim` | yes | After 3s the hero drops the gun and pivots side-on, ending turned away. No discharge visible in the kept part: it is an aim hold, not a fire clip. | Keep 0-3.0s. |
| `rifle_punch` | yes | About 0.75s of stance after the blow. Hips 0.85m out and back. | Cut 2.00-2.75. |
| `bayonet_stab` | yes | About 1.4s of dead stance after the lunge. Stand-in bar points back, so the stab line cannot be judged from it. | Cut 1.80-3.25. |
| `rifle_turn_and_kick` | yes | Starts turned 119 degrees off aim, so it snaps at the blend. Start after the turn. | Cut 0-0.75 and 2.35-2.75. |
| `throwing` | yes | Long lead and 2.2s of standing after release (flags confirmed); hips move 0.77m in the wind-up. | Keep 0.5-3.4s. |
| `throw_object` | yes | The 1.7s floor pick-up only suits a real object; wrong for summon or vision casts. Dead stand at the end. Release itself is on aim. | Keep 1.7-4.05s. |
| `casting_spell` | yes | 5s in a low lunge before anything happens. off-aim flag is false: the hand is on aim (+5), side-on is the lunge. Ends back in the deep lunge, so entry and exit need blends. | Keep 4.4-7.2s. |
| `sprinting_forward_roll` | yes | The baker turned it by its chest, not its travel, so it runs off its name. Goes -39. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `running_dive_roll` | yes | Last 0.6 s is standing around. | 0-1.5. |
| `dive_roll` | yes | Slow start for a dodge: 0.34 s standing before it goes. | 0.34-2.04. |
| `aerial_evade` | yes | Lead and tail are standing. Ends 86 deg turned from its start: the 94 deg seam only matters if looped. Sink not visible. | 0.45-3.1. |
| `mutant_jump_attack` | yes | About 0.9s of held stance at the end. Pop not visible; near-twin of jump_attack. | Cut 2.85-3.71. |
| `standing_taunt_battlecry` | yes | Same data as axe_standing_taunt_battlecry. About 0.9s dead at the end. | Cut 1.9-2.83s. |
| `standing_dodge_left` | yes | The baker turned it by its chest, not its travel, so it runs off its name. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `standing_dodge_right` | yes | The baker turned it by its chest, not its travel, so it runs off its name. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `stand_to_roll` | yes | Slow in and out for a dodge. | 0.34-2.04. |
| `blocking` | yes | A 1.2 s arm pump, not a hold: the guard drops every loop. | Parry only; out of every block slot. |
| `body_block` | yes | A one-shot slip, not a hold. | Reaction only; out of every block slot. |
| `getting_up` | yes | 2.5s dead lying and 2.5s dead standing; 8.3s is unusable uncut. Rises cleanly. | Keep 2.4-6.0s. |
| `inverted_double_kick_to_kip_up` | yes | Starts standing, so as a get-up it pops from the floor. The floor-to-feet half is good. Hips travel far (1.36m). | Keep 1.6-3.21s. |
| `sweep_fall` | yes | 0.5s of nothing before the sweep; a reaction must read at once. | Cut 0-0.5s. |
| `prone_to_crouch_transition` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Rifle heroes only. |
| `prone_left_turn` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Rifle heroes only. |
| `prone_roll` | yes | Both hands stay locked a rifle's width apart, so an empty-handed hero carries an invisible gun. | Rifle heroes only. |
| `pistol_aim_walk` | no | The baker turned it by its chest, not its travel, so it runs off its name. goes +36, named +0. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `pistol_aim_strafe_left` | no | The baker turned it by its chest, not its travel, so it runs off its name. goes +127, named +90. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `pistol_aim_walk_back` | no | The baker turned it by its chest, not its travel, so it runs off its name. goes -141, named +180. | Re-bake with its way named, as the weapon loops are (scripts/rpm-anim.ts:508). |
| `step_up_to_jump_over_object` | no | Half a second of walking first. No hand ever lands on anything, so fine for a vault and wrong for coverage:mantle. Hand pop falls between stills. | 0.55-2.88. |
| `braced_hang` | no | First half is a jump-to-grab, not a hang (flags confirmed); only the tail is a hold, and it must loop. | Keep 0.7-1.29s, loop that. |
| `male_runs_up_a_wall_onto_a_platform` | no | Last 0.7 s holds a crouch. | 0-1.4. |
| `landing` | no | Long relaxed stand at the end. | 0-1.35. |
| `outward_block` | no | Over a second of plain guard at the end. Through-body flag not visible on f-huge. | 0.2-1.6. |
| `jumping_down_from_higher_level` | no | Pop at 1.5s is the landing impact, reads as intended. Dead time both ends (0.67s, 1.2s). Seam flag is moot for a one-shot. | Keep 0.6-2.6s. |
| `dance_1` | no | 1.5s and 0.8s of nothing around a small dance. | Keep 1.4-5.5s. |
| `gesture_1` | no | Dead stand both ends. Male only: sheet shows no clip for any female body (flag confirmed). | Keep 2.3-4.9s. |

### Keep

`walk`, `walk_back`, `jog`, `jog_back`, `run`, `run_back`, `idle`, `idle_2`, `idle_v1`, `idle_v2`, `idle_v3`, `idle_v4`, `idle_v5`, `idle_v6`, `idle_v7`, `idle_v8`, `idle_v9`, `ual_jump_land`, `idle_to_sprint`, `running_slide`, `spell_cast`, `hit_to_body`, `big_hit_to_head`, `falling_back_death`, `quick_roll_to_run`, `standing_block_idle`, `prone_forward`, `crouch_rapid_fire`, `rifle_prone_fire`, `fall_a_loop`, `standing_block_start`, `falling_to_roll`, `mid_air_falling_to_a_hard_landing`, `hanging_from_a_ledge_idle`, `left_shimmy`, `right_shimmy`, `braced_hang_to_crouch`, `rifle_idle`, `rifle_walk_forward`, `rifle_walk_left`, `rifle_walk_backward`, `rifle_walk_right`, `rifle_run_forward`, `rifle_run_left`, `rifle_run_backward`, `rifle_run_right`, `rifle_sprint_forward`, `rifle_sprint_left`, `rifle_sprint_backward`, `rifle_sprint_right`, `pistol_idle`, `pistol_walk`, `pistol_strafe_left`, `pistol_walk_backward`, `pistol_strafe_right`, `pistol_run`, `pistol_run_backward`, `rifle_idle_crouching`, `rifle_jump_loop`, `pistol_kneeling_idle`, `pistol_jump`, `lead_jab`, `cross_punch`, `hook_punch`, `right_hook`, `uppercut`, `elbow_punch`, `punch_combo`, `combo_punch`, `quad_punch`, `illegal_knee`, `mutant_punch`, `roundhouse_kick`, `side_kick`, `mma_kick`, `knee_kick_lead`, `flying_kick`, `double_dagger_stab`, `stabbing`, `stable_sword_inward_slash`, `stable_sword_outward_slash`, `thrust_slash`, `one_hand_sword_combo`, `dual_weapon_combo`, `two_hand_sword_combo`, `one_hand_club_combo`, `two_hand_club_combo`, `gs_great_sword_slash`, `gs_great_sword_slash_2`, `gs_great_sword_slash_3`, `gs_great_sword_slash_4`, `gs_great_sword_slash_5`, `gs_great_sword_attack`, `gs_great_sword_kick`, `gs_great_sword_high_spin_attack`, `gs_great_sword_jump_attack`, `gs_great_sword_slide_attack`, `gs_great_sword_casting`, `ss_sword_and_shield_slash`, `ss_sword_and_shield_slash_2`, `ss_sword_and_shield_slash_3`, `ss_sword_and_shield_slash_4`, `ss_sword_and_shield_slash_5`, `ss_sword_and_shield_attack_2`, `ss_sword_and_shield_attack_3`, `ss_sword_and_shield_kick`, `ss_sword_and_shield_casting_2`, `ss_sword_and_shield_power_up`, `axe_standing_melee_attack_kick_ver_1`, `axe_standing_melee_attack_kick_ver_2`, `axe_standing_taunt_chest_thump`, `firing_rifle`, `throw`, `fireball`, `magic_standing_1h_magic_attack_01`, `magic_standing_1h_magic_attack_03`, `magic_standing_2h_magic_attack_01`, `magic_standing_2h_magic_attack_02`, `magic_standing_2h_magic_attack_03`, `magic_standing_2h_magic_attack_04`, `magic_standing_2h_magic_attack_05`, `magic_heal`, `two_hand_spell_casting`, `wide_arm_spell_casting`, `magic_spell_casting`, `magic_standing_1h_cast_spell_01`, `magic_standing_2h_cast_spell_01`, `corkscrew_evade`, `sprint_to_backslide`, `magic_standing_2h_magic_area_attack_01`, `magic_standing_2h_magic_area_attack_02`, `standing_taunt_chest_thump`, `taunt`, `backflip`, `ss_sword_and_shield_block_idle`, `ss_sword_and_shield_crouch_block_idle`, `axe_standing_block_idle`, `magic_standing_block_idle`, `standing_block_end`, `standing_block_react_large`, `big_stomach_hit`, `big_side_hit`, `receiving_a_big_uppercut`, `knocked_down`, `fall_a_land_to_standing_idle_01`, `falling_to_landing`, `shoulder_hit_and_fall`, `running_jump`, `crouch_to_prone`, `running_slide_pose`, `rifle_aiming_idle`, `axe_standing_block_react_large`, `magic_standing_block_react_large`, `axe_standing_react_large_gut`, `ss_sword_and_shield_impact`, `pistol_aim_idle`, `pistol_ready_alert`, `pistol_aim_run`, `pistol_running`, `pistol_reload_walking`, `pistol_fire`, `pistol_aim_jump`, `pistol_running_jump`, `pistol_draw`, `rifle_idle_aiming`, `rifle_idle_crouching_aiming`, `rifle_crouch_walk`, `rifle_reload`, `rifle_reload_walking`, `rifle_reload_running`, `rifle_reload_crouching`, `rifle_reload_prone`, `rifle_jump_down`, `rifle_pull_out`, `rifle_put_away`, `freehang_climb`, `left_braced_hang_shimmy`, `right_braced_hang_shimmy`, `braced_hang_drop_to_standing`, `freehang_drop`, `drop_to_freehang`, `run_to_rolling`, `hanging_by_hands_gently_swaying`, `moving_while_hanging`, `diagonal_wall_run`, `wall_run_to_jump_pose`, `front_flip`, `stylish_flip`, `front_twist_flip`, `falling_idle`, `crouch`, `magic_standing_react_small_from_front`, `magic_standing_react_large_from_front`, `inward_block`, `high_center_block`, `swing_backflip_to_superhero_pose`, `male_cape_jump_down`, `male_hulking_giant_jump_down`
