# John Rated Rumble: the game

**Status: APPROVED by the owner, 2026-11-02.** Once approved, this is the only spec. Anything in code, comments or `docs/archive/` that disagrees with it is wrong. Only the owner changes it, and every change is dated in the changelog at the end.

The rework is planned from this file and built in a fresh session after approval. Until then, no code changes.

---

## §1 Identity

**Name:** John Rated Rumble.

**Fantasy:** you generate any character you can imagine: anime, superhero, fantasy, myth, pop culture. It pops out of a **gacha machine** onto an exaggerated arcade-casino battlefield and fights.

**Art target.** The owner's words from 2026-10-31, kept:

> Anime realism but not so ugly. I want it to achieve FC 26 level of depth in realism in characters, movement and environment. Anime level of animation and visual bursts in skills and ultimate. Basically live action anime combat. Not exactly cartoonish like My Hero Ultra Rumble / Sparking Zero.

**Environment target:** hyperreal stylized anime. A Shibuya arcade parlour crossed with a casino. Exaggerated objects and a platformer-like battlefield, with the scale and readability of Hypercharge: Unboxed.

**Toy scale (owner, 2026-11-04).** The heroes are action figures in a real casino and pachinko parlour, "Honey, I Shrunk the Kids" in both third and first person: one scale, 1:15, for every real object (a hero is a 12 cm figure, a roulette table top is 11.25 m up, a pachinko machine a 12.75 m glass wall, a chip stack a staircase). Reference: docs/reference/2026-11-04-toy-casino.png, which shows the objects, layout and daylight: roulette, chips, cards, dice, slots, a pachinko wall, stools, ball trays, boxes, a stepladder, the cashier counter, and a zipline across. It is drawn in **hyper-real shaded anime in pastel tones**: the palette below in its pastel range, on real materials. The plan is docs/plans/2026-11-04-feel-and-toy-casino.md.

**Not wanted:** flashy neon, or the dark gold over-the-top casino look. The owner's layout reference image is right about **layout** and wrong about **art**.

### Palette: Retro Japanese Game Center × Hypercharge realism (owner, 2026-11-02)

The place is a 1990s–2000s Japanese amusement arcade with real materials, enlarged into a colourful, detailed combat playground. It is not cyberpunk, not neon Tokyo and not a dark casino. Hypercharge looks the way it does because of believable everyday objects, vibrant surface colours and exaggerated player-to-object scale.

**Material colours.** These are physical surface colours, never emissive light.

| Colour | Hex | Used on |
| --- | --- | --- |
| Warm porcelain | `#E9E3D7` | Arcade cabinet shells, walls, vending machines |
| Graphite | `#30383F` | Monitor casings, machine frames, railings |
| Vermilion red | `#D44137` | Racing cabinets, Japanese signs, combat landmarks |
| Arcade yellow | `#EABB43` | Gacha machines, prize graphics, traversal indicators |
| Cobalt blue | `#3569AB` | Fighting cabinets, carpeting, major signage |
| Jade mint | `#70A99B` | Crane machines, prize counters, decorative trims |
| Oxblood | `#78464D` | Carpet, booth upholstery, retro lounge flooring |

**Wings:**

- **Fighting Arcade:** ivory and graphite cabinet bodies, red and blue marquees, burgundy carpet, steel footrests. Dense arcade graphics give the richness.
- **Prize & Gacha Hall:** porcelain white, jade green, mustard yellow, clear acrylic. Plush toys, capsules, oversized prizes and glossy moulded plastic.
- **Pachinko & Betting Wing:** cream, vermilion, brushed champagne metal, deep red upholstery. Intricate machine faces, without turning the space into a light show.

**Lighting:**

- Neutral-white overhead fluorescent panels at 4500–5000 K.
- Natural shadows and subtle ambient occlusion.

**Materials:** realistic ABS plastic, powder-coated metal, textured carpet, acrylic, glass, slightly scuffed enamel.

**Grading:**

- Neutral contrast, warm highlights, slightly cool shadows.
- No purple or teal cinematic wash.

**Emissives:** only screens, indicator buttons and machine displays.

**Anime stylization:**

- Clean silhouettes and slightly exaggerated proportions.
- Controlled specular and restrained edge definition.
- No heavy cartoon outlines.

**Discipline:**

- 60% neutral architecture, 30% saturated machine colours, 10% screens, signage and small highlights.
- The arcade is colourful because the objects are colourful, never because the lighting is.

**Scale:**

- A red racing cabinet becomes a building.
- A row of capsule machines becomes a platforming district.
- A giant white crane machine becomes a transparent multi-level combat structure.

**What this means for rendering (§10):** overhead fluorescent light suits baked lightmaps and light probes, plus one shadowed key light. The look and the MacBook Air budget want the same thing.

---

## §2 Match formats and core loop

| | |
| --- | --- |
| **Final target** | Battle-royale scale: up to **100 players** a match, **squads of 1 to 10**. Every engineering decision is sized for this, from rendering and simulation to netcode and map size. |
| **First playable test** | **10 v 10** on House of Instinct (§8). |
| **Dev harness today** | 3 v 3 against AI, kept for fast iteration. |
| **Who you fight (for now)** | AI bots, all on the player's own machine in the browser. Online multiplayer comes in a later phase (decided 2026-11-02). |

**AI difficulty.** There are three levels:

| Level | What it is |
| --- | --- |
| **Hard** | Today's bots, which are too strong for most players |
| **Normal** | Slower reactions, less accurate aim, fewer combos and blocks, worse target choice |
| **Easy** | Slower again, and it rarely uses skills on cooldown |

The default is Normal. Each level is a set of AI tuning numbers (reaction time, aim error, how often it blocks or dodges, how well it uses skills), never extra health or damage.

**How a match is won (owner, 2026-11-02).** Three rules work together:

| Rule | What it does |
| --- | --- |
| **Win** | The last squad standing wins. Nobody respawns. |
| **House edge** | A shrinking zone closes in over the match and hurts anyone left outside it. It pulls fights together across levels, not only across the floor. |
| **Jackpot** | The House Vault holds a jackpot. The squad that cracks and holds it gets a team buff, which pulls fights into the lower levels. The jackpot can be stolen. |

All three hold in the 10 v 10 test and at battle-royale scale.

**Core loop:** create a character → gacha reveal → Forge the kit → lobby → drop in → fight → result → back to the Forge.

---

## §3 Controls

The canon's table, with the owner's change of 2026-11-02: **jump is Space, melee is V.**

