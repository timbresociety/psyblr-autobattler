import { ENGINE, ENGINE_CALIBRATION_VERSION } from '../arena/engine/calibration.js'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build.js'
import { MAX_RETUNE_STEPS, RETUNE_STEP, REFERENCE_SHEET, SLOT_BUDGETS } from '../charter/budget.js'
import { FAMILIES, FAMILY_LABEL, familiesOf, primaryFamily } from '../charter/families.js'
import { FLIGHT_SPEED_MUL, JUMP_REACH_PER_SPEED } from '../charter/locomotion.js'
import { BEARD_LABEL, BEARD_STYLES, FACE_POINTS, GEAR_SLOTS, GENDER_LABEL, HAIR_LABEL, HAIR_STYLES, LOOK_COLORS, LOOK_COLOR_LABEL, SLOT_KINDS, type LookColor } from '../charter/look.js'
import { ROLES, getRole } from '../charter/roles.js'
import { ALL_SIZE_CLASSES, SIZES, sizeHealth } from '../charter/sizes.js'
import { ATTRIBUTES, ATTRIBUTE_GAINS, POOL_SIZE, SECONDARY_STATS } from '../charter/stats.js'
import { CATALOG, CATALOG_VERSION, poolFor } from '../charter/templates/catalog.js'
import { renderTooltip } from '../charter/tooltip.js'
import { TRAITS, TRAIT_TIERS } from '../charter/traits.js'
import type { BuildSlot, SecondarySheet, SecondaryStat, SlotKind, Template } from '../charter/types.js'
import { FREE_GRANT, GENERATION_COST, PACKS, PIECE_PRICE } from '../forge/pricing.js'
import { MAX_QUESTIONS } from '../forge/reading.js'
import { BUILT_IN } from '../kit/pieces.js'
import { GATE_CEILING, GATE_DEFAULTS, GATE_FLOOR, GATE_HOPELESS, GATE_MARGIN, MAX_LIFT_STEPS } from '../sim/gate.js'

