# Playtest: traversal and melee, 2026-11-03

Played from the seat: held time, one frame every 3 ticks (50 ms), keys pressed through the page like a player's, over
the shoulder of Kestrel Stormcall (a melee hero) in the House of Instinct, in a headless Chrome on WebGPU. Exact
timings came from the engine itself in Node. Frames, rows and probe scripts are in `.scratch/play/` (not committed):
`c-jump2.jpg`, `c-roll2.jpg`, `c-mlow.jpg`, `c-mhigh.jpg`, `c-melee2.jpg`, `c-charge.jpg`, and `rows.json` per
scenario.

## Is it Rapier?

No. Rapier only tumbles knocked-back bodies and debris; the engine owns all movement and never reads it. The engine's
movement measured as designed: the jump arc, the roll's 5 m in 0.55 s, mantles that start where they should. Every
problem below is in the animation, the melee rules, missing moves or the camera, and none would change with Rapier
driving the hero. Moving the hero onto Rapier would break exact replays, the bots' paths and the balance gate. Unreal
doesn't use a physics body for this either: its character movement is kinematic code that sweeps a capsule. Rapier
(or our own shape casts) could help later with detecting walls for wall-runs, but the engine's boxes are enough for
marked surfaces.

## Findings, worst first

1. **Melee is slow because the combo runs at attack speed.** A swing can start only every 1 / attackSpeed seconds:
   0.65 s for the default fighter (1.54 a second), 0.97 s for Kestrel (1.03). Mashing V every 100 ms for 3 s gave
   4 swings. Each is about 0.25 s of motion followed by about 0.7 s of standing idle, and presses during that wait are
   lost after 0.45 s. Light chains in action games run at roughly 0.3 to 0.4 s a hit.
2. **The heavy charge reads wrong.** For the first 0.28 s of holding V nothing changes on screen (idle pose). Then the
   charge plays `standing_block_start`, a guard being raised, so it looks like blocking. The hero is also slowed and
   the screen tints orange. Releasing strikes 0.13 s later.
3. **Jump, double jump and roll don't match their clips.**
   - Jump: `run_jump` plays for 0.3 s of a 0.47 s rise, then the falling loop. The figure is upright with its arms out
     the whole way: no crouch before take-off, no tuck, nothing at the top.
   - Double jump: plays `backflip` on a jump that goes up and forward; on screen it's an arms-up reach.
   - Roll: from behind, the hero lands on its back with its feet in the air and its head toward the camera. It reads as
     a fall, not a forward roll, then snaps up into a run.
   - Landing after a 4.5 m drop while moving: no landing pose; it goes straight from falling to running.
4. **One pull-up clip for every ledge.**
   - On a 1.2 m box the hero reaches far above the top, as if hanging from a high wall, and its legs pass through the
     box. It ends with a snap to standing.
   - Caught mid-jump with its feet only 0.37 m under the top, it still plays the climb from a full hang.
   - There is no hanging, and no climb-up from a hang.
   - Only 4 spots in the whole House have a 0.9 to 1.4 m ledge with room to run up to it.
5. **No coyote time.** A jump pressed 17 ms after running off an edge is taken as the double jump. It costs a stamina
   pip and uses up the second jump.
6. **Jump size.** The first jump rises 4.06 m, the second 3.27 m more: 7.33 m at the top and about 1.5 s in the air.
   That fits §5's "big, dynamic, anime-sized", but §7's table still lists ~1.5 m and ~2.7 m as targets. With a 0.3 s
   jump clip it reads as floaty.
7. **A roll off a ledge keeps rolling in mid-air** and pushes into whatever wall it meets, for its full 0.55 s.
8. **Camera and HUD.** At 1600×813 the blurred hero card at the bottom left sits over the hero's legs. During the high
   mantle and the heavy blow the hero drifts to the bottom-left edge, under the card. On taking control at the start,
   the camera swoops in from the overview, so the hero is off screen for about 0.3 s.

What works: the arcs and distances are consistent, an early jump or roll is buffered, the roll's untouchable window
shows, mantles trigger reliably on the ground and in the air, and the camera never went inside geometry in these runs.

## Owner decisions (2026-11-03)

- Wall-run on marked surfaces only. Every hero can wall-run for a fixed short stretch; a passive (F) lets its holder
  wall-run without limit.
- Ledge hang and climb-up on marked ledges. Shimmying along the edge only if a smooth animation exists for it.
- Marked means the arcade-yellow traversal marking (§1, §8).

## Fix order proposed

Each fix gets its own seat pass and filmstrip before it's called done.

1. Melee pace and the charge.
   - Strike on press.
   - The light chain at a fixed quick beat (about 0.3 s a step), however fast the hero's attack speed. Attack speed
     would then scale the damage of the chain instead of its pace. That changes balance, so it goes through the gate.
   - The charge starts with a wind-up pose from the first frame, using its own clip instead of the guard.
2. Coyote time (about 0.1 s after leaving an edge), and a roll that ends at a ledge edge instead of rolling in the air.
3. The animation state machine.
   - Phases: take-off, rise, apex, fall, land.
   - Each phase timed from the engine's real arc instead of fixed seconds.
   - A forward tuck for the double jump.
   - A roll clip and cut that read as a forward roll from behind.
4. Ledges.
   - A vault or step-up clip for low ledges, a hang-and-climb for high ones.
   - A hang state on marked ledges.
   - Then wall-run on marked surfaces, and the passive.
   - The bots get nav links for both.
5. The HUD card and camera framing around the hero.
