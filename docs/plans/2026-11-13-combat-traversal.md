# Combat and traversal pass: what changed, and how it is checked

2026-11-13. Part of session 2 (`docs/plans/2026-11-11-session-2-handoff.md`): the owner's brief was that combat and
traversal still didn't feel smooth, with a list of faults to check against the code and a local motion pack to move
on. This is the record of what was found, what was changed and how each change is checked. `docs/GAME.md` stays the
only spec; the one line added there is the interact key (§3).

## The contract

One owner for each thing, written where it lives (`src/arena/client/animation.ts`):

- **The simulation owns what a hero does:** where it is, what it may start, what cuts it short, when a blow lands.
- **The animator owns what the body shows.** It reads the engine's state every frame, and the engine's events only
  for what state can't say (that a landing just happened, and how hard). It decides every transition.
- **The view plays the state it is handed.** It never holds a clip past its state and decides no transition. (Before,
  `characters.ts` kept a one-shot clip playing until it finished, whatever the animator said: a hero that was hit and
  ran on slid along in its flinch.)
- **One clock.** Everything timed runs on the engine's clock, in ticks: a cast's wind-up and recovery, a roll's or a
  mantle's progress, how long a landing holds. A pause, a slowed practice room, a hit-stop and a 30, 60 or 120 Hz
  display show the same pose at the same moment of the fight. (Before, one-shots counted down on the wall's clock.)
- **A jump has no timer.** Its take-off, rise, top and fall are read off how fast the body is rising, so they fit
  every size's jump, a second jump, a jump pad and a head stopped by a ceiling alike. (Before, the jump clip held the
  body for 0.42 s: a hero that hit a ceiling fell in its take-off pose.)
- **A cast is the engine's action, never a memory of one.** It shows while the engine's action is still that one. An
  action the engine dropped early, with or without an event, stops showing at once. (Before, the animator kept its own
  copy of the cast from the event: a blow whose recovery was cut by a knockback, or a blow dodged out of, played on
  over the roll or the fall.)
- **Who wins** when states overlap is one list, in `settle`: dead; knocked down; launched; stunned; a ledge, a wall
  run or a held E move; a roll; a cast; a ride; a slide or dive; a dash; a landing or other one-shot; a charge; a guard;
  the air; crouched or prone; running; standing.
- **Every engine move is mapped.** `MOVE_SHOWS` and `TRAVERSE_SHOWS` are exhaustive records: a new engine move does
  not compile until it is given a one-shot or marked as shown by its state. (Before, the event's name was cast to a
  clip name; a wall run, a pad and the E moves fell through and showed as a fall or the stance.)

## Who moves the body

- **The engine.** A pack clip's `Root` track (its authored travel across the floor) is dropped as it loads and kept
  only as a note. What stays on the hips is the body's own motion about the spot the engine holds: a landing's dip, a
  stride's bob, a lean. `Root` never reaches the upper-body layer of a cast, since it is not in the clip at all.
- **A climb is the one move that follows its clip's travel.** A mantle's or a climb's clip carries its own way up and
  over: on the pack's `Root`, and in the library's hips, from which it is taken out and kept (`travelled`,
  `library-gait.ts`). The body is drawn along it from the top of the real ledge down (`climbAlong`, `match-view.ts`),
  and the clip is played from the moment its hips are as far under the top as this body's are as it starts: all of it
  from a hang, the last of it (the push up and over) onto something low. So the hands stay where the clip has them on
  the ledge whatever its height, the body ends exactly where the engine's climb ends, and nothing rises twice. The
  engine's own straight path stays what collides and is hit.
- **A landing taken at a run keeps the run.** Nothing holds the body; the hips sink over legs that go on striding
  (each foot kept where its stride has it by the leg IK), up to 20 cm for a hard fall, down in 0.07 s and back in 0.3.
  The gait keeps the pace it had through the air, so it lands running rather than walking up to a run again.
- **A falling body's feet ride at its base,** where the floor will meet them. The library's fall tucks its legs 20
  to 27 cm up, so it touched down in the air and stretched to the floor after; the body now eases down by as much over
  the fall (`feetDown`, `characters.ts`), on any clip set.
- **A ground move that loses the floor falls at once:** a roll, a slide or a landing off an edge goes straight to the
  fall.

## Contact marks follow the clip

Every clip made from another carries its source: the clip it began as, and where in that clip each of its seconds
falls (`clip-source.ts`). Marks (where a blow lands, when each foot is down) are looked up under the source's name and
moved onto the clip that plays. Before this, marks were read by the name a clip played under: an engine move such as
`slash` took the body file's 0.2 s mark while playing the library's `jab_cross`, a clip cut or retimed kept its
source's times, and foot tags for `land` or `roll` were whatever clip of that name the index happened to hold.

## Combat rules

- **Timing was already the engine's:** every cast has a wind-up, a release tick and a recovery (`timing.ts`), how
  fast the hero may move through each (`moveShare`), and what may cut in (`free`). A strike tapped early waits
  (`queued`); a jump or roll pressed early waits 0.2 s (`buffer`). Those are unchanged, as are every damage, cooldown
  and stat budget.