/**
 * The master character charter (docs/charter/character-charter.html), written from the code itself so it can't drift:
 * how a hero is made, the roles and their synergies, how stats are bought, every skill template with its numbers, and
 * every piece of the look. `npx tsx scripts/charter-doc.ts` writes it; a test fails when the committed page is stale.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const num = (n: number) => String(Math.round(n * 100) / 100)
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
/** Small counts in words, the way a person writes them: "three questions". */
const words = (n: number) => WORDS[n] ?? String(n)
/** "2, 4 or 6" */
const either = (list: readonly (string | number)[]) => (list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list.at(-1)}` : String(list[0]))
const table = (head: string[], rows: string[][], cls = '') =>
  `<div class="scroll"><table${cls ? ` class="${cls}"` : ''}><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`

const STAT_DOC: Record<SecondaryStat, [label: string, unit: string, meaning: string]> = {
  maxHealth: ['Health', 'HP', 'Health points. At zero the hero is out of the fight.'],
  armor: ['Armor', '%', 'Takes this percentage off physical damage.'],
  magicResist: ['Spirit resist', '%', 'Takes this percentage off spirit damage.'],
  moveSpeed: ['Locomotion', 'm/s', `Ground speed. Flight runs at ${FLIGHT_SPEED_MUL}× it and drains the flight meter, and a jump reaches ${JUMP_REACH_PER_SPEED} m for every m/s.`],
  attackSpeed: ['Attack speed', '/s', 'Swings a second, for a basic attack that reaches 4 m or less.'],
  weaponDamage: ['Weapon damage', '', 'What a weapon skill adds for each point of its ratio. Most basic attacks scale with it.'],
  fireRate: ['Fire rate', '/s', 'Shots a second, for a basic attack that reaches past 4 m.'],
  ammo: ['Ammo', '', 'On the sheet, but the engine has no reloads yet, so it changes nothing in a fight.'],
  spiritPower: ['Spirit power', '', 'What a spirit skill adds for each point of its ratio: spells, heals, shields.'],
  regen: ['Regen', 'HP/s', 'Health back every second.'],
  lifesteal: ['Lifesteal', '%', 'The share of damage dealt that comes back as health.'],
  cooldownReduction: ['Cooldown reduction', '%', 'Takes this much off every cooldown. The engine stops counting at 40%.'],
}

const COLOR_DOC: Record<LookColor, string> = {
  skin: 'The skin. A photo face brings its own.',
  suit: 'The jacket, robe, top or dress.',
  trim: 'Accents, belts, sashes and scarves.',
  pants: 'Trousers, skirts and leggings.',
  glove: 'Gloves and gauntlets.',
  boot: 'Boots and shoes.',
  hair: 'Hair and beard.',
  iris: 'The eyes.',
  brow: 'The eyebrows.',
  cape: 'The cape, when it wears one.',
  metal: 'Armour plates and metal parts.',
}

const SLOT_DOC: Record<BuildSlot, [key: string, what: string]> = {
  basic: ['Left click', 'The basic attack, swung or fired again and again. Its rate is attack speed up close and fire rate at range.'],
  active1: ['Q', 'The first active skill.'],
  active2: ['E', 'The second active skill, never the same template as the first.'],
  passive: ['None', 'Always on, or set off by a hit, every third hit, low health or a kill.'],
  ultimate: ['R', `The big one. It starts each fight ${ENGINE.ultimateStartCooldown} s into its cooldown.`],
  movement: ['Shift', 'A dash, blink, leap or grapple, on top of running, jumping and flying.'],
}

const BUDGET_UNIT: Record<SlotKind, string> = { basic: 'per hit', active: 'per second of cooldown', passive: 'per trigger', ultimate: 'per second of cooldown', movement: 'per second of cooldown' }

/** The sheet every template is priced against, so the numbers shown are the catalogue's own. */
const REFERENCE: SecondarySheet = { ...getRole('fighter').base, ...REFERENCE_SHEET, cooldownReduction: 0 }
const BLANK: Parameters<typeof renderTooltip>[1] = { name: '', flavour: '' }

function delivery(t: Template): string {
  const d = t.delivery
  const parts: string[] = [d.kind]
  if (d.kind !== 'self' && d.kind !== 'aura' && d.range > 0) parts.push(`${num(d.range)} m`)
  if (d.radius) parts.push(`${num(d.radius)} m radius`)
  return parts.join(', ')
}

function templateRow(t: Template, role: string): string[] {
  const others = t.roles.filter((r) => r !== role).map((r) => getRole(r).name)
  const lines = renderTooltip(t, BLANK, REFERENCE, 0).lines.filter((l) => !/^(Range|Radius|Cooldown) /.test(l))
  return [
    `<b>${esc(t.name)}</b><code>${esc(t.id)}</code>${others.length ? `<small>Also ${esc(others.join(', '))}</small>` : ''}`,
    familiesOf(t).map((f) => `<span class="chip fam-${f}">${FAMILY_LABEL[f]}</span>`).join(' '),
    esc(delivery(t)),
    t.cooldown ? `${num(t.cooldown)} s` : '',
    esc(lines.join(' · ')),
  ]
}

function rolesSection(): string {
  const statRows = SECONDARY_STATS.map((stat) => [`<b>${STAT_DOC[stat][0]}</b>`, ...ROLES.map((r) => `${num(r.base[stat])}<small> to ${num(r.caps[stat])}</small>`)])
  const attrRows = ROLES.map((r) => [
    `<b>${r.name}</b>`,
    ...ATTRIBUTES.map((a) => num(r.weights[a])),
    ...ATTRIBUTES.map((a) => String(r.attributeCaps[a])),
    ATTRIBUTES.map((a) => r.defaultSpread[a]).join(' · '),
  ])
  const traitRows = ROLES.map((r) => {
    const trait = TRAITS[r.id]
    return [`<b>${trait.name}</b><small>${r.name}</small>`, esc(trait.blurb), ...trait.tiers.map((t) => esc(t.text))]
  })
  return `
