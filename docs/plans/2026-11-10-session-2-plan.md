# Session 2 plan: build the locked kit, and John's test lab

Owner's brief, 2026-11-10:

> Create a way for me to test all possible character kit interactions on John: a character called John, one of every
> weapon, ranged and melee, and every skill and R interaction. Sessions 3 and 4 fix the cosmetics, so by the end of
> session 2 all traversal and combat mechanics must work properly.

**Exit:** every row of the lab's checklist works on John, in the owner's hands, on the current map. Looks don't
count yet. A plain mesh, stand-in effects and stand-in clips are fine, as long as the mechanic behaves right.

Generation tools the owner gave: ChatGPT for images, Gemini Omni Flash for video, and Tripo for anything 3D.

## John

- **Mesh:** the owner's Tripo model `eb703f54-06d5-4bda-a001-d137fa657ecc`, rigged in Tripo (Humanoid, Mixamo
  preset) and rebound to our skeleton (`src/kit/bench/rebind.ts`), like the audit heroes. The file stays in
  `.scratch/tripo-in/john/`.
- **Every size and set (owner, 2026-11-11):** "when I said John I meant a John character that covers all sizes and
  sets so I can test each one." The lab switches John between all six size classes (tiny to colossal) in either gender,
  each physique, and each attitude set (neutral, brute, swagger, low, strut), live, with no reload. The rebound mesh is
  one of those bodies; our own bodies cover the rest. Every checklist row is run on at least the smallest, the medium
  and the largest John, and on each attitude.
- **Body checks:** the owner's local audit heroes stay switchable in the lab. A mechanic that works on John but breaks
  on a big or a small body gets fixed in session 2 too.

## One weapon per family (owner: the most popular in each)

| Hand | Family | Weapon | Mesh |
| --- | --- | --- | --- |
| V | Paired | Twin short swords | 1, used twice |
| V | With a shield | Arming sword and round shield | 2 |
| V | Fists | Bare fists | none |
| V | Kicks | Bare feet | none |
| V | One-hand edge | Katana | 1 |
| V | Two-hand edge | Greatsword | 1 |
| V | Chop and reap | Scythe | 1 |
| V | Smash | Warhammer | 1 |
| V | Thrust | Spear | 1 |
| V | Staff spin | Bo staff | 1 |
| V | Flexible | Whip, rigged as a bone chain with rope physics (owner's choice) | 1 |
| LMB | Body emitter | Eye beam | none |
| LMB | Thrown | Kunai | 1 |
| LMB | One-hand gun | Pistol | 1 |
| LMB | Paired guns | Twin pistols | the pistol, twice |
| LMB | Long gun | Assault rifle | 1 |
| LMB | Heavy gun | Rocket launcher | 1 |
| LMB | Bow | Recurve bow and quiver | 2 |
| LMB | Magic, one hand | Wand | 1 |
| LMB | Magic, two hands | Mage staff | 1 |

That's 18 meshes from Tripo, about 1,100 credits. Each gets grip and carry sockets (session 1's leftover rig-socket
step) and sits in the carry slot the solver picked (GAME.md §4, "Where weapons are carried").

## The lab: `/dev/john`

- **Where:** John on the current map, with a dummy, an enemy bot, an ally bot, a ledge, a column, a zipline, a wall
  and a jump pad within a few steps. The bots can be set to block, fire a beam, stand still or fight.
- **Body panel:** size class, gender, physique and attitude set, as above.
- **Loadout panel:** pick any V family, LMB family, Q family, E kind, F aura and R shape. The change applies at once,
  with no rebuild, and weapons stow and draw through their carry slots (done 2026-11-11: eight slots measured off
  each body's own skin, `src/kit/body/carry.ts`).
- **Checklist:** one row per interaction. The owner marks each pass or fail with a note, and the marks persist locally.
  The rows:
  - V: each family × the full moveset (light chain, charged heavy, guard, dash attack, air attack and slam, launcher
    and juggle, grab and throw).
  - LMB: each family × every firing mode (single, burst, spread, beam, full auto, charge) and every flight type
    (straight, beam, cone, lobbed, bouncing, returning, homing).
  - Q: all 11 families, each on the dummy, the enemy and the ally where it applies.
  - E: every kind, plus the four enhanced shared moves (Wall Run, Combat Roll, Power Slide, Zipline).
  - F: every aura, as a toggle with its own meter.
  - R: all 8 shapes, including Kit switch, Titan summon, the Strike lock-on and Rally's mass revive.
  - Systems: team-ups, fusion, beam clash, the spendable power meter, ability charges, hold-to-charge on LMB and Q.
  - Traversal with weapons out: hang, shimmy, climb, mantle, zipline, wall run, slide, jump pad, each one stowing both
    weapons.
  - Crossings: each weapon pair the carry solver moves off its first slot; R Kit switch mid-combo; F aura during an R
    form; a hold-to-charge cast cancelled by a Counter.
- **Automated sweep:** a headless pass drives every row through the seat (`seat-and-replay`) and logs engine events
  (hit landed, state entered, no exception). It makes contact sheets for the rows a picture can judge. The owner's
  marks remain the exit; the sweep catches regressions between their checks.

## The rest of session 2

1. Re-cut the catalogue (`src/charter/templates`, 307 entries) onto the locked library.
2. Build the new pieces in GAME.md §4 marked "New" (V moveset, LMB modes and flights, Q families, E kinds, F meter, R
   shapes, systems, jump pads).
3. Fix sinking bodies, per audit call 5: hips move by leg length, feet are levelled, and ground poses are lifted by each
   body's depth. Judge the fixes on the audit heroes.
4. Build the strafe splice, and make the audit's clip trims and swaps.
5. Map it to bodies and roles: the clip per size class, default kits per role, and which weapon families each body may
   hold.
6. Session 1 leftovers: rig sockets and attitude sets are done (2026-11-11, below); render quality remains.

**Done 2026-11-11 (session 1 leftovers the owner closed first):**

- Deep links: the deploy serves the app for `/range`, `/lobby`, `/match/...` on a reload (`vercel.json` fallback).
- Carry slots: `back_r`, `back_l`, `back_flat`, `lower_back`, `hip_l`, `hip_r`, `thigh_l`, `thigh_r`, measured off
  every body's skin and every generated hero's.
- Attitude sets from the clips we have: the library's style walks don't carry their style (the 100STYLE takes slouch
  and stop whatever their name), so an attitude is a layer on the rest pose (tips, arms, bent knees), bigger hip and
  chest swing on the gait loops, a stride beat, and brute's heavy landing. Feet are kept on the floor frame by frame
  under bent knees; moves down at the floor and hanging play without the layer. Floor sheets: every move on every set
  within 2 cm of neutral, on the medium body and on John.

**After session 4 (owner, 2026-11-11):** what the library can't give gets a custom animation pipeline: clips of each
attitude's own (a brute's walk, not a walk with a brute's posture), idles and poses per set, styled strafes, and
clean replacements for the broken style takes.

**Clips still missing:** staff, thrust and flexible come from the owner's phone recordings through video-to-motion.
Until those arrive, each family runs on the nearest stand-in clip, and its checklist rows stay "stand-in clip".
