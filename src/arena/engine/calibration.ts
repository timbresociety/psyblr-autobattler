/**
 * Every tunable constant of the 3D arena engine lives here (KTD1, KTD2, KTD5). Bump the version on any change:
 * stored gate results stamped with an older version are re-checked.
 */
export const ENGINE_CALIBRATION_VERSION = 17

export const ENGINE = {
  /** Fixed ticks per second; every timing in the engine and the AI is a whole number of ticks. */
  tickHz: 60,
  /** The arena: x is across, z runs from one half to the other, y is up. Metres. */
  arena: { halfWidth: 56, halfLength: 42, ceiling: 25 },
  /** Every hero is a vertical capsule this tall and wide at medium size, plus its size class's hitbox. */
  /** Largest radius a hero collides with walls at; hit capsules can be bigger (huge, colossal). */
  bodyRadiusCap: 0.9,
  capsule: { height: 1.8, radius: 0.4 },
  /** Where shots leave from and melee measures to, as a fraction of capsule height. */
  chest: 0.6,
  /** Ultimates start this far into their cooldown, seconds. */
  ultimateStartCooldown: 25,
  /** Health fraction that fires lowHealth passives. */
  lowHealth: 0.35,
  /** Damage per hit varies by up to this fraction either way. */
  variance: 0.12,
  /** An area heal, shield or buff delivers at most this many allies' worth in total, shared across everyone it hits. */
  alliesShare: 3,
  /** An area hit lands in full on up to this many enemies; more share it. */
  areaShare: 3,
  /** Burst heals landing on one hero inside this window weaken each other (stacked healers), seconds. */
  healWindow: 3,
  /** Each recent burst heal cuts the next one by this fraction. */
  healFalloff: 0.35,
  /** Default radius for an "allies" effect without its own radius, metres. */
  alliesRadius: 8,
  /** Melee reach beyond the skill's range, metres. */
  meleeSlack: 0.5,
  /** Dashes, blinks and grapples hit the nearest enemy inside this arc, degrees. */
  lungeArc: 40,
  /** A knockback or pull plays out over this long, seconds. */
  knockbackTime: 0.25,
  /**
   * Knockback physics (§5, §6b): a blow along the ground throws its target in an arc `hop` metres high for each metre
   * of push (at most `hopMax`); a heavier body goes less far (the push divides by its scale to the power 1.5, so a huge
   * body travels 0.67 of a medium one's push and a tiny one 1.4 times); slamming into a wall stops it, and a breakable
   * piece it slams into takes `slamDamage`.
   */
  knock: { hop: 0.18, hopMax: 1.2, slamDamage: 200 },
  /** A hit worth this fraction of the target's health counts as heavy (hit-stop and launch on the client). */
  heavyHit: 0.12,
  /** Ground-disc zones reach heroes this close to the floor, metres. */
  groundReach: 1.5,
  /**
   * Moving like Deadlock (Forge goal, phase 2): nobody flies. On the ground a hero eases toward the speed it wants at
   * `accel` (m/s²); in the air it keeps its momentum and steers at `airAccel`, falling at `gravity` up to `fall` m/s. A
   * jump rises `jump` metres; a second jump in the air rises `airJump` from wherever it starts and spends a stamina pip.
   * A dash spends a pip to cover `dash.speed` m/s for `dash.time` seconds along the way the hero steers (or faces),
   * level in the air too. Crouching at `slide.from` of run speed or more slides: it starts at `slide.boost` times run
   * speed and eases to `slide.end` over `slide.time` seconds, turning at most `slide.steer` radians a second, with the
   * body `slide.height` of its height, low enough for a shot at the chest to pass over. Stamina holds `stamina.max`
   * pips and refills one every `stamina.regen` seconds. A hero steps up anything `step` metres high without jumping
   * and stands on top of cover.
   */
  move: {
    accel: 60,
    airAccel: 12,
    // heavier than earth's so a big jump still takes about a second up and down
    gravity: 34,
    fall: 45,
    // GAME.md §5: jumps big and dynamic like anime fights, a medium hero's first 4.2 m and its second 3.4 m, scaled by
    // size (`jumpScale`): tiny heroes jump highest, colossal ones lowest. §7's ~1.5 m was a target until measured;
    // the House of Instinct's spacing is built on these measured heights instead (traversal.test.ts)
    jump: 4.2,
    airJump: 3.4,
    jumpScale: { tiny: 1.25, small: 1.12, medium: 1, large: 0.88, huge: 0.76, colossal: 0.66 },
    dash: { speed: 18, time: 0.2 },
    /**
     * Shift pressed dashes ahead at once; held on, it sprints at `speed` times run speed once the dash is spent: a
     * 6.5 m/s jog sprints at 8 (GAME.md §7).
     */
    sprint: { speed: 1.23 },
    /** Crouched and prone heroes move at these shares of run speed, their bodies these shares of their height. */
    crouch: { speed: 0.55, height: 0.7 },
    prone: { speed: 0.22, height: 0.35 },
    /** Z rolls `distance` metres along the facing in `time` seconds for a stamina pip, untouchable for its first `iframes`. */
    roll: { distance: 5, time: 0.55, iframes: 0.3 },
    /** X holds a guard: melee from in front lands on it, at `speed` times run speed. */
    block: { speed: 0.35, arcDegrees: 140 },
    slide: { from: 0.8, boost: 1.4, end: 0.75, time: 0.9, steer: 1.5, height: 0.55 },
    stamina: { max: 3, regen: 3.5 },
    step: 0.4,
    /**
     * Traversal (GAME.md §7). Pressing into a ledge up to `height` above the feet, on the ground or in the air, with
     * room to stand on top, pulls the hero up over `time` seconds, out of control; `reach` is how far ahead of the
     * body it looks for the top.
     */
    mantle: { height: 1.4, time: 0.5, reach: 0.45 },
    /**
     * Landing at `big` m/s or more (a fall well past a jump's own height) rolls when the hero steers, keeping its
     * speed, and lands heavily, stopping, when it doesn't. Never any fall damage.
     */
    landing: { big: 20 },
    /**
     * Ziplines and rails (§7): a hero in the air whose hands (a zipline) or feet (a rail) come within `grab` metres of
     * one rides it at `speed` m/s the way it was moving (away from the end, when caught within `endGrab` metres of
     * one); a jump lets go with a jump, the end lets go with the speed.
     */
    zip: { speed: 15, grab: 0.8, hang: 0.25, again: 0.5, endGrab: 1.5 },
  },
  /**
   * Melee (the canon, 2026-10-31). V tapped strikes; held past `heavyHold` it charges and lands a heavy blow on
   * release, worth `heavy` times a strike charged for nothing to `heavyFull` charged for `chargeFull` seconds, launching
   * the target as high as a jump. Strikes that land chain while each follows the last within `chain` seconds: the
   * third is the finisher, worth `finisher` times, launching as high as a double jump. A guarded strike breaks the
   * striker's chain and staggers it for `blockStagger` seconds. A launched hero is out of control and untouchable until
   * any input after `regainAfter` seconds takes control back, and it falls from there.
   */
  /**
   * Skill 1 is a gun (the canon, 2026-11-02): held, it fires `rate` times the sheet's fire rate a second, never faster
   * than one shot every `fastest` seconds (combat.ts, shotTemplate).
   */
  primary: { rate: 2.2, fastest: 0.16 },
  /**
   * The ranged weapon (§5). A magazine holds the weapon's shots times the sheet's ammo over `ammoReference`; an empty
   * one reloads at once, and one left unfired for `topUp` seconds reloads too. Bloom (radians of random spread) starts
   * at the style's `base`, grows `perShot` a shot and falls `recover` a second, plus `moving` at a run and `airborne`
   * in the air, never past `max`. Pellets spread over the weapon's cone; a burst's shots are `burstGap` seconds apart.
   * Shots leave the muzzle (`muzzle`: height, forward and right of the feet, as shares of the body's height) and fly at
   * the point the crosshair covers.
   */
  ranged: {
    topUp: 2.5,
    base: { pistol: 0.012, rifle: 0.006, thrown: 0.018, magic: 0.01 },
    perShot: 0.012,
    recover: 0.02,
    moving: 0.03,
    airborne: 0.05,
    max: 0.12,
    burstGap: 0.07,
    muzzle: { pistol: [0.72, 0.3, 0.12], rifle: [0.75, 0.42, 0.1], thrown: [0.8, 0.22, 0.16], magic: [0.72, 0.32, 0.08] },
  },
  ammoReference: 12,
  /** The passive (§4 F): a power that lands once as it switches on spends this share of its meter to do it. */
  passive: { switchCost: 0.35 },
  melee: { heavyHold: 0.28, chargeFull: 1, heavy: 1.25, heavyFull: 1.8, chain: 0.7, buffer: 0.45, finisher: 1.4, blockStagger: 0.4, guardBreak: 0.6, regainAfter: 0.2, launchPush: 4, lungeArc: 70, lungeTime: 0.12 },
  /** Shreds can't push a resist below this. */
  resistFloor: -20,
  /** No armor or spirit resist takes more than this percentage off a hit. */
  resistCap: 75,
  /** More damage taken (vulnerable, marks) stacks to at most this fraction. */
  vulnerableCap: 0.5,
  /** Healing taken can be cut (wound) by at most this fraction. */
  woundCap: 0.75,
  /** Evasion can make a basic attack miss at most this often. */
  evasionCap: 0.5,
  /** Enemies this close see through stealth, metres. */
  revealRange: 3,
  /** The hit that wakes a sleeping hero deals this much more. */
  wakeBonus: 0.5,
  /** A turret's shots, and anything a field or trap catches, reach heroes this close to the floor. */
  fieldHeight: 2.5,
} as const

export const DT = 1 / ENGINE.tickHz

/** Seconds to whole ticks, rounded up so a 0.1 s stun is never zero ticks. */
export const ticks = (seconds: number) => Math.ceil(seconds * ENGINE.tickHz - 1e-9)
