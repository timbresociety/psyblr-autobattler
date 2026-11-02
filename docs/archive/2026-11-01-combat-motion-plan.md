# Combat motion: eight role heroes on Mixamo, every skill its own motion

*2026-11-01. Owner's decisions today, in their words where it matters. The canon (`2026-10-31-canon-psyblr-human.md`)
still rules; this plan is how its phases 3 and 5 get done first.*

## Decisions (2026-11-01)

- **The rig is locked** at the Psyblr Human v2's 76 bones (Mixamo names, twist bones, fingers, jaw, eyes). The
  MetaHuman reset (`2026-10-31-metahuman-foundation.md`) is parked as a later face and likeness upgrade.
- **Eight heroes, one per role,** "properly built as per the 8 roles". Their skill visual effects stay customisable,
  and "all of these skills should have unique motion".
- **Mixamo only for now.** "We can build other animations later with Meshy."
- Mixamo is driven from the 9335 Chrome the owner signed into; ChatGPT images and Gemini (luckyloot786@gmail.com)
  are open there too.
- The v2 work that sat uncommitted is saved on the local branch `wip/psyblr-human-v2` (9527617).

## Where things stood this morning

| Area | State |
| --- | --- |
| Rig | 76 bones, all twelve bodies rebuilt on it. Enough for melee, weapons, shooting and casts. |
| Motion library | 69 clips, all Ready Player Me locomotion, idles, dances and talk. No combat clip. |
| Skills | About 300 templates shared 4 hand-keyed clips and 10 poses; on v2 bodies every cast played the stance. |
| Combat kernel | Not started: old bindings, no combo, heavy charge, block, dodge i-frames, regain, size-scaled jumps, prone. |

The rig was never the blocker for motion. The missing motion capture was.

## The heroes

One per role from the roster, each with a fighting style Mixamo covers in depth:

| Hero | Role | Style | Mixamo source |
| --- | --- | --- | --- |
| Jeff Bezos | Tank | Sword and shield | Pro Sword and Shield Pack |
| Oprah Winfrey | Fighter | Boxing and knees | Unarmed punches, elbows, knees |
| Mark Zuckerberg | Assassin | Daggers, flips | Dagger stabs, inward/outward slashes, flip kicks |
| Narendra Modi | Mage | Kicks and two-hand spells | Martial kicks, Pro Magic Pack |
| Jensen Huang | Marksman | Rifle | Rifle fire, rifle punch, bayonet |
| Satya Nadella | Support | Staff and heals | Pro Melee Axe Pack (as a staff), one-hand casts, Magic Heal |
| Sam Altman | Controller | Great sword and area casts | Great Sword Pack, area spells |
| Warren Buffett | Summoner | Cane, throws, summons | Club combos, throws, Throwing Dice |

Each hero's kit follows the canon slots: basic is a melee combo (light, light, heavy finisher, and a charged heavy),
Skill 1 is ranged, Skill 2 a spell, then movement, a toggled passive and the ultimate. Mages and marksmen have no
melee basic template today, so the kits need a few new melee templates, and the balance gate retunes after.

## Order of work

1. **Motion library.** About 150 Mixamo clips plus five packs, downloaded through Mixamo's export, converted by
   `tools/blender/mixamo.py`, retargeted onto the v2 rig by `scripts/rpm-anim.ts` as a `combat` set. The script
   marks each clip's hit frame (the fastest hand or foot) so a cast lands on the engine's release tick.
2. **A motion per skill.** `SkillLook.motion` names the clip; a catalogue sorts clips by kind (melee chain, heavy,
   ranged, spell, movement, ultimate, reaction) and gives every skill without one a default no other skill of the
   hero shares. The Forge's Moves panel picks a skill's motion beside its effects.
3. **The eight kits** on canon slots, with their motions chosen by hand.
4. **Combat kernel** (canon phase 3): bindings, combo chain and finisher, heavy charge, block, dodge roll with
   i-frames, knockback with any-key regain, size-scaled jumps and double jump, crouch, prone, sprint, first-person
   zoom. Deterministic, the same path for AI and human, then the balance gate.
5. **Owner review** of each hero in the Forge and in a fight.

## Where it stands (end of 2026-11-01)

| Step | State |
| --- | --- |
| 1. Motion library | Done. 243 Mixamo clips (individual clips plus the great sword, sword and shield, axe/staff, magic and pistol packs) in the `combat` set of `public/anim/standard`, each with its hit frame. |
| 2. A motion per skill | Done. `src/charter/motions.ts` catalogues 198 clips by kind and style; `look.motions` overrides per skill; the Forge's Moves panel picks one beside the effects. The basic attack plays its own chain (light, light, finisher) and a charged heavy blow (`meleeSet`). |
| 3. The eight kits | Done. Every one has a melee basic and a ranged Skill 1 (new `mage-spell-kick`, `marksman-rifle-butt`), and hand-picked motions (`DEMO_HEROES[].motions`). |
| 4. Combat kernel | Done: canon bindings, chain and finisher, heavy charge, guard, roll with i-frames, launch with any-key regain, size-scaled jumps, crouch, prone, sprint, first-person zoom. The AI presses the same buttons (heavy, guard, roll). Balance retuned against the field. |
| 5. Owner review | Next. |