- **New: a played hero's roll cancels its action in progress.** A blow still winding up never lands and a recovery
  ends there (`locomotion.ts`). Before, the blow went on inside the roll and landed from it. A wind-up that roots the
  hero (an ultimate's) still can't be rolled out of. It is the played hero's rule only, as the jump buffer and coyote
  time are: with every hero cancelling, the melee roles lose enough that the balance gate retunes the field (the
  default mage no longer passes unretuned, and the small size class averages 0.566 against a 0.55 ceiling). The AI's
  blows go on through its rolls as before, the gate's fights are unchanged and `ENGINE_CALIBRATION_VERSION` stays 17.
  **Confirmed by the owner, 2026-11-13:** cancels are for played heroes only.
- **The contact frame meets the release tick, then the clip follows through at its own pace.** Before, everything
  after the contact was squeezed into the engine's recovery (0.18 s for a basic blow), three to six times too fast.
  Now the engine's recovery plays that much of the follow-through, and the rest plays on while the hero does nothing
  else with its body; anything cuts it (a step, a jump, the next blow, a hit).
- **The full kit is on in every match played in the browser** (`RecordedSetup.fullKit`), as `state.ts` already said
  it should be; before, only the lab turned it on. The balance gate's AI-only fights stay without it. An older
  recording says nothing of it and replays as it was played. `fullkit.bench.test.ts` compares AI-only matches with it
  off and on: every match ends, and the same side wins in 9 of 10. The AI never holds the interact key, so its downed
  bleed out; teaching it to revive is not part of this pass.
- **G is the interact key** (revive, team-up). Nothing was bound to it, so a player could do neither. **Confirmed by
  the owner, 2026-11-13.**
- **States the full kit reaches now show:** lying knocked down, getting up, the tumble back to control in the air, a
  wall run, a glide, a swing, a wall crawl, a ride. Before, each showed as stunned, a fall or the stance.

## The motion pack

The owner's local pack lives in `.scratch/motion-pack` (gitignored) and is read only by the dev server
(`motion-pack.ts`). A build has no pack and every hero moves on the licensed library, as it does for every move the
pack has no clip for. Nothing of the pack is in `public/`, in a commit or in a deploy.

- Clips are resolved through the pack's index (`actions`, then the listed `file`); no path is guessed.
- Only the movement set (`PACK_MOVES`, 31 engine moves), the gait's stance and three loops (walk, jog, sprint) and the
  equipped kit's own clips (`PACK_KIT`: the fists' three-blow chain) are fetched: about 40 files, not 4,185.
- **Each attitude has a motion set of its own** (`PACK_STYLES`, below): its stance, walk, jog, sprint, jumps, landing,
  dash and chain come from that set, and the moves every set shares (the ledge, the crouch, the reactions, the dodge)
  from the plain one.
- Each was looked at frame by frame on the medium body before it was given a move. Each blow's contact is read off
  the striking hand and checked on the course.
- A pack clip is keyed on the male medium body's rest; `fitClip` reads it off that body whoever plays it.
- `?motion=library` plays the licensed library alone, for comparing.

## The course

`scripts/course.mjs` drives John through each acceptance sequence from the seat, a frame at a time at a display's own
rate (`seat.frame(seconds)`), in a private headless Chrome. Each sequence writes a filmstrip (side view, and the
player's own view) and a row per frame: the engine's state, the animator's state, the clips playing with their
weights, and where the feet, hips and hands are from the engine's position.

    COURSE_BASE=http://localhost:3110 node scripts/course.mjs --out .scratch/course/run
        [--fps 30|60|120] [--john body:tiny|…|body:colossal] [--gender f] [--physique heavyweight|lanky|…]
        [--v unarmed|blade|…] [--motion library] [--only mantle,hang] [--entry lobby]

`--entry lobby` starts an ordinary match from the lobby instead of the lab and plays the `match` sequence there.

The lab gained what the course needed: a low block, a slab overhead and a tower to hang from (the 2.1 m ledge is too
low for a medium body to hang from). **The lab's own pieces were not being drawn:** the baked house draws only its own,
so the wall, the column and the ledge added on 2026-11-11 blocked unseen. They are drawn now (`greybox.ts`).

Output is local debug data and stays in `.scratch`.

## Checked on the course

Medium John, the pack's movement set, 60 Hz, unless said. "Ran" means the engine did the move and the filmstrip was
looked at; numbers are from the rows.

| Sequence | Result |
| --- | --- |
| Run, jump, land, run on | Take-off, rise, top, fall, then the run with the hips sunk 16 cm; feet 1 to 3 cm off the floor at touchdown (27 cm before); speed kept (6.96 m/s) |
| Jump under the slab | Head stops at 1.4 m; goes over the top and falls at once |
| Second jump, turn in the air | Take-off again from the top, lands running |
| Dodge into run, two dodges, dodge off an edge | Roll, run, roll; off the edge it falls at once |
| Slide into crouch into run | Slide, crouched walk, run |
| Crouch, prone, crawl, stand | Each state its own clip |
| Low mantle | Onto the 1 m block and on, along the clip's own path; rises into the run with no snap |
| Mantle from a jump | Onto the 2.1 m block |
| Catch, hang, shimmy, climb, let go | Hands on the rim through the hang and both shimmies |
| Jump to the tower, catch, climb | Catches at the top of the jump |
| Wall run, wall jump | Shows as a run along the wall (a fall before) |
| Zipline to its end, land | Rides, lets go, lands running |
| Run, fire, jump, land | Legs keep running under the shot |
| Three-blow chain | Each contact on its release tick; follow-through plays into the next blow |
| Heavy charge and release | Charge draws back, blow lands |
| Air blow; dodge out of a blow | The roll shows as a roll (the blow's pose before) |
| Ordinary match from the lobby | Full kit on, pack clips playing, same states |

**On the licensed library alone** (`--motion library`, what a build ships), the same 17 sequences run with the same
states and no page errors. The contract, the jump's phases, the running landing (hips sunk 16 cm, feet within 1.5 cm
of the floor at touchdown, 27 cm before), the cast and roll rules and the follow-through all hold there. **Its mantle
is fixed too** (later the same day): onto the 1 m block both hands stay within 8 cm of its top through the push, the
feet come up onto it and never go under it (37 cm under before), and from a hang the hands stay within 10 to 20 cm of
the rim while the hips rise 1.8 m in one motion. Its ledge hang, dodge and blows are the clips it had.

Also run on the pack, same states and no page errors: 30 and 120 Hz (the jump's phases change on the same ticks at all three, and
the landing sinks the same 16 cm); the smallest and the largest John; heavyweight and lanky physiques; the female body.

## The whole pack, measured (later the same day)

Asked for: a proper check of all 4,185 clips, the pack added to the dev library, the attitudes taken from its motion
sets, and a view on whether the way we animate combat and traversal should change.

**The check.** `src/kit/bench/pack-audit.ts` opens every file in Node, puts it on the male medium body the way the
game fits it, and plays it through at 30 frames a second with nothing drawn (nine seconds for the lot):

    PACK_AUDIT=1 npx vitest run src/kit/bench/pack-audit.bench.test.ts     (writes .scratch/motion-pack-audit/clips.json)

Per clip: the file's own faults, whether it moves at all, a one-frame spike (a bone far out for one frame and back),
where a loop really starts, the hips' and soles' range, how the body is carried (lean, knee bend, elbows, stance
width, sway, shoulder turn), the fastest limb and when, the travel it was made with, and a looping gait's speed,
strides and foot strike. A contact sheet of every clip was drawn too, and `.scratch/motion-pack-audit/index.html`
is a page to browse all of it by category, set and what was caught. All of it is local, like the pack.

| | |
| --- | --- |
| Files that open, fit the rig and play | 4,185 of 4,185; no missing bone, no bad key |
| Distinct motions | 3,648 (537 are copies of another clip) |
| Held poses, not motions | 755: the face clips (407), the aim directions (261), poses and accessories |
| A one-frame spike over 35 degrees | 213 (37 over 70): knees and forearms flipping for a frame, mostly in skills and blows |
| Feet more than 12 cm under the floor | 20, nearly all air skills |
| Made with travel on the root | 439: the blows, dodges, dash starts and stops, knockbacks |

**What the measuring found that the first wiring had wrong.** Every stance and every sprint loop in the pack opens on
its way in (the stance being taken, the sprint leant into): a third to a half of the clip, then the cycle. Played
round whole, as they were, the way in came back once a cycle: 17 to 28 degrees of pop on the idle every 1.3 s and on
the sprint every 0.7 s. Each now loops from where its cycle starts, and the sprint's gait is read on the cycle alone
(one stride in 0.4 s, where it had been taken as two in 0.73 s).

**Motion sets and attitudes.** Forty of the pack's 45 sets are whole characters: each has its own stance, walk, run,
sprint, jumps, landing, dash, three-blow chain, air chain and finisher, over about 30 moves all of them share. Each
set's stance, walk and run were scored against what each attitude is (`kit/anim/attitude.ts` says it in words; the
score says it in lean, knee bend, elbows, stance width, sway, shoulder turn and cadence), the top few of each were
looked at on sheets, and one was given to each attitude:

