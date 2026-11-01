# Canon: the Psyblr Human, controls and combat

**Status: strict canonical source of truth.** Set by the owner on 2026-10-31. Where anything in this repo, in an
earlier plan (including `2026-10-30-forge-goal-plan.html`) or in code conflicts with this document, this document
wins. Change it only by the owner's say-so, and date every change.

Part 1 is the owner's spec, kept in their words. Part 2 is the approach agreed in the brainstorm the same day and the
order of work. Part 3 is the delta from today's code.

---

## Part 1. The owner's spec (verbatim)

### Art target

> Anime realism but not so ugly. I want it to achieve FC 26 level of depth in realism in characters, movement and
> environment. Anime level of animation and visual bursts in skills and ultimate. Basically live action anime combat.
> Not exactly cartoonish like My Hero Ultra Rumble / Sparking Zero.

### Third person control (action, binding)

| Action | Binding |
| --- | --- |
| Movement | W / A / S / D |
| Jump | V |
| Double jump | Double V |
| Dodge and roll ahead in the facing direction | Z |
| Dash and sprint | Left Shift (tap dashes forward; held sprints) |
| Crouch / stand (build crouch movement as well) | C |
| Prone / stand (build prone movement as well) | Left Control |
| Melee attack | Space bar tap |
| Melee attack combo | After three successful melee attacks, keep tapping Space |
| Heavy melee attack | Hold Space and release to launch a charged melee attack |
| Skill 1 | Left click (shoots based on attack speed and power) |
| Skill 2 | Q |
| Movement skill | E |
| Passive skill on / off | F to toggle |
| Ultimate | R |
| Melee block | X (breaks a melee combo and blocks damage) |
| Zoom to first person | Right mouse button held zooms in; released returns to third person |

### Slot semantics

- **Basic attacks are melee.** Punches, kicks, melee weapons. They combo like an RPG and have two variations, basic
  and heavy, like most fighting games.
- **Skill 1 is a ranged attack.** Guns, ki blasts, ranged weapons.
- **Skill 2 is a spell-like skill.** Heal, control, shield, and the like.
- **Movement skill** is a custom movement-based skill.
- **Passive skill** is toggled and gives an enhancement.
- **Ultimate** is special, with custom animations.

### Combat rules

- **Heavy melee.** A charge stance and an action stance. Gives a short flying knockback whose peak height equals a
  jump.
- **Melee combo.** First melee action, second melee action, then a heavy melee action. A 3x melee combo finish gives
  a massive flying knockback whose peak height equals a double jump.
- **Invulnerability.** You are invulnerable for a split second during a dodge roll, and while not in control during a
  knockback.
- **Regaining control.** Pressing any key during a knockback regains control but removes invulnerability; you come
  down as a normal jump descent.
- **Jumps.** Jumps need to be dynamic and big in height; current jumps are too small and all equal. Jump height is a
  function of character size, so large or tanky characters can't jump as high as light or tiny ones. Jumps feel like
  anime combat.

### Character-specific combat animation, by slot

- **Skill 2, movement skill and ultimate:** study popular third-person hero shooters (Deadlock, Marvel Rivals), 3D
  brawlers (My Hero Ultra Rumble, Dragon Ball Sparking Zero) and similar third-person hero games.
- **Skill 1 (ranged):** study every shooter mechanic across 3D RPGs, brawlers and shooters, across weapons and ki
  blasts. The animation depends on what the skill is; power, damage and attack speed must be balanced.
- **Melee:** study unarmed and weapon-based basic attacks across 3D fighting games and RPGs.

### The Forge creator (added 2026-10-31, afternoon)

> Stop doing this AI slop stuff. This character looks nothing like the expected Jensen. Please fix the forge to be as
> detailed and accurate like FC 26 creator, it even allows advanced sculpting. Seriously don't stop until you get
> FC 26 level of creator experience. User will come and give instructions in natural language and some image
> references; our forge should give a stylised accurate in-game character from it.

ChatGPT, Google Flow and Mixamo are open in the owner's browser for this work.

### Rig, motion and budget

- Mixamo is approved. Rigging must be detailed enough to carry full-body motion so custom animation stances later
  don't feel broken: the level of detail WWE or FC follow, enough for proper anime combat and basic facial gestures.
- Asset budget is not a problem. Assets can be generated or purchased, but must not break the art style.

---

## Part 2. The agreed approach

### Diagnosis (from the 2026-10-31 brainstorm)

