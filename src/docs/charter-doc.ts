import { demoLook } from '../arena/demo/looks.js'
import { DEMO_HEROES, type DemoHero } from '../arena/demo/roster.js'
import { ENGINE, ENGINE_CALIBRATION_VERSION } from '../arena/engine/calibration.js'
import { famousMove, formLookOf, lookFromWords, templateWords } from '../arena/recipes/looks.js'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build.js'
import { MAX_RETUNE_STEPS, RETUNE_STEP, REFERENCE_SHEET, SLOT_BUDGETS } from '../charter/budget.js'
import { FAMILIES, FAMILY_LABEL, familiesOf, primaryFamily } from '../charter/families.js'
import { FLIGHT_SPEED_MUL, JUMP_REACH_PER_SPEED } from '../charter/locomotion.js'
import { FACE_POINTS, GENDER_LABEL, LOOK_SLOTS, type Worn } from '../charter/look.js'
import { ROLES, getRole } from '../charter/roles.js'
import { ALL_SIZE_CLASSES, SIZES, sizeHealth } from '../charter/sizes.js'
import {
  CAST_POSES,
  CHARGES,
  CHARGE_LABEL,
  ELEMENTS,
  ELEMENT_LABEL,
  ELEMENT_LOOKS,
  FAMILY_OF,
  FORMS,
  FORM_AURAS,
  FORM_AURA_LABEL,
  FORM_AVATARS,
  FORM_AVATAR_LABEL,
  FORM_ENTRIES,
  FORM_ENTRY_LABEL,
  FORM_GROWTHS,
  FORM_GROWTH_LABEL,
  FORM_LABEL,
  FORM_MARKS,
  FORM_MARK_LABEL,
  FORM_TRAILS,
  FORM_TRAIL_LABEL,
  IMPACTS,
  IMPACT_LABEL,
  MOTIFS,
  MOTIF_LABEL,
  POSE_LABEL,
  TRAILS,
  TRAIL_LABEL,
  formOf,
  type FormFamily,
  type SkillLook,
  type TransformationLook,
} from '../charter/skill-look.js'
import { ATTRIBUTES, ATTRIBUTE_GAINS, POOL_SIZE, SECONDARY_STATS } from '../charter/stats.js'
import { CATALOG, CATALOG_VERSION, getTemplate, poolFor } from '../charter/templates/catalog.js'
import { renderTooltip } from '../charter/tooltip.js'
import { TRAITS, TRAIT_TIERS } from '../charter/traits.js'
import type { BuildSlot, SecondarySheet, SecondaryStat, SlotKind, Template } from '../charter/types.js'
import { ENCORE_COVER_ANSWER, ENCORE_PROMPT } from '../forge/examples.js'
import { FORM_TEMPLATES, formChange, formFromWords, transformOf } from '../forge/form.js'
import { FREE_GRANT, GENERATION_COST, PACKS, PIECE_PRICE } from '../forge/pricing.js'
import { MAX_QUESTIONS, hydrateReading, offlineReading, templateBlurb, type Reading } from '../forge/reading.js'
import { FAR_RATE, MAX_PARTICLES, RATE } from '../kit/physics/cloth.js'
import { FINISHES, ITEM_SLOTS, KNOBS, RUNGS, type ItemSlot, type Rung } from '../kit/wear/item.js'
import { LIBRARY, libraryItem, type LibraryEntry } from '../kit/wear/library.js'
import { PRINTS, PRINT_LABEL, PRINT_SCALE } from '../kit/wear/prints.js'
import { GATE_CEILING, GATE_DEFAULTS, GATE_FLOOR, GATE_HOPELESS, GATE_MARGIN, MAX_LIFT_STEPS } from '../sim/gate.js'
import { ARCH, CHROME_STOPS, LETTERS, SHINE, TOKEN_BOX, TOKEN_SHINE, TOKEN_SHINE_AT, WORDMARK_BOX } from '../ui/brand/marks.js'
import { SLOT_LABEL } from '../ui/forge/labels.js'
import { FINISH_LABEL, KNOB_LABEL, LOOK_SLOT_LABEL, RUNG_LABEL, isRigid } from '../ui/forge/wardrobe.js'

/**
 * The master character charter (docs/charter/character-charter.html), written from the code itself so it can't drift.
 * It comes in two halves. What the engine owns: the roles and their synergies, how stats are bought, sizes, every
 * skill template with its numbers, transformations and the balance check. What the player owns: the body and face,
 * the wardrobe with every item in the library, skill looks and forms, the four rungs and what keeps it all fair. The
 * worked examples (Encore ABJ, three beams, four transformations, the twenty starters) are computed by the same code
 * the Forge runs. `npx tsx scripts/charter-doc.ts` writes it; a test fails when the committed page is stale.
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
const swatch = (hex: string) => `<i class="sw" style="--c:${esc(hex)}" title="${esc(hex)}"></i>`
const swatches = (list: readonly (string | null | undefined)[]) => list.filter((c): c is string => !!c).map(swatch).join('')
const chips = (list: readonly string[]) => list.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')
/** A library picture: from this page (docs/charter) to public/, which works opened as a file and on the dev server. */
const picture = (thumb: string, cls = '') => `<img${cls ? ` class="${cls}"` : ''} src="../../public${esc(thumb)}" alt="" loading="lazy">`

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
/** What a template does on the reference sheet, without the lines the table has columns for. */
const atReference = (t: Template) => renderTooltip(t, BLANK, REFERENCE, 0).lines.filter((l) => !/^(Range|Radius|Cooldown) /.test(l))

/** Every item slot by name: the look's own labels, and the two hands a piece can be made for. */
const ITEM_SLOT_LABEL: Record<ItemSlot, string> = {
  hair: LOOK_SLOT_LABEL.hair,
  beard: LOOK_SLOT_LABEL.beard,
  head: LOOK_SLOT_LABEL.head,
  upper: LOOK_SLOT_LABEL.upper,
  lower: LOOK_SLOT_LABEL.lower,
  full: LOOK_SLOT_LABEL.full,
  back: LOOK_SLOT_LABEL.back,
  feet: LOOK_SLOT_LABEL.feet,
  face: LOOK_SLOT_LABEL.face,
  hand: 'Either hand',
  offhand: 'The off hand',
}