| Attitude | Its set carries itself |
| --- | --- |
| Neutral | A boxer's stance, the squarest; the set the first wiring used |
| Brute | Hunched and wide with the arms hung out, the heaviest walk of the forty, a charge of a run leant right over, slow blows |
| Swagger | Upright, a hand by the chin, the chest turning over an easy walk |
| Low | A low wide crouch behind a raised guard, the run leant over (the lowest stance of all holds an arm straight out through its walk, which read as aiming, and was passed over) |
| Strut | Tall and narrow, the widest swing of hips and arms in the walk |

**Then every clip the attitudes play was read by eye** (85 clips on stacked sheets, by two reviewers given only the
pictures), and the four sets' skills, spare blows and finishers were described the same way (110 clips; the notes are
with the pack's numbers, for whoever gives them to Q, E and R). What that changed:

- The brute's and the strut's own sprint loops did not suit them (a string of upright leaps that read slower than the
  brute's run; the tall set sprinting bent double with an arm folded over its back). Each sprints on its own run.
- The low set's fall holds both arms straight out ahead and the strut's hangs by both hands; each falls as the plain
  set does. The strut's dash is the plain set's too.
- The plain set's walk is a guard's shuffle, side-on, the same foot leading: the library's walk stays for it.
- Two chains' contacts were on the wrong moment (the fastest hand was in a turn before the blow): the low set's first
  blow lands at 0.95 s and the strut's two at 0.42 and 0.33 s. On the course each is now at full reach on its contact.
  The strut's first blow opens mid-run with a forearm flipped for a frame; its first fifth of a second is left off.
- The flinch was a second and a half of staggering squeezed into a quarter of a second; it is cut to the flinch.

Seen and left: several stances stand side-on to the aim with the head turned along it (the pack's fighters do); the
jump to the left, right and back all take off straight up; the blows end in each set's upright stand, not its stance.

A set's own clips play on the body's plain rest: the attitude's lean and knee bend are not laid over them a second
time. The moves the sets share, and every library clip, still take the attitude's layer as before. On the course each
attitude shows its own stance, walk, jog, sprint, jumps and chain (`--attitude brute` and so on, sequence `carriage`),
and each chain's first blow is at the dummy on its contact frame. The whole course ran on each of the five: 18 of
its 19 sequences with the same states as before and no page errors. The nineteenth, the guard taking a hit, passed on
one attitude and not on four: there the hero was launched out of its guard instead of taking the blow on it. The
sequence does not choose which blow the lab's bot throws; why it differed was not looked into. **This is dev only, and only
for a hero with no weapon in hand**, as the pack's movement set already was. A build's attitudes are still the layer.

### Should the way we animate change

What the pack shows is how a shipped hero shooter cuts its animation up. Against what we do:

| The pack does | We do | Verdict |
| --- | --- | --- |
| Jumps in phases: start, rise, top, fall, land | The same, since this morning | Nothing to change |
| Anything held is three clips: a start, a loop, an end (aimed shots, the sprint, using an item, reviving, a finisher, the crouch) | One clip per action, its wind-up stretched to the release. A held beam replays its attack; a sprint ends by blending to the stance; a charge now holds its wind-up | **Change.** Give held casts a hold: a start, a looped middle while the button is down, the end on release. The kit check's "held beam replays its attack" and the sprint's missing stop are this one gap |
| Aiming is a pose: an aim stance with up, down, left and right poses blended by where the camera points, and a shot is a small recoil on top (0.5 to 1 s) | A whole-body shot clip from the stance each time, with the aim spread up the back afterwards | **Change, the biggest one.** It is why the long gun fires tipped up, the bow looses low and one-hand magic points over the target. Hold an aim stance while a ranged weapon is hot, and layer the shot on it |
| Hit reactions by direction: front, back, left, right, each standing, moving and in the air; a knockdown on the face or the back, with its own get-up | One flinch, one knockdown, one get-up | **Change, cheaply.** The engine knows where a hit came from, and the licensed library already has hits from the left, the right, the back and the gut |
| Turning at a run banks: bank-left and bank-right loops, lean poses | The hips turn and the legs run at an angle; nothing leans | **Change, cheaply, with no clip:** roll the hips and spine into the turn by how hard it turns |
| Blows reach their contact in 0.2 to 0.4 s (a fifth of the clip), recover for a second that the next press cuts, and carry the body 0.9 to 1.5 m | The contact is met on the engine's release tick and the follow-through plays on, cut by the next blow; the engine's own lunge moves the body | Keep. One thing to settle: the engine's lunge closes on the target its own way whatever the blow, and the clips' own strides differ three-fold, so the feet slide on the long ones. Matching the lunge to the blow is a balance change |
| Blows and skills have air versions (some 400 clips) | The ground clip's top half over falling legs, and one air blow per family | Keep for now; an air chain per family when clips are made |
| Every character has its own stance, gait, jumps, landing, dash and chain, about 28 clips, and shares the rest | An attitude is a layer on shared clips | **This is the scope for the custom pipeline:** 28 clips an attitude, not a whole library each |
| Keyed pose to pose: 629 clips snap more than 45 degrees in one frame | Motion capture, smooth | A style choice, not a fault. The two do not sit together in one hero: a dev attitude snaps through its own clips and flows through the library's. Pick one before the pipeline starts |
| Loops that open on a way in | Loops assumed to start at frame 0 | Done for the pack. The library's loops were already seam-checked in session 1's clip audit |

So: yes, in three places worth doing before the map and the forge, none of which needs the pack. In order of what a
player would notice: **an aim stance with the shot layered on it; a hold phase for held casts and a stop for the
sprint; hit reactions by direction and a lean into turns.** The first is the largest (it touches every ranged
family's clips and `aim.ts`); the last two are small. None is started.

## The kit check: every V, LMB, Q, E, F and R action

Asked for the same day: does each action play a motion that suits it. `scripts/course.mjs --kit` puts every option
the lab's panel lists on John, one pass at a time, and plays it at a dummy from the seat: the eleven melee families'
eight moves each (three-blow chain, charged heavy, guard, dash blow, air blow, slam, launcher, grab), the nine ranged
families in each of the seven ways of firing, and every Q, E, F and R. That is 222 actions on the licensed library.
Each writes six frames (start, half way to the contact, the contact, 0.1 and 0.3 s after, the end) onto a sheet and
its numbers into `audit.json`. The sheets were then read row by row, by five reviewers who were given only the
pictures, and the rows they marked were looked at again against the numbers.

    COURSE_BASE=http://localhost:3111 node scripts/course.mjs --kit --motion library --out .scratch/course/kit
        [--sect V,LMB,Q,E,F,R] [--move light,dash,…] [--pick 7,14] [--rows] [--frames] [--bare]
    COURSE_BASE=http://localhost:3111 node scripts/course.mjs --clips --motion library --out .scratch/course/kit-clips

`--bare` photographs nothing and runs about ten times faster (the numbers alone). `--clips` reads every melee clip
through on a copy of the body, nothing played (`characters.ts` `timeline`): which way the weapon in the right hand
points and where the hands and feet are, step by step, against the clip's mark. That is what the marks below were set
from.

**Every action reached the engine and played a clip of its own,** with no page errors. What did not suit, and what
was done:

| Found | Now |
| --- | --- |
| An air slam played no blow in a match: the engine casts nothing for a slam, so the animator showed a fall and a landing | The slam's clip winds up through the plunge and lands with the landing (`animation.ts` `slam`) |
| A blow caught on the guard showed nothing | The guard jolts (`block_hit`), then holds on |
| Every hold-to-charge shot and the charged Q stood idle while held, and took its aim only as it let go | The cast's own wind-up is drawn while the button is down and the shot goes on from there (`hero.charging`); all nine ranged families checked |
| The E dash slid upright: the engine lets it go at once, so its clip played from its mark, a stride from the end | Marked at the break into the sprint (0.3 s) |
| Blows landing off their contact: the library marks a blow where the hand is fastest, which for a long blade is 0.1 to 0.35 s before the blade comes round, and for a clip with two motions can be the wrong one | 25 clips re-marked where the weapon's tip or the kicking foot is furthest toward the target (`characters.ts` `CLIP_RELEASE`): the great sword's eight, the axe's five, the club's four, four kicks, the advancing slash, the stab, the shield's heavy cut, the pitch |
| The spear stood on end through its heavy lunge, and pointed back over the shoulder on its first thrust and its air stab; a one-hand sword's stab pointed back too | Those three clips' own hands held their piece another way (a rifle's grip, a blade out of the bottom of the fist). Ours is turned in the hand for them (`characters.ts` `HOLDS`, `arms.ts` `turn`), and the off hand follows |
| The spear's third thrust pointed back: the twin stab's marked blow is its left hand's | The spear's chain ends on a right-hand driving thrust (`ss_sword_and_shield_attack`) |
| Launchers that did not rise: the great sword's, the staff's and the spear's chopped down over the top, the axe's spun flat at the hip | All four use the rising two-handed swing the club had (`club_swing_homerun`) |
| The grab slammed thin air as it connected, weapon in hand, and the throw came 0.45 s later | Its clip is marked where the hands close, so the slam comes down as the engine throws; the weapons go back on their slots for it and come out again after |
| A thrown burst, spread or beam left a hand still down by the hip | The pitch is marked where the arm comes over |
| The lab kept the last pick's clip when a pick was changed live | A pick that plays another clip restarts the lab |

Seen on the sheets after: the spear level at the dummy on the first thrust and through the lunge, and point down on
the air stab; the kicks' legs out on the back kick and the snap kicks; the great sword, the axe and the shield's heavy
cut at the dummy on their contact frames; all four launchers sweeping up; the grab's hands empty, the dummy standing
when it is taken.

Two things the audit itself got wrong, since fixed in it: the dummy lay through the next row after a knockdown (the
view let a knockdown's clip finish though its state had ended; it gives way at once now), and the launcher row backed
John into a wall, where the camera stops drawing him. The stray spear head two reviewers saw is the spear's own point,
swept toward the side camera.

## Weapons and effects on the aim, on every size (the same day, evening)

The owner: one-hand and two-hand magic are wrong, then the body emitter, guns on a colossal body and the bow across
physiques; make every action work with its weapon and its effect, and check it across John's sizes.

The kit audit gained what that needs. On each release it now reads where the effect would leave the hero by the
effects' own rule, how far off the aim the weapon points (a gun's barrel, a wand's or a staff's length, the arrow's
line from the string hand to the bow hand, the casting forearm), how far the off hand is from a two-handed weapon,
what is in each hand, and whether a held action's clip starts over. Measured on all 63 ranged actions first:

| Found (medium body) | Now |
| --- | --- |
| Every gun fired nose up: the pistol 20 degrees, the long gun 28 at head height, the launcher 14 | A gun is turned about the wrist that holds it, on its own barrel's line, as the shot comes to its release. 0 degrees off the aim, at shoulder height |
| The bow's arrow line ran 60 to 68 degrees to the left of the aim: the clips were baked chest to the front | The four archer clips are turned side-on as they load (`CLIP_TURNS`); 2 to 4 degrees off |
| A wand was thrust out held upright like a baton; a staff lay a metre to the side of the hands pushing its beam, or stood on end with its head over the hero's own | A wand and a staff are levelled along the forearm through a shot, and the arm is turned onto the aim. The shot leaves the far end, in front of the hands |
| One-hand magic's beam, auto and charge cast with the left arm, raised, while the beam left the wand in the right hand at the waist | One-hand magic thrusts the wand out for every way it fires |
| The body emitter raised an arm 50 to 70 degrees over the target, or squatted on its heels leaning back | One arm thrust out for a shot, both palms pushed out for a spread, a beam or a charge |
| A held beam started its clip over five times in one hold | The pose holds where the beam leaves it; a trigger held for full auto pumps from the last of the draw |
| The off hand took a fifth of its grip on a long gun (none at all on the huge and colossal bodies: the check was in a medium body's metres) | A long gun, a launcher and a staff are held in both hands through the shot, on every size |
| A Q or an R cast with a gun in the fist left the gun's muzzle | The hands are emptied for a Q or an R that is cast with them (a lock-on's flurry and a leaping slam keep their blades), and the spell leaves the casting palm |
| On a colossal body a staff's head, a spear's point and a scythe's blade are over two metres from the hand, past the effects' check for a view not yet in place: the effect fell back to the palm | The check goes by the body's size |

`characters.ts` `pointWeapon` and `levelPiece` do the turning, on the live pose, after the look and before the off
hand's grip; nothing is baked per clip or per body, so it holds for any body the game builds.

**Across John's six sizes** (tiny to colossal), the whole kit, 222 actions each: every action reaches the engine and
plays the same clip as on the medium body, and the same weapons are in the same hands. Then the 63 ranged actions again
on each size with everything above in: every gun, the bow, the wand and the staff within 4 degrees of the aim on
every size (the staff's spread 7 to 11); the body emitter's forearm 11 to 20 degrees off (two palms pushed out
together converge on the line between them); no held clip starts over; both hands on every long gun, launcher and
staff; and the effect leaves the same place on the body. The colossal body's 88 melee actions leave their effects
where the medium body's do (11 had not, above). The seven ranged families were looked at on the medium and the
colossal body, and the bow and the long gun on the heavyweight, lanky and bodybuilder physiques.

Not checked by eye across sizes: melee, Q, E, F and R (numbers only). The audit plays each action standing still at
a dummy; shots on the move, and at a target above or below, were not measured.

## Weapons sized to the hero (the same day, night)

The owner: weapons, melee and ranged, should scale with the character so they fit.

What was there: a piece hung in its hand socket at scale 1 and took only the body's root scale. A body of ours has a
root scale by size class (0.8 tiny to 1.6 colossal), so its weapons already grew with it, a little off its hands. A
generated hero is drawn at its own height with a root scale of 1, so its weapons stayed as modelled for the medium
body: on the 2.4 m test hero, whose hands are 1.3 times as long and 1.5 times as broad, every weapon was a medium
body's.

Now (`src/arena/client/fit.ts`): every piece is modelled once, for the medium body's hands, and each hero's hands are
measured on its own skeleton against them: the wrist to the end of the middle finger and the breadth across the
knuckles, both hands as one, in any pose and at any scale. The hand sockets take that as their scale, so whatever
hangs on them fits (`gear.ts` `hangSockets`, `arms.ts` `hangHands`). Three things follow from it:

- **Put away, a weapon is the size it is in the hand** (`arms.ts` `stowed`), on the back, the hip or the thigh.
- **A piece no hand holds** (the quiver) is sized to the body's frame (a leg and the back) instead.
- **A hand far off its frame is held to a range** (0.75 to 1.4 of the frame): a mitten, a claw or a hand whose
  fingers the rig never found falls back on the frame, so a sword never shrinks to a knife.

A physique's Hands dial scales the hand bone, and the measure follows it. Where the socket sits in the palm is kept
in the modelled hand's units, so a generated hero's is as deep in its own palm.

| John | Hands against the modelled ones | A weapon's scale, before | Now |
| --- | --- | --- | --- |
| tiny | 1.06 (big for the body) | 0.80 | 0.845 |
| medium | 1.00 | 1.00 | 1.00 |
| colossal | 0.955 (small for the body) | 1.60 | 1.528 |
| generated hero (2.4 m) | 1.38 | 1.00 | 1.381 |

The quiver takes the frame: 0.79 on tiny, 1.63 on colossal, 1.24 on the generated hero.

**Checked.** `course.mjs --fit` photographs every weapon pair on a John, in the hand close up and whole, put away, and
at its shot, with each piece's scale and length (`--fitting off` hangs them as modelled, to set beside). All nine pairs
(between them every melee family and every ranged one) on the tiny and the colossal body and on the generated hero, and one pair
on the medium: a grip fills the fist the same on all four, and a stowed weapon is in proportion on each. The aim audit
again on those three with seven ranged weapons: every gun, the wand and the staff 0 degrees off the aim and the bow 3;
both hands on the long gun, the launcher and the staff; every effect leaves the weapon's far end; nothing flagged.
`fit.test.ts` holds the rules (seven tests, on all twelve shipped bodies and on stick bodies with odd hands). Gates:
tsc clean, vitest without the sim 1191 passed and 2 skipped, the build passes with no pack strings in it.

Not checked: the small, large and huge bodies, the female bodies and the physiques in the browser (their measure is
in the unit test only); melee blows in motion at the new sizes (the engine's reach does not change with the piece).

The course's Chrome now fetches and caches nothing it does not use and exits with a run that is stopped (an orphan
had been left on port 9444 by every killed run). On the owner's machine: one run at a time, `nice`, no batch in the
background, and the dev server stopped after.

## The camera sized to the hero (the same night)

The owner: the third-person view has to follow the character's size; on a colossal hero nothing could be seen.

The shoulder camera's eye height already followed the size, but its boom did not: 3.4 m behind, 0.68 m to the right
and 0.38 m over the eyes for every hero. A colossal hero is 1.6 times as tall and as broad, so from a medium hero's
distance it filled the view from the thighs up, its feet and the floor around it off the bottom of the screen.

Now the boom is as many of the hero's own heights long at every size (`camera.ts`, `sight.scale`, the size class's
scale): 2.7 m behind a tiny hero, 5.4 m behind a colossal one, the offset to the right and the height over the eyes
with it. Every size stands in the same place on screen, the same size, as a medium hero does (`camera.test.ts` holds
head, feet and shoulder to the same screen points on all six). The boom eases to a new size over about a second when
a form grows the hero, the "camera is in the head" check goes by the size too, and a hero followed while watching is
followed from as many of its heights. Walls still pull the boom in as before; a longer boom meets them more often.

Seen in the lab on the medium and the colossal John side by side (`.scratch/course/fit/view-sizes.jpg`): the same
framing, the reticle clear. Not played: a colossal hero in the map's tight rooms, where the longer boom will be pulled
in, and first person (it looks out of the head bone and was not changed). The full test suite was not run again after
this change (the camera and control tests and the type check were), to keep the load off the owner's machine.

## The pole, the long guns, the paired pistols and the emitter (the same night)

The owner, playing a colossal John: the pole is breaking, the heavy and the long gun don't fit, the paired pistols
move oddly as they fire, the body emitter is one-hand magic again, and the weapons may be too big on the large, huge
and colossal bodies. Each was filmed frame by frame and measured first.

| Found | Cause | Now |
| --- | --- | --- |
| The pole's tip crossed 1.2 to 2 m between one frame and the next, then froze | A wind-up was squeezed into whatever the engine gives it: 0.12 s for a light blow whose clip takes 0.6 s to its contact. The staff's twirl played at 5.3 times its pace, the slide blow at 8.5 | A wind-up plays at most twice its clip's pace (`characters.ts` `WIND`): a shorter one starts later in its clip and the body blends into it. Every blow and shot in the game is paced this way now. Measured 2.04 at most on the staff's blows |
| The pole lay across the back of the neck and through the chest | Its jab and shaft strike are a rifle's butt smash and punch, and the pole stood on end in the fist where the rifle's barrel ran forward | The pole lies on the rifle's line through those two clips (`HOLDS`), under both hands |
| The long gun hung off a bent wrist in front of the face | The clip carries the gun nose up; the fix of the evening before levelled it about the wrist where the clip left the hand, so the stock left the shoulder | The hand is drawn in along the aim to where the gun's own stock reaches back to the shoulder, and the barrel is laid on the aim there (`pointWeapon`). 0 degrees off the aim, both hands on it |
| The heavy gun dropped into a squat for one shot and stood up again within the second, the tube held out in front | No launcher clip in the library; it played a crouched rifle burst | Fired standing on a rifle clip of its own (`firing_rifle`), shouldered as the long gun is: the tube lies over the shoulder beside the head |
| Both pistols snapped 30 cm in to the middle as a shot ended, and the off hand bobbed 9 cm seven times a second on full auto | The turn that puts each arm out to its own side was cut off with the cast while the clip still faded out; and every repeat shot started the draw again from 0.7 | What is done to the arms for a shot fades with the shot's own layer (this holds for every gun's aim too), and a repeat shot starts from 0.85 of the draw. The largest sideways step is the draw itself; the bob is 4.8 cm on the colossal body |
| The body emitter's shot was the wand's thrust | Pointed at the same clip the evening before | A straight punch, the bolt leaving the fist (`cross_punch`); its blast, beam and charge keep the two-palm push |
| Weapons too big on the big bodies | Sized all the way with the hand: a colossal hero's were 1.53 times a medium one's, a staff 2.75 m and a shaft too thick for the fist | Past the medium hand a weapon grows as the hand's size to the power 0.6 (`fit.ts` `GROW`, one number to turn): large 1.07 (was 1.13), huge 1.14 (was 1.25), colossal 1.29 (was 1.53), the generated hero 1.21 (was 1.38). The fist closes further round a grip on those bodies. Tiny and small are as before |

**The pole's mesh.** The owner was not sure whether the pole was a bad asset or a bad render. The file is sound: one
opaque mesh of 1,872 triangles, 1.8 m long, drawn whole in every still. What is wrong with it is its girth: about
5 cm through the shaft and 10 cm through its wrapping, where a hand closes round 4. It was not remade (that is the
Blender pipeline, and the owner's machine was short of memory); the smaller scale on big bodies helps, and a thinner
pole is listed below.

Checked on the colossal body, frame by frame, and the two guns on the medium body as well; the greatsword, the rifle
and both staffs photographed at their new size on the large, huge, colossal and generated Johns. Tests: the wind-up's
pace (`motion-pack.test.ts`), the growth rule (`fit.test.ts`), the shot table.

### The open points, closed (the owner: "fix the open points")

- **The pole is remade thinner.** `weapons.py` takes a `girth` for a piece (the bo staff's is 0.45) and the staff was
  put through it again from its small mesh (six seconds): 2.3 cm through the shaft and 4.7 through the wrapping, where
  it was 5 and 10. Only its own file and thumbnail changed.
- **The staff's third blow is a two-handed overhead whirl** (the long axe's high whirl, which nothing else played), in
  place of the acrobat's twirl that threw the body through the air with the pole in one hand. All eight of its moves
  were looked at on the medium body with the thin pole: both hands on it through the jab, the strike, the whirl, the
  heavy sweep and the guard.
- **The shooter stands up to a long gun.** The rifle clips lean back from the hips through the shot; the back is
  brought upright about the lowest of the spine (`LEAN`), on the long gun and the launcher.
- **The head comes to the rifle's sights:** the stock sits in the pocket inside the shoulder joint, three tenths of
  the way to the neck, and the head tips 12 degrees over to it (`SIGHTS`). The launcher stays on top of the shoulder.
  Both guns 0 degrees off the aim with both hands on them, on the medium and the colossal body.

How far a weapon grows on a big body (`GROW`, 0.6) is the owner's to turn and was left where it is.

## The pack's shots and skills on the kit (the same night)

The owner: the staff is too thin now, the body emitter throws punches, and the new clips are not used well enough,
with so many combat and spell actions in them.

- **The staff** is between the two it has been: 3.5 cm through the shaft and 7.4 through the wrapping (`girth` 0.7).
- **The body emitter** no longer punches. In a build its shot is both palms pushed out. In development it fires on
  the pack's own shots from the bare hands (below).

**What the pack had been used for:** the movement set, three punches and a stance and gait for each attitude. Its 943
skill clips, 98 shots from the bare hands, 336 blows and finishers, 143 interactions and 60 reactions played nowhere.

**Read first.** 771 of those clips (every shot, finisher, air blow, power-up, revive and reaction, and the 437 ground
skills of the 41 sets not yet described that move at all) were stacked five to an image and described by five
reviewers, a line a clip: what the body does, the phase, the second it peaks, what it could serve
(`.scratch/motion-pack-audit/described/`, `all.json` for the lot; local, like the pack). Each clip given a skill below
was then picked off those lines, checked against its measured travel and facing, and filmed in the lab.

**Wired.** Each skill has a key for what it is, as the recipes already file it (`recipes/motions.ts` `skillKey`:
`shot:emitter:single`, `cast:stun`, `move:leap`, `aura:element`, `ult:form`), and the pack has a table from that key
to one of its clips with the second its shot leaves or its gesture peaks (`motion-pack.ts` `PACK_SKILLS`). A hero's
clip for the skill is replaced by the pack's as it loads, armed or not (a Q and an R empty the hands, and a shot from
the bare hands holds nothing). The lab's John says what each of his picks is (`look.kinds`), since his templates are
stand-ins. 51 keys so far:

| Slot | On the pack now | Still the library's |
| --- | --- | --- |
| LMB, body emitter | all six ways: an arm held out and kicked by each shot; both palms pulsed for a burst; the arms swept to a fan; a braced lunge behind a beam; hands drawn in, then thrust, for a charge | every weapon held in the hand (the pack has no weapons) |
| Q | 26 shapes: substitute, reflect, absorb, minions, clone, decoy, wall, terrain, portal, turret, trap, totem, copy, possess, stun, root, push, lift, heal, shield, revive, curse, zone, vision, charged, bolt | parry, barrier, swap health, steal, rewind, pull |
| E | teleport, dash, homing, leap, flight, burrow | blink, swap, grapple, swing, glide, crawl, ride, wall run, roll, slide, zipline |
| F | all six kinds of aura, each a power-up of its own | |
| R | devastation, domain, rally, rampage, form, giant, titan | the lock-on's flurry, the kit switch, the fusion |

Filmed on the medium John, all 71 Q, E, F and R options and the emitter's ways: every one releases, the 51 play their
pack clip, nothing flagged but the first titan-form pick (it stepped 0.8 m off the spot; changed for one that stays).
`motion-pack.test.ts` holds the table to the recipes' own keys.

**It is development only, as before.** The table and its loader are behind the same switch as the rest of the pack: a
build was made and searched, and no pack clip's name or path is in it. `?motion=library` shows the library's.

### Seeing it in an ordinary arena fight

The owner asked to see the changes, the generated characters, the clips and the combat in an ordinary arena fight,
not only in the lab.

- **The changes to the game** (the camera by size, weapons sized to the hand, the wind-up's pace, the shouldered guns,
  the staff, the emitter's own shot) are ordinary code. They are in every match and in any build.
- **The generated characters are in the game.** The six rigged meshes are in `public/heroes/generated` with an
  `index.json`, their textures shrunk to 2K webp (`scripts/generated-heroes.mjs`: 150 MB of exports to 64 MB), and the
  game finds them there in any build (`hero-file.ts` `triedHeroes`). An ordinary match takes a cast:
  `/lobby?cast=john,large-john` gives the match's first heroes those bodies, the played one first (`heroes.ts`
  `localCast`, remembered for the tab; `?cast=` clears it). A built copy was served and played from the lobby with
  three of them: their files load and nothing errors. The roster does not offer them yet: the cast in the address is
  how one is put in a fight.
- **The motion pack is a development source.** It is read from the development machine's scratch folder and is not
  part of a build: there every hero moves and fights on the library. On the development server it plays in ordinary
  matches as it does in the lab.

## Not done, or not right yet

- **Hands on a low mantle, on the pack.** The vault's planting hand is 3 to 29 cm under the block's top through the
  push (the pack's clip vaults from a cling on a wall, not from standing). The library's own mantle is the better one
  for a low block; say so and the pack's can be left off `mantle`.
- **The pack runs and sprints ahead only.** Sideways and backwards at a jog are the library's strafes, a different
  carriage. Blending the two at a diagonal has not been judged by eye.
- **A 1 m step-off plays the full fall,** arms up. It reads as too much for a small drop.
- **The AI never revives** (above). Team-ups and the grab are likewise a player's alone.
- **An AI hero that rolls mid-blow still lands the blow** (above): the body shows the roll, and the hit lands from it.
  This is the owner's call (cancels are a played hero's), so it stays; only how it reads is open.
- **Getting up, a glide, a swing, a wall crawl and a ride** show a stand-in on the library (a crouch, a fall, the
  zipline hang, the ledge hang, a crouch). A wall run has no lean toward the wall.
- **Not looked at:** the knockdown and get-up in a real fight (the lab's bots were still), sound against the new
  follow-through, and the pack on a hero that carries a gun (it keeps the library's weapon set).

From the kit check, still not suiting:

- **No clip in the library fits:** the whip's heavy blow and the Q "Lift and throw" both play a kettlebell swing (two
  hands, the thong hanging); the Q heal has no healing gesture; the Q rewind and the R titan summon read as attacks.
- **A dash blow runs on through its target.** The engine's lunge carries the hero 3 m and the blow lands inside it, so
  on the contact frame the hero is shoulder to shoulder with the target, whatever the clip. This is the engine's
  (`kit-tuning.ts` `dashAttack.lunge`), and changing it changes balance. The flying kick barely reads as a kick there.
- **Ranged aim: done the same evening** (above). What is left of it: the head does not come down to a gun's sights,
  and an E move keeps whatever was last in the hand.
- **R forms, the kit switch, the fusion and the Q copy** rebuild the body as they let go, so only their wind-up shows
  (a third of a second): the flourish is cut where it should follow through.
- **Not judged by the audit,** which plays each action on an open floor at a still dummy: the grapple, the swing, the
  wall crawl, the wall run and the ride (they need a wall, a point or an ally in reach), and a burrow (the hero is
  under the floor). The staff's two ends and the whip's thong make the reach measure meaningless for those two
  families; they were judged from the pictures alone.
- **The audit's own flag** (the hand's fastest moment against the contact) fires on backswings; the reach read off
  `--clips` is the better measure, and is not yet what the audit flags on.

From the weapon fit, the same on every size (so not a matter of scale):

- **The off hand lies open on a long gun,** under the handguard. Only a hand that holds a piece closes its fingers
  round it; the hand that steadies a two-handed weapon keeps the clip's fingers.
- **The hand on the two-hand staff is open at its shot** on our bodies, palm down along the shaft.
- **The pistol sits high in the fist:** the base of its grip shows under the little finger. It is where the piece's
  grip was modelled, not its size.
- **The fit check's close view of the warhammer** is hidden behind the stowed bow; that one was judged from the whole
  views.
- **The staff still has no clips of its own.** Its jab and strike are a rifle's, its whirl a long axe's, and its
  heavy, dash, air and slam blows the greatsword's, held at the pole's middle. They read as a staff's now; clips made
  for one wait for the animation pipeline after session 4.
- **On a preview with no size given** (the forge's stage), a weapon is sized by the hand in the body's own space, so a
  big body's weapon is a little larger there than in a match.
- **The pack's blows and reactions are still unused:** 50 finishers and their wind-ups, 55 air blows, the fourth
  blow of the chain, and hit reactions from each side, the knockbacks, the shock and the freeze. They are described
  (`described/all.json`) and want the same treatment: the fists' heavy, air, dash and slam blows, and a hit that
  staggers the way it came from.
- **The pack's aim poses** (ahead, up, down, left and right for 49 sets) would make the aim stance the assessment
  above asked for.
- **Each pack skill was judged on the medium body, standing at a dummy,** on small tiles: none was looked at on the
  other sizes, in the air, or with each weapon family on the back. The E moves play over the engine's own travel and
  were only checked to release.
- **A hero's pack clips are the plain set's whatever its attitude,** except the stance, the gait and the chain.