Every complaint traced to one foundation: a MakeHuman low-poly proxy mesh, a 20-bone rig with no fingers, twist or
facial bones, and combat clips typed as pose numbers in `tools/blender/humanlib/clips.py`. Locomotion felt fine
because it is Ready Player Me motion capture; combat felt broken because it is not mocap at all. Eye colour did
nothing because the MakeHuman bodies bake one `eye` region and the picker tints an `iris` region those bodies don't
have. Body shape stops at five morphs because only weight, muscle and age are exported, while the face already
exports a basis of dozens of targets. Hair is a procedurally lifted scalp shell, which no tuning turns into card hair.

### The Psyblr Human contract

One canonical human. Everything targets it and nothing is rigged per asset, the way MetaHuman and FC's player
skeleton work.

- **Skeleton:** Mixamo naming, so Ready Player Me, Mixamo and Tripo's auto-rig all speak it, plus twist bones on
  upper arm, forearm, thigh and calf, full fingers, jaw and eye bones. Source of truth: `src/kit/rig/standard.json`.
- **Topology:** MakeHuman's full base mesh rather than the game proxy, with head and hands on their own UV space.
- **Face:** the 52 ARKit blendshapes baked from MakeHuman expression targets.
- **Body:** region sliders exported from MakeHuman targets the way the face basis already is.
- **Motion:** mocap only. Ready Player Me for locomotion, Mixamo and purchased packs for combat, retargeted once.
  Runtime layering on top: upper-body additive casts, foot IK, hand IK that grips the weapon.
- **Hair:** a curated set of around fifteen card-based styles with alpha, flow and ID textures.
- **Shading:** skin subsurface approximation, an eye shader with cornea refraction and parallax, a hair card shader.
- **Generative AI** supplies likeness from photos, face sculpt, outfits and textures on the standard body, weapons and
  props as rigid pieces, and the charter. It never supplies bodies, rigs or animations.
- **Hardware floor:** an M1 MacBook Air with 8 GB at 1440 by 900 Retina. Twenty heroes in a fight.

### The creator goal: a likeness, not a mannequin

What the owner saw on 2026-10-31: the reference is a stylised portrait of Jensen Huang with grey swept hair, a
leather jacket and a broad, strong-jawed face, and the Forge produced a bald MakeHuman mean head wearing a photo
patch. Three things are missing, in order of how much they cost the likeness:

1. **Head shape.** The fit uses 39 MakeHuman target groups against front-view landmarks only, so every head stays
   near the mean. MakeHuman ships about 290 face targets (eyes 68, nose 42, mouth 44, chin 15, cheeks 16, forehead
   8, ears 44, head 27, brows 6, neck 20). The fit moves to the full set, paired left and right, and to landmarks
   with depth (MediaPipe's z), with a side view when the player gives one. Judged by landmark error and by a
   side-by-side with the reference, every time.
2. **Hair, glasses and outfit.** Half of a likeness is silhouette. A v2 body wears nothing until the wardrobe is
   re-pointed, so phase 3 moves ahead of the combat kernel.
3. **Texture and shading.** A clean, evenly lit, front-on stylised portrait generated from the player's references
   (ChatGPT) projects far better than a raw photo; a side view fills the cheeks and jaw. Skin, eye and hair shaders
   follow in phase 5.

The creator's surface then grows to FC 26's depth: every face target group becomes a slider in its region (head,
forehead, brows, eyes, ears, nose, cheeks, mouth, jaw and chin, neck), on top of whatever the references fitted, and
the chat takes natural-language changes ("stronger jaw", "greyer hair") as patches to named parts.

Done when a hero made from references reads as that person to the owner, in the studio and in a fight.

### Kept and replaced

Kept: the engine's prep / release / recover timing, the wardrobe's surface binding and physics chains, sockets, the
face landmark fit, the charter and the balance gate.

Replaced: the proxy mesh, the 20-bone rig, the scripted combat clips, the scalp-shell hair, and the control scheme.

### Order of work

Each phase ends with the test suite green, and from phase 1 on, with the soak test on the Air.

0. **Canon and contract.** This document, the rig contract and its tests. Done 2026-10-31.
1. **Psyblr Human v2.** One gender built in Blender on the contract. Existing Ready Player Me clips and a handful of
   Mixamo combat clips retargeted. A vertical slice: one hero, one gripped weapon, three combat moves, measured on
   the Air. This is the performance go or no-go.

   *Status 2026-10-31: built, bar the Mixamo clips.* `tools/blender/human2.py` builds a body on MakeHuman's full
   mesh (26,756 triangles) with its Mixamo rig and weights completed to the contract (`humanlib/standard.py`: 76
   bones, twists weighted along each segment, finger tips, jaw, eyes). `public/heroes/v2/m-medium.glb` is the first,
   and `V2_BODIES` in `character-look.ts` lists which bodies load from v2. The motion library is retargeted onto it
   with fingers and eyes (`scripts/rpm-anim.ts --rig standard`, `public/anim/standard/`). The client runs both rigs
   through `src/arena/client/rig.ts`, solves the twist bones every frame and curls the fingers of a hand holding a
   piece. Verified by eye in the Forge studio, the loadout and the training ground (face, glasses, katana grip, run
   and strafe), and by the probe's node positions. A two-minute 20-hero soak on this Air with the two v2 heroes in it
   held a 16.7 ms median, 18.7 ms at the 95th percentile and 34.0 ms at the 99th. Deviations: a v2 body wears no
   wardrobe item yet (the items are bound to the old proxy surface; phase 3), so it stands in its base layer; the
   female body and the other sizes follow the same script once the wardrobe is re-pointed; the Mixamo combat clips
   are not downloaded yet, so casts on a v2 body fall back to the stance until they land.
   *Later the same day:* all twelve bodies are rebuilt on v2 (`V2_BODIES` lists them all), the glasses socket sits at
   the eyes clear of the bridge of the nose, and the library is retargeted for both genders. The wardrobe is carried
   onto the v2 skin from the first body before binding (`src/kit/fit/retarget.ts`), hiding items are pushed out of
   the skin, buried parts are tucked rather than dropped, and footwear hides the whole foot: the skin no longer shows
   through trousers and boots.
2. **The creator: likeness and sculpting.** (Moved ahead on 2026-10-31.) The full-target, depth-aware face fit in
   Blender and in the browser; the wardrobe re-pointed to the v2 surface so hair, glasses and outfits return (the
   old phase 3); the sculpt panel over every target group; reference images cleaned into stylised portraits; and a
   likeness review page with the reference beside the result for every starter.
   *Status 2026-10-31, evening: the first pass is in.* The Blender and browser fits run on the full target set (200
   groups, ears included) with depth, at a ridge of 1e-5; the v2 face basis lives in `public/kit/v2/`. The wardrobe
   is refitted onto the v2 surface (`public/kit/wear2`) and the kit's fit, fields and cloth take bone names from the
   body's rig. The v2 eyeballs carry an iris region the look's eye colour tints. The sculpt panel spans ten regions
   and 98 sliders. Jensen in the Forge now carries his breadth, jaw, dark eyes, parted grey hair, glasses and jacket
   (`docs/forge/2026-10-31-creator.html`). Still to do: card hair and brows, stylised skin shading, a generated side
   view for the profile, and the chat's natural-language patches to named parts.
   *Later the same day:* the chat patches named parts (`src/forge/patch.ts`: "a much stronger jaw, whiter hair and
   a bigger nose" nudges the sculpt, shades the hair and reads back what changed). The owner's review: the hair
   parting is nothing like Jensen's, and the hair, beard, body, outfit and gear libraries are far too thin against
   FC 26 and WWE 2K26. The study of both creators and the library and foundation plan that follows is
   `2026-10-31-creator-library-plan.md`; it leads with authored card hair and per-part body morphs on the base.
3. **Combat kernel.** The control scheme above in the engine: melee light / light / heavy combo and finisher, heavy
   charge, block, dodge roll with i-frames, knockback with any-key regain, size-scaled jumps, crouch, prone, sprint
   and first-person zoom. Deterministic, parity-tested between AI and human, then a gate retune.
4. **Re-point the rest of the kit.** Sockets and body sliders on the new surface. A real iris region.
5. **Animation library.** Per-slot libraries built from the reference games above, with grip IK, foot IK and additive
   layers. Every skill template maps to a mocap clip, never a scripted pose.
6. **Look.** The hair set, the three shaders, and the environment to FC depth.
7. **Director and acceptance.** The automatic anime camera, then the full soak and a visual review.

---

## Part 3. Delta from today's code

- **Bindings** (`src/arena/client/input.ts`): today Space jumps, Shift dashes, C slides, F is the movement skill,
  left click is the basic attack and Q / E are the actives. All change to the table above. Left Control is reserved
  by the old comment because Ctrl+click is a right click on a Mac; pointer lock in the arena takes the mouse, so the
  binding stands as specified, and the engine treats Ctrl+W as prone plus forward.
- **Slots** (`src/charter/types.ts`): the six slot names stay, but their deliveries are fixed by slot. Today the 301
  templates assign deliveries freely, so the charter's per-slot pools must be reclassified and the gate retuned.
- **Jumps** (`src/arena/engine/calibration.ts`): one jump height for every size becomes a function of size class.
- **New engine state:** combo step, heavy charge, block, dodge i-frames, launched-with-regain, crouch and prone
  stances, sprint.
- **Rig** (`tools/blender/humanlib/rig.py`, `public/anim/index.json`): the 20-bone set is replaced by the contract.
  The old names map onto it (`legacy` in `standard.json`) so existing clips retarget without re-export.
