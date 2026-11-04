# Kit library coverage: what we have, and what the genre's fans will look for

2026-11-04. The whole kit library (src/charter/templates, 307 entries) against the third-person hero combat genre:
aiming, melee, vertical traversal and abilities, as in Deadlock, Marvel Rivals, My Hero Ultra Rumble (MHUR),
Naruto to Boruto: Shinobi Striker and Dragon Ball: Sparking! Zero. The tables at the end are generated from the code.
Examples from those games are their best-known abilities, named to show what a fan expects, not to copy them.

## The answer

**No, the library isn't MECE yet.**

- **Not mutually exclusive.** Five places hold the same thing twice (below). The worst is that transformations sit in
  both F and R, under the same names.
- **Not collectively exhaustive for this genre.** It covers the hero-shooter core well: damage, healing, shields,
  nine kinds of crowd control, debuffs, buffs, zones, walls, traps, turrets, vision and a few tricks. It is thin
  on what makes the anime and superhero fandoms feel served: flight, swinging, teleporting to a mark, clones, pets,
  copying an enemy, grabs and throws, counters, transformations that change the moveset, revives, and team-ups.
  Most of those need a new engine piece, not just new catalogue entries.

| Slot | Count | Verdict |
| --- | ---: | --- |
| V melee styles | 7 | Good spread; whip/chain and spear share one style with axes and staffs, and dual wield, scythe and gauntlets are missing |
| LMB ranged | 33 | Strong on bolts, beams, cones; no lobbed or bouncing grenades, returning throws, spin-up guns or charged shots |
| Q spells | 107 | Strongest row; the summon family holds no actual summons, and clones, possession and copying are missing |
| E movement | 22 | Only dash, blink, leap, grapple; no flight, swing, teleport-to-mark, swap or burrow; four duplicate the shared moves |
| F passives | 80 | Broad; overlaps R on transformations; no real counter (Counter Stance is a shield and a damage buff) |
| R ultimates | 58 | Broad; transformations change numbers and look but never the moveset; no revive, no cinematic lock-on |

## Not mutually exclusive: the overlaps

1. **Transformations live in two rows.** GAME.md §4 puts every transformation in F, yet R has Titan Form, Super
   Form, Ascended Form, Avatar Form and Shrink Form, and F has its own Titan Form and Super Form. Fix: forms in F
   only, or one rule (F toggles a form on its meter, R is a bigger, timed form) and different names.
2. **E repeats the moves every hero already has.** Wall Run, Combat Roll, Power Slide and Zipline are E skills, while
   §7 gives every hero a wall-run on marked walls, a dodge roll, a crouch slide and map ziplines. Fix: E should only
   hold moves the baseline lacks (see the gaps).
3. **Q burst repeats LMB.** Snipe and Piercing Shot sit beside Rifle Shot and Railgun; Kunai Volley and Shuriken Fan
   beside Throwing Knives. Fix: say what makes a Q burst different (a cooldown nuke that winds up or charges), and
   keep plain weapon fire in LMB.
4. **The summon family holds no summons.** It is turrets, traps and totems, which overlap construct (placed things)
   and zone (fields). Fix: give summon real minions (a gap below), and move turrets, traps and totems to construct.
5. **Hard control has two homes.** Stun is its own effect while the other eight controls share one type, and Time
   Stop is a stun. Small, but it splits one idea in two. Fix: make stun a control type.

Smaller: Venom Dart (curse) only deals damage, which makes it a burst; Levitate is a dash with a buff, not a hover.

## Not collectively exhaustive: what's missing

Grouped by row. **New piece** means the engine has nothing to build it from; **entries** means it can be made from
the effects we have.

### Movement and traversal (E, and the shared baseline)