<section id="roles">
  <h2>The eight roles, and the synergy each one is</h2>
  <p>A role sets where a hero starts and how far each stat can climb. It also decides what an attribute point is worth.</p>
  <p>Every role doubles as a trait. Field ${either(TRAIT_TIERS)} heroes of one role in an army and its trait lights up a tier at a time, the way Teamfight Tactics does it.</p>
  ${table(['Role', 'What it does'], ROLES.map((r) => [`<b>${r.name}</b>`, esc(r.description)]))}
  <h3>Where each stat starts, and where it stops</h3>
  <p>The first number is the role's base. The second is its cap: no spread of points, and no size, pushes a stat past it.</p>
  ${table(['Stat', ...ROLES.map((r) => r.name)], statRows, 'dense')}
  <h3>What an attribute point is worth to each role</h3>
  <p>A point's gains (below, under stats) are multiplied by the role's weight for that attribute. The caps stop any role from pouring all ${POOL_SIZE} points into one attribute.</p>
  ${table(['Role', 'Strength weight', 'Agility weight', 'Intellect weight', 'Strength cap', 'Agility cap', 'Intellect cap', 'Suggested split'], attrRows)}
  <h3>Synergies</h3>
  <p>A trait mostly strengthens its own role, and its higher tiers reach the rest of the side.</p>
  <p>But traits only exist in army fights. We measure every hero in the balance check without them, so a hero's own numbers stay fair however the army around it is built.</p>
  ${table(['Trait', 'About', ...TRAIT_TIERS.map((n) => `${n} heroes`)], traitRows)}
</section>`
}

function statsSection(): string {
  const gainRows = ATTRIBUTES.map((a) => [
    `<b>${a.charAt(0).toUpperCase()}${a.slice(1)}</b>`,
    Object.entries(ATTRIBUTE_GAINS[a])
      .map(([stat, v]) => `${STAT_DOC[stat as SecondaryStat][0]} +${num(v!)}`)
      .join(', '),
  ])
  const statRows = SECONDARY_STATS.map((s) => [`<b>${STAT_DOC[s][0]}</b>`, STAT_DOC[s][1], esc(STAT_DOC[s][2])])
  const sizeRows = ALL_SIZE_CLASSES.map((c) => {
    const z = SIZES[c]
    return [`<b>${z.label}</b>${c === 'colossal' ? '<small>Transformation only</small>' : ''}`, `${num(z.scale)}×`, `${z.hitRadius >= 0 ? '+' : ''}${num(z.hitRadius)} m`, `${z.reachBonus >= 0 ? '+' : ''}${num(z.reachBonus)} m`, `${num(z.speedMul)}×`, ...ROLES.map((r) => `${num(sizeHealth(r.id, c))}×`)]
  })
  const fights = GATE_DEFAULTS.duelsPerMember * ROLES.length
  return `
<section id="stats">
  <h2>Stats: thirty points, three attributes, twelve numbers</h2>
  <p>Every hero gets the same ${POOL_SIZE} points to spend. Strength is bulk. Agility is weapon tempo and footwork. Intellect is skill power and shorter cooldowns.</p>
  <p>The twelve stats a hero fights with start from the role's base and grow with those points. The size class shifts them, and the role's caps stop them.</p>
  <h3>What one point buys</h3>
  ${table(['Attribute', 'Each point adds, before the role weight'], gainRows)}
  <h3>The twelve stats</h3>
  ${table(['Stat', 'Unit', 'What it does'], statRows)}
  <h3>Six sizes</h3>
  <p>Any role can pick any of the first five. Bigger bodies reach further and move slower, and they're easier to hit, because the hit capsule grows with the body you see. We tuned each class's health price per role in the arena engine until every size of a role did as well in skirmishes as the same role at medium, which is why a tiny tank gets twice the health and a huge one gives a third of it back.</p>
  <p>Colossal is different. Only a transformation gets there.</p>
  ${table(['Size', 'Body', 'Hit radius', 'Melee reach', 'Speed', ...ROLES.map((r) => `${r.name} health`)], sizeRows, 'dense')}
  <h3>How damage lands</h3>
  <p>A hit's damage is its amount plus its ratio times the stat it scales with, weapon damage or spirit power.</p>
  <p>Each hit rolls up to ${pct(ENGINE.variance)} either way. Then the target's armor, against physical damage, or its spirit resist, against spirit damage, takes that percentage off. Shreds can push a resist down to ${ENGINE.resistFloor}%, where the target takes more, and no resist takes off more than ${ENGINE.resistCap}%.</p>
  <p>An area hit lands in full on up to ${ENGINE.areaShare} enemies and shares itself past that. An area heal, shield or buff delivers at most ${ENGINE.alliesShare} allies' worth. Burst heals on one hero inside ${ENGINE.healWindow} s weaken each other by ${pct(ENGINE.healFalloff)} each, so stacking healers stops paying.</p>
  <h3>The balance check</h3>
  <p>Before a hero can fight, it plays ${fights} ${GATE_DEFAULTS.team}v${GATE_DEFAULTS.team} skirmishes against a field of one default hero per role.</p>
  <p>It has to win under ${pct(GATE_CEILING - GATE_MARGIN)} of them. That's the ${pct(GATE_CEILING)} ceiling less ${pct(GATE_MARGIN)} for sampling noise.</p>
  <ul>
    <li>Over the line, every number it has is retuned down ${pct(RETUNE_STEP)} a step, up to ${MAX_RETUNE_STEPS} steps. Still over at the full retune, it's blocked, and the skill carrying it is named with alternatives to swap in.</li>
    <li>Under ${pct(GATE_FLOOR)}, it's lifted ${pct(RETUNE_STEP)} a step, up to ${MAX_LIFT_STEPS} steps, so nobody's hero is sent in hopeless. Still under ${pct(GATE_HOPELESS)} at the full lift, it's blocked and its weakest skill is named.</li>
    <li>Looks never touch a number, so changing one keeps the result. Changing a role, a size, the points or a skill sends the hero back for a new check.</li>
  </ul>
