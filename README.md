# psyblr autobattler

A 3D arena brawler where anyone forges heroes with generative AI and the engine keeps every fight fair.

This repo starts with the **Character Charter**: the layer that turns any hero (a name, reference photos and flavour text) into a standard, balanced, readable kit. See `docs/plans/` for the plan.

## Scripts

- `npm run dev`: hero creator on http://localhost:3110
- `npm test`: unit and component tests
- `npm run sim`: balance report over the template catalogue (exits non-zero over the win-rate ceiling)
- `npm run typecheck`, `npm run build`

## Environment

Copy `.env.example` to `.env.local`. Never commit secrets.
