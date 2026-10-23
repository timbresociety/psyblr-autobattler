# Balance tuners

Every change to the engine, the AI or the catalogue moves win rates, so the numbers need tuning again afterwards. These scripts do that the way the October 2026 pass did. They play 3v3 skirmishes against the reference field, the same fights the balance gate uses. They're kept out of the normal test suite because each one plays thousands of fights. Run them one at a time, since the machine struggles under load. Results land in `tools/balance/out/` (ignored by git).

1. **Role damage.** `GROUPS="tank,fighter,assassin,mage marksman,support,controller,summoner" ./tools/balance/round.sh` bisects each role's weapon and spirit damage so the median of its default kit plus four sampled kits sits at 50%. Run a second round with `SPAN=1.2 STEPS=5`, then copy the factors in `out/factors.json` into `src/charter/roles.ts` (base and caps). Health stays fixed by role.
2. **Check.** `npx vitest run --config tools/balance/vitest.config.ts tools/balance/check.test.ts` prints each role's default and median. Defaults must stay under the 55% ceiling, because they are the field everyone is measured against.
3. **Sizes.** `./tools/balance/sizes.sh` bisects `SIZE_HEALTH` so each size class of a role does as well as the same role at medium. Copy `out/sizes.json` into `src/charter/sizes.ts`.
4. **Demo heroes.** `FACTION=mogul` (then `leader`) with `npx vitest run --config tools/balance/vitest.config.ts tools/balance/demo-gate.test.ts` runs the gate on each demo hero's persona kit. Copy its steps into `retune` in `src/arena/demo/roster.ts`. `ONLY="Merkel|Lincoln"` reruns just those heroes.
5. **Big fights.** `CROSS=1 SEEDS=12` with `tools/balance/live.test.ts` plays the default 10v10 matchup with staging's own deployment and prints per-hero damage and survival. 3v3 can't see ten-hero crowds, so check this last.

Then run `npm run sim`, the roster test (`src/arena/demo/roster.test.ts`), and bump `CATALOG_VERSION`, `ENGINE_CALIBRATION_VERSION` or `AI_CALIBRATION_VERSION` for whatever changed.
