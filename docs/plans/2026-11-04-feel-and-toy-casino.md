# Plan: feel and the toy-scale casino, 2026-11-04

Owner direction on 2026-11-04, after the traversal playtest (docs/playtests/2026-11-03-traversal-and-melee.md):

- melee: see how MHUR and Sparking Zero handle it, and make the call;
- the real problem is the jump, double jump and roll animations: one clip for every jump, every double jump ends in a
  backflip, and the roll's angle is off in third person; study parkour games (Mirror's Edge Catalyst);
- the map is still ugly and should look like the owner's reference: a casino and pachinko parlour seen at toy scale
  ("Honey, I Shrunk the Kids"), built for traversal and combat (ziplines, wall-runs, dashes, knockbacks, ledge climbs,
  rolls), in hyper-real shaded anime with pastel tones.

## 1. Melee: the call

Sparking Zero chains its light Rush hits by tapping, up to four, then a different button for the ender. Holding the
same button charges a Smash, and a full charge is a Power Smash that knocks the target further. MHUR chains 4 to 5
light hits by tapping, and since November 2025 holding melee is the Finishing Attack. In neither game does a stat
slow the chain down. The chain runs at the character's own animation beat, and the stats show up as damage and range.

**Decision:**
- Light strikes chain at the weapon style's own beat: about 0.37 s a step (0.14 s prep, 0.18 s recover, plus the
  slack). Before this, a strike waited for 1 / attackSpeed, which is 0.65 to 0.97 s.
- Each strike carries the share of damage its attack speed would have spread over the longer wait, so damage a second
  is unchanged.
- A hero faster than the beat chains faster still.
- Held V stays the charged heavy blow. Holding should show the wind-up from early in the hold, using a charge clip
  instead of the guard.

Done in `engine/deliveries.ts` and `combat.ts` (`MeleeBlow.pace`); the balance gate decides whether anything moved.

## 2. Traversal animation: closing the parkour gap

What parkour games do, and what we did:

| Parkour games | Us until now |
| --- | --- |
| The move depends on the context: speed, which way you're going, how high the obstacle is, how far the wall is | One clip per move whatever the context |
| The arc drives the body: crouch before take-off, tuck at the top, legs reaching for the ground as it nears | A 0.3 s clip, then a loop, whatever the arc |
| Hands meet the geometry: palms on the vault, fingers on the ledge, a hand on the wall during a wall-run | One pull-up from a full hang for every ledge |
| Speed is kept: vaults at a sprint, rolls on landing, wall-runs turn speed into height | Mostly kept by the engine, lost by the clips |
| The camera rolls into a wall-run and dips on a hard landing | Fixed |

The library already has what this needs (1,283 clips): standing and running jumps, strafe jumps left and right, a
backward jump, front flips, a front twist flip and a backflip, dive, quick and side rolls, directional dodges, soft and
hard landings, a step-up, a vault, braced hang with shimmy and climb-up, jump to hang, diagonal wall-run, a run up a
wall, and a jump off a wall.

**Steps:**
1. Each move picks a variant as it starts, from which way it's going relative to the body and how fast:
   - jump: standing (straight up), running, strafing left or right, backward;
   - double jump: front flip going forward, twist or side flip going sideways, backflip only going backward;
   - roll: forward roll cut to include getting up; side rolls; a back dodge;
   - landing: soft, rolling or heavy, from the speed of the fall;
   - ledge: step-up or vault for low ledges, hang and climb-up for high ones.
2. The jump plays in phases (take-off, rise, top, fall, landing), each timed from the engine's real arc instead of
   fixed seconds.
3. The roll keeps the body facing where the camera aims and picks the clip for its direction, the way third-person
   shooters do. A forward roll no longer looks like a fall from behind.
4. Coyote time (0.1 s after leaving an edge), and a roll that stops at a ledge's edge.
5. Then the new moves, on marked surfaces only:
   - ledge hang and climb-up;
   - shimmy, if the clip reads smoothly;
   - wall-run for everyone for a fixed stretch, and a passive (F) for unlimited wall-running;
   - nav links so the bots use them;
   - the camera rolls into a wall-run.

Every step is checked from the seat with a filmstrip before it's called done.

## 3. The toy-scale casino (the House, rebuilt)

**Scale.** One scale for every real object: 1:15, so a 1.8 m hero is a 12 cm action figure. At 1:15 real furniture
lands on the House's existing heights, so the gameplay bands stay:

| Real object | Real size | At 1:15 | Gameplay |
| --- | --- | --- | --- |
| Stool foot ring | 0.30 m up | 4.5 m | Deck band: one jump plus a mantle |
| Roulette or card table top | 0.75 m | 11.25 m | Balcony band; the roulette wheel is a 12 m sunken dish arena |
| Cashier counter | 1.1 m | 16.5 m | Aerial band |
| Stepladder rungs | 0.28 m apart | 4.2 m apart | A climbing route: jump, catch, climb, rung after rung |
| Pachinko machine | 0.85 × 0.5 m | 12.75 × 7.5 m | Glass-faced walls in rows: wall-run lanes, with ledges at the ball trays |
| Slot machine | 1.8 m | 27 m | Towering walls and landmarks |
| Ball tray (red basket) | 0.4 × 0.3 × 0.15 m | 6 × 4.5 × 2.25 m | Cover, and a step onto higher things |
| Poker chip | 39 × 3.3 mm | 0.59 m across, 5 cm thick | Stacks as stairs (15 chips = one 0.74 m step) and as cover |
| Card | 63 × 88 mm | 0.95 × 1.32 m | Fanned out as bridges and ramps |
| Promo die | 0.18 m | 2.7 m | Cover cubes with rounded edges |
| Bar cart, card shoe, cardboard box | Real sizes | 1:15 | Platforms and cover |

Ziplines are cables strung between the counter, the slot tops and the ladder. A pachinko row with its glass faces is
the wall-run lane. Loose pachinko balls (17 cm) and chips are what breaks and scatters.

**Look.** The owner's reference image sets the layout and the objects: roulette, chip stacks, slot rows, a pachinko
wall, stools, ball trays, cardboard boxes, a stepladder, the cashier counter with a lucky cat, パチンコ & スロット
signage, tiled floor with hazard tape, and daylight from high windows. It is drawn hyper-real, shaded like anime, in
pastels: the §1 palette moved to pastel (blush, mint felt, powder blue, butter yellow, lavender, peach, with cream and
brushed metal). It is still real materials: lacquered wood, felt, chrome, acrylic, glass, ABS, cardboard. Emissives
stay on screens and lamps.

**Pipeline** (docs/ENGINE.md):
1. Gameplay layout in `engine/house.ts`: the pieces keep collision exact.
2. Blender scripts model each object from parameters, at 1:15. Detail goes into the modelling: pin fields, reels,
   chip edge spots, felt, brass.
3. Cycles bakes the light.
4. Meshopt and KTX2 pack it.
5. The client draws it over the collision pieces.

**Order:**
1. A look test: one corner (the roulette rail, chip stacks, a ball tray, a stool, the ladder, three pachinko machines)
   rendered in Blender at player eye height and from above, shown to the owner before the whole map.
2. The layout rebuilt around these objects, with the zones kept: Roulette Court, Chip Stacks, Card Ramp, the pachinko
   wing and the cashier heights.
3. Every object modelled and baked; the grey boxes retired.
4. A traversal pass from the seat on the new map.

**Open question for the owner:** the reference has hanging card-suit banners and trailing plants. Banners, trees and
greenery were ruled out on 2026-11-03, so they stay out unless the owner says these are fine.