</section>`
}

function kitSection(): string {
  const slotRows = BUILD_SLOTS.map((s) => {
    const kind = SLOT_KIND[s]
    return [`<b>${s === 'active1' ? 'Active 1' : s === 'active2' ? 'Active 2' : s.charAt(0).toUpperCase() + s.slice(1)}</b>`, SLOT_DOC[s][0], esc(SLOT_DOC[s][1]), `${SLOT_BUDGETS[kind]} ${BUDGET_UNIT[kind]}`]
  })
  const familyCounts = FAMILIES.map((f) => [`<span class="chip fam-${f}">${FAMILY_LABEL[f]}</span>`, String(CATALOG.filter((t) => primaryFamily(t) === f).length)])
  const kinds: SlotKind[] = ['basic', 'active', 'passive', 'ultimate', 'movement']
  const KIND_TITLE: Record<SlotKind, string> = { basic: 'Basic attacks', active: 'Actives', passive: 'Passives', ultimate: 'Ultimates', movement: 'Movement' }
  const perRole = ROLES.map((r) => {
    const groups = kinds.map((k) => {
      const pool = poolFor(r.id, k)
      return `<h4>${KIND_TITLE[k]} <small>${pool.length}</small></h4>${table(['Mechanic', 'Families', 'Delivery', 'Cooldown', 'At the reference sheet'], pool.map((t) => templateRow(t, r.id)), 'templates')}`
    })
    const count = kinds.reduce((n, k) => n + poolFor(r.id, k).length, 0)
    return `<details${r.id === 'tank' ? ' open' : ''}><summary><b>${r.name}</b> <small>${count} templates</small></summary>${groups.join('')}</details>`
  })
  return `
<section id="kit">
  <h2>The kit: six slots, ${CATALOG.length} templates</h2>
  <p>Every hero carries six skills. The player names each one and says what it does. The engine carries it on a template from the role's pool and sets every number.</p>
  <p>So a skill can be called anything and still play fair.</p>
  ${table(['Slot', 'Key', 'What it is', 'Power budget'], slotRows)}
  <p>Every template in a slot is worth the same power budget, measured on a reference sheet of ${REFERENCE_SHEET.weaponDamage} weapon damage and ${REFERENCE_SHEET.spiritPower} spirit power. We set control, movement and durations by hand, and everything else gets scaled until the template lands on its budget.</p>
  <p>That's why a stun hits softer than a pure nuke.</p>
  <h3>Ten families</h3>
  <p>Every effect belongs to exactly one family, so the families split the whole space with nothing in two places. Most templates mix two or three. The count is by each template's main family.</p>
  ${table(['Family', 'Templates'], familyCounts)}
  <h3>Every template, role by role</h3>
  <p>The numbers are what each template does on the reference sheet, so a real hero's own weapon damage and spirit power move them, and so do the retunes and lifts the balance check hands out. A template several roles share shows under each, marked with the others.</p>
  ${perRole.join('\n  ')}
</section>`
}

function looksSection(): string {
  const sockets = GEAR_SLOTS.map((s) => [`<b>${{ head: 'Head', face: 'Face', hand_r: 'Right hand', hand_l: 'Left hand', back: 'Back' }[s]}</b>`, SLOT_KINDS[s].join(', ')])
  const pieces = BUILT_IN.map((p) => [`<b>${esc(p.name)}</b>`, p.kind, esc(p.tags.join(', ')), p.tint ? 'Yes' : ''])
  return `
