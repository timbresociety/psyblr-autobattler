# My Hero Ultra Rumble: camera, dodge, jump, wall and melee, measured from footage

Date: 2026-11-04. Source: 16 YouTube clips of MHUR gameplay (list at the end). I stepped through them at 30 fps on contact sheets and listened with earshot. Every number names its clip (by video id) and its time `t` in seconds. Frame `k` in a strip means `t0 + k/30`.

How the numbers were taken:
- **Frame size.** Positions are fractions of the game frame: x of width W, y of height H, measured from the top-left. Pixel values are for a 1280x720 frame. Four 16:9 clips gave clean third-person frames: 7S0pfVy1JcQ, JAbX1vH-FZ4, rQ3avtCc5oQ and q-2lz7FnsAc/poqbDJLmKsw. Most vertical Shorts are cropped or zoomed, so I did not use them for framing.
- **Hero height (HH).** I use the hero's own height as the unit for distances.
- **Camera geometry.** Two things are known exactly from frames: the horizon height, and the squash of a round manhole cover on the road. From them I solved for the focal length. A second, independent route through the hero's head and feet gives the same answer.
- **Limits.** Input timing is visible only where the uploader overlaid a controller (oJDixZ1In1U). Almost every clip has music or voice-over mixed over the game. Sound findings are therefore partial, and I say so where it matters.

---

## 1. Camera framing (the "right shoulder" question)

### What is on screen

The reticle is a tiny white "+" with a gap, about 20 px wide at 720p. It sits at the exact screen centre (0.500 W, 0.500 H) in every clip. At 8x zoom it is centred on pixel (640, 360) in 7S0pfVy1JcQ t=31.0. It never moves; the hero is what sits off-centre.

| clip, t | hero centreline x | head top y | feet y | hero height on screen | camera pitch |
|---|---|---|---|---|---|
| 7S0pfVy1JcQ t=31.0 (Deku, running away from camera) | 520 px = **0.406 W** | 400 = 0.556 H | ~705 = 0.98 H | 305 px = **0.42 H** | about 1 deg down (horizon at y≈352) |
| JAbX1vH-FZ4 t=0.3 (standing) | 547 = 0.427 W | 367 = 0.51 H | 673 = 0.935 H | 0.425 H | 3–5 deg down |
| rQ3avtCc5oQ t=19.0 (standing) | 520 = 0.406 W | 360 = 0.50 H | 633 = 0.88 H | 0.38 H | slightly down |
| poqbDJLmKsw t=10.5 (Mirko, standing) | 527 = 0.41 W | 320 = 0.44 H | 633 = 0.88 H | 0.43 H | about 2 deg **up** |
| q-2lz7FnsAc t=3.0 (Mirko, camera aimed down a plaza) | 547 = 0.43 W | 400 = 0.56 H | 640 = 0.89 H | 0.33 H | about 18 deg down (horizon at y≈167) |

Across these clips:

- **The hero sits left of centre.** Their centreline is at **0.41–0.43 W**: 90–120 px left of the reticle at 1280 wide, or 0.07–0.09 W.
- **The hero is low in the frame.** The head top is at 0.50–0.56 H and the feet at 0.88–0.98 H. On level ground the hero is about **0.42 H tall**.
- **Where the reticle sits relative to the body.** It is about **0.08–0.09 W right of the hero's centreline**. Vertically it is level with the top of the head, or up to 0.06 H above it, depending on pitch. Measured from the hero's right shoulder (7S0pfVy1JcQ t=31.0: shoulder at about (575, 490)), the reticle is **65 px right and 130 px up**. In hero heights that is 0.21 HH right of the shoulder and 0.43 HH above it, which puts it about 0.13 HH above the head and to the right.
- **What a player perceives.** The reticle reads as hovering just above and outside the right shoulder. It never sits on the body and never sits far out in the scene.
- **The offset is camera-space, not body-space.** It stays the same whichever way the hero faces. In 7S0pfVy1JcQ t=29.9–30.5 the hero runs toward the camera, facing it, and is still at x≈0.38–0.41 W (sheet 03).

### The camera rig that produces this

These values were solved from 7S0pfVy1JcQ t=31.0. Sheet 01 is that frame with a 40 px grid.