const HOLDS: Record<ItemSlot, string> = {
  hair: 'Hairstyles, each in its colour. The long ones can be cut shorter.',
  beard: 'Beards and moustaches, in the hair colour or their own.',
  head: 'Hats, helmets, hoods, crowns and headbands.',
  upper: 'The torso and arms. Layered looks are one item with a channel for each layer.',
  lower: 'The legs: trousers, skirts and greaves.',
  full: 'Torso, arms and legs at once. It takes the place of the upper and lower items.',
  back: 'Capes, cloaks, scarves, wings and packs.',
  feet: 'Shoes and boots.',
  face: 'Glasses, masks and the odd cigar.',
  hand: 'Weapons and props, in either hand.',
  offhand: 'Shields and bows, which only ever go in the left hand.',
}

const FAMILY_NAME: Record<FormFamily, string> = { beam: 'Beam', projectile: 'Projectile', melee: 'Melee', cone: 'Cone', zone: 'Zone', aura: 'Aura', self: 'Self', movement: 'Movement' }

const RUNG_DOC: Record<Rung, [get: string, example: string]> = {
  wear: ['A library item as it was made.', 'The straw kasa, as it comes.'],
  recolour: ['Your colours and finishes on its channels.', 'The kimono in navy, with a gold silk obi.'],
  restyle: ['A print over one channel, and cuts along the item.', 'The kimono in the waves print, cut shorter.'],
  generate: ['A new item made in 3D from your words or picture, fitted to every body.', 'A raven-feather cloak.'],
}

// ------------------------------------------------------------------------------------------------ the brand

/** psyblr's token and wordmark in their still chrome, the same marks the top bar wears where its live chrome can't run. */
function brandMarks(): string {
  const fill = `<defs><linearGradient id="chrome" x1="0" y1="0" x2="0.18" y2="1">${CHROME_STOPS.map(([at, color]) => `<stop offset="${at}" stop-color="${color}"/>`).join('')}</linearGradient></defs>`
  const token = `<svg class="token" viewBox="${TOKEN_BOX.join(' ')}" aria-hidden="true">${fill}<g fill="url(#chrome)"><path d="${ARCH}"/><path d="${TOKEN_SHINE}" transform="${TOKEN_SHINE_AT}"/></g></svg>`
  const word = `<svg class="wordmark" viewBox="${WORDMARK_BOX.join(' ')}" role="img" aria-label="psyblr"><g fill="url(#chrome)">${LETTERS.map(([d, t]) => `<path d="${d}" transform="${t}"/>`).join('')}<path d="${SHINE[0]}" transform="${SHINE[1]}"/></g></svg>`
  return `<div class="brand">${token}${word}</div>`
}

// ------------------------------------------------------------------------------------------------ making a hero

function makingSection(): string {
  return `
<section id="making">
  <h2>How a hero is made</h2>
  <p>The Forge reads before it builds.</p>
  <p>You give it words, plus up to three pictures if you have them. It says back what it understood: the body, the wardrobe slot by slot, what each of the six skills is called, what it does and how it looks, and which way the ultimate's transformation goes if it has one.</p>
  <p>Where it can't tell, it asks, ${words(MAX_QUESTIONS)} questions at most.</p>
  <p>Skills come first, then whether the form grows, keeps its size or shrinks, then whether to wear the face in your picture.</p>
  <p>Every wish in the wardrobe shows the rung it sits on and what it costs, and you can move it. You can answer a question with a tap or fix any row by hand. And if it got something wrong, type a correction and it reads again.</p>
  <p>A correction about the ultimate goes to the form, so "make the ultimate shrink him" shrinks the form and leaves the hero's own size alone.</p>
  <p>Nothing exists until you press Build hero.</p>
  ${table(['Reader', 'When it reads'], [
    ['<b>Your Claude Code</b>', 'On the local dev server only. It runs claude -p with Claude Haiku 5.5, the reading\'s JSON schema, no tools, no MCP servers, no plugins, and nothing saved.'],
    ['<b>Claude Haiku 5.5</b>', 'In production, once ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY is set. It costs $0.10 in and $0.50 out per million tokens.'],
    ['<b>Offline</b>', 'Always there. It reads quoted skill names after words like Skill 1, Q, ultimate or passive, and mechanics such as a transformation and which way it goes. It matches the clothes, hair and gear the prompt names against the library\'s own words, with their colours and prints, and reads outfit colours off the picture.'],
  ])}
  <p>Whichever reader answers, we rebuild its reading from the vocabulary on this page, so an item the library doesn't have, a colour that isn't one or a template outside the role's pool never gets through.</p>
  <p>And a name you gave stays yours, whatever the reader thought.</p>
</section>`
}

// ------------------------------------------------------------------------------------------------ what the engine owns