<section id="looks">
  <h2>The look: everything you see, none of it a number</h2>
  <p>A hero's look is cosmetic.</p>
  <p>The engine never reads any of it, so a look can change after the balance check without sending the hero back.</p>
  <h3>Bodies</h3>
  <p>Two bodies, ${Object.values(GENDER_LABEL).join(' and ').toLowerCase()}, each rigged at every size: ${ALL_SIZE_CLASSES.map((c) => SIZES[c].label.toLowerCase()).join(', ')}. The size class picks the body, so the hit capsule and the model always agree.</p>
  <h3>Hair, beards, armour and a cape</h3>
  ${table(['Part', 'Choices'], [
    ['<b>Hair</b>', HAIR_STYLES.map((h) => HAIR_LABEL[h]).join(', ')],
    ['<b>Beard</b>', BEARD_STYLES.map((b) => BEARD_LABEL[b]).join(', ')],
    ['<b>Armour</b>', 'On or off'],
    ['<b>Cape</b>', 'On or off'],
  ])}
  <h3>Eleven colours</h3>
  ${table(['Region', 'What it colours'], LOOK_COLORS.map((c) => [`<b>${LOOK_COLOR_LABEL[c]}</b>`, esc(COLOR_DOC[c])]))}
  <h3>A face from a photo</h3>
  <p>When a reference image shows a face, the Forge finds ${FACE_POINTS} landmarks on it in the browser and warps the photo onto the body's own face wherever the hero is drawn, and the photo's colours come along with it.</p>
  <h3>Gear</h3>
  <p>Rigid pieces hang in five sockets on every body, and while a hand piece fits either hand, an off-hand piece like a shield or a bow only ever fits the left one. A piece with a colour slot takes the colour picked beside it.</p>
  ${table(['Socket', 'Takes'], sockets)}
  <p>Everything in the asset repository is free to wear, for everyone: the ${BUILT_IN.length} built-in pieces below, and every piece the community has generated. A piece the repository lacks can be generated from words or a picture for ${PIECE_PRICE} credits, and once it exists it's free for everyone after.</p>
  ${table(['Piece', 'Kind', 'Words that pick it', 'Colour slot'], pieces)}
  <p>The <a href="../forge/kit-sheet.html">kit sheet</a> renders every body, hair style and piece.</p>
</section>`
}

function makingSection(): string {
  const packs = PACKS.map((p) => [`<b>${p.credits} credits</b>`, `$${(p.amountCents / 100).toFixed(2)}`, `${Math.floor(p.credits / PIECE_PRICE)} pieces`])
  return `
<section id="making">
  <h2>How a hero is made</h2>
  <p>The Forge reads before it builds.</p>
  <p>You give it words, plus up to three reference images if you have them, and it says back what it understood: the look in the body kit's own words, the gear, what each of the six skills is called and does, and a role. Where it can't tell, it asks, ${words(MAX_QUESTIONS)} questions at most.</p>
  <p>You answer with a tap, fix any row by hand, or type a correction and it reads again.</p>
  <p>Nothing exists until you press Build hero.</p>
  ${table(['Reader', 'When it reads'], [
    ['<b>Your Claude Code</b>', 'On the local dev server only. It runs claude -p with Claude Haiku 5.5, the reading\'s JSON schema, no tools, no MCP servers, no plugins, and nothing saved.'],
    ['<b>Claude Haiku 5.5</b>', 'In production, once ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY is set. It costs $0.10 in and $0.50 out per million tokens.'],
    ['<b>Offline</b>', 'Always there. It reads quoted skill names after words like Skill 1, Q, ultimate or passive, mechanics such as a transformation, the colours and gear the prompt names, and outfit colours off the image.'],
  ])}
  <p>Whichever reader answers, its reading is rebuilt from the vocabulary on this page, so a hair style that doesn't exist or a template outside the role's pool never gets through.</p>
  <p>And a name you gave stays yours, whatever the reader thought.</p>
  <h3>What's free and what costs credits</h3>
  <p>Everything about making a hero is free, wearing anything in the repository included. The one thing that costs credits is generating a piece of gear the repository doesn't have yet: ${PIECE_PRICE} credits, twice the roughly ${GENERATION_COST.piece} it costs us to make.</p>
  <p>Every account gets ${FREE_GRANT} credits once.</p>
  ${table(['Pack', 'Price', 'Enough for'], packs)}
  <h3>The content floor</h3>
  <p>Anything legal goes, real people and parody included.</p>
  <p>Three things don't: anything involving children, sexual depictions of real people, and real people shown endorsing the game. The floor checks the prompt and the reading's words before you ever see a reading, and it checks generated pieces and their pictures again.</p>