- **Field of view.** The manhole at (770, 455) has a minor-to-major ratio of 17/105 = 0.163, so the ground there is seen at 9.4 deg below the eye. It is 95 px below centre, and the horizon is 1 deg above level. Solving gives a focal length of **f ≈ 575–630 px at 1280 wide**. That is a horizontal FOV of **about 90–96 deg** (vertical **about 60–63 deg**). The engine default of 90 deg horizontal fits.
- **Camera height.** The horizon (y≈352) cuts the scene above the hero's head (head top at y=400). The camera is therefore **≈1.15 HH above the ground**, which is ≈0.15 HH above the head top.
- **Distance.** Two routes give **≈1.9–2.0 HH horizontally behind the hero**:
  - The hero is 305 px tall with f≈600, so the hero is ≈1.92 HH away.
  - The feet are 30.5 deg below the horizon with the camera 1.15 HH up, which gives 1.95 HH.
- **Sideways offset.** The hero is 120 px left of centre at a depth of 1.95 HH. The camera is therefore **≈0.37–0.40 HH to the right** of the hero's centreline. For a 1.75 m hero that is ~0.68 m right, ~2.0 m above the ground and ~3.4 m back.
- **Pitch.** At neutral the camera is **level**: the horizon is within 1–2 deg of the screen centre while running on flat ground. Pitch follows the player's mouse or stick freely, from about 18 deg down (q-2lz7FnsAc t=3.0) to steep up-looks while wall-running (ZkFzh9Wbm0M, sheet 09). When pitched down, the hero shrinks on screen (0.33 H at 18 deg down), which is consistent with a boom that orbits a pivot near the head.
- **Check.** Putting a camera at (right 0.38, up 1.15, back 1.95) HH with a 61 deg vertical FOV and looking straight ahead predicts:
  - feet at y = 360 + 600·(1.15/1.95) ≈ 713 px (measured 705);
  - head top at 360 + 600·(0.15/1.95) ≈ 406 px (measured 400);
  - hero height 600/1.95 ≈ 307 px (measured 305).

### How the camera moves

- **Dodges.**
  - The camera follows position with a little lag. During a forward dash the hero drifts 0.18 HH further away before the camera catches up (7S0pfVy1JcQ t=31.2 → 31.567, sheet 10).
  - On a side dodge the hero gets pushed out to ~0.30 W before the camera recentres (7S0pfVy1JcQ t=31.6–31.83, sheet 04).
  - The camera does not rotate with the dodge; it keeps its aim.
- **Moving toward the camera.** The camera keeps its aim and backs away at the hero's speed. The hero's size stays nearly constant over 7S0pfVy1JcQ t=29.9–30.5.
- **Not measured.**
  - **Turns:** I found no clip with a clean, input-visible turn, so lag and lead on turns are unmeasured.
  - **Knockback:** I found no clip with the player's own hero being knocked back.
- **Ultimates** cut to a close-up cinematic camera, such as the All Might "???" close-up in oJDixZ1In1U at about t=5. This is a separate camera.

### Facing

- **Movement.** The body faces the **movement direction**. There is no backpedal and no strafe walk for these melee heroes.
  - In 7S0pfVy1JcQ t=29.9–30.5 the player moves "back" (toward the camera). Deku turns and runs facing the camera while the camera keeps looking down the street (sheets 03 and 04).
  - On a side dodge the body turns side-on toward the dodge direction (7S0pfVy1JcQ t=31.6).
- **Attacks.** Attacks home onto the target with a lunge (section 5). Whether the body snaps to the camera's aim on attack when no target is near could not be judged; every attack clip had a target in front.

---

## 2. Dodge

The three clearest dodges, all from 7S0pfVy1JcQ, Deku. This is a dodge-tutorial clip with voice-over.

**Dive-roll toward the camera (backward relative to the aim), t=29.267 (sheet 03, strip t0=29.10).**

| frame (t) | what happens |
|---|---|
| k=0–4 (29.10–29.233) | Normal run toward the camera. No crouch or wind-up before the dodge. |
| k=5 (29.267) | First dodge frame: the body is already low and pitched into a dive. |
| k=6–11 (29.30–29.467) | Tumbling on the ground. A large white air-crescent sweeps across k=8–11, and dust puffs are left behind. |
| k=12–16 (29.50–29.633) | Gets up: prone, then crouched, then rising. |
| k=17 (29.667) | Upright and running again. It goes straight into the run; there is no idle or stop pose. |