function templateRow(t: Template, role: string): string[] {
  const others = t.roles.filter((r) => r !== role).map((r) => getRole(r).name)
  const d = t.delivery
  const where = [d.kind, ...(d.kind !== 'self' && d.kind !== 'aura' && d.range > 0 ? [`${num(d.range)} m`] : []), ...(d.radius ? [`${num(d.radius)} m radius`] : [])]
  return [
    `<b>${esc(t.name)}</b><code>${esc(t.id)}</code>${others.length ? `<small>Also ${esc(others.join(', '))}</small>` : ''}`,
    familiesOf(t).map((f) => `<span class="chip fam-${f}">${FAMILY_LABEL[f]}</span>`).join(' '),
    esc(where.join(', ')),
    t.cooldown ? `${num(t.cooldown)} s` : '',
    esc(atReference(t).join(' · ')),
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
</section>`
}

function kitSection(): string {
  const slotRows = BUILD_SLOTS.map((s) => {
    const kind = SLOT_KIND[s]
    return [`<b>${SLOT_LABEL[s]}</b>`, SLOT_DOC[s][0], esc(SLOT_DOC[s][1]), `${SLOT_BUDGETS[kind]} ${BUDGET_UNIT[kind]}`]
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

function transformSection(): string {
  const rows = FORM_TEMPLATES.map((t) => {
    const form = transformOf(t)!
    return [
      `<b>${esc(t.name)}</b><code>${esc(t.id)}</code>`,
      esc(t.roles.map((r) => getRole(r).name).join(', ')),
      form.size ? `${SIZES[form.size].label} <small>${num(SIZES[form.size].scale)}×</small>` : 'Its own',
      esc(formChange(t, 'medium')),
      `${num(form.duration)} s`,
      t.cooldown ? `${num(t.cooldown)} s` : '',
      esc(atReference(t).join(' · ')),
    ]
  })
  return `
<section id="transformations">
  <h2>Transformations: the template sets the size</h2>
  <p>A transformation is an ultimate that changes the hero for a while.</p>
  <p>It grows, keeps the hero's size or shrinks, and each way is its own template with its own numbers, priced and balance-checked like any other.</p>
  <p>The arena loads the size class's own body for the form, so the hit capsule grows and shrinks with what you see.</p>
  ${table(['Template', 'Roles', 'Size', 'On a medium hero', 'Lasts', 'Cooldown', 'At the reference sheet'], rows, 'templates')}
  <p>Tiny is the smallest body there is, so Shrink Form is a big change on a huge hero (${num(SIZES.huge.scale)}× down to ${num(SIZES.tiny.scale)}×) and a small one on a small hero (${num(SIZES.small.scale)}× down to ${num(SIZES.tiny.scale)}×).</p>
  <p>How a form looks is yours, and it's further down the page.</p>
</section>`
}

function balanceSection(): string {
  const fights = GATE_DEFAULTS.duelsPerMember * ROLES.length
  return `
<section id="balance">
  <h2>The balance check</h2>
  <p>Before a hero can fight, it plays ${fights} ${GATE_DEFAULTS.team}v${GATE_DEFAULTS.team} skirmishes against a field of one default hero per role.</p>
  <p>It has to win under ${pct(GATE_CEILING - GATE_MARGIN)} of them. That's the ${pct(GATE_CEILING)} ceiling less ${pct(GATE_MARGIN)} for sampling noise.</p>
  <ul>
    <li>Over the line, every number it has is retuned down ${pct(RETUNE_STEP)} a step, up to ${MAX_RETUNE_STEPS} steps. Still over at the full retune, it's blocked, and the skill carrying it is named with alternatives to swap in.</li>
    <li>Under ${pct(GATE_FLOOR)}, it's lifted ${pct(RETUNE_STEP)} a step, up to ${MAX_LIFT_STEPS} steps, so nobody's hero is sent in hopeless. Still under ${pct(GATE_HOPELESS)} at the full lift, it's blocked and its weakest skill is named.</li>
    <li>Changing a role, a size, the points or a skill sends the hero back for a new check. Changing anything in the second half of this page never does.</li>
  </ul>
</section>`
}

// ------------------------------------------------------------------------------------------------ what you own

function bodySection(): string {
  const bodies = Object.keys(GENDER_LABEL).length * ALL_SIZE_CLASSES.length
  const rows = [
    ['<b>Body</b>', esc(Object.values(GENDER_LABEL).map((g, i) => (i ? g.toLowerCase() : g)).join(' or ')), 'The size class picks which of its six bodies'],
    ['<b>Weight</b>', 'Lean to heavy', '0 to 1, and 0.5 is the body as made'],
    ['<b>Muscle</b>', 'Soft to built', '0 to 1, and 0.5 is the body as made'],
    ['<b>Age</b>', 'Young to old', '0, the body as made, to 1, about 75'],
    ['<b>Skin, eyes and brows</b>', 'Any colour', 'A photo face brings its own skin'],
    ['<b>Face</b>', 'A photo of anyone', `${FACE_POINTS} landmarks, and how much of its shape to take, 0 to 1`],
  ]
  return `
<section id="body">
  <h2>The body and the face</h2>
  <p>Every size class has a man's body and a woman's, ${bodies} in all, and they share one surface: the same vertices joined into the same triangles.</p>
  <p>Everything a hero wears is bound to that surface. So one item fits every body, whatever its build or face, and it stays on through a transformation that changes the size.</p>
  ${table(['Part', 'What you set', 'Range'], rows)}
  <p>Under everything sits a base layer painted into the body itself: shorts, and a sports top on a woman's body. So a slot left empty never shows more than a swimmer would.</p>
  <p>When a picture shows a face, the Forge finds its ${FACE_POINTS} landmarks in the browser, lays the photo on the head and fits the head's shape to it by mixing MakeHuman's face targets, the same way Blender fitted the twenty starters to their portraits. The strength slider sets how much of that shape the face takes. The picture itself always goes on whole.</p>
</section>`
}

function wardrobeSection(): string {
  const rows = ITEM_SLOTS.map((slot) => {
    const items = LIBRARY.filter((e) => e.slot === slot)
    return [`<b>${ITEM_SLOT_LABEL[slot]}</b>`, esc(HOLDS[slot]), String(items.length), esc(items.slice(0, 4).map((e) => e.name).join(', '))]
  })
  return `
<section id="wardrobe">
  <h2>The wardrobe: one item in each slot</h2>
  <p>A hero wears one item per slot.</p>
  <p>That keeps fitting simple, because a garment is only ever fitted to the body and never to another garment. So a layered look like a leather jacket over a tee is a single item with a colour channel for each layer.</p>
  ${table(['Slot', 'Holds', 'In the library', 'For example'], rows)}
  <p>Each slot sits at its own distance from the skin: boots outside the trouser legs, a top outside the waistband, a cape outside the top. Whatever an item covers is hidden under it, so nothing pokes through. Hair and beards are pressed in under a hat, so a cap flattens the hair, and long hair still hangs below a kasa's brim.</p>
  <h3>Cloth that moves</h3>
  <p>Loose cloth and long hair hang from short chains that swing and push off the body, and so do the tails of a nine-tails form, with up to ${MAX_PARTICLES} moving points a hero across everything it wears, stepped ${RATE} times a second near the camera and ${FAR_RATE} times far away.</p>
  <p>Each moving point is a bone the cloth is skinned to, so the GPU does the bending and nothing simulates a mesh.</p>
</section>`
}

function rungsSection(): string {
  const rungRows = RUNGS.map((r) => [`<b>${RUNG_LABEL[r]}</b>`, esc(RUNG_DOC[r][0]), r === 'generate' ? `${PIECE_PRICE} credits, once` : 'Free', esc(RUNG_DOC[r][1])])
  const packs = PACKS.map((p) => [`<b>${p.credits} credits</b>`, `$${(p.amountCents / 100).toFixed(2)}`, `${Math.floor(p.credits / PIECE_PRICE)} items`])
  return `
<section id="rungs">
  <h2>Four rungs to any look</h2>
  <p>Say you want a kimono. You can wear the library's as it is, put it in your own colours, give it a print and cut it shorter, or have a new one made. Those are the four rungs, cheapest first.</p>
  ${table(['Rung', 'You get', 'Cost', 'For example'], rungRows)}
  <p>The Forge picks the lowest rung that gets you what you asked for, and the reading shows it.</p>
  <p>What anyone generates joins the shared library, so the next player can wear it, recolour it or restyle it for free. Generated items recolour too, because the fit finds their colour regions and turns them into channels.</p>
  <h3>Channels and finishes</h3>
  <p>Every item has up to four colour channels, like a kimono's cloth, obi and collar. Each channel takes a finish: ${either(FINISHES.map((f) => FINISH_LABEL[f].toLowerCase()))}.</p>
  <h3>Prints</h3>
  <p>Any cloth channel can wear one of ${PRINTS.length} prints, or a picture you upload. Each print is a small tile in two colours, the channel's own and an ink, that repeats without a join. So one print reads in any colours, at ${PRINT_SCALE.min} to ${PRINT_SCALE.max} repeats a metre.</p>
  <p class="chips">${chips(PRINTS.map((p) => PRINT_LABEL[p]))}</p>
  <h3>Cuts</h3>
  <p>An item that allows it can be cut shorter: ${either(KNOBS.map((k) => KNOB_LABEL[k].toLowerCase()))}, each from 0, the shortest, to 1, as made. Every vertex of an item records where it sits along the body's limbs and trunk, so a cut works on any item, generated ones included.</p>
  <h3>What's free and what costs credits</h3>
  <p>Everything about making a hero is free, wearing anything in the library included. The one thing that costs credits is generating an item the library doesn't have yet: ${PIECE_PRICE} credits, twice the roughly ${GENERATION_COST.piece} it costs us to make. If it can't be made, or doesn't fit, the credits go back.</p>
  <p>Every account gets ${FREE_GRANT} credits once.</p>
  ${table(['Pack', 'Price', 'Enough for'], packs)}
</section>`
}

function skillLookSection(): string {
  const families = Object.keys(FORMS) as FormFamily[]
  const deliveries = (f: FormFamily) => (Object.keys(FAMILY_OF) as (keyof typeof FAMILY_OF)[]).filter((k) => FAMILY_OF[k] === f)
  const formRows = families.map((f) => [`<b>${FAMILY_NAME[f]}</b>${deliveries(f).join(', ') !== f ? `<small>${esc(deliveries(f).join(', '))}</small>` : ''}`, esc(FORMS[f].map((x) => FORM_LABEL[x]).join(', '))])
  const distinct = new Set(Object.values(FORMS).flat()).size
  const axisRows = [
    ['<b>Element</b>', esc(ELEMENTS.map((e) => ELEMENT_LABEL[e]).join(', '))],
    ['<b>Colours</b>', 'Three: a core, a glow and an accent'],
    ['<b>Form</b>', `${distinct} shapes, by how the skill is delivered (below)`],
    ['<b>Cast pose</b>', esc(CAST_POSES.map((p) => POSE_LABEL[p]).join(', '))],
    ['<b>Charge</b>', esc(CHARGES.map((c) => CHARGE_LABEL[c]).join(', '))],
    ['<b>Impact</b>', esc(IMPACTS.map((i) => IMPACT_LABEL[i]).join(', '))],
    ['<b>Trail</b>', esc(TRAILS.map((t) => TRAIL_LABEL[t]).join(', '))],
    ['<b>Motif</b>', `What a motif trail sheds: ${esc(MOTIFS.map((m) => MOTIF_LABEL[m]).join(', ').toLowerCase())}`],
    ['<b>Intensity</b>', 'Brightness, 0.5 to 2. It never changes a size.'],
    ['<b>Callout</b>', 'The move\'s name over the caster as it fires'],
  ]
  const elementRows = ELEMENTS.map((e) => {
    const l = ELEMENT_LOOKS[e]
    const own = Object.values(l.forms).map((f) => FORM_LABEL[f])
    return [`<b>${ELEMENT_LABEL[e]}</b>`, swatches(l.palette), own.length ? esc(own.join(', ')) : '<small>The plain ones</small>', IMPACT_LABEL[l.impact], TRAIL_LABEL[l.trail], MOTIF_LABEL[l.motif]]
  })
  return `
<section id="skill-looks">
  <h2>Skill looks: how a skill looks, beside what it does</h2>
  <p>The template owns a skill's mechanic, its numbers and its hit area. The look owns everything you see, so three beams can share a template and still look nothing alike. The worked example below has three.</p>
  ${table(['Part', 'Choices'], axisRows)}
  <h3>Forms, by delivery</h3>
  <p>A skill's form has to suit how it's delivered. A form that stops fitting after a template swap gives way to the element's own.</p>
  ${table(['Delivery', 'Forms, the plain one first'], formRows)}
  <h3>Each element's own look</h3>
  <p>A skill nobody gave a look reads one from its name and what it does, and an element brings the rest. Famous moves are recognised whole, so a skill called Kamehameha fires a white and sky-blue wave from the hip, while the preset names stay generic.</p>
  ${table(['Element', 'Colours', 'Its own forms', 'Impact', 'Trail', 'Motif'], elementRows)}
  <p>The layer that shows a skill's hit area is always drawn at its true size. Everything else is decoration, and it never reads as damage.</p>
</section>`
}

function formLookSection(): string {
  const rows = [
    ['<b>Arrives as</b>', esc(FORM_ENTRIES.map((e) => FORM_ENTRY_LABEL[e]).join(', '))],
    ['<b>Around it</b>', esc(FORM_AURAS.map((a) => FORM_AURA_LABEL[a]).join(', '))],
    ['<b>Size change</b>', `${esc(FORM_GROWTHS.map((g) => FORM_GROWTH_LABEL[g]).join(' or '))}: swelling into the new size, or all at once`],
    ['<b>Trail</b>', esc(FORM_TRAILS.map((t) => FORM_TRAIL_LABEL[t]).join(', '))],
    ['<b>Avatar</b>', `${esc(FORM_AVATARS.map((a) => FORM_AVATAR_LABEL[a]).join(' or '))}: tails of energy on cloth chains, or a spirit body that fills the hitbox exactly`],
    ['<b>Body</b>', `A hair item and its colour, eye colour, ${esc(FORM_MARKS.map((m) => FORM_MARK_LABEL[m].toLowerCase()).join(', '))}, and library items worn over the outfit`],
  ]
  return `
<section id="form-looks">
  <h2>Forms: the size is the template's, the rest is yours</h2>
  <p>A transformation's look says how it arrives, what surrounds the hero while it lasts, how the change of size plays, what it leaves behind as it moves, and what changes about the body.</p>
  ${table(['Part', 'Choices'], rows)}
  <p>Body changes are items from the wardrobe, like spiky gold hair or a chakra cloak over the outfit. Everything stays bound to the shared surface, so the outfit stays on through any size, and an avatar fills exactly the hitbox its template gives.</p>
</section>`
}

function fairSection(): string {
  return `
<section id="fair">
  <h2>What keeps it fair</h2>
  <ul>
    <li>Looks never touch a number. The balance check's key leaves them out, so editing a look, a wish or a skill's colours keeps the result the hero already has.</li>
    <li>What you see is what can be hit. The body is its size class's own, a skill's hit layer is drawn at its true size, and an avatar fills its hitbox exactly.</li>
    <li>The engine sets every number, whatever a skill is called. A Kamehameha on a beam template hits exactly as hard as that template.</li>
    <li>Everything in the library is free for everyone. Generating costs ${PIECE_PRICE} credits once, and the item it makes is everyone's after.</li>
  </ul>
  <h3>The content floor</h3>
  <p>Anything legal goes, real people and parody included.</p>
  <p>Three things don't: anything involving children, sexual depictions of real people, and real people shown endorsing the game. The floor checks the prompt and the reading's words before you ever see a reading, and it checks generated items and their pictures again.</p>
</section>`
}

// ------------------------------------------------------------------------------------------------ worked examples

/** A skill's look in a few words: its element, the form it takes on this delivery, and its colours. */
const lookLine = (look: SkillLook, kind: Template['delivery']['kind']) => `${ELEMENT_LABEL[look.element]} ${FORM_LABEL[formOf(look, kind)].toLowerCase()} ${swatches(look.palette)}`

/** What a form changes beyond the hero's size, one part a line. */
function formExtras(look: TransformationLook): string {
  const b = look.body
  const parts = [
    ...(b?.hair ? [`${esc(libraryItem(b.hair)?.name ?? b.hair)} hair ${b.hairColor ? swatch(b.hairColor) : ''}`] : []),
    ...(b?.eyes ? [`Eyes ${swatch(b.eyes)}`] : []),
    ...(b?.marks ? [FORM_MARK_LABEL[b.marks]] : []),
    ...(b?.wear ?? []).map((w) => `Over the outfit: ${esc(libraryItem(w.id)?.name ?? w.id)} ${swatches(w.colors ?? [])}`),
    ...(look.avatar ? [FORM_AVATAR_LABEL[look.avatar]] : []),
    ...(look.trail ? [`${FORM_TRAIL_LABEL[look.trail]} trail`] : []),
  ]
  return parts.length ? `<ul class="bits">${parts.map((p) => `<li>${p}</li>`).join('')}</ul>` : '<small>Nothing more</small>'
}

/** Each channel's colour as this hero wears it: theirs, or the item's own where they kept it. */
function wornColors(w: Worn): string[] {
  const channels = libraryItem(w.id)?.channels ?? []
  return channels.map((c, i) => w.colors?.[i] ?? c.color)
}

function encoreExample(): string {
  const offline = offlineReading({ prompt: ENCORE_PROMPT })
  const cover: Reading = hydrateReading(ENCORE_COVER_ANSWER, { prompt: ENCORE_PROMPT, heroName: 'Encore ABJ', faceFound: true }, 'claude')
  const named = BUILD_SLOTS.filter((s) => offline.kit[s].name).map((s) => offline.kit[s].name)
  const wishRows = cover.wear.map((w) => {
    const item = w.item ? libraryItem(w.item) : undefined
    return [`<b>${LOOK_SLOT_LABEL[w.slot]}</b>`, esc(w.phrase), item ? `<span class="pick">${picture(item.thumb, 'mini')}${esc(item.name)}</span>` : '<small>Not in the library yet</small>', RUNG_LABEL[w.rung], swatches(w.colors ?? []) + (w.finishes?.length ? ` <small>${esc(w.finishes.filter(Boolean).map((f) => FINISH_LABEL[f!]).join(', '))}</small>` : '')]
  })
  const kitRows = BUILD_SLOTS.map((s) => {
    const skill = cover.kit[s]
    const t = getTemplate(skill.template)
    const kind = t.delivery.kind
    const look = skill.look ?? lookFromWords({ own: [skill.name, skill.does].filter(Boolean).join(' '), ...templateWords(t), kind, slot: s })
    const asked = cover.questions.some((q) => q.about === s)
    return [`<b>${SLOT_LABEL[s]}</b>`, esc(skill.name || t.name), skill.does ? esc(skill.does) : `<small>${asked ? 'Asked below' : 'What its template does'}</small>`, esc(templateBlurb(t)), look ? lookLine(look, kind) : '<small>Its element\'s look</small>']
  })
  const form = cover.form
  const ult = getTemplate(cover.kit.ultimate.template)
  return `
<h3>Encore ABJ, read off a cover</h3>
<p>Here's the prompt a player typed, with the Lunch Break cover attached:</p>
<blockquote>${esc(ENCORE_PROMPT)}</blockquote>
<p>A reader that can see the cover answers with the wardrobe too. Rebuilt the way every answer is, it comes out as a ${esc(getRole(cover.roleId).name.toLowerCase())} at ${esc(SIZES[cover.look.size].label.toLowerCase())} size${cover.look.wearFace ? ', wearing the face from the cover' : ''}:</p>
${table(['Slot', 'Wish', 'Answered by', 'Rung', 'Colours'], wishRows)}
${table(['Slot', 'Name', 'What it does', 'Engine', 'Look'], kitRows)}
<p>The ultimate is ${esc(ult.name)}, so the hero ${esc(formChange(ult, cover.look.size))}. The form arrives in a ${form?.entry ? esc(FORM_ENTRY_LABEL[form.entry].toLowerCase()) : 'flash'}${form?.aura ? ` with a ${esc(FORM_AURA_LABEL[form.aura].toLowerCase())}` : ''}, and while it lasts the hero gets:</p>
${form ? formExtras(form) : ''}
<p>Then the reader asks what it couldn't tell:</p>
<ul>${cover.questions.map((q) => `<li><b>${esc(q.ask)}</b> ${esc(q.options.map((o) => o.label).join(' · '))}</li>`).join('')}</ul>
<p>Offline, with no picture to look at, the Forge still gets all ${words(named.length)} names from the words (${esc(named.join(', '))}) and asks ${words(offline.questions.length)} questions. ${offline.wear.length ? '' : 'It can\'t see the hat, so the role dresses the hero until you name the clothes.'}</p>`
}

function beamsExample(): string {
  const beam = getTemplate('mage-mega-beam')
  const rows = ['Kamehameha', 'Galick Gun', 'Special Beam Cannon'].map((name) => {
    const look = famousMove(name)!
    return [`<b>${name}</b>`, FORM_LABEL[formOf(look, beam.delivery.kind)], swatches(look.palette), look.pose ? POSE_LABEL[look.pose] : '', look.charge ? CHARGE_LABEL[look.charge] : '', look.impact ? IMPACT_LABEL[look.impact] : '']
  })
  return `
<h3>Three beams, one template</h3>
<p>Kamehameha, Galick Gun and Special Beam Cannon can all fire on ${esc(beam.name)} (<code class="inline">${esc(beam.id)}</code>), with its numbers and its hit area: ${esc(atReference(beam).join(' · '))}. Their looks are where they part ways.</p>
${table(['Move', 'Form', 'Colours', 'Pose', 'Charge', 'Impact'], rows)}`
}

function formsExample(): string {
  const rows = ['Titan', 'Ant-Man', 'Nine-Tails', 'Super Saiyan'].map((name) => {
    const t = getTemplate(formFromWords(name)!)
    const size = transformOf(t)?.size
    const look = formLookOf(famousMove(name))
    return [
      `<b>${name}</b>`,
      `${esc(t.name)}<code>${esc(t.id)}</code>`,
      size ? `${SIZES[size].label} <small>${num(SIZES[size].scale)}×</small>` : 'Its own',
      FORM_ENTRY_LABEL[look.entry],
      look.aura ? FORM_AURA_LABEL[look.aura] : '<small>None</small>',
      size ? FORM_GROWTH_LABEL[look.growth] : '<small>None</small>',
      formExtras(look),
    ]
  })
  return `
<h3>Four transformations</h3>
<p>Each one takes its own template, and that sets the size. The look does the rest.</p>
${table(['Form', 'Template', 'Size', 'Arrives as', 'Around it', 'Size change', 'And'], rows)}`
}

function starterCard(hero: DemoHero): string {
  const look = demoLook(hero.id)
  const p = look.physique!
  const worn = LOOK_SLOTS.filter((s) => look.wear?.[s]).map((s) => {
    const w = look.wear![s]!
    return `<li><span class="slot">${LOOK_SLOT_LABEL[s]}</span><span>${esc(libraryItem(w.id)?.name ?? w.id)} ${swatches(wornColors(w))}</span></li>`
  })
  return `<figure class="starter">${picture(look.face!.url)}<figcaption><b>${esc(hero.heroName)}</b><small>${getRole(hero.roleId).name} · ${SIZES[hero.sizeClass].label} · ${GENDER_LABEL[look.gender]}</small><p class="build">Weight ${num(p.weight)} · muscle ${num(p.muscle)} · age ${num(p.age)}</p><ul class="worn">${worn.join('')}</ul></figcaption></figure>`
}

function startersExample(): string {
  return `
<h3>The twenty starters</h3>
<p>The heroes the game ships with are made the way yours is: a body, a physique for their build, their portrait as a photo face, library hair and a beard, a signature outfit of library items in their colours, and their gear.</p>
<p>Nothing about them is bespoke, so a remix keeps the whole look, and anyone can dress like them. They lose one thing on purpose, their own heights. A hero's size class sets its height, so the hitbox stays the truth.</p>
<div class="starters">${DEMO_HEROES.map(starterCard).join('')}</div>`
}

function examplesSection(): string {
  return `
<section id="examples">
  <h2>Worked examples</h2>
  <p>Everything below is computed by the same code the Forge and the arena run.</p>
  ${encoreExample()}
  ${beamsExample()}
  ${formsExample()}
  ${startersExample()}
</section>`
}

// ------------------------------------------------------------------------------------------------ the library

function itemCard(e: LibraryEntry): string {
  const rigid = isRigid(e)
  const channels = rigid
    ? e.channels.map((c) => `<li>${swatch(c.color)}Takes a colour</li>`).join('') || '<li>Its own colours</li>'
    : e.channels.map((c) => `<li>${swatch(c.color)}${esc(c.name)} <small>${FINISH_LABEL[c.finish]}</small></li>`).join('')
  const cuts = e.knobs.length ? `<p class="cuts">Cuts: ${esc(e.knobs.map((k) => KNOB_LABEL[k].toLowerCase()).join(', '))}</p>` : ''
  return `<figure class="item">${picture(e.thumb)}<figcaption><b>${esc(e.name)}</b><code>${esc(e.id)}</code><ul class="channels">${channels}</ul>${cuts}<p class="words">${esc(e.tags.slice(0, 3).join(', '))}</p></figcaption></figure>`
}

function librarySection(): string {
  const groups = ITEM_SLOTS.map((slot) => {
    const items = LIBRARY.filter((e) => e.slot === slot)
    return items.length ? `<h3>${ITEM_SLOT_LABEL[slot]} <small>${items.length}</small></h3><div class="items">${items.map(itemCard).join('')}</div>` : ''
  })
  return `
<section id="library">
  <h2>The library: ${LIBRARY.length} items, free to wear</h2>
  <p>Every item here is free for everyone, on the first three rungs.</p>
  <p>We built them in Blender and ran each one through the same fit a player's generated item goes through, so a kimono from the library and a kimono someone generates tomorrow sit on the body the same way. Clothes and hair are bound to the shared body, and so are most hats. Rigid pieces like a top hat or a katana hang on a socket and take one colour.</p>
  <p>Under each item are its channels with their finish, the cuts it allows, and a few of the words a prompt can use for it.</p>
  ${groups.join('\n  ')}
</section>`
}

// ------------------------------------------------------------------------------------------------ the page

const STYLE = `
  :root {
    color-scheme: light;
    --ink: #2a2540; --ink-dim: rgba(42, 37, 64, 0.72); --ink-faint: rgba(42, 37, 64, 0.5);
    --glass: rgba(255, 255, 255, 0.62); --glass-hi: rgba(255, 255, 255, 0.86); --line: rgba(42, 37, 64, 0.13); --well: rgba(238, 238, 246, 0.75);
    --edge: rgba(255, 255, 255, 0.9); --shadow: 0 24px 60px -26px rgba(40, 38, 64, 0.4), 0 2px 6px rgba(40, 38, 64, 0.08);
    --banner: linear-gradient(180deg, #5d5878 0%, #2a2540 46%, #8f8bab 52%, #3b3655 100%);
    --iri-ring: conic-gradient(from 210deg, #c9d2ff, #bff3e2, #fff0c4, #ffd3ee, #d8ccff, #c9d2ff);
    --iri: linear-gradient(115deg, #d4daff 0%, #cdf4e8 26%, #fff2cf 50%, #f8dcef 72%, #d4daff 100%);
    --page-bg: radial-gradient(1000px 560px at 86% -10%, rgba(212, 218, 255, 0.95), transparent 70%), radial-gradient(820px 520px at 4% 0%, rgba(205, 244, 232, 0.6), transparent 70%), radial-gradient(900px 520px at 50% 122%, rgba(248, 220, 239, 0.75), transparent 70%), linear-gradient(180deg, #fbfaff 0%, #f4f1ff 100%);
    --display: 'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', sans-serif;
    --font: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --ink: #fbfaff; --ink-dim: rgba(251, 250, 255, 0.72); --ink-faint: rgba(251, 250, 255, 0.48);
      --glass: rgba(22, 22, 30, 0.64); --glass-hi: rgba(46, 46, 60, 0.8); --line: rgba(251, 250, 255, 0.14); --well: rgba(9, 9, 14, 0.55);
      --edge: rgba(255, 255, 255, 0.07); --shadow: 0 24px 60px -22px rgba(2, 2, 6, 0.75), 0 2px 8px rgba(2, 2, 6, 0.35);
      --banner: linear-gradient(100deg, #e6e9ff 0%, #c9f3e6 30%, #fff1c9 55%, #ffd6f0 80%, #dcd2ff 100%);
      --page-bg: radial-gradient(1100px 520px at 50% 122%, rgba(248, 220, 239, 0.06), transparent 70%), radial-gradient(900px 620px at 88% -12%, rgba(170, 182, 255, 0.14), transparent 70%), radial-gradient(760px 520px at 6% -8%, rgba(205, 244, 232, 0.07), transparent 70%), linear-gradient(180deg, #0e0e14 0%, #121219 58%, #15151d 100%);
    }
  }
  * { box-sizing: border-box; }
  html { background: #fbfaff; }
  @media (prefers-color-scheme: dark) { html { background: #0e0e14; } }
  body { margin: 0; background: var(--page-bg); background-attachment: fixed; color: var(--ink); font: 400 16px/1.6 var(--font); -webkit-font-smoothing: antialiased; }
  main { max-width: 1120px; margin: 0 auto; padding: 48px 16px 96px; }
  .brand { display: flex; align-items: center; gap: 14px; margin-bottom: 32px; filter: drop-shadow(0 1px 1px rgba(40, 38, 64, 0.5)) drop-shadow(0 6px 14px rgba(40, 38, 64, 0.3)); }
  @media (prefers-color-scheme: dark) { .brand { filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6)) drop-shadow(0 0 22px rgba(212, 218, 255, 0.28)); } }
  .brand .token { width: 50px; height: auto; }
  .brand .wordmark { height: 40px; width: auto; }
  .kicker { margin: 0 0 10px; font: 600 13px/1 var(--font); letter-spacing: 0.2em; text-transform: uppercase; color: var(--ink-faint); }
  h1 { margin: 0 0 16px; font: 800 italic clamp(48px, 8vw, 92px)/0.88 var(--display); letter-spacing: 0.01em; text-transform: uppercase; background: var(--banner); -webkit-background-clip: text; background-clip: text; color: transparent; }
  h2 { margin: 72px 0 12px; font: 800 italic clamp(28px, 3.4vw, 40px)/1 var(--display); letter-spacing: 0.02em; text-transform: uppercase; }
  h3 { margin: 36px 0 8px; font: 700 italic 24px/1.1 var(--display); letter-spacing: 0.03em; text-transform: uppercase; }
  h3 small, h4 small, summary small { color: var(--ink-faint); font: 500 13px/1 var(--font); letter-spacing: 0; text-transform: none; }
  h4 { margin: 22px 0 6px; font-size: 15px; }
  p, li { max-width: 74ch; }
  .lede { font-size: 20px; line-height: 1.5; color: var(--ink-dim); }
  .meta { font-size: 13px; color: var(--ink-faint); }
  nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 24px 0 0; }
  nav a { padding: 7px 14px; border: 1px solid transparent; border-radius: 999px; background: linear-gradient(var(--glass), var(--glass)) padding-box, linear-gradient(var(--line), var(--line)) border-box; color: var(--ink); text-decoration: none; font-size: 14px; font-weight: 600; box-shadow: inset 0 1px 0 var(--edge); }
  nav a:hover, nav a:focus-visible { background: linear-gradient(var(--glass-hi), var(--glass-hi)) padding-box, var(--iri-ring) border-box; outline: none; }
  a { color: inherit; text-decoration-color: rgba(127, 120, 170, 0.6); text-underline-offset: 3px; }
  a:focus-visible { outline: 2px solid #c9d2ff; outline-offset: 2px; }
  .part { margin: 104px 0 0; padding: 32px 28px; border-radius: 22px; background: var(--glass); box-shadow: inset 0 1px 0 var(--edge), inset 0 0 0 1px var(--line), var(--shadow); }
  .part p { margin: 8px 0 0; color: var(--ink-dim); font-size: 18px; }
  .part .label { display: inline-block; margin: 0 0 10px; padding: 3px 12px; border-radius: 999px; background: var(--iri); color: #2a2540; font: 700 12px/1.4 var(--font); letter-spacing: 0.16em; text-transform: uppercase; }
  .part h2 { margin: 0; font-size: clamp(36px, 5vw, 60px); background: var(--banner); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .scroll { overflow-x: auto; margin: 12px 0 18px; border-radius: 14px; background: var(--glass); box-shadow: inset 0 1px 0 var(--edge), inset 0 0 0 1px var(--line); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 9px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); }
  th { font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-faint); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  td small { display: block; color: var(--ink-faint); font-size: 12px; }
  td > b:first-child { white-space: nowrap; }
  table.dense td { white-space: nowrap; }
  table.dense td small { display: inline; }
  table.templates td:first-child { min-width: 170px; }
  table.templates td:last-child { min-width: 280px; color: var(--ink-dim); }
  code { display: block; font: 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-faint); }
  code.inline { display: inline; font-size: 13px; }
  blockquote { margin: 12px 0 18px; padding: 14px 18px; border-radius: 14px; background: var(--well); font-style: italic; color: var(--ink-dim); max-width: 74ch; }
  .chip { display: inline-block; margin: 0 2px 4px 0; padding: 2px 10px; border-radius: 999px; background: var(--well); box-shadow: inset 0 0 0 1px var(--line); font-size: 12.5px; font-weight: 600; white-space: nowrap; }
  .sw { display: inline-block; width: 14px; height: 14px; margin: 0 4px 0 0; border-radius: 50%; vertical-align: -2px; background: var(--c); box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.5); }
  .bits { margin: 0; padding: 0; list-style: none; }
  .bits li { margin: 0 0 2px; }
  ul.bits { font-size: 14px; }
  section > .bits { margin: 4px 0 14px; padding-left: 4px; }
  .pick { display: inline-flex; align-items: center; gap: 8px; }
  img.mini { width: 36px; height: 36px; border-radius: 8px; background: radial-gradient(circle at 50% 35%, #3a3a4a, #15151d); object-fit: contain; }
  details { margin: 10px 0; border-radius: 14px; background: var(--glass); box-shadow: inset 0 1px 0 var(--edge), inset 0 0 0 1px var(--line); }
  details > summary { padding: 12px 16px; cursor: pointer; font-size: 17px; }
  details > :not(summary) { margin-left: 16px; margin-right: 16px; }
  .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; margin: 12px 0 8px; }
  .item, .starter { margin: 0; padding: 10px; border-radius: 16px; background: var(--glass); box-shadow: inset 0 1px 0 var(--edge), inset 0 0 0 1px var(--line); }
  .item img { display: block; width: 100%; aspect-ratio: 1; border-radius: 11px; object-fit: contain; background: radial-gradient(circle at 50% 32%, #3a3a4a, #15151d 72%); }
  .item figcaption, .starter figcaption { padding: 8px 2px 0; font-size: 13px; line-height: 1.45; }
  .item b, .starter b { display: block; font-size: 14px; }
  .channels, .worn { margin: 6px 0 0; padding: 0; list-style: none; }
  .channels small { color: var(--ink-faint); }
  .cuts, .words, .build { margin: 4px 0 0; color: var(--ink-faint); font-size: 12px; }
  .starters { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 14px; margin: 14px 0; }
  .starter img { display: block; width: 100%; aspect-ratio: 1; border-radius: 12px; object-fit: cover; object-position: 50% 30%; }
  .starter small { display: block; color: var(--ink-dim); }
  .worn li { display: grid; grid-template-columns: 78px 1fr; gap: 6px; align-items: baseline; }
  .worn .slot { color: var(--ink-faint); font-size: 11.5px; }
  footer { margin-top: 80px; font-size: 13px; color: var(--ink-faint); }
  footer code { display: inline; }
  @media (max-width: 640px) { main { padding-top: 32px; } .part { padding: 24px 18px; } .items { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); } }
`

/** The whole page. No date in it, so regenerating an unchanged charter writes the same bytes. */
export function charterDoc(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Character Charter</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;1,600;1,700;1,800&family=Inter:wght@400;500;600;700&display=swap">
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
  ${brandMarks()}
  <p class="kicker">Autobattler</p>
  <h1>The character charter</h1>
  <p class="lede">Every rule a hero is made of, on one page. The engine owns every number. You own everything you see.</p>
  <p class="meta">Written by the code itself (src/docs/charter-doc.ts), so it can't drift from the game. Catalogue v${CATALOG_VERSION}, ${CATALOG.length} skill templates, ${LIBRARY.length} wardrobe items, engine calibration v${ENGINE_CALIBRATION_VERSION}.</p>
  <nav><a href="#making">Making a hero</a><a href="#engine">What the engine owns</a><a href="#yours">What you own</a><a href="#examples">Worked examples</a><a href="#library">The library</a></nav>
</header>
${makingSection()}
<header class="part" id="engine"><span class="label">Part one</span><h2>What the engine owns</h2><p>Every number. The engine decides how a hero fights, and the balance check holds each hero to the same line. Change the role, the size, the points or a skill and the hero goes back through it.</p></header>
${rolesSection()}
${statsSection()}
${kitSection()}
${transformSection()}
${balanceSection()}
<header class="part" id="yours"><span class="label">Part two</span><h2>What you own</h2><p>Everything you see. None of it is a number, so a hero can change its whole look after the balance check without going back through it.</p></header>
${bodySection()}
${wardrobeSection()}
${rungsSection()}
${skillLookSection()}
${formLookSection()}
${fairSection()}
${examplesSection()}
${librarySection()}
<footer>Regenerate with <code>npx tsx scripts/charter-doc.ts</code> after changing a rule. A test fails while this page is out of date. Related pages: the <a href="charter-sheet.html">charter sheet</a>, the <a href="skill-library.html">skill library</a> and the <a href="../forge/likeness.html">likeness sheet</a> for the twenty starters.</footer>
</main>
</body>
</html>
`
}