| Missing | Fans know it from | Needs |
| --- | --- | --- |
| Flight and hover, held, with its own camera | Sparking Zero (everyone flies), Marvel Rivals (Iron Man, Storm), Deadlock (Vindicta's Flight) | New piece |
| Swinging on a line | Marvel Rivals (Spider-Man) | New piece (grapple only pulls in a straight line) |
| Wall-crawl and wall-run | Shinobi Striker (chakra wall running), Marvel Rivals (Spider-Man) | Decided for the baseline (§7), not built |
| Teleport to a mark or a target | Instant Transmission (Sparking Zero), Flying Thunder God (Naruto), portals (Doctor Strange, Magik in Rivals) | New piece |
| Swap places with a hero | Deadlock (Paradox's Paradoxical Swap) | New piece |
| Burrow underground | Deadlock (Mo & Krill) | New piece |
| Carry or ride an ally | Marvel Rivals (Rocket riding Groot, Jeff swallowing heroes) | New piece |
| Make walkable terrain: ramps, ice paths, platforms | MHUR (Todoroki's ice) | New piece (our walls block but can't be climbed on) |
| Homing dash to a target | Sparking Zero (Dragon Dash) | Entries plus target lock |

### Defence and reactions

| Missing | Fans know it from | Needs |
| --- | --- | --- |
| Counter or parry: a window that answers a hit | Sparking Zero (vanish and Super Counter), Naruto (Substitution Jutsu) | New piece |
| Directional barrier that blocks shots | Marvel Rivals (Doctor Strange's shield, Magneto's Metal Bulwark) | New piece (a wall blocks both ways; shield is health) |
| Absorb projectiles | Marvel Rivals (Magneto's ultimate gathers incoming shots) | New piece (reflect exists) |
| Revive a downed ally | Marvel Rivals (Adam Warlock), MHUR and Shinobi Striker (reviving teammates) | New piece; matters more with last squad standing |

### Offence and control

| Missing | Fans know it from | Needs |
| --- | --- | --- |
| Grab, carry and throw | Deadlock (Lash's Death Slam), Sparking Zero throws | New piece (Chain Hook only pulls) |
| Clones, decoys and illusions | Naruto (Shadow Clone), Marvel Rivals (Loki's illusions), MHUR (Twice) | New piece |
| Pets and minions that move and fight | MHUR (Tokoyami's Dark Shadow), Naruto (summoning) | New piece (turrets don't move) |
| Copy an enemy's form and kit | Marvel Rivals (Loki's ultimate), MHUR (Toga) | New piece |
| Possession: the target mirrors the caster | Naruto (Shikamaru's Shadow Possession) | New piece |
| Charge-up casts: hold to power a shot or beam | Sparking Zero (charged Kamehameha), Deadlock (Grey Talon's Charged Shot), Marvel Rivals (Hawkeye's bow) | New piece for LMB and Q (melee heavy already charges) |
| Beam clash | Sparking Zero (beam struggles) | New piece; niche but iconic for that fandom |
| Air juggle: launch, chase, combo, slam | Sparking Zero, MHUR | Entries plus a launcher and chase on the melee chain |
| Guided or map-wide projectile | Deadlock (Grey Talon's Guided Owl) | New piece |
| Lobbed and bouncing grenades | Marvel Rivals (Squirrel Girl's acorns) | New piece (projectiles fly straight) |
| Returning throw | Marvel Rivals (Captain America's shield, Thor's hammer) | New piece |
| Ability charges: two or three uses banked | Deadlock and Marvel Rivals, widely | New piece (cooldowns only) |

### Transformations and team (F and R)

| Missing | Fans know it from | Needs |
| --- | --- | --- |
| A form that changes the moveset, in stages | Marvel Rivals (Bruce Banner to Hero Hulk to Monster Hulk), Sparking Zero (transformations), Naruto (Sage and Kurama modes) | New piece (form now changes numbers and look only) |
| Switch between two kits | Marvel Rivals (Cloak & Dagger) | New piece |
| Fusion | Sparking Zero (fusion characters) | New piece; niche |
| Team-up moves between two named heroes | Marvel Rivals (team-ups) | New piece (synergies are role-count bonuses, like TFT traits) |
| Cinematic lock-on ultimate: lands, then plays out | Sparking Zero ultimates, Shinobi Striker ultimate jutsu | New piece (presentation more than rules) |
| A spendable power meter for skills, like ki or chakra | Sparking Zero (ki and skill count), Naruto (chakra), MHUR (Plus Ultra) | Partly there: F has an energy meter and moves cost stamina |

### Weapon styles (V and LMB)

| Missing | Fans know it from | Needs |
| --- | --- | --- |
| Whip and chain as their own style (crack, wrap, pull) | Kusarigama users, chain whips | A style with its own clips (now inside Axe or staff) |
| Spear and lance thrusts | Polearm fighters | A style (now inside Axe or staff) |
| Dual wield and claws | Marvel Rivals (Wolverine) | A style (claws now inside Unarmed) |
| Scythe | Reapers across anime | A style |
| Power gauntlets | Marvel Rivals (Iron Fist), MHUR (Deku's smashes) | Could stay Unarmed with heavier blows |
| Spin-up gun | Marvel Rivals (Punisher's turret) | A ranged kind with spin-up |
| Akimbo pistols | Hero shooters widely | A ranged clip set |

## What to build first

Ordered by how many fandoms each piece serves:

1. **Teleport to a mark or target, and counters.** These two serve DBZ, Naruto and Marvel fans at once, and both
   build on the dash and invulnerability frames we already have.
2. **Flight and hover.** Sparking Zero is built on it, and it serves the Marvel flyers; it needs its own camera and
   nav rules.
3. **Clones and real summons.** These are core to Naruto, Loki and Twice, and they fill the empty summon family.
4. **Forms that change the moveset.** Hulk, Super Saiyan and Sage Mode are the moments fans come for; this also
   settles the F and R overlap.
5. **Grab and throw, and an air juggle on the melee chain.** These make the anime fighters feel right.
6. **Revive.** It matters for last squad standing.
7. **Ability charges and charge-up casts.**
8. **The cheap ones, from what exists:** the overlap fixes above, and whip/chain and spear as their own styles.

Each new piece is a rule change, so it needs the owner's say-so before it goes into GAME.md, and the balance gate
reruns after.

## The library as built

### V: melee weapon styles (7)

A style, not a skill: it sets the clips, reach, arc and lunge; damage comes from the role. Every role may take every style. Each gives a 3-hit combo (3rd knocks back), a charged heavy (V hold) and a guard (X).

| Style | Reach, arc | Covers |
|---|---|---|
| Unarmed | 2.4 m, 100° | punch, fist, martial arts, boxing, brawler, elbow, knee, claw |
| Kicks | 2.7 m, 110° | kick, taekwondo, capoeira, muay thai, stomp |
| Blade | 2.6 m, 100° | dagger, knife, sword, katana, iaido |
| Greatsword | 3.3 m, 140° | claymore, zweihander, buster sword |
| Sword and shield | 2.7 m, 110° | knight, paladin, sword and board |
| Axe or staff | 3.2 m, 130° | axe, staff, spear, polearm, whip, chain, halberd, bo |
| Club | 2.9 m, 120° | bat, hammer, mace, wrench, maul |

### LMB: ranged (33)

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Chain Spark | beam | damage | mage |
| Chill Ray | beam | damage, slow | controller |
| Drone Zap | beam | damage | summoner |
| Light Ray | beam | damage, heal ally | support |
| Railgun | beam | damage | marksman |
| Siphon Beam | beam | damage, heal | support |
| Brawler Shotgun | cone | damage | fighter |
| Ember Spray | cone | damage | mage |
| Shockwave Punch | cone | damage | tank |
| Shotgun Blast | cone | damage | all |
| Arcane Bolt | projectile | damage | mage, support, controller, summoner, fighter |
| Bolas | projectile | damage, slow | controller, tank, support, assassin |
| Burst Fire | projectile | damage | marksman, summoner, assassin |
| Chime Orb | projectile | damage | support |
| Crossbow Bolt | projectile | damage, armour shred | marksman |
| Energy Wave | projectile | damage | fighter, mage, tank, support, controller |
| Frost Shard | projectile | damage, slow | mage, controller, support |
| Gravity Orb | projectile | damage, slow | controller |
| Hex Bolt | projectile | damage, spirit shred | mage |
| Ki Blast | projectile | damage | all |
| Longbow | projectile | damage | marksman |
| Magic Missile | projectile | damage | mage |
| Mending Shot | projectile | damage, heal ally | support |
| Nail Gun | projectile | damage, armour shred | summoner |
| Poison Darts | projectile | damage | assassin |
| Rifle Shot | projectile | damage | marksman, tank, summoner, controller, fighter |
| Shadow Bolt | projectile | damage | assassin |
| Shoulder Cannon | projectile | damage | tank |
| Sidearm | projectile | damage | all |
| Silenced Pistol | projectile | damage, mark | assassin |
| Spore Shot | projectile | damage, wound | summoner |
| Throwing Knives | projectile | damage | assassin, fighter, tank, summoner, marksman |
| Void Orb | projectile | damage | mage |

### Q: spells (107), by family

**Burst (13)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Arcane Barrage | projectile | damage | mage |
| Arcane Orb | projectile | damage | mage |
| Cleaving Arc | cone | armour shred, damage | fighter |
| Comet | zone | knock-up, damage | mage |
| Fireball | projectile | damage | mage |
| Kunai Volley | projectile | damage | assassin |
| Lightning Lance | beam | stun, damage | mage |
| Piercing Shot | beam | damage | marksman |
| Ricochet | projectile | damage | marksman |
| Scatter Shot | cone | damage, slow | marksman |
| Shuriken Fan | cone | damage | assassin |
| Snipe | projectile | damage | marksman |
| Whirlwind | aura | damage | fighter |

**Control (23)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Dark Hex | projectile | silence, damage | mage |
| Disarm Lash | beam | disarm, damage | fighter, assassin |
| Earthen Grip | zone | root, damage | tank, controller |
| Force Palm | cone | push, stun, damage | fighter |
| Frost Nova | aura | slow, damage | mage |
| Ground Breaker | zone | slow, damage | fighter |
| Ground Spikes | zone | slow, damage | tank |
| Grounding Pulse | aura | grounded, slow, damage | controller |
| Hex | projectile | silence, disarm, slow, damage | support |
| Hush Sigil | projectile | silence, damage | assassin, controller, mage |
| Net Launcher | projectile | root, grounded, damage | marksman |
| Null Zone | zone | break, spirit shred, damage | controller |
| Pacify | projectile | disarm, damage | controller |
| Paralysis Needle | projectile | root, slow, damage | assassin, controller |
| Seismic Slam | zone | stun, damage | tank |
| Silence Field | zone | silence, damage | controller |
| Sleep Dart | projectile | sleep, damage | support |
| Sleep Mist | zone | sleep, damage | controller |
| Stasis Bolt | projectile | stun, damage | controller |
| Terrify | cone | fear, damage | controller |
| Tether | projectile | root, damage | controller |
| War Cry | aura | taunt, +damage reduction, damage | tank |
| War Stomp | aura | grounded, slow, damage | fighter |

**Displacement (13)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Body Slam | aura | knock-up, damage | tank |
| Chain Hook | projectile | pull, stun, damage | tank, fighter |
| Concussive Round | projectile | push, damage | marksman |
| Explosive Arrow | projectile | push, damage | marksman |
| Gravity Well | zone | pull, slow, damage | mage, controller |
| Magnetize | aura | pull, slow, damage | tank |
| Repel | aura | push, slow, damage | support |
| Repulse | projectile | push, damage | controller |
| Sonic Shockwave | cone | push, cripple, damage | tank |
| Telekinetic Lift | projectile | knock-up, damage | controller |
| Thunderclap | aura | push, damage | mage |
| Updraft | zone | knock-up, damage | fighter |
| Vortex | aura | pull, stun, damage | controller |

**Curse (14)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Armor-Piercing Round | projectile | armour shred, damage | marksman |
| Corrode | projectile | spirit shred, damage | mage |
| Crippling Hex | projectile | cripple, slow, damage | fighter, controller |
| Crippling Poison | projectile | cripple, slow, damage | assassin |
| Death Mark | projectile | mark, damage | assassin |
| Enfeeble | projectile | cripple, damage | support |
| Expose | projectile | vulnerable, damage | assassin, marksman |
| Ground Sunder | beam | armour shred, slow, damage | tank, fighter |
| Hemorrhage | projectile | wound, damage | assassin |
| Hunter's Mark | projectile | mark, damage | marksman |
| Rend | cone | wound, armour shred, damage | fighter |
| Seeker Drone | projectile | mark, damage | summoner |
| Shadow Lunge | projectile | mark, execute, damage | assassin |
| Venom Dart | projectile | damage | assassin |

**Zone (7)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Blizzard | zone | lingers, slow, damage | mage |
| Drone Swarm | aura | lingers, damage | summoner |
| Flame Pillar | zone | lingers, damage | mage |
| Incendiary Grenade | zone | lingers, damage | marksman |
| Spore Cloud | zone | lingers, wound, damage | summoner |
| Thorn Mail | aura | lingers, damage | tank |
| Time Dilation | zone | lingers, slow, cripple, damage | controller |

**Construct (4)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Barricade | zone | wall, push, damage | tank |
| Ice Pillar | zone | wall, knock-up, damage | controller, mage, tank |
| Ice Wall | zone | wall, slow, damage | controller |
| Scrap Wall | zone | wall, damage | summoner |

**Summon (12)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Bear Trap | zone | trap, root, damage | marksman, summoner |
| Flame Turret | zone | turret | summoner |
| Frost Totem | zone | lingers, slow, damage | summoner |
| Healing Totem | zone | lingers, heal allies | support, summoner |
| Proximity Mine | zone | trap, push, damage | summoner |
| Rocket Turret | zone | turret | summoner |
| Sentry Turret | zone | turret | summoner |
| Shadow Snare | zone | trap, root, damage | assassin |
| Shield Generator | zone | lingers, shield | summoner |
| Tar Trap | zone | trap, slow, grounded, damage | summoner |
| Tesla Coil | zone | turret | summoner |
| War Drum | zone | lingers, +attack speed | summoner |

**Support (11)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Barrier | projectile | shield | support |
| Empower | aura | +damage | support |
| Fortify | aura | +damage reduction | tank |
| Guardian Bubble | aura | shield | tank, support |
| Healing Burst | aura | heal allies | support |
| Lifelink | aura | +lifesteal | support |
| Purify | aura | cleanse, heal allies | support |
| Renew | projectile | heal ally | support |
| Sanctified Ground | zone | lingers, shield | support |
| Steadfast | projectile | unstoppable, shield | support |
| Tailwind | aura | +move speed, +attack speed | support |

**Vision (6)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Blinding Light | cone | blind, damage | controller |
| Echo Ping | zone | reveal, slow, damage | support, summoner, marksman |
| Flashbang | zone | blind, damage | marksman |
| Reveal Pulse | aura | reveal, mark, damage | marksman, assassin, controller |
| Smoke Bomb | zone | blind, slow, +move speed | assassin |
| Smoke Screen | zone | lingers, blind, damage | assassin, marksman, summoner |

**Trick (4)**

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Health Swap | projectile | health swap, damage | controller, assassin, mage |
| Reflect Barrier | aura | reflect, shield | tank, support, controller |
| Rewind | projectile | rewind, heal ally | support, mage |
| Spell Steal | projectile | spell steal, damage | mage, controller, support |

### E: movement (22)

| Name | Kind | Does | Roles |
|---|---|---|---|
| Gravity Step | blink | moves self, +evasion | controller, mage |
| Phase Shift | blink | moves self (i-frames), +move speed | assassin, mage, controller |
| Shadow Step | blink | moves self, stealth, +damage | assassin |
| Teleport | blink | moves self, shield | mage, controller, summoner, support, assassin |
| Time Recall | blink | moves self, heal | mage, support, controller |
| Air Dash | dash | moves self, +damage | all |
| Bull Rush | dash | moves self, unstoppable, +damage reduction | tank, fighter |
| Bulldozer | dash | moves self, shield | tank |
| Combat Roll | dash | moves self, +attack speed | marksman, assassin, fighter, summoner |
| Gap Closer | dash | moves self, +damage | fighter |
| Levitate | dash | moves self, +move speed | mage, controller, support |
| Power Slide | dash | moves self, +attack speed | fighter |
| Thruster Skid | dash | moves self, +damage reduction | summoner, tank |
| Wall Run | dash | moves self, +move speed | assassin, marksman |
| Wind Step | dash | moves self, +move speed | support, mage, controller |
| Grapple Hook | grapple | moves self, heal | assassin, marksman, fighter, summoner |
| Zipline | grapple | moves self, +damage | marksman |
| Crater Leap | leap | moves self, +damage reduction | tank, fighter |
| Guardian Leap | leap | moves self, shield | support, tank |
| Jetpack | leap | moves self, shield | marksman, summoner, tank |
| Rocket Jump | leap | moves self, +attack speed | marksman, summoner |
| Sky Step | leap | moves self, +move speed | fighter, support |

### F: passive toggles (80), by trigger

**While on (35)**

| Name | Does | Roles |
|---|---|---|
| Arcane Focus | +damage | mage |
| Arcane Surge | cooldown refresh, +damage | mage |
| Aura of Renewal | heal | support |
| Benediction | +damage reduction, +move speed | support |
| Berserk | +attack speed, +damage | fighter |
| Blade Dancer | +evasion | assassin |
| Blood Rage | +lifesteal, +damage | fighter |
| Chrono Rewind | heal, cleanse | mage, support |
| Counter Stance | shield, +damage | fighter |
| Cull the Weak | execute | assassin |
| Elemental Body | form look, +lifesteal, +damage reduction | mage, controller, summoner, support |
| Evasive Dance | +evasion, +move speed | assassin |
| Ferocity | +attack speed, +damage | fighter |
| Giant Body | resize, +damage reduction, +damage | tank, fighter, support |
| Iron Skin | +damage reduction | tank |
| Mana Shield | shield | mage |
| Overclock | cooldown refresh, +attack speed | summoner |
| Overclocked | +attack speed, +move speed | summoner |
| Overdrive | +attack speed | marksman |
| Rapid Reload | cooldown refresh, +attack speed | marksman |
| Regenerating Core | heal | tank |
| Second Wind | heal, cleanse | fighter |
| Shadow Realm | invulnerable, +damage | assassin |
| Shield Wall | shield | tank |
| Shrink | resize, +evasion, +move speed | assassin, marksman, controller, summoner |
| Sprint Burst | +move speed | all |
| Steady Aim | +attack speed | marksman |
| Super Form | form look, +damage, +attack speed | fighter, assassin, mage, marksman |
| Thick Hide | +damage reduction | tank |
| Tinkerer | heal | summoner |
| Titan Form | resize, +damage reduction, unstoppable | tank, fighter |
| Unbreakable Will | unstoppable, +damage reduction | tank |
| Unstoppable Fury | unstoppable, +attack speed | fighter |
| Vampiric Edge | +lifesteal | fighter |
| Vanish | stealth, +move speed, +damage | assassin |

**On hit (14)**

| Name | Does | Roles |
|---|---|---|
| Arcane Erosion | spirit shred, damage | mage |
| Armor Piercer | armour shred, damage | marksman |
| Bloodlust | heal | fighter |
| Bulwark | +damage reduction | tank |
| Crushing Blows | armour shred, damage | tank |
| Grievous Wounds | wound, damage | fighter |
| Hollow Points | wound, damage | marksman |
| Ignite | damage | mage |
| Inspiring Strikes | +attack speed | support |
| Lingering Chill | slow, damage | controller |
| Mind Fray | spirit shred, damage | controller |
| Spell Vamp | heal | mage |
| Spore Host | wound, damage | summoner |
| Venom Coat | damage | assassin |

**Every third hit (12)**

| Name | Does | Roles |
|---|---|---|
| Concussive | stun, damage | controller |
| Exploit | vulnerable, damage | assassin |
| Grounding Strikes | grounded, damage | controller |
| Headhunter | damage | marksman |
| Momentum | damage | fighter |
| Overcharge | damage | mage |
| Overwhelm | silence, damage | controller |
| Precision | damage | assassin |
| Spotter | mark, damage | marksman |
| Static Charge | slow, damage | summoner |
| Target Painter | mark, damage | summoner |
| Tremor Steps | slow, damage | tank |

**At low health (11)**

| Name | Does | Roles |
|---|---|---|
| Battle Trance | +attack speed, +move speed | fighter |
| Emergency Shield | shield | summoner |
| Evasion | +evasion, +move speed | assassin |
| Guardian Spirit | shield | support |
| Juggernaut | unstoppable, +damage reduction | tank |
| Last Stand | +damage reduction, heal | tank |
| Martyr | heal, shield | support |
| Stasis Reflex | invulnerable, heal | mage |
| Tactical Retreat | +evasion, +move speed | marksman |
| Undying Rage | unstoppable, +lifesteal | fighter |
| Unshaken | unstoppable, shield | controller |

**On a kill (8)**

| Name | Does | Roles |
|---|---|---|
| Absolution | cleanse, heal | support |
| Cold Snap | cooldown refresh, shield | controller |
| Flux | cooldown refresh, +damage | mage |
| Kill Rush | +move speed, +attack speed | marksman |
| Killing Spree | heal, cooldown refresh | fighter |
| Salvage | cooldown refresh, heal | summoner |
| Shadow Instinct | stealth, cooldown refresh, heal | assassin |
| Soul Harvest | heal, cooldown refresh | support |

### R: ultimates (58)

| Name | Delivery | Does | Roles |
|---|---|---|---|
| Assassinate | projectile | execute, damage | assassin |
| Death Blossom | aura | damage, slow | assassin |
| Night Fall | aura | blind, stealth, +damage | assassin |
| Shadow Dance | self | stealth, +evasion, +damage | assassin |
| Shrink Form | self | resize, +evasion, +move speed, +damage | assassin |
| Thousand Cuts | melee | invulnerable, execute, damage | assassin |
| Toxic Cloud | zone | lingers, wound, silence, damage | assassin |
| Vendetta | projectile | mark, vulnerable, damage | assassin |
| Dead Air | zone | lingers, silence, damage | controller |
| Event Horizon | zone | lingers, pull, slow, damage | controller |
| Glacial Prison | zone | root, damage | controller |
| Gravity Collapse | zone | grounded, knock-up, damage | controller |
| Labyrinth | zone | wall, root, damage | controller |
| Nightmare | aura | fear, damage | controller |
| Ascended Form | self | form look, +damage, +attack speed, heal | fighter, mage, marksman |
| Avatar Form | self | resize, +damage, +damage reduction, heal | fighter, tank |
| Blade Storm | aura | lingers, damage, slow | fighter |
| Bloodbath | self | +lifesteal, +attack speed, unstoppable | fighter |
| Colossus Smash | zone | armour shred, stun, damage | fighter |
| Death Sentence | melee | execute, wound, damage | fighter |
| Limit Break | aura | knock-up, damage | fighter |
| Meteor Combo | melee | stun, damage | fighter |
| Super Form | self | resize, +damage, +attack speed, +move speed | fighter |
| Inferno | zone | lingers, damage | mage |
| Mega Beam | beam | damage, push | mage |
| Meteor Storm | zone | damage, slow | mage |
| Singularity | zone | pull, stun, damage | mage |
| Supernova | self | cooldown refresh, +damage, shield | mage |
| Thunder God's Wrath | aura | damage, slow | mage |
| Time Stop | zone | stun, damage | mage, controller |
| Artillery Barrage | zone | lingers, damage | marksman |
| Bullet Storm | cone | damage | marksman |
| Deadeye | projectile | execute, damage | marksman |
| Gunslinger | self | +attack speed, +damage, cooldown refresh | marksman |
| Lockdown | projectile | root, mark, damage | marksman |
| Orbital Strike | zone | damage | marksman |
| Rail Cannon | beam | armour shred, damage | marksman |
| Citadel | zone | wall, shield | summoner |
| Drone Carrier | aura | lingers, damage | summoner |
| Minefield | zone | trap, knock-up, damage | summoner |
| Overdrive Core | self | cooldown refresh, +attack speed, shield | summoner |
| Plague Garden | zone | lingers, wound, slow, damage | summoner |
| Totem of War | zone | lingers, +damage, +attack speed | summoner |
| War Machine | zone | turret, shield | summoner |
| Guardian Angel | aura | invulnerable, heal allies | support |
| Life Bond | aura | +lifesteal, heal allies | support |
| Lullaby | zone | sleep, damage | support |
| Mass Cleanse | aura | cleanse, unstoppable, heal allies | support |
| Mass Haste | aura | +attack speed, +move speed | support |
| Revival Wave | aura | heal allies, shield | support |
| Sanctuary | zone | +damage reduction, heal allies | support |
| Avalanche | cone | knock-up, damage | tank |
| Earthquake | zone | stun, damage | tank |
| Grand Challenge | aura | taunt, +damage reduction, damage | tank |
| Great Wall | zone | wall, shield | tank |
| Immovable Object | self | invulnerable, unstoppable, heal | tank |
| Titan Form | self | resize, +damage reduction, +damage, heal | tank |
| Unbreakable | aura | shield, slow | tank |
