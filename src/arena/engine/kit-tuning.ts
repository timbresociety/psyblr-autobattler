/**
 * The tunables of the locked library's new pieces (GAME.md §4, session 2). They sit apart from `ENGINE` because the
 * balance gate's AI-only fights never reach them (`MatchState.fullKit` is off there), so changing them leaves stored
 * gate results valid. Seconds and metres throughout.
 */
export const KIT = {
  /** X pressed this soon before a close blow lands parries it: no damage, the striker staggers for `stagger`. */
  parry: { window: 0.15, stagger: 0.8 },
  /**
   * A knockdown: lying `time` seconds after a finisher, a heavy blow, a launcher, a spike or a throw lands, then
   * `rise` seconds getting up, untouchable. A dodge or a jump after `techAfter` rolls out at once instead.
   */
  down: { time: 0.9, rise: 0.4, techAfter: 0.2 },
  /** V at a sprint: worth `worth` strikes, carrying the body `lunge` metres in, and pushing the target `push` metres. */
  dashAttack: { worth: 1.3, lunge: 3, push: 3 },
  /**
   * V in the air: worth `worth`. A hit holds an airborne target where it is for `hold` seconds, bumped `bump` metres,
   * and the striker with it; the third air hit spikes it down at `spike` m/s.
   */
  air: { worth: 0.8, hold: 0.45, bump: 0.35, spike: 26 },
  /** V held in the air plunges at `speed` m/s; landing strikes everyone within `radius`, worth `worth`, popping them `pop` metres. */
  slam: { speed: 32, radius: 2.8, worth: 1.6, pop: 1.2 },
  /** Back + V: worth `worth`, throws the target `height` metres straight up; a jump within `chase` seconds follows it. */
  launcher: { worth: 1, height: 6.5, chase: 0.8 },
  /** V + X close in: catches the nearest enemy within `reach` ahead (`arc` degrees), holds it `hold`, then throws it `throw` metres, worth `worth`. */
  grab: { reach: 1.4, arc: 100, hold: 0.45, throw: 7, worth: 1.5 },
  /** At no health with an ally still standing, a hero is downed for `bleed` seconds; an ally holding the interact key within `reach` for `time` revives it at `health` of its max. */
  downed: { bleed: 12, reach: 1.9, time: 2.5, health: 0.3 },
  /**
   * Wall run (§4 shared walls): an airborne hero moving at least `minSpeed` across into a marked wall runs along it at
   * `speed` for `time` seconds, sinking `sink` m/s; a jump kicks off it `push` m/s out with a full jump, and gives the air
   * jump back. Not again for `again` seconds.
   */
  wallRun: { minSpeed: 4, speed: 9, time: 1.1, sink: 0.6, push: 7, again: 0.35 },
  /**
   * The locked library's ranged families (§4 LMB), beside ENGINE.ranged's: each style's bloom `base`, and its muzzle as
   * shares of the body's height up, ahead and to the right of the feet (the body emitter fires from the eyes, paired guns
   * from each hand in turn: the left mirrors the right).
   */
  ranged: {
    base: { emitter: 0.004, paired: 0.02, heavy: 0.014, bow: 0.004 },
    muzzle: { emitter: [0.93, 0.08, 0], paired: [0.72, 0.3, 0.14], heavy: [0.84, 0.36, 0.14], bow: [0.78, 0.32, 0.04] },
  },
  /**
   * How shots fly (§4 LMB): a lobbed shot falls at `gravity` m/s² and is thrown to come down where it's aimed (no
   * steeper than `steepest` up); a bouncing one bounces `bounces` times unless its template says; homing turns at most
   * `homing` and guided at most `guided` radians a second; a homing shot locks the nearest enemy within `lock` degrees
   * of the aim.
   */
  flight: { gravity: 22, steepest: 0.8, bounces: 3, homing: 3.5, guided: 6, lock: 30 },
  /**
   * Beams that meet clash (§4 Systems): two held beams whose lines pass within their widths. The clash point starts
   * between them and moves `push` of the way a second toward the side whose beam is weaker, by the share it's weaker
   * (`least` at worst, so an even clash still moves with each side's mashing: every fresh press adds `mash`). Reaching a
   * caster, that side's beam breaks and it takes `burst` times the winner's beam damage. Two seconds of a clash give
   * way to whoever leads.
   */
  clash: { push: 0.35, least: 0.08, mash: 0.12, burst: 3, longest: 6 },
  /**
   * The E row's ways of moving (traverse.ts). Teleport and swap take the hero the crosshair is within `lock` degrees of,
   * a homing dash the enemy within `homingLock`. Flight goes `flightSpeed` times run speed and climbs or sinks at
   * `flightRise` m/s; a glide `glideSpeed` times run speed, falling no faster than `glideSink`. A swing starts with a
   * `swingKick` m/s push along the aim, steers at `swingPull` m/s², and lets go with `swingRelease` m/s up. Crawling
   * climbs at `climb` times run speed, burrowing goes `burrowSpeed` times it, a rider sits at `rideHeight` of its
   * mount's height, a combat roll takes `rollTime` seconds and a power slide goes `slideSpeed` m/s.
   */
  /**
   * An elemental sheath's hits (systems.ts): flame burns on for `share` of the hit over `seconds`, frost slows by `pct`
   * for `seconds`, lightning leaps `share` of the hit to the next enemy within `reach` metres.
   */
  element: { flame: { share: 0.3, seconds: 2 }, frost: { pct: 30, seconds: 1.5 }, lightning: { share: 0.35, reach: 5 } },
  /** The power meter (§4 Systems) fills by damage dealt over `dealt` times the hero's health, and taken over `taken` times it. */
  power: { dealt: 1, taken: 1.5 },
  /** Each stage of a staged form past the first adds `damage` to its hits (and a size class). */
  stage: { damage: 0.15 },
  /** A Strike's last blow throws its target `finish` metres. */
  lockon: { finish: 5 },
  /** Fusion takes the nearest ally within `reach` metres; the fused hero hits `damage` harder and gets `shield` of the ally's health as a shield. */
  fuse: { reach: 4, damage: 0.5, shield: 0.5 },
  /**
   * A team-up throw: an ally within `reach` metres throws the hero `throw` metres along its aim over `flight` seconds,
   * `arc` metres high; it lands for `damage` on everyone within `radius`. Once each `again` seconds.
   */
  teamUp: { reach: 2.2, throw: 12, flight: 0.7, arc: 3, radius: 2.5, damage: 80, again: 10 },
  traverse: { lock: 12, homingLock: 25, flightSpeed: 1.4, flightRise: 5, glideSpeed: 1.35, glideSink: 2, swingKick: 6, swingPull: 8, swingRelease: 4, climb: 0.7, burrowSpeed: 1.2, rideHeight: 0.75, rollTime: 0.45, slideSpeed: 14 },
} as const
