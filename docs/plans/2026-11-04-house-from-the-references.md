# Plan: the House from the owner's three references, 2026-11-04

**Superseded the same day:** the owner asked for a complete rebuild of the map, traversal and platforming, not a re-dress (docs/plans/2026-11-04-handoff-map-and-animation-rework.md). The object list, the scale and the zone ideas below still apply.

The owner's references (docs/reference/2026-11-04-lucky-floor.png, -pachinko-boulevard.png,
-skyline-jackpot-atrium.png) set the look, the objects and the perspective. The owner left the layout to us: "You know
what'll work best with current traversal and animation constraints."

Clarified the same day: the ban on banners and greenery meant the old Roman-arena banners, the scenery around the map
and that generated-asset style. Hanging casino banners and indoor plants are fine.

## What the references share

- **Inside, in daylight.** A bright parlour hall: glass roof or high windows, warm cream walls, brass and wood trim, and
  pink, mint, butter and powder-blue felt and lacquer. It is dense with real objects, and the screens and lamps glow.
- **Toy scale.** Heroes stand as tall as a stack of 15 chips. Every route is made of things you could buy:
  - chips, cards and dice;
  - roulette wheels;
  - pachinko and slot machines;
  - stools, ball trays, boxes and ladders;
  - the cashier counter and the lucky cat.
- **One central hub with loops round it.** The Lucky Floor's Roulette Court, the Boulevard's Spin Plaza and the
  Atrium's Jackpot Plaza are each a round sunken or raised floor with:
  - an inner loop for brawling;
  - an outer loop for rotating;
  - a high VIP route with sightlines;
  - a low service route for flanks.
- **Readable traversal, marked in colour.** Each route type has its own mark:
  - wall-run lanes on pachinko glass;
  - ledges at ball trays and counter tops;
  - ziplines strung between high points;
  - dodge-roll gaps under tables;
  - knockback edges at the wheel's rim.
- **Vertical range.** About −6 to +16 m, in four or five bands, close to the House's own bands (0, 4.5, 11 and 16.5 m, with the service tunnel below).

## The call: re-dress the House we have, zone by zone, rather than draw a new layout

The House's layout already does what the references show:
- a central Roulette Court;
- four bands;
- mirrored halves;
- loops;
- a service tunnel;
- ziplines;
- a nav graph the bots path on;
- a balance gate that passes on it.

A new layout would throw all of that away to buy a different floor plan, which the owner did not ask for. What is
wrong is the look: grey and primary-coloured boxes. So each zone keeps its collision and gets the reference's objects
modelled over it, at 1:15:

| House zone | Becomes (reference) | Objects at 1:15 | Traversal it carries |
| --- | --- | --- | --- |
| Roulette Court | Roulette Court / Spin Plaza / Jackpot Plaza | A 12 m sunken wheel dish with a chrome turret; the rail ring as the inner loop; chip-stack steps up | Knockback edges at the rim; dodge-roll gaps between the frets |
| Card Ramp / Card Hall | Card Hall / Card Rampart | Fanned and leaning cards as ramps and bridges; poker tables at 11.25 m as broad platforms; dealer shoes as cover | Dashes along the card bridges; ledge hangs at the table edges |
| Chip Stack Balconies | Chip Market | Chip stacks of 0.74 m steps as stairs; dice as cover cubes | Jump, mantle, jump; rolls between stacks |
| Pachinko Alley (each flank) | Pachinko Run / Machine Gallery | Rows of 12.75 m pachinko machines, glass-faced; ball trays as ledges | **Wall-run lanes** on the glass, the marked surfaces of §7; hangs at the trays |
| Pachinko Spire | Pachinko Tower | Stacked machines round a spiral ramp; ring landings | Vertical loop; ziplines off the top |
| VIP Crescent and balcony loop | VIP Balcony / Skybridge VIP Walk / Overlook Café | A brass-railed mezzanine with lounge chairs, glass partitions and potted plants | High-ground route; zipline anchors |
| Service tunnel and trenches | Service Bay / Ball Return Depot | Conveyors, ball hoppers, crates and pipes under the floor | Flank route; low cover |
| Prize Counter halls | Cashier counter and prize wall | A 16.5 m counter with the lucky cat; prize shelves; a stepladder | Aerial band; the ladder as a climb chain |
| Slot Canyon, Gacha Arcade | Slot rows, capsule machines | 27 m slot machines as walls and landmarks; capsule machines as platforms | Side ledges; ziplines between slot tops |
| The hall itself | The parlour | Glass roof or high windows with daylight; cream walls; パチンコ & スロット signage; hanging card-suit banners | — |

Pieces that are mechanically new to the map are added where the re-dress needs them, each checked by the nav and
balance gates:
- marked ledges (§7) at the tray and table edges;
- wall-run glass on the pachinko rows;
- zipline cables between the slot tops, the counter and the tower.

## Why this fits the current constraints

- **Ledge hang.** Built 2026-11-04: on a 2 m+ sheer edge, a played hero walking off catches it. The tables (11.25 m
  tops) and the pachinko trays give it edges at every band. Any sheer edge counts today. When marked ledges land, the
  hang narrows to the marked ones, as §7 says.
- **Wall-run.** Only on marked surfaces. The pachinko glass gives long, straight, readable lanes, and the clip we have
  (a diagonal wall-run) suits straight walls, not curves.
- **Animation.** The library's ledge clips assume square edges. Card edges and table rims are square; the wheel's rim
  is a knockback edge, not a hang edge.
- **Camera.** The shoulder camera pulls in at walls. Under-deck spaces (the service bay) need 3 m+ of headroom so it
  isn't forced into the hero (a known issue). The depot is built that tall.

## Look and pipeline

As in docs/plans/2026-11-04-feel-and-toy-casino.md §3:
1. Blender models each object from parameters at 1:15.
2. Cycles bakes the light.
3. Meshopt and KTX2 pack it.
4. The client draws it over the collision.

The style is hyper-real shaded anime in pastels. The references add:
- warmer light;
- denser dressing, meaning many small props on every surface;
- brass;
- hanging banners;
- indoor plants.

**Order:**
1. The Roulette Court corner as the look test, rendered at hero eye height and from above, shown to the owner.
2. The pachinko row with wall-run glass and tray ledges, with wall-run built alongside it.
3. The other zones, one at a time, each with a traversal pass from the seat.
4. The hall: windows, signage, banners, plants.