That is **about 12 frames (0.40 s) from the first dodge frame to running**. The body faces the dodge direction for the whole move, and the camera keeps its aim.

**Forward dash, t=31.233 (sheet 04, strip t0=31.20).**

| frame (t) | what happens |
|---|---|
| k=1 (31.233) | A small white ring appears at the hero's back. |
| k=2–5 (31.267–31.367) | The ring grows into a large white spiky starburst around the body for **4 frames**. |
| k=6–10 (31.40–31.533) | The hero dashes upright and leaning, with white streak afterimages. |

That is **about 10 frames** in all. The measured displacement over 31.2 → 31.567 is **≈0.9 HH**: the camera moved 0.74 HH (from the manhole's ground distance, 5.81 → 5.07 HH) and the hero moved 0.18 HH further from the camera. Treat the distance as low confidence, because the dash may begin before t=31.2.

**Side dodge left, t≈31.6 (same sheet, k=12–19).**
- The body turns side-on toward the left, low and leaning, with a white ground-streak trail.
- It lasts **about 8 frames**.
- **It starts 12 frames after the previous dodge started**, so dodges chain back to back with almost no recovery.

Other clips agree that **MHUR's dodge reads as a fast, low dash or dive with a white air-burst, not a slow tumbling roll**:
- _hpT72J-BC0 t=3.05–3.8 (strip): Deku's evasive dashes are blurred sprints with white speed streaks.
- rQ3avtCc5oQ t=21.967: a fire hero crouches for 1 frame and lunges sideways. A white glowing ring follows for ~5 frames (22.067–22.2), with dust.

**Invulnerability cue.** The white starburst or ring on the first 4–5 frames is the only visual cue I could see. There is no flashing or transparency on the body.

**Cancelling attacks.** Not shown with inputs in any clip. oJDixZ1In1U ("jump cancel tech") shows All Might cancelling the third melee hit with a **jump**, which suggests melee recovery can be cancelled by movement.

**Sound.**
- The 7S0pfVy1JcQ dodge at t=30.567 has a **hero vocal grunt 35 ms after the first dodge frame** (earshot: "spoken word", +32 dB over the bed).
- The rQ3avtCc5oQ dodge has a whoosh 74–140 ms after it starts. That clip has music over the game, so the offset is a weak reading.
- The 29.267 dodge was covered by voice-over.

---

## 3. Jump, double jump, air dash

Not measured. No clip in the set shows a clean, side-on jump on flat ground with a scale reference.
- 7S0pfVy1JcQ t=26.2–27.0 (strip `7S0pfVy1JcQ_jump_*`) shows Deku landing from height. There is a white shock ring at the feet for about 6 frames (26.2–26.37), and he is running by about k=7 (26.43). That suggests **landing recovery of about 6 frames even from a big drop**. It is low confidence, because the drop height is unknown.
- ZkFzh9Wbm0M t≈9.2–9.7: a "super jump" off a wall top with a burst VFX, landing on the roof about 0.5–0.8 s later.

Jump height, air time and second-jump shapes need a dedicated clip. A next pass should search for "mhur double jump" or "mhur air dash".

---

## 4. Wall run, climb, ledge

From ZkFzh9Wbm0M ("Wall Runner tips and tricks"), sheet 09 (10 fps, t0=7.40), and dZ24lX09yP4 (Shigaraki cliff dive):

- **The run up the wall.**
  - Running into a tall wall turns into an **upright run straight up the face**: feet on the wall, body nearly vertical, with a rainbow speed aura.
  - There is no grab or mantle pause, and **no ledge hang** in any clip.
  - In ZkFzh9Wbm0M the run lasts from **t≈5.3 to t≈8.9 (≈3.5 s) without stopping**, up a building whose window panes are about 1.5 HH tall each.
- **At the top.**
  - When the roof lip appears (k=15, t≈8.9), the hero does a **vault or super jump over the lip**, with a burst at the feet.
  - The camera swings from looking up the wall to looking across the roof.
  - She lands on the roof at about t=9.6–9.7. The total top transition is about 0.7–0.8 s.
- **Camera on the wall.** The camera pitches up to look along the wall. The hero stays bottom-centre-left, at about 0.42 W with the feet near 0.95 H.
- **Wall jump.** The tutorial caption at t≈12.3 says "jump during the wall run then immediately release your directional input". So a wall jump that kicks off the wall exists, and leaving the stick neutral matters.
- **Steep slopes and cliffs (dZ24lX09yP4 t=2.4–3.6).** A falling Shigaraki touches a steep cliff with a white dust puff on contact (t≈2.8). He immediately **runs up or along the cliff face**, sticking to it with no transition animation.
- **Not measured.** Wall-run speed in HH per second; the panes move too fast and blur at 30 fps on these sheets.

---

## 5. Melee

**Mirko melee loop (poqbDJLmKsw; sheets 05 and 06; strips t0=1.35 and 2.95).** This clip has the clearest hit timing.

| hit | contact frame (t) | damage number | wind-up visible before contact |
|---|---|---|---|
| light kick | 1.717 | "10" | purple swing arc from k=8 (3 frames before) |
| heavy spin | 2.383 | "44" | crouch, then a purple-white charge ring growing for **5 frames** (2.217–2.35) |
| light kick | 3.083 | "11" | swing arc for 3–4 frames |
| heavy spin | 3.683 | "44" | charge ring for 4–5 frames |

- **Hit spacing:** 20, 21 and 18 frames, which is **0.60–0.70 s per hit** in this loop.
- **Lunge:** Mirko closes about one body width onto the target during each light kick.
- **Hit-stop:** the attacker's pose holds for about **3 frames (≈100 ms) on light hits and about 4 frames on heavies**, while the sparks and the damage number keep animating. At 30 fps I cannot tell a true time freeze from a slow animation segment.
- **Damage numbers:** they pop in large on the frame after contact, shrink over about 3 frames, and stay for about 1 s.
- **Heavy hits:** they add a white swirl ring about 1.5 HH across, expanding for 4–6 frames.
- **Sound:** earshot puts an impact or whoosh **13 ms after** the 1.717 contact, 89 ms after 3.083 and 66 ms after 3.683. For 2.383 the game sound is buried under the music (−10 LUFS, music-led).

**All Might chain with a controller overlay (oJDixZ1In1U; sheet 08; strip t0=1.00).**
- **The only input-to-hit measurement in the set.** The button lights at k=10 (t=1.333). The swing blur and lunge run k=11–17, and the first contact flash and "19" appear at k=19 (t=1.633). That is **9 frames (0.30 s) from input to the first hit, including a lunge of about 1 HH** to the target.
- **Hits 2 and 3:** "24" at 1.967 (10 frames later) and "34" at 2.667 (21 frames later). Then the move goes into a super with comic "THOOM" text.
- **Sound:** earshot has an impact 3 ms after 1.967 and 33 ms before 2.667. At 1.633 the loud sound comes 105 ms early, on the swing rather than the contact.

**Toya combo (aJVmPROGBb8; sheet 07; strip t0=1.6).** The title translates as "dash melee 1, melee 1, melee 2 hits".
- **Dash-in:** k=0–4 (1.6–1.733).
- **Hits:** the first lands at **2.000** ("39"), then **2.667** ("78"), **3.333** ("117"), and the finisher at **3.633** ("185"). Single hits are 20 frames apart; the second hit of the 2-hit string lands 9 frames after the first.
- **Finisher:** a blue sphere of energy fills about 40% of the screen for 6 frames. The target is launched up and back from about k=18 onward (3.8–3.97 s).
- **Sound:** game audio sits under music. Earshot puts a whoosh 94 ms before the first hit and a "deep boom" 154 ms after the finisher frame.

**Not measured:**
- **Camera shake:** none visible at 320 px thumbnails. Effects are carried by VFX scale, comic text and damage numbers, not by obvious screen shake.
- **The target's own hit reaction:** the target flinches on every hit and flies on finishers, but I took no frame counts.

---

## 6. Moving and aiming

- **Facing:** the body faces the movement direction (section 1).
- **Run speed:** not measured reliably. The 7S0pfVy1JcQ stretch with a fixed ground reference is a chain of dodges, not a steady run.
- **Footsteps:** aJVmPROGBb8 t=1.01, 1.21, 1.57 show running steps 0.20–0.36 s apart. Music masks the rest.
- **Shooting heroes:** no frame study was done; eKOgEem07r0 and gdFbaPEZAP0 were only looked at in overview. In eKOgEem07r0 the reticle stays at the screen centre and the hero at the lower left, the same as the melee clips.

## 7. What else makes it feel snappy

- **No wind-up on dodges.** The first dodge frame is already the dive or dash (7S0pfVy1JcQ t=29.267 and t=31.233).
- **Recovery goes straight into a run**, about 12 frames after a dodge. Dodges can chain every ~12 frames.
- **Big, short white air-bursts:**
  - a starburst ring for 4 frames at dodge start;
  - an air-crescent for 4 frames mid-dodge;
  - a shock ring at the feet on landing for about 6 frames.
- **White streak afterimages** on dashes, and a rainbow speed aura on wall runs and boosted movement.
- **Damage numbers** pop large on the frame after contact. Big hits add comic onomatopoeia text ("SMAAASH", "THOOM", "SHUU").
- **Heavies telegraph themselves** with a growing charge ring for 4–5 frames; lights use a 3-frame swing arc. Hits land 0.6–0.7 s apart in a loop.
- **A vocal grunt** about 35 ms into a dodge, and impact sounds within about 1 frame of contact where the game audio can be heard.

---

## What to copy

**Camera framing first.** These are in hero heights (HH) and fractions of the screen; scale them to our hero.
1. Keep the reticle fixed at the exact screen centre.
2. Put the camera ≈**1.95 HH behind** the hero (horizontal), ≈**1.15 HH above the ground** (≈0.15 HH above the head top) and ≈**0.38 HH to the right** of the hero's centreline.
3. Look parallel to the aim, level at neutral pitch.
4. Use a vertical FOV of ≈**60–63 deg** (horizontal ≈90 deg at 16:9).
5. Check the result in a 1280x720 render. The hero's centreline should be at **x ≈ 0.41 W**, the head top at **y ≈ 0.50–0.56 H**, the feet at **y ≈ 0.88–0.98 H**, and the hero about **0.42 H tall**. The reticle should sit **≈0.08–0.09 W right of the centreline**, about level with or just above the head top: ≈65–90 px right of and ≈120–130 px above the right shoulder.
   - If our hero is smaller than 0.42 H, or the reticle sits much more than 0.09 W from the body, the camera is too far back or too far to the side.
6. Keep the offset in camera space. The hero stays left of centre even when running toward the camera.
7. Have the camera follow position with slight lag on dodges: the hero drifts up to ~0.1 W sideways or ~0.2 HH in depth, then recentres. Do not rotate the camera with dodges.

**Dodge.**

8. Start the dodge on the very next frame, with no crouch or wind-up. The dive or dash should be visible on frame 1.
9. Make it a fast, low **dash or dive in the input direction, with the body facing that direction**, not a slow roll. Use a dive-and-tumble for backward or toward-camera dodges, and a low side-on dash for sideways ones.
10. Total about **10–12 frames at 30 fps (0.33–0.40 s)** from start to running. End **directly in a run**, and allow the next dodge ~12 frames after the last one started.
11. Show invulnerability with a big white starburst or ring around the body for the first ~4 frames, white afterimage streaks for the rest, and dust puffs left at the start point.
12. Add a short vocal grunt about 1 frame after the dodge starts, plus a whoosh.

**Then the rest.**

13. Melee light hits: about a 3-frame visible swing arc before contact, a lunge of about 1 HH onto the target, and about 9 frames from input to the first contact including the lunge (All Might). Loop hits come every 18–21 frames, and a quick second hit can come 9 frames after the first.
14. Hit-stop of about 3 frames (≈100 ms) on lights and about 4 on heavies, with the VFX and damage number still animating. Heavies get a 4–5-frame growing charge ring and a swirl ring on impact.
15. The damage number pops large the frame after contact and shrinks over 3 frames. Put the impact sound within about 1 frame of contact.
16. Walls: running into a tall wall becomes an upright vertical run with no mantle. Auto-vault at the lip (~0.7 s up and over). There is no ledge hang. Jump during a wall run with a neutral stick to kick off.
17. Landing: a shock ring at the feet and back to running in about 6 frames.

---

## Contact sheets saved (`.scratch/mhur/sheets/`)

1. `01_framing_deku_7S0p_t31.0_grid.png`: full 1280x720 frame with a 40 px grid and cyan centre lines. This is the camera-geometry reference.
2. `02_framing_4heroes_grid.png`: 4 gridded frames (q-2lz7FnsAc t=3.0, JAbX1vH-FZ4 t=0.3, rQ3avtCc5oQ t=19.0, PWAtXCjMOBo t=3.0 fading).
3. `03_dodge_diveroll_7S0p_t29.10_30fps.jpg`: dive-roll toward the camera, every frame.
4. `04_dodge_chain_fwd_side_7S0p_t31.20_30fps.jpg`: forward dash with starburst, then a side dash, every frame.
5. `05_melee_mirko_poqb_t1.35_30fps.jpg`: Mirko light kick, every frame (crop).
6. `06_melee_mirko_poqb_t2.95_30fps.jpg`: Mirko light kick into heavy, every frame.
7. `07_melee_finisher_toya_aJVm_t3.20_30fps.jpg`: hit 3 and the finisher sphere, every frame.
8. `08_melee_allmight_input_oJDi_t1.00_30fps.jpg`: controller overlay to first hit, every frame.
9. `09_wallrun_top_ZkFz_t7.40_10fps.jpg`: wall run, then the vault over the top, at 10 fps.
10. `10_fwd_dodge_before_after_7S0p_t31.2_31.567.png`: before and after of the forward dash, gridded.

Full paths: `/Users/deepsheth/Documents/Claude/psyblr-autobattler/.scratch/mhur/sheets/<name>`. More strips are in `.scratch/mhur/strips/` and 3 fps overviews in `.scratch/mhur/ov/`. The videos (`v.mp4`) and audio (`a.wav`) are in `.scratch/mhur/<id>/`.

## Clips studied

Studied frame by frame:
- https://www.youtube.com/shorts/dZ24lX09yP4: Shigaraki cliff dive (wall and slope run, combo)
- https://www.youtube.com/watch?v=7S0pfVy1JcQ: "How To Dodge attacks", a 186 s regular video, not a Short (framing, dodges, landing)
- https://www.youtube.com/watch?v=poqbDJLmKsw: Mirko melee loop (melee timing, framing)
- https://www.youtube.com/watch?v=oJDixZ1In1U: All Might jump-cancel tech, with a controller overlay (input to hit)
- https://www.youtube.com/shorts/aJVmPROGBb8: Toya melee string and finisher
- https://www.youtube.com/watch?v=ZkFzh9Wbm0M: Wall Runner tips, 104 s (wall run, vault, wall jump)
- https://www.youtube.com/watch?v=_hpT72J-BC0: Advanced Movement and Fighting Guide (Deku evasive dashes)
- https://www.youtube.com/watch?v=rQ3avtCc5oQ: "Dodge" (dodges, framing)
- https://www.youtube.com/watch?v=q-2lz7FnsAc: Mirko combos (framing, side hops)
- https://www.youtube.com/watch?v=JAbX1vH-FZ4: Aizawa combo (framing)

Looked at in overview only:
- https://www.youtube.com/watch?v=TGOWqHbYx9s: Mt. Lady dodge
- https://www.youtube.com/watch?v=2SmNafom9rk: Todoroki combo
- https://www.youtube.com/shorts/eKOgEem07r0: Deku aiming
- https://www.youtube.com/shorts/gdFbaPEZAP0: flick shot
- https://www.youtube.com/shorts/jTmvFKDF6jA: rooftop triple down
- https://www.youtube.com/shorts/Y51xDwL9jBA: Shoto speed race (vertical crop, not usable for framing)

Downloaded and triaged, not used: PWAtXCjMOBo, UdJD2itCf10, a0fpSXlsC_w, dBku0o0Az4U.

YouTube search mostly returns long videos, so several of the useful clips are short regular videos rather than Shorts.