</section>`
}

const STYLE = `
  :root { --bg: #fbfaff; --panel: #ffffff; --ink: #2a2540; --muted: #6a6488; --line: #e4e0f2; --accent: #7a5cff; --brand: #ff48d8; --chip: #f1eeff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #141220; --panel: #1b1830; --ink: #f1eefc; --muted: #a49fc0; --line: #2e2a48; --accent: #a48dff; --chip: #262143; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 48px 16px 96px; }
  .kicker { margin: 0 0 6px; font-weight: 700; font-size: 13px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
  h1 { margin: 0 0 12px; font-size: 44px; line-height: 1.05; letter-spacing: -0.02em; }
  h2 { margin: 64px 0 10px; font-size: 28px; line-height: 1.2; letter-spacing: -0.01em; }
  h3 { margin: 32px 0 8px; font-size: 19px; }
  h4 { margin: 22px 0 6px; font-size: 15px; }
  h4 small, summary small { color: var(--muted); font-weight: 500; }
  p, li { max-width: 74ch; }
  .lede { font-size: 19px; color: var(--muted); }
  .meta { font-size: 13px; color: var(--muted); }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 0; }
  nav a { padding: 6px 12px; border-radius: 999px; background: var(--chip); color: var(--ink); text-decoration: none; font-size: 14px; font-weight: 600; }
  nav a:hover { box-shadow: inset 0 0 0 1px var(--accent); }
  a { color: var(--accent); }
  .scroll { overflow-x: auto; margin: 12px 0 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 8px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  th { position: sticky; top: 0; background: var(--panel); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td small { display: block; color: var(--muted); font-size: 12px; }
  table.dense td { white-space: nowrap; }
  table.dense td small { display: inline; }
  table.templates td:first-child { min-width: 170px; }
  table.templates td:last-child { min-width: 280px; color: var(--muted); }
  code { display: block; font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--muted); }
  .chip { display: inline-block; margin: 0 2px 2px 0; padding: 1px 8px; border-radius: 999px; background: var(--chip); font-size: 12px; font-weight: 600; white-space: nowrap; }
  details { margin: 10px 0; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
  details > summary { padding: 12px 16px; cursor: pointer; font-size: 17px; }
  details > :not(summary) { margin-left: 16px; margin-right: 16px; }
  details > .scroll { border-radius: 8px; }
  footer { margin-top: 72px; font-size: 13px; color: var(--muted); }
  @media (max-width: 640px) { h1 { font-size: 34px; } h2 { font-size: 23px; } }
`

/** The whole page. No date in it, so regenerating an unchanged charter writes the same bytes. */
export function charterDoc(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Charter</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  <p class="kicker">psyblr autobattler</p>
  <h1>The character charter</h1>
  <p class="lede">Every rule a hero is made of, in one place. If it changes how a hero looks or fights, it's on this page, with the real numbers.</p>
  <p class="meta">Written by the code itself (src/docs/charter-doc.ts), so it can't drift from the game. Catalogue v${CATALOG_VERSION}, ${CATALOG.length} skill templates, engine calibration v${ENGINE_CALIBRATION_VERSION}.</p>
  <nav><a href="#making">Making a hero</a><a href="#roles">Roles and synergies</a><a href="#stats">Stats</a><a href="#kit">The kit</a><a href="#looks">The look</a></nav>
</header>
${makingSection()}
${rolesSection()}
${statsSection()}
${kitSection()}
${looksSection()}
<footer>Regenerate with <code>npx tsx scripts/charter-doc.ts</code> after changing a rule. A test fails while this page is out of date. Related pages: the <a href="charter-sheet.html">charter sheet</a>, the <a href="skill-library.html">skill library</a> and the <a href="../forge/kit-sheet.html">kit sheet</a>.</footer>
</main>
</body>
</html>
`
}