| Action | Binding |
| --- | --- |
| Move | W A S D (or the arrow keys), relative to the camera |
| Jump / double jump | Space / Space again in the air |
| Melee combo | **V** tap, chaining: 1st, 2nd, 3rd hit, the 3rd knocks back |
| Heavy melee | **V** hold, release to land the charged blow |
| Block | X (breaks the attacker's combo and blocks damage) |
| Ranged (Skill 1) | Left click |
| Spell (Skill 2) | Q |
| Movement skill | E |
| Passive on / off | F |
| Ultimate | R |
| Dodge roll, the way W A S D steers (ahead with no key held) | Z |
| Dash / sprint | Left Shift tap / hold |
| Crouch / stand (crouch at a run slides) | C |
| Prone / stand | Left Control |
| First-person aim | Right mouse held |

---

## §4 The kit: the slots are the buttons

Every hero has exactly one item per row. Rows don't overlap, and together they cover the whole kit.

| Button | Slot | What it is | Animation |
| --- | --- | --- | --- |
| V tap ×3 | **Melee combo** | A **weapon style**, not a template. The style sets the clips, reach, contact frames and lunge; damage comes from the role's weapon damage. The 3rd hit knocks back. | 3 custom, from the style |
| V hold | **Heavy** | The style's charged blow | 1 custom |
| X | **Block** | The style's guard | 1 custom |
| LMB | **Ranged** | The ranged library: pistol, rifle, thrown, magic one- or two-handed. Ki Blast, Energy Wave and the like live here. | 1 custom, by ranged style |
| Q | **Spell** | **Everything no other row covers** (§4, the spell universe): control, displacement, zones, constructs, summons, ally support, curses, burst spells, vision and tricks | 1 custom |
| E | **Movement skill** | Dash, blink, leap or grapple | 1 shared clip, its own VFX |
| F | **Passive toggle** | Every self-buff, state and **transformation** (forms, resizes), on an energy meter | 1 shared clip for on and off, its own VFX |
| R | **Ultimate** | An overpowered move on a long cooldown. It can be any kind of effect, scaled up. | 1 custom clip, massive VFX |

**Shared by every hero:** idle, walk, jog (normal movement), run (sprint), jump, double jump, mantle, fall, land, dodge roll, crouch slide, dash, crouch and crouch-walk, prone and crawl, hit reacts, knockdown and get-up.

**Roles.** The 8 roles stay: tank, fighter, assassin, mage, marksman, support, controller, summoner. A role sets the stat sheet and which library items it may take.

### Typing rules

The engine enforces these, so a wrong item can't be stored in a slot:

- Melee holds only a weapon style.
- Ranged holds only things that fire from the hand or a weapon, on repeat.
- Q holds nothing melee and nothing self-only.
- F holds nothing that reaches anyone else.
- E holds only things that move the caster.

### Libraries, from the clips we have today

**Melee styles (V)**

| Style | Light clips | Heavy clips | Block | Notes |
| --- | --- | --- | --- | --- |
| Unarmed | 16 | 3 | any-style | Punches, elbows, knees |
| Kicks | 7 | 6 | any-style | |
| Blade (one-hand, daggers) | 6 | 2 | any-style | |
| Greatsword | 7 | 3 | own | Also 2 cast clips |
| Sword + shield | 7 | 3 | own (2) | Also 3 cast clips |
| Axe / staff | 5 | 5 | own | Club folds in here until it has its own clips |

**Ranged styles (LMB)**

| Style | Clips | Takes in |
| --- | --- | --- |
| Pistol | 4 | Sidearm, silenced pistol |
| Rifle | 4 | Rifle shot, burst fire, railgun, crossbow, longbow |
| Thrown | 8 | Throwing knives, kunai, darts, bolas, grenade-type shots |
| Magic, one- and two-handed | 9 + fireball | Ki Blast, Energy Wave, Arcane Bolt, Magic Missile, Frost Shard, Chain Spark, and the like |

Shotgun cones are a ranged fire mode (pellets).

**Today's melee "basic" templates retire into the styles.** These are Twin Daggers, Iaido, Combo Strikes, Claw Rake, Chain Whip, War Hammer, Heavy Strike, Shield Bash, Anchor Chain, Staff Strike, Psy Lash, Spell Kick, Rifle Butt and Wrench. An on-hit rider they carried, such as a slow or a bleed, becomes a passive (§4 F) or is dropped.

**Q: the spell universe (owner, 2026-11-02).** Q holds every spell that isn't one of the other rows:

- not melee (V);
- not ranged repeat-fire (LMB);
- not a self-buff or transformation (F);
- not movement (E);
- not an ultimate (R).

That makes Q a complete, non-overlapping universe of its own, drawn from Deadlock, 3D anime brawlers and superhero powers, limited only by the clips we can play. **Ranged vs Q:** ranged fires again and again at the weapon's fire rate; a Q spell is one cast on a cooldown, even when it's a damaging bolt.

Each spell has exactly one family, its main purpose:

| # | Family | What it does | Examples (inspiration) |
| --- | --- | --- | --- |
| 1 | **Control** | Takes away an enemy's actions | Stun bolt, root snare, silence sigil, sleep mist, fear, taunt, blind flash, disarm lash |
| 2 | **Displacement** | Moves *other* bodies | Chain hook pull (Scorpion), repulse wave, telekinetic lift (Magneto), knock-up updraft, position swap (Paradox), gravity well |
| 3 | **Zone** | Denies ground for a while | Fire field, poison cloud, frost field (slow), time dilation, darkness or smoke, lightning storm patch |
| 4 | **Construct** | Builds geometry | Wall or barricade, ice pillar, ice bridge or ramp (Kelvin, Iceman: traversal on the vertical map), dome, ally portal pair (Doctor Strange) |
| 5 | **Summon / deploy** | Leaves something that acts | Turret, totem, trap, mine, drone, shadow clone or decoy (Naruto) |
| 6 | **Ally support** | Helps *others* | Heal burst, ally shield, cleanse, haste or empower on allies, tether heal, revive pulse |
| 7 | **Curse** | Weakens a target over time | Mark, vulnerable, armour shred, anti-heal wound, hex, damage-over-time brand |
| 8 | **Burst spell** | One big hit on a cooldown | Fireball, lightning lance, comet, energy beam (Kamehameha-style), meteor fist shockwave |
| 9 | **Vision** | Information and its denial | Reveal pulse, scout drone, echo ping through walls, flash, smoke |
| 10 | **Trick** | Bends the rules of a fight | Projectile reflect barrier, counter sigil, spell steal, swap health, rewind an ally |

**Shapes.** Every spell has one: projectile, beam, cone, line, targeted zone, aura around the caster, tether, or placed object.

**Clips.** These come from the cast families we have:

- 9 magic casts;
- one- and two-handed magic attacks;
- 2 area attacks;
- 8 throws;
- the power-ups and weapon casts on greatsword and sword+shield.

New clips come in from §12.

**Library build (rework):**

1. Sort today's spells into the 10 families.
2. Fill each family to at least 4 spells.
3. Spread them across roles.
4. Fix one clip and one VFX for each.

**The 11 melee strikes that were in Q** become spells in these families, as listed below. A strike that stays a pure strike belongs to melee and is cut.

| Today (strike) | Becomes (spell) | What it does | Clip family |
| --- | --- | --- | --- |
| Haymaker | **Force Palm** | Close cone: push and stun | magic 1h attack |
| Rising Uppercut | **Updraft** | Small zone at the target that knocks up | magic 2h attack |
| Backstab | **Shadow Lunge** | Short blink to the target, then mark it | cast + dodge |
| Venom Blade | **Venom Dart** | Projectile: poison over time | throw |
| Nerve Strike | **Paralysis Needle** | Projectile: root and slow | throw |
| Silencing Strike | **Hush Sigil** | Projectile: silence | magic 1h cast |
| Expose Weakness | **Expose** | Projectile: vulnerable mark | magic 1h cast |
| Crippling Blow | **Crippling Hex** | Projectile: slow movement and attacks | magic 1h cast |
| Disarming Strike | **Disarm Lash** | Short beam: disarm | magic 2h cast |
| Rending Strike | **Rend** | Cone: armour shred and bleed | magic 2h attack |
| Sunder | **Ground Sunder** | Line zone: armour shred and slow | greatsword / sword-shield cast |

Names and effects are a proposal (open question 5).

**Self-only actives move to the passive (F) library.** These are Berserk, Blood Rage, Counter Stance, Second Wind, Unstoppable Fury, Evasive Dance, Shadow Realm, Vanish, Arcane Surge, Mana Shield, Chrono Rewind, Overdrive, Rapid Reload, Overclock, Iron Skin, Shield Wall and Unbreakable Will. They join today's passives.

**Passive energy meter (owner, 2026-11-02).**

- Each passive has its own meter, shown on the HUD. It drains while the passive is on and refills while it's off.
- When the meter runs dry, the passive switches itself off.
- It never costs health, and it never blocks an action.

**Transformations are passives.** Forms and resizes are switched on with F and run on the same meter, so a transformation lasts as long as its energy does:

- super forms, avatar forms and titan forms;
- shrink;
- a giant body;
- an elemental body.

A transformation can carry several buffs at once:

- a bigger or smaller size, which changes the hit capsule and reach;
- speed, armour, damage or lifesteal;
- a change in look.

The ultimate can still hold a form that is stronger and short, on its long cooldown.

**Movement skills (E):** today's movement library, with its common clip family and per-skill VFX. These are dash, blink, leap and grapple.

**Ultimates (R):** an overpowered move on a long cooldown, with any kind of effect scaled up. Today's ultimates go here. Each gets a custom clip: the 6 "any" ultimate clips, 2 magic area attacks, the axe jump attack, and new ones from §12.

**Balance.** There are no hand-made heroes. Balance runs on **generated kits**: role × melee style × ranged × spell × move × passive × ultimate, sampled and simulated toward a 45–55% win band.

---

## §5 Combat rules

**Melee**

- Combo windows come from each clip's contact and recovery frames. An early tap is buffered, never dropped.
- **Pace (2026-11-04, after Sparking Zero and MHUR):** light hits chain at the weapon style's own beat (about 0.37 s a step), never slowed by attack speed. Attack speed sets how much damage each hit carries, so damage a second is the same, and a hero quicker than the beat chains quicker still. Holding V shows its wind-up from early in the hold.
- Magnetism and lunge toward the target in front, then hit-stop on contact.
- **Knockback, per the canon:**
  - the 3rd combo hit sends the target as high as a double jump;
  - a full heavy, as high as a single jump.
- **Block (X)** breaks the attacker's combo and blocks the damage. A heavy breaks the guard.
- Hit reacts by where the hit landed (head, body, big hit). Knockdown leads to a get-up.

**Invulnerability and control**

- A split second of invulnerability during the dodge roll, and while out of control in a knockback.
- Pressing any key during a knockback regains control but ends the invulnerability; you come down as a normal jump.

**Ranged**

- Shots leave the **muzzle socket**.
- The crosshair converges on what it covers, so what the reticle sits on is what gets hit.
- Fire rate follows attack speed. Ammo and reload apply.
- Bloom grows while moving or in the air.
- First-person aim on right mouse.

**Air**

- Every attack works in the air.
- Air control while airborne.
- Ordinary map heights never deal fall damage.

**Jumps (canon)**

- Big, dynamic, anime-sized.
- Height depends on body size and mass, so heavy bodies jump lower than light ones.

**Physics**

- Knockback arcs.
- Mass changes how far a hit pushes.
- Bodies stop against walls, ledges and props, and can break props (§6b).

---

## §6 Effects land where they happen

| Effect | Plays at |
| --- | --- |
| Cast flash | The hand or weapon socket, on the clip's **release frame** |
| Projectile | Leaves the muzzle socket |
| Impact | The contact point on the victim |
| Melee spark | Where the weapon tip meets the victim's hit capsule |
| Zone | The ground at its centre |
| Buff, state, aura | The body |

Nothing is centred on the torso by default.

---

## §6b Impact and destruction: the 3D anime brawler feel

Big hits must visibly change the world.

**Blasts.** Each one is layered:

1. an anticipation flash;
2. a shock ring;
3. a smoke and dust plume;
4. debris chunks;
5. sparks;
6. a lingering haze.

Five tiers, by what caused it: light hit, heavy, combo finisher, spell, ultimate.

**Hit feel:**

- hit-stop;
- camera shake and kick;
- radial blur and speed lines on heavies and ultimates;
- an anime impact-frame flash on ultimates.

**Ground:**

- crater decals plus displaced rubble where heavies, slams and ultimates land;
- skid marks from knockback slides;
- scorch, frost and other elemental marks.

All of them fade on a budget.

**Breakable props.** Chips, cards, dice, capsules, glass, cabinet panels, signs and railings shatter. They are pre-fractured, so nothing fractures at runtime. Knocking someone into a prop breaks it.

**Gameplay vs cosmetic:**

- **In the engine (deterministic):** cover and the bridges or platforms the map marks as breakable, such as a collapsible card bridge. Their health builds on today's cover health.
- **On the client only:** debris and every other cosmetic breakage.

**Rule:** destruction never removes the only route to a position (§7, rule 2).

**MacBook Air budget:**

| Item | Budget |
| --- | --- |
| Live debris chunks | ≤ 300, pooled |
| Live decals | ≤ 64 |
| Particles | GPU particles |
| At distance | Effects drop to a lower level of detail |

---

## §7 Traversal, designed first

**Baseline movement.** Every character has these. These are targets until they're measured in-engine, and the map spacing is tuned to the measured values.

| Move | Target |
| --- | --- |
| Jog (normal) | 6.5 m/s |
| Run (sprint) | 8 m/s |
| Jump | ~1.5 m rise |
| Double jump | ~2.7 m total rise |
| Dash | ~3.5 m burst |
| Auto-mantle | Ledges up to ~1.4 m |
| Air control | Yes |
| Fall damage | None at ordinary arena heights |
| Dodge | Short grounded evasion |

Size and mass scale jump height (§5).

**Base traversal moves (owner, 2026-11-02).** Every character gets these:

- **mantle and ledge climb:** pull up onto ledges up to about 1.4 m, automatically;
- **drop down and landing roll:** step off a ledge on purpose, and roll on landing after a big fall so you keep your speed;
- **ziplines and rails** placed in the map, such as the Chandelier Spine: fast, but you're exposed while riding.

**Wall-run and ledge hang (owner, 2026-11-03).** On marked surfaces only (arcade yellow, §1):

- **wall-run:** every character runs along a marked wall for a fixed short stretch; a passive (F) lets its holder wall-run without limit;
- **ledge hang and climb-up:** catch a marked ledge, hang from it and pull up; shimmy along the edge only if a smooth animation exists for it.

Not included: jump pads ("rather than floating platforms or arbitrary jump pads"). Movement skills (E) can add shortcuts, but no important area may need one.

**Five design rules:**

1. **Baseline movement reaches every major platform.** No rare ability is needed just to take part.
2. **Every strong position has 2–3 routes in:** stairs, a jump chain and a side flank.
3. **Levels overlook each other**, so fights flow across levels instead of sitting in isolated pockets.
4. **Platforms read at a glance.** Can I land there? Can I jump from here to there? Is it a safe route or a risky shortcut? Arcade yellow marks traversal (§1).
5. **The riskier route is the faster one.** Strategic betting, embodied as movement.

---

## §8 The first map: House of Instinct

Built at the §1 toy scale (2026-11-04): the bands below are the heights real furniture reaches at 1:15, and every route is made of real casino and parlour objects. The exact layout is ours to decide. The principles below are fixed. Every major casino or arcade object is part of one **connected traversal network**: no disconnected floating platforms, and every route visibly reachable.

**Four elevation bands.** Every change of band has stairs, a ramp or a reachable platform chain.

| Band | Contents |
| --- | --- |
| Aerial routes | Chart Climb, the Chandelier Spine |
| Upper balconies | NFT Gallery, Chip Stack Balconies, VIP Crescent |
| Main floor | Roulette Court and the wings |
| Lower routes | Diamond Mines, House Vault, Crypto Catacombs |

**Zones and their traversal grammar:**

| Zone | Grammar |
| --- | --- |
| **Roulette Court** (centre) | A huge circular floor with a raised central platform. Four outer entrances, two stair routes up, chip-stack shortcuts, a balcony loop above, a service tunnel below. |
| **Card Hall** | Giant reinforced cards as ramps and bridges; poker tables as broad fighting platforms; dealer stations as cover and stepping stones. Sprint up the card ramp → jump the gap → land on the table → jump to the upper walkway. |
| **Chip Stack Balconies** | Chip stacks as stairs: 0.75–1.2 m steps, 1–2.5 m gaps, some joining permanent balconies. Jump → mantle → double jump → balcony. |
| **Slot Canyon** | Fights *between* giant slot machines, which have side ledges, maintenance stairs and overhead bridges. Side stair → maintenance ledge → gap jump → upper catwalk. |
| **Pachinko Spire** | A central cylindrical tower: spiral service ramps, ring landings, connecting bridges. Not every decorative pin is jumpable. Spiral ramp → ring platform → lateral jump → high bridge. |
| **Gacha Arcade** | Capsule-machine roofs and cabinet platforms, plus the crane machine as a transparent multi-level structure. |
| **VIP Crescent** | Curved balcony routes, glass partitions, lounge combat, strong flank routes. |
| **NFT Gallery** | Glass walkways and sculpture plinths. |
| **Chart Climb** | A rising series of candlestick platforms, the risky way up. |
| **Diamond Mines / House Vault** | Rock ledges, mine-cart roofs, broken bridges and scaffold stairs. Tunnels give sheltered flanks; exposed bridges are faster. The vault door is the landmark and the objective space. |
| **Crypto Catacombs** | Service corridors, server-room walkways, stairwells. Low-visibility tactical fights. |
| **Chandelier Spine** | A suspended traversal line across the map. Risky but fast, built for cinematic fights; the premium movement layer. |

Props: scratch cards, dice, slot machines, pachinko, gacha capsules and crash-style graph bars.

**Three route classes across the same arena:**

| Class | Example | Character |
| --- | --- | --- |
| **Safe** | Card Hall → Main Staircase → VIP Balcony → Pachinko Spire | Long but predictable; minimal jumping |
| **Fast** | Card Hall → Chip Stacks → Card Bridge → Upper Balcony → Spire | Faster if executed well; exposed while jumping |
| **High-risk** | Chart Climb → Chandelier Gantry → Suspended Bridge → Spire | Fastest. Small landings, little cover, big fall exposure. |

**Starting dimensions.** These are generous on purpose: precision platforming must never make attacking and dodging frustrating.

| Geometry | Size |
| --- | --- |
| Standard combat platform | ≥ 5 × 5 m |
| Jumpable chip platform | 2.5–3 m diameter |
| Standard gap | 2–3 m |
| Advanced gap | 3.5–4.5 m |
| Traversal bridge | 1.5–2 m wide |
| Balcony walkway | 3–4 m wide |
| Card ramp | 20–25° |
| Combat headroom | ≥ 4 m |

**First deliverable, in grey boxes:** Roulette Court → Chip Stacks → Card Ramp → VIP Balcony → Chandelier Route. It is tested with the real controller, camera, air attacks, collision and pursuit **before any art**. If that sequence is fun in grey, it becomes the traversal grammar for every other zone.

**Scale:** the full map must hold 100 players (§2). The 10 v 10 test may use a cut-down version.

**Map tech the layout needs:**

- full 3D collision: walkable tops, ramps, ledges, ceilings;
- ledge detection for mantle;
- an AI navmesh with jump, mantle and drop links;
- occlusion by zone and by level, so one band hides another.

---

## §9 The metarig: the body under the head (first priority)

**Priority (owner, 2026-11-02).** The metarig and its animation library come **first** in the rework, before the kit, map or effects reach polish. The goal is one skeleton system that carries every human-like character from roleplaying, anime and superhero fiction, in both genders and every size. Animations play smoothly on all of them, through the full range of motion, with proper muscle and jiggle, and with body parts working together the way each clip intends.

**Not now:** hair movement, cloth waves, outfits, tails, wings and beast skeletons.

### 9.1 The head is a separate, fixed object

- The head is **its own mesh**, generated per character where a character needs special attention (likeness, an anime face, a helmet head). It attaches at a standard **neck socket** on the body.
- **The neck socket standard:**
  - socket position and orientation on the Neck bone;
  - collar radius by physique;
  - a blend ring that hides the seam;
  - skin tone matched to the body.
- **The head's own rig:** Head, Jaw, LeftEye and RightEye, plus the 52 ARKit face blendshapes for expressions and speech.
- **Up close it must hold up** (Forge zoom and the gacha reveal):
  - real eyeball meshes (sclera, iris, pupil, a cornea with wetness and highlight);
  - lids that close over the eyes;
  - teeth and tongue;
  - brows and lashes as cards;
  - pores and normal detail on a 2K head texture at the near level of detail.
- **Bug to fix: googly eyes.** In the Forge the eyes show skin colour when they move. Round 3 dropped the eyeball triangles and kept only eyes painted on the closed skin, so when the eye bones or blinks move, skin shows where eyes should be. The fixed head object with real eyeballs replaces that workaround.

### 9.2 The skeleton under the head

Today: 6 core, 8 arm, 8 leg, 8 twist, 30 finger, 3 face and 13 end bones, with Mixamo names (`src/kit/rig/standard.json`). The proposal keeps every existing name, so clips keep working, and adds three kinds of bone that **clips never key**:

| Kind | Bones (each side where paired) | Driven by | Why |
| --- | --- | --- | --- |
| **Root** | `Root` at the ground under the hips | Animation root motion | Lunges, dashes and root-motion retargeting stay correct at every size |
| **Twist** (exists) | Upper arm, forearm, thigh, calf | A share of the child's roll | Wrists and knees don't candy-wrap |
| **Muscle helpers** | Trapezius, deltoid, pectoral, latissimus, biceps, triceps, forearm, glute, quad, calf | The joint angle they bulge with, scaled by that region's muscle dial | DBZ volume holds and bulges as joints rotate; weight is 0 on lean bodies |
| **Corrective helpers** | Shoulder, elbow, wrist, hip, knee, ankle | Joint angle | Big bodies don't collapse or pinch at joints |
| **Jiggle** | Breast (both sides), glute (both sides), belly, plus a subtle chest pad on muscular males | A spring-damper on the bone's world acceleration, after the clip | Secondary motion (§9.4) |
| **Sockets** | Hand_R and Hand_L props, back, hips, muzzle, weapon tip | The parent bone | Weapons, effects (§6) and two-hand IK |
| **IK targets** | Foot_L/R, Hand_L/R virtual bones | Solved at runtime | Feet planted on uneven platforms, hands on two-handed grips |
| **Neck** | Neck plus an optional `Neck1` | Animation | Long or thick necks, big traps; carries the head socket |

**Ranges of motion.** The rework fixes a joint-limit table per bone (degrees per axis). IK, look-at and procedural layers respect it, and the test bench (§9.7) flags any clip that breaks it after retargeting.

**Weights.** The body mesh is skinned to these bones once, in Blender. Helper influence is a per-vertex weight times a per-physique dial, so a lean body gets no helper effect without a second skin.

### 9.3 Physique: Structure × Volume

**Structure** (bone lengths and placement):

| Dial | Covers |
| --- | --- |
| Height | ~1.0–2.6 m choosable; Titan scale only by transformation |
| Head-to-body ratio | Chibi-leaning small bodies through realistic 7.5 heads to heroic 8.5–9 heads |
| Leg length, arm length, torso length | Long-limbed heroes to stocky dwarves |
| Shoulder width, chest depth, rib-cage width | Superhero V-taper to narrow builds |
| Hip width, pelvis tilt | Female and male pelvises, posture |
| Neck length and thickness | Long necks to bull necks |
| Hand size, foot size | |
| Posture | Upright, heroic chest-out, hunched brute, elderly stoop |

**Volume** (mass and shape):

| Dial | Covers |
| --- | --- |
| Body fat | Lean through heavyweight |
| Overall muscle | Soft through DBZ |
| Regional muscle | Traps, delts, pecs, arms, forearms, abs and obliques, lats, glutes, quads, calves |
| Muscle definition | A normal-map blend for abs and striations, at no triangle cost |
| Bust size, shape, spacing and lift | Adult bodies only |
| Waist, hips, glutes, thighs, belly | Hourglass, pear, apple, athletic |

**Fantasy coverage.** These presets ship first; every dial stays free on top of them.

| Archetype | Roleplaying | Anime | Superhero |
| --- | --- | --- | --- |
| Small (child-proportioned) | Halfling | Detective Conan | Kid sidekick |
| Lanky | Elf mage | Waluigi-like tall and thin | Mister Fantastic |
| Slender agile | Rogue, ranger | Naruto, Luffy | Spider-Man |
| Athletic hero | Paladin | Zoro, Goku (base) | Captain America |
| Anime heroine | Sorceress, valkyrie | Nami, Tsunade, Erza | Wonder Woman |
| Athletic heroine | Huntress | Mikasa | Black Widow |
| Caped powerhouse | Warlord | All Might | Superman |
| Bodybuilder | Barbarian (Conan the Barbarian) | Broly, Goku (super forms) | Hulk |
| Heavyweight | Ogre-like brute | Chōji, Big Mom | Kingpin |
| Stocky | Dwarf | Hiei-short-and-dense | Wolverine |
| Giant | Half-giant | Jinbe | Thanos |
| Elder | Old sage | Master Roshi | Professor X standing |

**Titan** is the transformation scale of any archetype: Attack on Titan, giant forms.

The child-proportioned preset keeps the adult-figure dials (bust included) locked at neutral.

### 9.4 Jiggle and secondary motion (including the Gainax bounce)

- Jiggle runs **after** animation, as a spring-damper on each jiggle bone.
  - **Inputs:** the bone's world acceleration and the body's landing impacts.
  - **Settings:** stiffness, damping, mass and a maximum angle.
- **Presets per body:**
  - off;
  - realistic;
  - **anime**, the Gainax bounce: an exaggerated, springy bust bounce on jumps, landings, dashes and big hits, on stylized adult heroines.
- **Glutes and belly** follow the same system, with presets by body fat.
- **Muscle** gets a small, stiff jiggle on landings and heavy hits.
- **Cost:** client-only and cosmetic. On at the near level of detail, simplified at mid, off far away. It never affects gameplay.

### 9.5 The skeleton fits the body automatically

- **The parametric body (this rework):** joint positions are derived analytically from the Structure dials, and helper and socket placement from the Volume dials. This extends `src/arena/client/wear/proportions.ts`, which already repositions joints at rest and re-binds the skin.
- **Generated bodies (later):** a joint-fit solver places each joint at the volume centre of the matching cross-section of the new mesh, using the same hierarchy and names. It then transfers skin weights from the base body, so every clip plays on it unchanged.

### 9.6 Dynamic retargeting for varying proportions

A clip is stored as **rotations, never positions**. That way one clip plays on a Conan-sized body and a Broly-sized body alike.

1. **Import (bake time).** Each source skeleton (Mixamo, the UE5 mannequin from Fab, Quaternius, CMU BVH) has a name map onto ours. The source rest pose is aligned to ours with a fixed correction rotation per bone, and the clip is saved as local quaternions relative to our rest pose. Only the root and hips keep translation.
2. **Playback (runtime, per character).**
   - Local rotations are applied onto the character's own bone lengths.
   - Hip height and root motion are scaled by the leg-length ratio (character's hips over source hips), so feet don't float or sink and lunges cover the right ground.
3. **Fix-ups after rotations:**
   - foot IK and contact locking on the clip's tagged foot plants, which ends sliding on the uneven map (planted feet already exist);
   - an arm and leg spread offset that grows with chest, arm and thigh girth, so bulky arms and legs don't pass through the body;
   - two-hand IK onto the weapon grip sockets;
   - aim and look IK spread across the spine and neck within joint limits.
4. **Tagged events per clip** at import: hit-contact, release (for casts and shots), foot plant, and root-motion windows. Combat (§5) and effects (§6) read these tags, never guessed timings.

`three-vrm`'s humanoid retargeting is a reference for the runtime step. We use our own rig and format, not VRM.

### 9.7 The physique test bench

The bench is a grid of every archetype × the key clips: combo, heavy, block, cast, jog, run, sprint, slide, mantle, land roll, hit react and get-up. A face close-up and a jiggle test (jump and land) are added. Each clip is scored automatically, so regressions show up as numbers:

- penetration (body intersecting itself);
- foot slide and ground-contact error;
- hand-to-grip error;
- joint-limit violations.

---

## §10 Performance and rendering on a MacBook Air M1

The goal is the look of a late Unreal Engine 4 game in a web browser.

**Target:** 60 fps at 1440 × 900 in Chrome and Safari, with dynamic resolution.

**Budgets:**

| Item | Budget |
| --- | --- |
| On-screen triangles | ≤ 1.5 M |
| Draw calls | ≤ 300 |
| Shadows | 1 shadowed key light (cascades); everything else baked lightmaps and light probes |
| GPU texture memory | ≤ 512 MB, KTX2-compressed |
| Geometry | Meshopt-compressed |

**Character levels of detail.** At most ~10 heroes render at full detail.

| Tier | Distance | Triangles | Animation |
| --- | --- | --- | --- |
| Near | ≤ 15 m | 25–35k | Full skinning at 60 Hz, 1–2K textures |
| Mid | 15–40 m | ~8k | Skinned at 30 Hz |
| Far | 40–120 m | ~2k | Baked vertex-animation textures, instanced |
| Very far | beyond | Impostor | none |

**Map:**

- modular kit pieces drawn instanced and batched;
- baked lighting;
- occlusion by zone and level;
- distance LOD on props.

**Simulation:**

- a spatial grid for hit queries;
- AI thinks less often the further it is from players;
- 100 heroes within the 60 Hz deterministic tick.

**Engine: three.js (owner, 2026-11-02).** The game moves to three.js r186's WebGPU renderer, with WebGL2 as the fallback and TSL node materials. Babylon.js was considered and not chosen.

- **For Babylon.js:** a richer built-in game toolkit (Havok physics, a navmesh, a vertex-animation baker, a node material editor).
- **Against switching:** it means rewriting every client module: renderer, characters, wear, effects, map and camera.
- **Three.js covers the same ground:** `recast-navigation-js` for the navmesh, our own deterministic physics or Rapier, and vertex-animation baking in our Blender pipeline.


**Netcode: later, not in this rework (owner, 2026-11-02).** This rework is single-player in the browser against AI bots. The engine still keeps the habits that make online play easy to add later:

- a deterministic 60 Hz tick;
- heroes driven only by input commands;
- no client-only gameplay state.

When online play comes, it will be server-authoritative, with client prediction.

---

## §11 App structure and routing

Today the app switches screens with React state and `?query` flags (`src/ui/App.tsx`). The rework gives it real routes:

| Route | Page |
| --- | --- |
| `/` | Home |
| `/create` | Create a character, ending in the gacha reveal |
| `/forge/:heroId` | Forge: physique, kit (one element, §4) and the dummy reel from 3 views |
| `/lobby` | Squad, queue, match settings |
| `/match/:id` | The match |
| `/range` | Training range: dummy, kit reel, traversal course |
| `/dev/*` | Bench, soak, wardrobe, probe, physique bench |

**Router:** proposed React Router 7. Every route lazy-loads, and the 3D canvas persists across the routes that use it.

**Forge, one kit element.** Moves and Kit become one panel with one row per button (V, X, LMB, Q, E, F, R). Each row has:

- the library picker;
- its animation (for V: combo 1, combo 2, combo 3 and heavy);
- a VFX swatch;
- a play button.

The shared locomotion moves sit beneath the rows. The 3-view dummy reel plays the selected row.

---

## §12 Animation library and sourcing

**Goal:** an extensive library on our rig, with no gap in any category. The first target is **600+ clips**, tagged and retargeted (§9.6), covering:

- locomotion in every direction (walk, jog, run, sprint, strafe, backpedal, starts and stops, turns);
- crouch and prone;
- jump, double jump, fall and land;
- mantle, drop, land roll and zipline;
- every melee style (combos, heavies, blocks, parries, guard breaks);
- every ranged style (fire, aim, reload);
- every spell family's casts;
- hit reacts by direction and size, knockdowns and get-ups;
- taunts and emotes;
- the gacha entrance.

Mirroring left/right clips doubles the directional ones for free.

**Free sources.** Every clip's licence is checked before import and recorded per clip.

| Source | What it gives | Skeleton | Licence | Use |
| --- | --- | --- | --- | --- |
| **Mixamo** (Adobe) | Thousands of clips, the base of today's library | Mixamo | Free in games; raw files can't be redistributed | Yes |
| **Fab** (Epic) | Free animation packs, plus Epic's free-every-two-weeks drops | Mostly the UE5 Mannequin, needs retargeting | [Standard Licence](https://www.fab.com/cla): commercial, any engine; no standalone redistribution; limits for fully open-source projects | Yes, per pack |
| **ActionForge** / Quaternius Universal Animation Library | Hundreds of game clips | Mixamo export | CC0 | Yes |
| **CMU Motion Capture Database** | ~2,500 raw mocap takes (BVH) | CMU | Free for any use | Yes, after cleanup |
| **100STYLE** | Locomotion in 100 styles | BVH | CC BY 4.0 (attribution) | Yes, with credit |
| **Rokoko free packs** | Mocap packs | Various | Check per pack | Per pack |
| Bandai Namco Research Motion | Mocap, mostly locomotion and hand actions | BVH | CC BY-NC 4.0 (needs credit) | **No.** The owner declined to credit it (2026-11-02). |
| AMASS | Large research mocap | SMPL | Non-commercial research | No |

**Weapon-held locomotion.** A hero carrying a ranged weapon moves with that weapon's own locomotion set, not the unarmed one:

- pistol and rifle idle, walk, jog, run and sprint;
- strafe and backpedal;
- crouch and crouch-walk, prone crawl;
- aim-walk, reload, fire while moving;
- jump and land, mantle;
- the switch between melee and the weapon.

Upper-body layers blend aiming and firing over the legs. Melee styles that hold a weapon (greatsword, sword and shield, axe or staff) get the same treatment wherever the library has the clips.

**Only what we can animate (owner, 2026-11-02).** A melee style, ranged style, spell clip family or traversal move can be picked **only if the library holds its complete clip set.** A coverage manifest lists the required clips per style, the Forge hides incomplete styles, and a test fails the build if a pickable style is missing a clip. A weapon with no animation does not exist in the game.

**Pipeline.** Source FBX, GLB or BVH go through Blender (`tools/blender/mixamo.py`, extended with a name map per source and the rest-pose alignment), then `scripts/rpm-anim.ts` with the clip tags, then `public/anim`.

**The public-repo problem (decided: the repo goes private).** The GitHub repo is **public** today. Mixamo's terms and Fab's no-redistribution and open-source limits mean the raw and baked third-party clips must not sit in a public repository. Either the repo goes private, or licensed clips live in a private asset store that the build pulls in. Open question 7.

**Gaps to fill first:**

- mantle and ledge climb;
- drop and land roll;
- zipline ride;
- parry and block-hit;
- guard break;
- reload;
- aim-down-sights walk;
- directional jog and strafe;
- more spell casts;
- heavies for club and kicks;
- a signature clip for each ultimate;
- the gacha pop-out.

---

## §13 Gaps register

| Area | Gap | Status |
| --- | --- | --- |
| Roster | The 20 demo heroes (looks, faces, retunes) | **Dropped (M3):** deleted with their faces; staging and the soak use two generated squads of ten, and balance uses generated kits (§4) |
| Kit | Ki Blast sits in melee; Chain Hook in ranged; Skill 1 is forced into projectiles; strike skills in Q | **Fixed (M3):** six typed rows enforced on save; melee is a weapon style, LMB the ranged library (magazine, reload, bloom, muzzle), Q the 10 spell families, F passives on an energy meter (§4, §5) |
| Effects | Casts flash at the torso | **Fixed (M5):** casts flash at the hand, projectiles leave the muzzle, impacts land at the contact point on the victim, melee sparks at the weapon tip, zones and marks sit on the floor under them (not y 0), auras on the body |
| Effects | No proper blasts, craters or breakable props | **Fixed (M5):** six-layer blasts at five tiers; hit-stop, shake and kick, radial blur and speed lines, an ink impact frame on ultimates (felt near the camera); craters with rubble, skid marks and elemental marks on a 64-decal budget; 300-chunk debris pool; pre-fractured chips, cards, dice, capsules, cabinet panels, signs and railings; engine knockback arcs with mass and slams; breakable glass partitions and card bridges in the engine, routes kept when they fall. **M7 anime pass:** cel-banded fresnel on energy shells and cores, saturated area colours, tighter glows, two-tone puffs and thinner smoke, bloom only on hot cores; in the thickest fight frames white-out fell from 22% to 9% of the view |
| Map | The arena is a flat 2D floor | **Fixed (M4):** the House of Instinct's first deliverable in grey boxes, cut down for 10 v 10 (Roulette Court, Chip Stacks, Card Ramp, VIP Crescent, balcony loop, Chart Climb, Chandelier Spine, trenches, service tunnel, vault): four bands, mirrored halves, §8 starting dimensions, arcade yellow on traversal; live matches and the balance gate play it. **M7:** Diamond Mines, Crypto Catacombs, Gacha Arcade, NFT Gallery and Pachinko Spire added in grey, every platform reachable both ways at every size; the house edge, vault jackpot and last squad standing (§2) play on it. **M7, owner playtest:** the map grows outward to 152 × 116 m with a concourse (Pachinko Alley down each flank, Prize Counter halls at each end) and stands inside an enclosed Game Centre hall in the §1 palette; the outdoor valley and banners are gone from the match and the staging board; pieces are painted in the palette by what they are; heroes stage on any level. Final art comes later |
| Engine | No 3D collision, mantle or navmesh | **Fixed (M4):** walkable tops, ramps, ledges and ceilings; mantle, drop and landing roll, ziplines and rails (§7); a nav graph built from the map with walk, jump, double-jump, drop and zipline links, which the bots path on. Occlusion by zone and level added in M6 (§10). **2026-11-03:** wall-run and ledge hang on marked surfaces decided (§7), not built yet; playtest findings and the fix order in docs/playtests/2026-11-03-traversal-and-melee.md. **2026-11-04:** light melee at the style's beat; coyote time; a roll stops at an edge; jump, double jump and roll play a clip per direction; the charge holds the heavy wind-up (checked from the seat) |
| Engine | No LOD or crowd path for 100 heroes | **Mostly fixed (M6):** a spatial grid for hit queries, AI thinking by distance from players, 50 v 50 inside the tick; character tiers (whole near, ~8k mid at 30 Hz, ~2k far at 15 Hz without shadows, impostor cards), at most 10 near; the sun in two shadow cascades, the sky in a light probe, baked light on the grey box, occlusion by zone and level, batched scenery, decals and effects, distance LOD on props, a 1440 × 900 render cap, and budget checks in the bench and soak. **Still open:** the far tier is skinned, not baked vertex-animation textures; textures are not KTX2 and the GLBs not meshopt-compressed. **M7 measured (production, M1 Air):** 56–60 fps in four camera views (median frame 16.6 ms), with dynamic resolution at its floor in the thick of the fight; the main thread is 90–97% busy there (about 50 µs of renderer work per draw, the HUD's page layout and paint 10–20%). Bodies at rest stop costing pose and matrices. **M7 closed (production, M1 Air, in the Game Centre hall):** 60 fps in follow, overview and shoulder views on every run and 58–60 in the default view (median frame 16.6 ms everywhere), at the full 1440 × 900-pixel render target through the fight rather than the scaler's floor |
| Engine | No netcode | Later phase; this rework is AI-only in the browser (§2). **Engine track:** a played match records itself and replays tick for tick, in the browser or headless, checked by a state hash every second, the groundwork netcode needs (docs/ENGINE.md) |
| AI | Bots are too strong | **Fixed (M3):** Easy, Normal (default) and Hard (today's bots, used by the gate), picked per side in staging (§2) |
| Controls | Jump and melee keys | **Fixed (M3):** Space jumps, V is melee (§3). **M7:** the roll goes the way WASD steers, a jump faces the way it travels, quick taps are never lost between ticks, arrow keys move, and the shoulder camera lifts over posts and stays under decks instead of entering them. **Engine track:** a player's jump or roll pressed up to 0.2 s too early (mid-climb, mid-roll, just before landing) now happens the moment it can instead of being lost; the AI's presses aren't buffered, so balance is unchanged |
| Forge | Moves and Kit are split | **Fixed (M6):** one Kit panel with the six rows, and the dummy reel from three views (shoulder, side and the dummy's own) in one renderer (§11) |
| App | Loose screen switching | **Fixed (M6):** React Router routes for Home, Create, Forge, Lobby, Match, Range, Credits and the dev tools; every route lazy-loads; old `?flags` redirect. The 3D canvas does not yet persist across routes: each 3D route makes and disposes its own renderer (§11) |
| Body | No helper bones or corrective morphs | **Fixed (M1):** muscle helpers, correctives and drivers added at load (§9.2–9.4) |
| Body | Arms pass through bulky torsos | **Fixed (M1):** girth spread fix-up; on the bench, heavyweight run penetration fell from 9.6 to 1.6 cm (§9.6, §9.7) |
| Body | No hand IK | **Fixed (M1):** two-hand grip IK plus aim and look IK within joint limits (§9.6). Foot locking on tagged plants waits for the §12 tags |
| Body | Googly eyes: the eyes show skin colour when they move in the Forge | **Fixed (M1):** the head is its own object with real eyeballs and 52 face shapes (§9.1). No dedicated 2K head texture yet |
| Body | No jiggle or secondary motion; no root bone; no joint limits | **Fixed (M1):** Root bone, jiggle (off, realistic, anime), joint limits from the clip library (§9.2, §9.4) |
| Animation | ~120 clips, from 2 sources | **Fixed (M2):** 1,147 combat clips per gender from Mixamo, Quaternius, CMU and 100STYLE, with name maps, rest alignment, contact/release/plant/root tags, mirrors and per-clip licences (§12). Fab not imported (needs an Epic account) |
| Legal | The repo was public, but licensed clips can't be redistributed | **Fixed:** the repo was made private on 2026-11-02 |
| Legal | Bandai Namco clips require credit | **Excluded** (Q8) |
| Animation | Ranged heroes use unarmed locomotion | **Fixed (M2):** rifle and pistol locomotion sets, picked by the hero's style (§12). Gun props aren't drawn yet |
| Kit | Styles offered without full animation coverage | **Fixed (M2):** coverage manifest and its test; every style, club included, is covered (§12) |
| Docs | Ten conflicting plan files | **Fixed:** this file; the rest are in `docs/archive/` |
| Round 3 | Eyes, slide, jog/run, crosshair, charge meter, knockback | Fixed |
| Round 3 | One Skill 2 clip turns the hero away from the camera; a pillar can block the reel's side view | Open; re-check after the rework |
| Later | Likeness and cosmetics; Tripo export needs the owner's plan upgrade | Parked |

---

## §14 Open questions for the owner

1. ~~Online multiplayer~~ **Decided 2026-11-02:** later. This rework is AI bots in the browser, at three difficulty levels.
2. ~~Engine~~ **Decided 2026-11-02:** three.js, on its WebGPU renderer.
3. ~~Victory condition~~ **Decided 2026-11-02:** a mix. The last squad standing wins, the house-edge zone closes in, and the vault jackpot buffs the squad that holds it.
4. ~~Traversal set~~ **Decided 2026-11-02:** mantle and ledge climb, drop down and landing roll, map ziplines and rails.
5. ~~Q and passive~~ **Decided 2026-11-02:** Q is the spell universe (everything the other rows don't cover, in 10 families). The passive runs on an energy meter, and transformations live there.
6. ~~Archetypes~~ **Decided 2026-11-02:** every human-like body for now. Sizes from Conan to Titans (Titan only by transformation), muscle up to DBZ level, proper anime figures for women. Tails, wings and beast skeletons come later.
7. ~~Public repo~~ **Decided 2026-11-02:** make the GitHub repo private.
8. ~~Bandai Namco~~ **Decided 2026-11-02:** left out. The game stays free, but no credit is given, and the licence requires credit.

---

## Changelog

- 2026-11-04: Owner direction recorded: light melee hits chain at the style's beat, with attack speed setting the damage per hit (§5, the call made after Sparking Zero and MHUR); the House is a casino and pachinko parlour at 1:15 toy scale in hyper-real shaded anime with pastel tones (§1, §8, reference image in docs/reference). Jump, double jump and roll pick a clip by the way they go: a standing jump springs up, a strafe jump hops sideways, the double jump flips forward, twists sideways and backflips only going back; a roll turns into its way and comes up running, back is a hop (docs/plans/2026-11-04-feel-and-toy-casino.md). Coyote time 0.1 s and a roll that ends at an edge, both for the played hero (like the input buffer, so the bots' fights and the balance gate are unchanged); any hero's roll off an edge shows as a fall. The heavy charge holds the heavy blow's own wind-up from 0.12 s of holding instead of a guard.
- 2026-11-03: Owner decisions after the traversal playtest, recorded in §7: on marked surfaces only, every hero wall-runs for a fixed short stretch and a passive (F) gives unlimited wall-running; ledge hang and climb-up on marked ledges, with shimmying only if a smooth animation exists. Wall-run and ledge hang were "not included" before. §13 Engine row updated.
- 2026-11-03: Engine track started (owner direction: session replays for playtesting, and a Blender pipeline toward Unreal-grade output on an M1 Air), planned in docs/ENGINE.md. §13 Controls and Engine (netcode) rows updated. The jump and roll input buffer is a feel change from the owner's playtest notes, recorded in §13 only. No rule changed.
- 2026-11-03: §13 status updated for Milestone 7 (the full House of Instinct, §2, §8, §10): the LOD row's 60 fps target is met in production. No rule changed.
- 2026-11-03: Owner decisions from the M7 playtest, recorded: the map is bigger instead of outdoor scenery, inside a Japanese pachinko arcade hall at Hypercharge scale, with no stone, trees, grass or Roman banners anywhere (§1, §8); heroes may be staged on any level; the dodge roll goes the way WASD steers, not where the pointer aims, and the arrow keys move (§3 table updated); spells are to read as hyper-real anime, not a white wash (§6b). Direction for the next session, no rule yet: character customisation through shading alone, without generated assets. §13 Map, Effects and Controls rows updated.
- 2026-11-03: §13 status updated for Milestone 7 work (the full House of Instinct, §2, §8): Map row gains the other zones and the match rules; the LOD row records the measured 10 v 10 frame rate, still short of a steady 60. No rule changed.
- 2026-11-03: §13 status updated for Milestone 6 (performance and app, §10–§11): Forge and App rows closed, the LOD and crowd row mostly closed, with what's still open noted. No rule changed.
- 2026-11-03: §13 status updated for Milestone 5 (effects and destruction, §6–§6b): both Effects rows closed. No rule changed.
- 2026-11-03: §13 status updated for Milestone 4 (traversal and the grey-box map, §7–§8): Map and Engine rows closed. No rule changed.
- 2026-11-02: §13 status updated for Milestone 3 (kit engine, §2–§5): Roster, Kit, AI and Controls rows closed. No rule changed.
- 2026-11-02: §13 status updated for Milestone 2 (animation library, §12): three Animation/Kit gaps closed. No rule changed.
- 2026-11-02: §13 status updated for Milestone 1 (metarig, §9.1–9.7): five Body gaps closed. No rule changed.
- 2026-11-02: **approved by the owner.** Bandai Namco left out.
- 2026-11-02: repo made private on GitHub. Q8: the game stays free; Bandai Namco clips only with a Licences-page credit.
- 2026-11-02: Q7 decided: the repo goes private. Bandai Namco motion data added as prototype-only (non-commercial, Q8). Weapon-held locomotion added, and a rule that only fully animated styles can be picked.
- 2026-11-02: the metarig became the first priority. §9 is rewritten in detail (fixed head object, new bones, physique dials, fantasy coverage, Gainax bounce, auto-fit, dynamic retargeting, test bench). §12 now has a free-source list with licences. Open question 7 added (public repo).
- 2026-11-02: Q6 decided: human-like bodies only, from Conan to Titan size, DBZ muscle, anime figures.
- 2026-11-02: Q5 decided: Q is the spell universe in 10 families; the F passive runs on an energy meter and includes transformations; R is an overpowered move on a long cooldown.
- 2026-11-02: Q4 decided: base traversal is mantle, drop and land roll, ziplines and rails.
- 2026-11-02: Q3 decided: last squad standing, plus a closing house-edge zone and a vault jackpot.
- 2026-11-02: Q2 decided: stay on three.js, move to WebGPU.
- 2026-11-02: Q1 decided: no netcode in this rework; AI bots at three difficulty levels.
- 2026-11-02: first draft. Replaces the canon doc and the plans now in `docs/archive/`.
